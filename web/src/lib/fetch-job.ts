import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { fetchJobs, fetchTweets } from "@/db/schema";
import { db } from "@/lib/db";
import { fetchThreadContext, fetchUserLastTweets, XApiError, type XPost } from "@/lib/x-api";
import { ingestCreditsUsage } from "@/lib/billing-access";
import { captureServerEvent, captureServerException } from "@/lib/server-telemetry";

type FetchJobStatus = "queued" | "running" | "completed" | "stopped" | "failed";
export type FetchJobRequestType = "thread" | "user";
const ACTIVE_FETCH_JOB_STATUSES: FetchJobStatus[] = ["queued", "running"];

export type FetchJobRow = typeof fetchJobs.$inferSelect;

function isQueuedOrStaleRunningJobSql(): ReturnType<typeof sql> {
  return sql`(
    ${fetchJobs.status} = 'queued'
    OR (
      ${fetchJobs.status} = 'running'
      AND ${fetchJobs.updatedAt} < now() - interval '5 minutes'
    )
  )`;
}

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
      .orderBy(asc(fetchTweets.seq))
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
      status: sql<FetchJobStatus>`CASE
        WHEN ${isQueuedOrStaleRunningJobSql()}
        THEN 'stopped'
        ELSE ${fetchJobs.status}
      END`,
      runnerId: sql<string | null>`CASE
        WHEN ${isQueuedOrStaleRunningJobSql()}
        THEN null
        ELSE ${fetchJobs.runnerId}
      END`,
      finishedAt: sql<Date | null>`CASE
        WHEN ${isQueuedOrStaleRunningJobSql()}
        THEN now()
        ELSE ${fetchJobs.finishedAt}
      END`,
      updatedAt: new Date(),
    })
    .where(and(eq(fetchJobs.id, jobId), inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES)))
    .returning();

  if (job) {
    if (job.status === "stopped") captureFinishedJob(job);
    return job;
  }

  return getJobStatus(jobId);
}

async function updateJobProgress(
  jobId: string,
  runnerId: string,
  updates: {
    pagesFetched: number;
    rawFetchedTweets: number;
    nextCursor: string | null;
    hasNextPage: boolean;
  },
): Promise<{ storedTweets: number; updated: boolean }> {
  const [storedResult] = await db
    .select({ value: count() })
    .from(fetchTweets)
    .where(eq(fetchTweets.jobId, jobId));
  const storedTweets = storedResult?.value ?? 0;

  const [job] = await db
    .update(fetchJobs)
    .set({
      pagesFetched: updates.pagesFetched,
      rawFetchedTweets: updates.rawFetchedTweets,
      storedTweets,
      nextCursor: updates.nextCursor,
      hasNextPage: updates.hasNextPage,
      updatedAt: new Date(),
    })
    .where(and(eq(fetchJobs.id, jobId), eq(fetchJobs.runnerId, runnerId)))
    .returning({ id: fetchJobs.id });

  return { storedTweets, updated: Boolean(job) };
}

async function updateJobChargedCredits(
  jobId: string,
  runnerId: string,
  chargedCredits: number,
): Promise<boolean> {
  const [job] = await db
    .update(fetchJobs)
    .set({
      chargedCredits,
      updatedAt: new Date(),
    })
    .where(and(eq(fetchJobs.id, jobId), eq(fetchJobs.runnerId, runnerId)))
    .returning({ id: fetchJobs.id });

  return Boolean(job);
}

async function finishJob(
  jobId: string,
  runnerId: string,
  status: "completed" | "stopped" | "failed",
  error?: { code: string; message: string },
): Promise<boolean> {
  const [job] = await db
    .update(fetchJobs)
    .set({
      status: sql<FetchJobStatus>`CASE
        WHEN ${status} = 'completed' AND ${fetchJobs.stopRequested} THEN 'stopped'
        ELSE ${status}
      END`,
      finishedAt: new Date(),
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
      runnerId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(fetchJobs.id, jobId),
        eq(fetchJobs.runnerId, runnerId),
        inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES),
      ),
    )
    .returning({ id: fetchJobs.id });

  if (job) {
    const finishedJob = await getJobStatus(jobId);
    if (finishedJob) captureFinishedJob(finishedJob);
  }

  return Boolean(job);
}

