import { eq } from "drizzle-orm";
import { creditTransactions } from "../db/schema.ts";
import { db } from "./db.ts";
import {
  BillingAccessError,
  lockCreditBalance,
  recordCreditChange,
  type CreditTransaction,
} from "./credit-ledger.ts";

export interface DirectResult {
  payload: object;
  credits: number;
  tweetCount?: number;
}

export async function getDirectResult(
  operationKey: string,
  userId: string,
  fingerprint: string,
  connection: CreditTransaction | typeof db = db,
): Promise<DirectResult | null> {
  const [entry] = await connection
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.operationKey, operationKey));
  if (!entry) return null;
  if (
    entry.userId !== userId ||
    entry.type !== "usage" ||
    entry.metadata.fingerprint !== fingerprint ||
    !entry.metadata.result
  ) {
    throw new BillingAccessError(
      "Operation key already used for another request.",
      409,
      "IDEMPOTENCY_CONFLICT",
    );
  }
  return entry.metadata.result as unknown as DirectResult;
}

export async function settleDirectResult(
  operationKey: string,
  userId: string,
  fingerprint: string,
  result: DirectResult,
): Promise<DirectResult> {
  return db.transaction(async (tx) => {
    await lockCreditBalance(tx, userId);
    const existing = await getDirectResult(operationKey, userId, fingerprint, tx);
    if (existing) return existing;
    await recordCreditChange(tx, {
      operationKey,
      userId,
      amount: -result.credits,
      type: "usage",
      report: true,
      // ponytail: retain paid responses indefinitely for exact retries; add expiry/rejection if storage becomes material.
      metadata: { fingerprint, result },
    });
    return result;
  });
}
