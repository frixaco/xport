import { test as base, expect, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPolar } from "@polar-sh/sdk/2026-10";
const live = process.env.E2E_MODE === "live";
const baseURL = process.env.BETTER_AUTH_URL!;
const polar = live
  ? createPolar({ accessToken: process.env.SANDBOX_POLAR_ACCESS_TOKEN!, environment: "sandbox" })
  : null;

export const db = new Pool({ connectionString: process.env.DATABASE_URL });
const database = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || !database.pathname.endsWith("_test"))
  throw new Error("Browser tests require an isolated local *_test database");
export const test = base.extend<{ account: { id: string; token: string }; browserErrors: void }>({
  account: async ({ context }, use) => {
    const id = randomUUID(),
      token = randomUUID();
    const [mailbox, domain] = (process.env.XPORT_TEST_EMAIL || "test@example.test").split("@");
    const email = live
      ? `${mailbox.split("+")[0].slice(0, 35)}+xport-${id.slice(0, 8)}@${domain}`
      : `${id}@example.test`;
    await db.query('INSERT INTO "user" (id,name,email,credit_balance) VALUES ($1,$2,$3,100)', [
      id,
      "Browser Test",
      email,
    ]);
    await db.query(
      "INSERT INTO xport_credit_transactions(operation_key,user_id,amount,type) VALUES ($1,$2,100,'opening')",
      [`polar-opening-balance:v1:${id}`, id],
    );
    await db.query(
      "INSERT INTO session(id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
      [randomUUID(), id, token],
    );
    const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
      .update(token)
      .digest("base64");
    const customer = polar
      ? await polar.customers.create({
          email,
          name: "Xport automated test",
          external_id: id,
          metadata: { xport_test: true },
        })
      : null;
    try {
      await context.addCookies([
        {
          name: "better-auth.session_token",
          value: encodeURIComponent(`${token}.${signature}`),
          url: baseURL,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await use({ id, token });
    } finally {
      if (customer) await polar!.customers.delete(customer.id);
      const mismatch = await db.query(
        'SELECT u.credit_balance, COALESCE(SUM(t.amount),0)::int AS ledger FROM "user" u LEFT JOIN xport_credit_transactions t ON t.user_id=u.id WHERE u.id=$1 GROUP BY u.id',
        [id],
      );
      expect(mismatch.rows[0].credit_balance).toBe(mismatch.rows[0].ledger);
      await db.query("DELETE FROM xport_credit_transactions WHERE user_id=$1", [id]);
      await db.query('DELETE FROM "user" WHERE id=$1', [id]);
    }
  },
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await use();
      expect(errors, "Uncaught browser errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
export async function submit(page: Page, input: string) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await page.getByLabel("X (ex-Twitter) URL or username").fill(input);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
}
export async function currentJob(page: Page) {
  await expect(page).toHaveURL(/jobId=/);
  return new URL(page.url()).searchParams.get("jobId")!;
}
export async function jobRow(id: string) {
  return (await db.query("SELECT * FROM xport_fetch_jobs WHERE id=$1", [id])).rows[0];
}
export async function balance(id: string) {
  return (await db.query('SELECT credit_balance FROM "user" WHERE id=$1', [id])).rows[0]
    .credit_balance as number;
}
export async function download(
  page: Page,
  format: "Markdown" | "JSON" = "Markdown",
  article = false,
) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: article ? "Download" : "Download export", exact: true })
    .click();
  if (!article) await page.getByRole("menuitem", { name: format, exact: true }).click();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return { filename: file.suggestedFilename(), text: Buffer.concat(chunks).toString() };
}
