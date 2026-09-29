import type { WebhookOrderPaidPayload } from "@polar-sh/sdk/models/components/webhookorderpaidpayload";
import { eq } from "drizzle-orm";
import { creditTransactions } from "../db/schema.ts";
import { db } from "./db.ts";
import { assertBillingEnabled, lockCreditBalance, recordCreditChange } from "./credit-ledger.ts";
import { creditProducts } from "./billing-products.ts";

export async function grantPurchaseCredits({
  data: order,
}: WebhookOrderPaidPayload): Promise<void> {
  assertBillingEnabled();
  const product = creditProducts().find(
    (item) => item.productId && item.productId === order.productId,
  );
  if (!product)
    throw new Error(
      "Unknown credit product; configure its credit amount before replaying this order.",
    );
  const userId = order.customer.externalId;
  if (!order.paid || !userId) throw new Error("Paid order must identify an Xport user.");
  await db.transaction(async (tx) => {
    await lockCreditBalance(tx, userId);
    const [opening] = await tx
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.operationKey, `polar-opening-balance:v1:${userId}`));
    const importedOrders = opening?.metadata.includedOrderIds;
    if (Array.isArray(importedOrders) && importedOrders.includes(order.id)) return;
    await recordCreditChange(tx, {
      userId,
      operationKey: `purchase:${order.id}`,
      amount: product.credits,
      type: "purchase",
      metadata: { productId: order.productId },
    });
  });
}
