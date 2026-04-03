import { query } from "@/lib/db";
import { fetchThreadContext, fetchUserLastTweets, XApiError, type XPost } from "@/lib/x-api";
import { ingestCreditsUsage } from "@/lib/api-access";

export type FetchJobStatus = "queued" | "running" | "completed" | "stopped" | "failed";
export type FetchJobRequestType = "thread" | "user";
const ACTIVE_FETCH_JOB_STATUSES = ["queued", "running"] as const;

export interface FetchJobRow {
  id: string;
  owner_user_id: string;
  request_type: FetchJobRequestType;
  input_raw: string;
  input_normalized: string;
  status: FetchJobStatus;
  stop_requested: boolean;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  pages_fetched: number;
  raw_fetched_tweets: number;
  stored_tweets: number;
  charged_credits: number;
  next_cursor: string | null;
  has_next_page: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateFetchJobParams {
  ownerUserId: string;
  requestType: FetchJobRequestType;
  inputRaw: string;
  inputNormalized: string;
}

export async function createFetchJob(params: CreateFetchJobParams): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO xport_fetch_jobs (
      id, owner_user_id, request_type, input_raw, input_normalized,
      status, stop_requested, started_at, expires_at,
      pages_fetched, raw_fetched_tweets, stored_tweets, charged_credits,
      next_cursor, has_next_page
    ) VALUES (
      $1, $2, $3, $4, $5,
      'running', false, now(), now() + interval '1 hour',
      0, 0, 0, 0,
      null, true
    )`,
    [id, params.ownerUserId, params.requestType, params.inputRaw, params.inputNormalized],
  );
  return id;
}

export async function getJobStatus(jobId: string): Promise<FetchJobRow | null> {
  const result = await query<FetchJobRow>(`SELECT * FROM xport_fetch_jobs WHERE id = $1`, [jobId]);
  return result.rows[0] ?? null;
}

interface JobTweetsResult {
  tweets: XPost[];
  mainTweet: XPost | null;
  total: number;
}

export async function getJobTweets(
  jobId: string,
  offset: number,
  limit: number,
): Promise<JobTweetsResult> {
  const [tweetsResult, countResult, mainResult] = await Promise.all([
    query<{ tweet_json: XPost }>(
      `SELECT tweet_json FROM xport_fetch_tweets
       WHERE job_id = $1
       ORDER BY seq DESC
       LIMIT $2 OFFSET $3`,
      [jobId, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT count(*)::text AS count FROM xport_fetch_tweets WHERE job_id = $1`,
      [jobId],
    ),
    query<{ tweet_json: XPost }>(
      `SELECT tweet_json FROM xport_fetch_tweets
       WHERE job_id = $1 AND is_main = true
       LIMIT 1`,
      [jobId],
    ),
  ]);

  return {
    tweets: tweetsResult.rows.map((r) => r.tweet_json),
    mainTweet: mainResult.rows[0]?.tweet_json ?? null,
    total: parseInt(countResult.rows[0]?.count ?? "0", 10),
  };
}

export async function requestJobStop(jobId: string): Promise<FetchJobRow | null> {
  const result = await query<FetchJobRow>(
    `UPDATE xport_fetch_jobs
     SET stop_requested = true, updated_at = now()
     WHERE id = $1 AND status = ANY($2::text[])
     RETURNING *`,
    [jobId, ACTIVE_FETCH_JOB_STATUSES],
  );
  if (result.rows[0]) {
    return result.rows[0];
  }

  return getJobStatus(jobId);
}