async function claimFetchJob(jobId: string, runnerId: string): Promise<FetchJobRow | null> {
  const [job] = await db
    .update(fetchJobs)
    .set({
      status: "running",
      runnerId,
      startedAt: sql`coalesce(${fetchJobs.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(fetchJobs.id, jobId),
        eq(fetchJobs.stopRequested, false),
        isQueuedOrStaleRunningJobSql(),
      ),
    )
    .returning();

  return job ?? null;
}

async function touchActiveJob(jobId: string, runnerId: string): Promise<boolean> {
  const [job] = await db
    .update(fetchJobs)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(fetchJobs.id, jobId),
        eq(fetchJobs.runnerId, runnerId),
        inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES),
      ),
    )
    .returning({ id: fetchJobs.id });

  return Boolean(job);
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

async function runFetchLoop(jobId: string, authHeaders: Headers): Promise<void> {
  const runnerId = randomUUID();
  const job = await claimFetchJob(jobId, runnerId);
  if (!job) return;

  let cursor = job.nextCursor ?? undefined;
  let pagesFetched = job.pagesFetched;
  let rawFetchedTweets = job.rawFetchedTweets;
  let chargedCredits = job.chargedCredits;
  const seenCursors = new Set<string>();
  const isThread = job.requestType === "thread";

  try {
    while (true) {
      if (await isStopRequested(jobId)) {
        await finishJob(jobId, runnerId, "stopped");
        return;
      }
      if (!(await touchActiveJob(jobId, runnerId))) return;

      if (cursor) {
        if (seenCursors.has(cursor)) {
          const progress = await updateJobProgress(jobId, runnerId, {
            pagesFetched,
            rawFetchedTweets,
            nextCursor: null,
            hasNextPage: false,
          });
          if (!progress.updated) return;
          await finishJob(jobId, runnerId, "completed");
          return;
        }
        seenCursors.add(cursor);
      }

      let tweets: XPost[];
      let hasNextPage: boolean;
      let nextCursor: string | undefined;

      if (isThread) {
        const response = await fetchWithRetry(() =>
          fetchThreadContext(job.inputNormalized, cursor),
        );
        tweets = response.tweets ?? [];
        hasNextPage = response.has_next_page;
        nextCursor = response.next_cursor;
      } else {
        // TODO: support includeReplies toggle
        const response = await fetchWithRetry(() =>
          fetchUserLastTweets(job.inputNormalized, cursor),
        );
        tweets = response.data?.tweets ?? [];
        hasNextPage = response.has_next_page;
        nextCursor = response.next_cursor;
      }

      if (!(await touchActiveJob(jobId, runnerId))) return;

      if (await isStopRequested(jobId)) {
        await finishJob(jobId, runnerId, "stopped");
        return;
      }

      pagesFetched++;
      rawFetchedTweets += tweets.length;

      await insertTweets(jobId, tweets, pagesFetched, isThread ? job.inputNormalized : null);

      const progress = await updateJobProgress(jobId, runnerId, {
        pagesFetched,
        rawFetchedTweets,
        nextCursor: nextCursor ?? null,
        hasNextPage,
      });
      if (!progress.updated) return;

      const requiredCredits = Math.max(1, Math.ceil(progress.storedTweets / 20));
      const delta = requiredCredits - chargedCredits;
      if (delta > 0) {
        const billingRequest = new Request("http://localhost", {
          headers: authHeaders,
        });
        const charged = await ingestCreditsUsage(billingRequest, { credits: delta });
        if (!charged) {
          throw new Error("Could not charge credits for this export.");
        }
        chargedCredits += delta;
        if (!(await updateJobChargedCredits(jobId, runnerId, chargedCredits))) return;
      }

      if (!hasNextPage || !nextCursor || tweets.length === 0) {
        await finishJob(jobId, runnerId, "completed");
        return;
      }

      cursor = nextCursor;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await finishJob(jobId, runnerId, "failed", {
      code: error instanceof XApiError ? "UPSTREAM_ERROR" : "FETCH_JOB_ERROR",
      message,
    });
  }
}

export function startFetchJobInBackground(jobId: string, requestHeaders: Headers): void {
  const authHeaders = new Headers();
  const cookie = requestHeaders.get("cookie");
  if (cookie) authHeaders.set("cookie", cookie);
  const authorization = requestHeaders.get("authorization");
  if (authorization) authHeaders.set("authorization", authorization);

  runFetchLoop(jobId, authHeaders).catch((error: unknown) => {
    console.error(error);
    captureServerException(error, {
      properties: {
        job_id: jobId,
        error_code: "FETCH_JOB_UNHANDLED",
      },
    });
  });
}

function captureFinishedJob(job: FetchJobRow): void {
  const event = getFinishedJobEvent(job.status);
  if (!event) return;

  const properties = {
    job_id: job.id,
    request_type: job.requestType,
    input_normalized: job.inputNormalized,
    status: job.status,
    pages_fetched: job.pagesFetched,
    raw_fetched_tweets: job.rawFetchedTweets,
    stored_tweets: job.storedTweets,
    charged_credits: job.chargedCredits,
    error_code: job.errorCode,
  };

  captureServerEvent(event, {
    distinctId: job.ownerUserId,
    properties,
  });

  if (job.status === "failed") {
    captureServerException(new Error("Fetch job failed"), {
      distinctId: job.ownerUserId,
      properties,
    });
  }
}

function getFinishedJobEvent(status: FetchJobStatus): string | null {
  if (status === "completed") return "fetch job completed";
  if (status === "stopped") return "fetch job stopped";
  if (status === "failed") return "fetch job failed";
  return null;
}
