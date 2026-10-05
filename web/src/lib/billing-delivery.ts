import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { creditTransactions } from "../db/schema.ts";
import { db } from "./db.ts";
import { ingestEvents } from "@polar-sh/sdk/2026-10/services/events";
import { polarClient } from "./polar.ts";

type Payload = NonNullable<typeof creditTransactions.$inferSelect.polarPayload>;

export async function deliverCreditReports(
  send: (payload: Payload) => Promise<void> = async (payload) => {
    const result = await ingestEvents(polarClient)(
      {
        events: [
          {
            name: payload.name,
            external_id: payload.externalId,
            external_customer_id: payload.externalCustomerId,
            metadata: payload.metadata,
          },
        ],
      },
      { timeout: 30 },
    );
    if (result.inserted + (result.duplicates ?? 0) !== 1)
      throw new Error("Polar did not acknowledge the usage event.");
  },
): Promise<number> {
  if (process.env.BILLING_MAINTENANCE === "true") return 0;
  let delivered = 0;
  for (let i = 0; i < 100; i++) {
    const entry = await db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(creditTransactions)
        .where(
          and(
            isNotNull(creditTransactions.polarPayload),
            isNull(creditTransactions.polarDeliveredAt),
            lte(creditTransactions.polarNextAttemptAt, new Date()),
          ),
        )
        .orderBy(creditTransactions.polarNextAttemptAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!pending) return null;
      const [claimed] = await tx
        .update(creditTransactions)
        .set({
          polarAttempts: pending.polarAttempts + 1,
          // A crashed delivery becomes eligible again without holding a lock over the network.
          polarNextAttemptAt: sql`now() + interval '5 minutes'`,
        })
        .where(eq(creditTransactions.operationKey, pending.operationKey))
        .returning();
      return claimed;
    });
    if (!entry) break;
    const owned = and(
      eq(creditTransactions.operationKey, entry.operationKey),
      eq(creditTransactions.polarAttempts, entry.polarAttempts),
    );
    try {
      await send(entry.polarPayload!);
      await db
        .update(creditTransactions)
        .set({ polarDeliveredAt: new Date(), polarLastError: null })
        .where(owned);
      delivered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Polar delivery failed";
      await db
        .update(creditTransactions)
        .set({
          polarLastError: message.slice(0, 1000),
          polarNextAttemptAt: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** Math.min(entry.polarAttempts - 1, 6)) * 1000,
          ),
        })
        .where(owned);
      console.error("Polar credit report failed", { operationKey: entry.operationKey, message });
    }
  }
  return delivered;
}
