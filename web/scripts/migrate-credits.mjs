import { readFile, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { creditTransactions, fetchJobs, user } from "../src/db/schema.ts";
import { db } from "../src/lib/db.ts";
import { recordCreditChange } from "../src/lib/credit-ledger.ts";
import { polarClient } from "../src/lib/polar.ts";
import { extractCreditsBalance } from "../../core/src/credits.ts";
import { creditProducts } from "../src/lib/billing-products.ts";

const [mode, path] = process.argv.slice(2).filter((arg) => arg !== "--");
try {
  if (
    !path ||
    !["snapshot", "import"].includes(mode) ||
    process.env.BILLING_MAINTENANCE !== "true"
  ) {
    throw new Error(
      "Set BILLING_MAINTENANCE=true; usage: pnpm credits:migrate <snapshot|import> <reviewed-file.json>",
    );
  }
  const active = await db
    .select({ id: fetchJobs.id })
    .from(fetchJobs)
    .where(inArray(fetchJobs.status, ["running", "queued"]));
  if (active.length) throw new Error("Drain or stop all jobs before taking a billing snapshot.");
  const users = await db.select({ id: user.id }).from(user);
  if (mode === "snapshot") {
    const rows = [];
    for (const account of users) {
      // Resolve by the durable local user ID, never guess between customers by email.
      const state = await polarClient.customers.getStateExternal({ externalId: account.id });
      const includedOrderIds = [];
      for await (const page of await polarClient.orders.list({
        externalCustomerId: account.id,
        limit: 100,
      })) {
        for (const order of page.result.items) {
          if (
            order.paid &&
            creditProducts().some((product) => product.productId === order.productId)
          )
            includedOrderIds.push(order.id);
        }
      }
      rows.push({
        userId: account.id,
        polarCustomerId: state.id,
        originalBalance: extractCreditsBalance(state),
        includedOrderIds,
        confirmed: false,
      });
    }
    await writeFile(
      path,
      JSON.stringify({ createdAt: new Date().toISOString(), users: rows }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "Snapshot saved. Reconcile customer mappings, settled purchases, and included order IDs; mark each row confirmed before import.",
    );
  } else {
    const snapshot = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(snapshot.users) || snapshot.users.length !== users.length)
      throw new Error("Snapshot must cover every local user exactly once.");
    const ids = new Set(users.map((account) => account.id));
    const customerIds = new Set();
    const orderIds = new Set();
    for (const row of snapshot.users) {
      if (
        !ids.delete(row.userId) ||
        row.confirmed !== true ||
        !Number.isSafeInteger(row.originalBalance) ||
        !Array.isArray(row.includedOrderIds) ||
        row.includedOrderIds.some((id) => typeof id !== "string") ||
        !(typeof row.polarCustomerId === "string" || row.polarCustomerId === null)
      ) {
        throw new Error("Invalid or unconfirmed snapshot row.");
      }
      if (row.polarCustomerId !== null) {
        if (customerIds.has(row.polarCustomerId))
          throw new Error("A Polar customer cannot fund two local opening balances.");
        customerIds.add(row.polarCustomerId);
      }
      for (const orderId of row.includedOrderIds) {
        if (orderIds.has(orderId))
          throw new Error("A purchase cannot be included in two opening balances.");
        orderIds.add(orderId);
      }
    }
    await db.transaction(async (tx) => {
      for (const row of snapshot.users) {
        const entries = await tx
          .select()
          .from(creditTransactions)
          .where(eq(creditTransactions.userId, row.userId));
        const key = `polar-opening-balance:v1:${row.userId}`;
        if (entries.some((entry) => entry.operationKey !== key))
          throw new Error(
            "Local spending/grants already exist; do not import a second opening balance.",
          );
        await recordCreditChange(tx, {
          userId: row.userId,
          operationKey: key,
          amount: Math.max(0, row.originalBalance),
          type: "opening",
          metadata: {
            originalBalance: row.originalBalance,
            polarCustomerId: row.polarCustomerId,
            includedOrderIds: row.includedOrderIds,
          },
        });
      }
    });
    console.log(`Imported ${snapshot.users.length} opening balances; no Polar events queued.`);
  }
} finally {
  await db.$client.end();
}
