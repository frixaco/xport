import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { fetchJobs, fetchTweets } from "@/db/schema";
import { db } from "@/lib/db";
import { fetchThreadContext, fetchUserLastTweets, XApiError, type XPost } from "@/lib/x-api";
import { ingestCreditsUsage } from "@/lib/billing-access";

type FetchJobStatus = "queued" | "running" | "completed" | "stopped" | "failed";
export type FetchJobRequestType = "thread" | "user";
const ACTIVE_FETCH_JOB_STATUSES: FetchJobStatus[] = ["queued", "running"];

export type FetchJobRow = typeof fetchJobs.$inferSelect;

interface CreateFetchJobParams {
  ownerUserId: string;
  requestType: FetchJobRequestType;
  inputRaw: string;
  inputNormalized: string;
}

export async function createFetchJob(params: CreateFetchJobParams): Promise<string> {
  const [job] = await db
    .insert(fetchJobs)
    .values({
      ownerUserId: params.ownerUserId,
      requestType: params.requestType,
      inputRaw: params.inputRaw,
      inputNormalized: params.inputNormalized,
      status: "running",
      startedAt: new Date(),
      expiresAt: sql`now() + interval '1 hour'`,
    })
    .returning({ id: fetchJobs.id });

  return job.id;
}

export async function getJobStatus(jobId: string): Promise<FetchJobRow | null> {
  const [job] = await db.select().from(fetchJobs).where(eq(fetchJobs.id, jobId)).limit(1);
  return job ?? null;
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
  const [tweetRows, countRows, mainRows] = await Promise.all([
    db
      .select({ tweetJson: fetchTweets.tweetJson })
      .from(fetchTweets)
      .where(eq(fetchTweets.jobId, jobId))
      .orderBy(desc(fetchTweets.seq))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(fetchTweets).where(eq(fetchTweets.jobId, jobId)),
    db
      .select({ tweetJson: fetchTweets.tweetJson })
      .from(fetchTweets)
      .where(and(eq(fetchTweets.jobId, jobId), eq(fetchTweets.isMain, true)))
      .limit(1),
  ]);

  return {
    tweets: tweetRows.map((row) => row.tweetJson),
    mainTweet: mainRows[0]?.tweetJson ?? null,
    total: countRows[0]?.value ?? 0,
  };
}

export async function requestJobStop(jobId: string): Promise<FetchJobRow | null> {
  const [job] = await db
    .update(fetchJobs)
    .set({
      stopRequested: true,
      updatedAt: new Date(),
    })
    .where(and(eq(fetchJobs.id, jobId), inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES)))
    .returning();

  if (job) {
    return job;
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
  const [storedResult] = await db
    .select({ value: count() })
    .from(fetchTweets)
    .where(eq(fetchTweets.jobId, jobId));
  const storedTweets = storedResult?.value ?? 0;

  await db
    .update(fetchJobs)
    .set({
      pagesFetched: updates.pagesFetched,
      rawFetchedTweets: updates.rawFetchedTweets,
      storedTweets,
      nextCursor: updates.nextCursor,
      hasNextPage: updates.hasNextPage,
      updatedAt: new Date(),
    })
    .where(eq(fetchJobs.id, jobId));
}

async function updateJobChargedCredits(jobId: string, chargedCredits: number): Promise<void> {
  await db
    .update(fetchJobs)
    .set({
      chargedCredits,
      updatedAt: new Date(),
    })
    .where(eq(fetchJobs.id, jobId));
}

async function finishJob(
  jobId: string,
  status: "completed" | "stopped" | "failed",
  error?: { code: string; message: string },
): Promise<void> {
  await db
    .update(fetchJobs)
    .set({
      status: sql<FetchJobStatus>`CASE
        WHEN ${status} = 'completed' AND ${fetchJobs.stopRequested} THEN 'stopped'
        ELSE ${status}
      END`,
      finishedAt: new Date(),
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(fetchJobs.id, jobId), inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES)));
}

async function insertTweets(
  jobId: string,
  tweets: XPost[],
  page: number,
  mainTweetId: string | null,
): Promise<void> {
  if (tweets.length === 0) return;

  const [seqResult] = await db
    .select({ maxSeq: sql<number | null>`max(${fetchTweets.seq})` })
    .from(fetchTweets)
    .where(eq(fetchTweets.jobId, jobId));
  let seq = seqResult?.maxSeq ?? 0;

  await db
    .insert(fetchTweets)
    .values(
      tweets.map((tweet) => {
        seq++;
        return {
          jobId,
          tweetId: tweet.id,
          seq,
          page,
          tweetJson: tweet,
          isMain: page === 1 && mainTweetId !== null && tweet.id === mainTweetId,
        };
      }),
    )
    .onConflictDoNothing({ target: [fetchTweets.jobId, fetchTweets.tweetId] });
}

async function isStopRequested(jobId: string): Promise<boolean> {
  const [job] = await db
    .select({ stopRequested: fetchJobs.stopRequested })
    .from(fetchJobs)
    .where(eq(fetchJobs.id, jobId))
    .limit(1);
  return job?.stopRequested ?? false;
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
