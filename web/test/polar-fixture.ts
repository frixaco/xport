import { createHmac, randomUUID } from "node:crypto";
export function paidOrder(id: string, productId = "product-test", orderId = randomUUID()) {
  const webhookId = randomUUID(),
    timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    type: "order.paid",
    timestamp: new Date().toISOString(),
    data: {
      id: orderId,
      created_at: new Date().toISOString(),
      modified_at: null,
      status: "paid",
      paid: true,
      subtotal_amount: 100,
      discount_amount: 0,
      net_amount: 100,
      tax_amount: 0,
      total_amount: 100,
      applied_balance_amount: 0,
      due_amount: 0,
      refunded_amount: 0,
      refunded_tax_amount: 0,
      currency: "usd",
      billing_reason: "purchase",
      billing_name: null,
      billing_address: null,
      invoice_number: "TEST-1",
      is_invoice_generated: false,
      receipt_number: null,
      customer_id: randomUUID(),
      product_id: productId,
      discount_id: null,
      subscription_id: null,
      checkout_id: null,
      metadata: {},
      platform_fee_amount: 0,
      platform_fee_currency: null,
      product: null,
      discount: null,
      subscription: null,
      items: [],
      description: "Test credits",
      refundable_amount: 100,
      refundable_tax_amount: 0,
      customer: {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        modified_at: null,
        metadata: {},
        external_id: id,
        email: `${id}@example.test`,
        email_verified: true,
        type: "individual",
        name: "Test",
        billing_address: null,
        tax_id: null,
        organization_id: randomUUID(),
        deleted_at: null,
        avatar_url: "https://example.test/avatar",
      },
    },
  });
  const signature = createHmac("sha256", "local-test-only")
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest("base64");
  const webhookHeaders = {
    "Content-Type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };

  return { body, headers: webhookHeaders };
}
