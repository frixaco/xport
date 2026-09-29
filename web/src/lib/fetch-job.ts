import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { fetchJobs, fetchTweets } from "@/db/schema";
import { db } from "@/lib/db";
import {
  fetchThreadContext,
  fetchUserInfo,
  fetchUserTimeline,
  XApiError,
  type XPost,
} from "@/lib/x-api";
import { assertBillingEnabled } from "./credit-ledger.ts";
import { settleFetchPage } from "./fetch-job-settlement.ts";
import { captureServerEvent, captureServerException } from "@/lib/server-telemetry";

type FetchJobStatus = "queued" | "running" | "completed" | "stopped" | "failed";
export type FetchJobRequestType = "thread" | "user" | "timeline" | "replies";
const ACTIVE_FETCH_JOB_STATUSES: FetchJobStatus[] = ["queued", "running"];
const TERMINAL_FETCH_JOB_STATUSES: FetchJobStatus[] = ["completed", "stopped", "failed"];
const MAX_ACTIVE_JOBS_PER_USER = 2;
const MAX_FETCH_PAGES = 100;
const MAX_FETCH_DURATION_MS = 15 * 60 * 1000;

export type FetchJobRow = typeof fetchJobs.$inferSelect;

export class FetchJobLimitError extends Error {
  constructor() {
    super("Too many exports are already in progress.");
    this.name = "FetchJobLimitError";
  }
}

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
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.ownerUserId}))`);
    await tx
      .delete(fetchJobs)
      .where(
        and(
          inArray(fetchJobs.status, TERMINAL_FETCH_JOB_STATUSES),
          sql`${fetchJobs.expiresAt} < now()`,
        ),
      );

    const [activeJobs] = await tx
      .select({ value: count() })
      .from(fetchJobs)
      .where(
        and(
          eq(fetchJobs.ownerUserId, params.ownerUserId),
          inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES),
        ),
      );
    if ((activeJobs?.value ?? 0) >= MAX_ACTIVE_JOBS_PER_USER) {
      throw new FetchJobLimitError();
    }

    const [job] = await tx
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
  });
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
      expiresAt: sql<Date | null>`CASE
        WHEN ${isQueuedOrStaleRunningJobSql()}
        THEN now() + interval '1 hour'
        ELSE ${fetchJobs.expiresAt}
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
      expiresAt: sql`now() + interval '1 hour'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(fetchJobs.id, jobId),
        eq(fetchJobs.runnerId, runnerId),
        inArray(fetchJobs.status, ACTIVE_FETCH_JOB_STATUSES),
      ),
    )
    .returning();

  if (job) captureFinishedJob(job);

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

async function runFetchLoop(jobId: string): Promise<void> {
  assertBillingEnabled();
  const runnerId = randomUUID();
  const job = await claimFetchJob(jobId, runnerId);
  if (!job) return;

  let cursor = job.nextCursor ?? undefined;
  let pagesFetched = job.pagesFetched;
  const seenCursors = new Set<string>();
  const isThread = job.requestType === "thread";
  const deadline = Date.now() + MAX_FETCH_DURATION_MS;

  try {
    let userId: string | undefined;
    if (!isThread) {
      const userInfo = await fetchWithRetry(() => fetchUserInfo(job.inputNormalized));
      userId = userInfo.data.id;
    }

    while (true) {
      if (pagesFetched >= MAX_FETCH_PAGES || Date.now() >= deadline) {
        await finishJob(jobId, runnerId, "failed", {
          code: "FETCH_LIMIT_REACHED",
          message: "Fetch safety limit reached.",
        });
        return;
      }

      if (await isStopRequested(jobId)) {
        await finishJob(jobId, runnerId, "stopped");
        return;
      }
      if (!(await touchActiveJob(jobId, runnerId))) return;

      if (cursor) {
        if (seenCursors.has(cursor)) {
          await db
            .update(fetchJobs)
            .set({ nextCursor: null, hasNextPage: false })
            .where(and(eq(fetchJobs.id, jobId), eq(fetchJobs.runnerId, runnerId)));
          await finishJob(jobId, runnerId, "completed");
          return;
        }
        seenCursors.add(cursor);
      }

      let tweets: XPost[];
      let rawPageTweetCount: number;
      let hasNextPage: boolean;
      let nextCursor: string | undefined;

      if (isThread) {
        const response = await fetchWithRetry(() =>
          fetchThreadContext(job.inputNormalized, cursor),
        );
        tweets = response.tweets ?? [];
        rawPageTweetCount = tweets.length;
        hasNextPage = response.has_next_page;
        nextCursor = response.next_cursor;
      } else {
        const response = await fetchWithRetry(() =>
          fetchUserTimeline(userId!, cursor, {
            includeReplies: job.requestType !== "user",
          }),
        );
        const responseTweets = response.data?.tweets ?? [];
        rawPageTweetCount = responseTweets.length;
        if (job.requestType === "replies") {
          tweets = responseTweets.filter((tweet) => {
            return (
              tweet.author.userName.toLowerCase() === job.inputNormalized.toLowerCase() &&
              Boolean(tweet.isReply || tweet.inReplyToId)
            );
          });
        } else if (job.requestType === "user") {
          tweets = responseTweets.filter((tweet) => !(tweet.isReply || tweet.inReplyToId));
        } else {
          tweets = responseTweets;
        }
        hasNextPage = response.has_next_page;
        nextCursor = response.next_cursor;
      }

      const settled = await settleFetchPage({
        jobId,
        runnerId,
        cursor: cursor ?? null,
        tweets,
        rawCount: rawPageTweetCount,
        nextCursor: nextCursor ?? null,
        hasNextPage,
      });
      if (!settled) return;
      if (settled.status !== "running") {
        captureFinishedJob(settled);
        return;
      }
      pagesFetched = settled.pagesFetched;

      cursor = nextCursor;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Fetch job failed", { jobId, error });
    captureServerException(error, {
      distinctId: job.ownerUserId,
      properties: {
        job_id: jobId,
        request_type: job.requestType,
        error_code: error instanceof XApiError ? "UPSTREAM_ERROR" : "FETCH_JOB_ERROR",
      },
    });
    await finishJob(jobId, runnerId, "failed", {
      code: error instanceof XApiError ? "UPSTREAM_ERROR" : "FETCH_JOB_ERROR",
      message,
    });
  }
}

export function startFetchJobInBackground(jobId: string): void {
  runFetchLoop(jobId).catch((error: unknown) => {
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
}

function getFinishedJobEvent(status: FetchJobStatus): string | null {
  if (status === "completed") return "fetch job completed";
  if (status === "stopped") return "fetch job stopped";
  if (status === "failed") return "fetch job failed";
  return null;
}
