import { eq, or } from "drizzle-orm";
import { user } from "../src/db/schema.ts";
import { db } from "../src/lib/db.ts";
import { assertBillingEnabled, recordCreditChange } from "../src/lib/credit-ledger.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const [identifier, amountInput, reason, flag, key] = args;
const amount = Number(amountInput);
try {
  assertBillingEnabled();
  if (
    args.length !== 5 ||
    !identifier ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !reason ||
    flag !== "--key" ||
    !key
  ) {
    throw new Error(
      'Usage: pnpm credits:grant <email-or-user-id> <credits> "<reason>" --key <stable-operation-key>',
    );
  }
  const matches = await db
    .select({ id: user.id })
    .from(user)
    .where(or(eq(user.id, identifier), eq(user.email, identifier)));
  if (matches.length !== 1) throw new Error("Expected exactly one local user.");
  const entry = await db.transaction((tx) =>
    recordCreditChange(tx, {
      userId: matches[0].id,
      amount,
      operationKey: `manual:${key}`,
      type: "manual",
      metadata: { reason },
      report: true,
    }),
  );
  console.log(
    JSON.stringify({
      operationKey: entry.operationKey,
      userId: entry.userId,
      credits: entry.amount,
    }),
  );
} finally {
  await db.$client.end();
}