async function updateJobProgress(
  jobId: string,
  updates: {
    pagesFetched: number;
    rawFetchedTweets: number;
    nextCursor: string | null;
    hasNextPage: boolean;
  },
): Promise<void> {
  const storedResult = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM xport_fetch_tweets WHERE job_id = $1`,
    [jobId],
  );
  const storedTweets = parseInt(storedResult.rows[0]?.count ?? "0", 10);

  await query(
    `UPDATE xport_fetch_jobs SET
      pages_fetched = $2,
      raw_fetched_tweets = $3,
      stored_tweets = $4,
      next_cursor = $5,
      has_next_page = $6,
      updated_at = now()
    WHERE id = $1`,
    [
      jobId,
      updates.pagesFetched,
      updates.rawFetchedTweets,
      storedTweets,
      updates.nextCursor,
      updates.hasNextPage,
    ],
  );
}

async function updateJobChargedCredits(jobId: string, chargedCredits: number): Promise<void> {
  await query(
    `UPDATE xport_fetch_jobs SET charged_credits = $2, updated_at = now() WHERE id = $1`,
    [jobId, chargedCredits],
  );
}

async function finishJob(
  jobId: string,
  status: "completed" | "stopped" | "failed",
  error?: { code: string; message: string },
): Promise<void> {
  await query(
    `UPDATE xport_fetch_jobs SET
      status = CASE
        WHEN $2 = 'completed' AND stop_requested THEN 'stopped'
        ELSE $2
      END,
      finished_at = now(),
      error_code = $3,
      error_message = $4,
      updated_at = now()
    WHERE id = $1
      AND status = ANY($5::text[])`,
    [jobId, status, error?.code ?? null, error?.message ?? null, ACTIVE_FETCH_JOB_STATUSES],
  );
}

async function insertTweets(
  jobId: string,
  tweets: XPost[],
  page: number,
  mainTweetId: string | null,
): Promise<void> {
  if (tweets.length === 0) return;

  const seqResult = await query<{ max_seq: string | null }>(
    `SELECT max(seq)::text AS max_seq FROM xport_fetch_tweets WHERE job_id = $1`,
    [jobId],
  );
  let seq = parseInt(seqResult.rows[0]?.max_seq ?? "0", 10);

  for (const tweet of tweets) {
    seq++;
    const isMain = page === 1 && mainTweetId !== null && tweet.id === mainTweetId;
    await query(
      `INSERT INTO xport_fetch_tweets (job_id, tweet_id, seq, page, tweet_json, is_main)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_id, tweet_id) DO NOTHING`,
      [jobId, tweet.id, seq, page, JSON.stringify(tweet), isMain],
    );
  }
}

async function isStopRequested(jobId: string): Promise<boolean> {
  const result = await query<{ stop_requested: boolean }>(
    `SELECT stop_requested FROM xport_fetch_jobs WHERE id = $1`,
    [jobId],
  );
  return result.rows[0]?.stop_requested ?? false;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof XApiError) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  const delays = [500, 1500];
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastError;
}

export async function runFetchLoop(
  jobId: string,
  requestType: FetchJobRequestType,
  inputNormalized: string,
  authHeaders: Headers,
): Promise<void> {
  let cursor: string | undefined;
  let pagesFetched = 0;
  let rawFetchedTweets = 0;
  let chargedCredits = 0;
  const seenCursors = new Set<string>();
  const isThread = requestType === "thread";

  try {
    while (true) {
      if (await isStopRequested(jobId)) {
        await finishJob(jobId, "stopped");
        return;
      }

      if (cursor) {
        if (seenCursors.has(cursor)) {
          await updateJobProgress(jobId, {
            pagesFetched,
            rawFetchedTweets,
            nextCursor: null,
            hasNextPage: false,
          });
          await finishJob(jobId, "completed");
          return;
        }
        seenCursors.add(cursor);
      }

      let tweets: XPost[];
      let hasNextPage: boolean;
      let nextCursor: string | undefined;

      if (isThread) {
        const response = await fetchWithRetry(() => fetchThreadContext(inputNormalized, cursor));
        tweets = response.tweets ?? [];
        hasNextPage = response.has_next_page;
        nextCursor = response.next_cursor;
      } else {
        // TODO: support includeReplies toggle
        const response = await fetchWithRetry(() => fetchUserLastTweets(inputNormalized, cursor));
        tweets = response.data?.tweets ?? [];
        hasNextPage = response.has_next_page;
        nextCursor = response.next_cursor;
      }

      pagesFetched++;
      rawFetchedTweets += tweets.length;

      await insertTweets(jobId, tweets, pagesFetched, isThread ? inputNormalized : null);

      await updateJobProgress(jobId, {
        pagesFetched,
        rawFetchedTweets,
        nextCursor: nextCursor ?? null,
        hasNextPage,
      });

      const requiredCredits = Math.max(1, Math.ceil(rawFetchedTweets / 20));
      const delta = requiredCredits - chargedCredits;
      if (delta > 0) {
        const billingRequest = new Request("http://localhost", {
          headers: authHeaders,
        });
        await ingestCreditsUsage(billingRequest, { credits: delta });
        chargedCredits = requiredCredits;
        await updateJobChargedCredits(jobId, chargedCredits);
      }

      if (!hasNextPage || !nextCursor || tweets.length === 0) {
        await finishJob(jobId, "completed");
        return;
      }

      cursor = nextCursor;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await finishJob(jobId, "failed", {
      code: "UPSTREAM_ERROR",
      message,
    });
  }
}
