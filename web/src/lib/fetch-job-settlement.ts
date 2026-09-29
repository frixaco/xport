import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchJobs, fetchTweets } from "../db/schema.ts";
import { calculateTweetListCredits, TWEETS_PER_CREDIT } from "../../../core/src/credits.ts";
import { db } from "./db.ts";
import { assertBillingEnabled, lockCreditBalance, recordCreditChange } from "./credit-ledger.ts";
import type { XPost } from "./x-api.ts";

export async function settleFetchPage(input: {
  jobId: string;
  runnerId: string;
  cursor: string | null;
  tweets: XPost[];
  rawCount: number;
  nextCursor: string | null;
  hasNextPage: boolean;
}) {
  assertBillingEnabled();
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(fetchJobs)
      .where(eq(fetchJobs.id, input.jobId))
      .for("update");
    if (
      !job ||
      job.runnerId !== input.runnerId ||
      job.status !== "running" ||
      job.nextCursor !== input.cursor
    )
      return null;
    if (job.stopRequested) {
      const [stopped] = await tx
        .update(fetchJobs)
        .set({
          status: "stopped",
          runnerId: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: sql`now() + interval '1 hour'`,
        })
        .where(eq(fetchJobs.id, job.id))
        .returning();
      return stopped;
    }
    const balance = await lockCreditBalance(tx, job.ownerUserId);
    const stored = job.storedTweets;
    const existing = input.tweets.length
      ? await tx
          .select({ id: fetchTweets.tweetId })
          .from(fetchTweets)
          .where(
            and(
              eq(fetchTweets.jobId, job.id),
              inArray(
                fetchTweets.tweetId,
                input.tweets.map((tweet) => tweet.id),
              ),
            ),
          )
      : [];
    const seen = new Set(existing.map((tweet) => tweet.id));
    const unique = input.tweets.filter((tweet) => {
      if (seen.has(tweet.id)) return false;
      seen.add(tweet.id);
      return true;
    });
    const capacity = Math.max(0, (job.chargedCredits + balance) * TWEETS_PER_CREDIT - stored);
    const affordable = unique.slice(0, capacity);
    const required = calculateTweetListCredits(stored + affordable.length);
    const insufficient =
      affordable.length < unique.length || required > job.chargedCredits + balance;
    const delta =
      required > job.chargedCredits + balance ? 0 : Math.max(0, required - job.chargedCredits);
    if (affordable.length) {
      await tx.insert(fetchTweets).values(
        affordable.map((tweet, index) => ({
          jobId: job.id,
          tweetId: tweet.id,
          seq: stored + index + 1,
          page: job.pagesFetched + 1,
          tweetJson: tweet,
          isMain: job.requestType === "thread" && tweet.id === job.inputNormalized,
        })),
      );
    }
    if (delta > 0)
      await recordCreditChange(tx, {
        userId: job.ownerUserId,
        operationKey: `job:${job.id}:page:${job.pagesFetched + 1}`,
        amount: -delta,
        type: "usage",
        report: true,
      });
    const completed = !input.hasNextPage || !input.nextCursor || input.rawCount === 0;
    const [settled] = await tx
      .update(fetchJobs)
      .set({
        pagesFetched: job.pagesFetched + 1,
        rawFetchedTweets: job.rawFetchedTweets + input.rawCount,
        storedTweets: stored + affordable.length,
        chargedCredits: job.chargedCredits + delta,
        nextCursor: completed ? null : input.nextCursor,
        hasNextPage: !completed,
        updatedAt: new Date(),
        ...(insufficient || completed
          ? {
              status: insufficient ? ("stopped" as const) : ("completed" as const),
              runnerId: null,
              errorCode: insufficient ? "INSUFFICIENT_CREDITS" : null,
              errorMessage: insufficient
                ? "Insufficient credits. Paid results remain available."
                : null,
              finishedAt: new Date(),
              expiresAt: sql`now() + interval '1 hour'`,
            }
          : {}),
      })
      .where(eq(fetchJobs.id, job.id))
      .returning();
    return settled;
  });
}
