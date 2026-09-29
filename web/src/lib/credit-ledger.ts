import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import { creditTransactions, user } from "../db/schema.ts";
import { db } from "./db.ts";

export type CreditTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class BillingAccessError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "BillingAccessError";
  }
}

export function assertBillingEnabled(): void {
  if (process.env.BILLING_MAINTENANCE === "true") {
    throw new BillingAccessError(
      "Billing maintenance in progress. Please try again shortly.",
      503,
      "BILLING_MAINTENANCE",
    );
  }
}

export async function getCreditBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: user.creditBalance })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) throw new BillingAccessError("Account not found.", 401, "UNAUTHORIZED");
  return row.balance;
}

export async function lockCreditBalance(tx: CreditTransaction, userId: string): Promise<number> {
  const [row] = await tx
    .select({ balance: user.creditBalance })
    .from(user)
    .where(eq(user.id, userId))
    .for("update");
  if (!row) throw new BillingAccessError("Account not found.", 401, "UNAUTHORIZED");
  return row.balance;
}

export async function recordCreditChange(
  tx: CreditTransaction,
  input: {
    userId: string;
    operationKey: string;
    amount: number;
    type: "usage" | "signup" | "purchase" | "manual" | "opening";
    metadata?: Record<string, unknown>;
    report?: boolean;
  },
) {
  const { userId, operationKey, amount, type, metadata = {}, report = false } = input;
  if (
    !Number.isSafeInteger(amount) ||
    Math.abs(amount) > 2_147_483_647 ||
    (type === "usage" ? amount >= 0 : type === "opening" ? amount < 0 : amount <= 0) ||
    !operationKey ||
    operationKey.length > 512
  ) {
    throw new BillingAccessError("Invalid credit operation.", 400, "INVALID_CREDIT_OPERATION");
  }
  const balance = await lockCreditBalance(tx, userId);
  const [existing] = await tx
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.operationKey, operationKey));
  if (existing) {
    if (
      existing.userId !== userId ||
      existing.amount !== amount ||
      existing.type !== type ||
      !isDeepStrictEqual(existing.metadata, metadata)
    ) {
      throw new BillingAccessError(
        "Operation key already used for another request.",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
    }
    return existing;
  }
  if (balance + amount < 0) {
    throw new BillingAccessError("Insufficient credits.", 402, "INSUFFICIENT_CREDITS");
  }
  const [entry] = await tx
    .insert(creditTransactions)
    .values({
      operationKey,
      userId,
      amount,
      type,
      metadata,
      polarPayload: report
        ? {
            name: "usage",
            externalCustomerId: userId,
            externalId: operationKey,
            metadata: { credits: -amount },
          }
        : null,
    })
    .returning();
  await tx
    .update(user)
    .set({ creditBalance: sql`${user.creditBalance} + ${amount}` })
    .where(eq(user.id, userId));
  return entry;
}

export async function grantSignupCredits(userId: string): Promise<void> {
  assertBillingEnabled();
  await db.transaction(async (tx) => {
    // Imported balances already include any historical signup grant.
    await lockCreditBalance(tx, userId);
    const [opening] = await tx
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.operationKey, `polar-opening-balance:v1:${userId}`));
    if (opening) return;
    await recordCreditChange(tx, {
      userId,
      operationKey: `signup-credit:v1:${userId}`,
      amount: 50,
      type: "signup",
      report: true,
    });
  });
}
