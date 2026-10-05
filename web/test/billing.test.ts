import { paidOrder } from "./polar-fixture.ts";
import { getDownloadPayload } from "../../core/src/copy-formats.ts";
import { buildFetchJobResult } from "../../core/src/fetch-job-result.ts";
import { normalizeTweetCards } from "../../core/src/tweet-card.ts";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "../src/lib/db.ts";
import { creditTransactions, fetchJobs, fetchTweets, session, user } from "../src/db/schema.ts";
import {
  getCreditBalance,
  grantSignupCredits,
  recordCreditChange,
} from "../src/lib/credit-ledger.ts";
import { settleFetchPage } from "../src/lib/fetch-job-settlement.ts";
import { deliverCreditReports } from "../src/lib/billing-delivery.ts";
import { grantPurchaseCredits } from "../src/lib/billing-grants.ts";
import { settleDirectResult } from "../src/lib/direct-billing.ts";
import type { XPost } from "../src/lib/x-api.ts";
import type { webhooks } from "@polar-sh/sdk/2026-10";

const database = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname.endsWith("_test"),
  "Use a dedicated local *_test database.",
);
const users: string[] = [];
async function account(balance: number) {
  const id = randomUUID();
  await db.insert(user).values({ id, name: "Billing test", email: `${id}@example.test` });
  users.push(id);
  await db.transaction((tx) =>
    recordCreditChange(tx, {
      userId: id,
      operationKey: `opening:${id}`,
      amount: balance,
      type: "opening",
    }),
  );
  return id;
}
function tweets(count: number, offset = 0): XPost[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(offset + i + 1),
    text: `Post ${offset + i + 1}`,
    url: `https://x.com/example/status/${offset + i + 1}`,
    createdAt: "2026-09-29T00:00:00Z",
    author: { id: "author", userName: "example", name: "Example" },
  }));
}
async function job(userId: string) {
  const [row] = await db
    .insert(fetchJobs)
    .values({
      ownerUserId: userId,
      requestType: "replies",
      inputRaw: "@example",
      inputNormalized: "example",
      status: "running",
      runnerId: randomUUID(),
    })
    .returning();
  return row;
}
function page(row: typeof fetchJobs.$inferSelect, posts: XPost[]) {
  return {
    jobId: row.id,
    runnerId: row.runnerId!,
    cursor: row.nextCursor,
    tweets: posts,
    rawCount: posts.length,
    nextCursor: "next",
    hasNextPage: true,
  };
}
async function entries(userId: string) {
  return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId));
}

test("PostgreSQL billing and local HTTP exports", { timeout: 180_000 }, async (t) => {
  await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  try {
    await t.test("opening-balance import and manual grant scripts are replay-safe", async () => {
      const id = randomUUID();
      users.push(id);
      await db.insert(user).values({ id, name: "Imported user", email: `${id}@example.test` });
      const dir = await mkdtemp(join(tmpdir(), "xport-billing-"));
      const file = join(dir, "snapshot.json");
      try {
        await writeFile(
          file,
          JSON.stringify({
            users: [
              {
                userId: id,
                polarCustomerId: null,
                originalBalance: -20,
                includedOrderIds: [],
                confirmed: true,
              },
            ],
          }),
        );
        const env = { ...process.env, BILLING_MAINTENANCE: "true" };
        const run = promisify(execFile);
        await run(process.execPath, ["scripts/migrate-credits.mjs", "import", file], { env });
        await run(process.execPath, ["scripts/migrate-credits.mjs", "import", file], { env });
        assert.equal(await getCreditBalance(id), 0);
        assert.equal((await entries(id)).length, 1);
        await grantSignupCredits(id);
        assert.equal(await getCreditBalance(id), 0);
        const grant = [
          "scripts/grant-credits.mjs",
          id,
          "2",
          "Test adjustment",
          "--key",
          `script:${id}`,
        ];
        await run(process.execPath, grant);
        await run(process.execPath, grant);
        assert.equal(await getCreditBalance(id), 2);
        await assert.rejects(
          run(process.execPath, ["scripts/migrate-credits.mjs", "import", file], { env }),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
    await t.test("concurrent debits, replay, mismatch, and non-negative constraint", async () => {
      const id = await account(1);
      const debit = (key: string) =>
        db.transaction((tx) =>
          recordCreditChange(tx, { userId: id, operationKey: key, amount: -1, type: "usage" }),
        );
      const outcomes = await Promise.allSettled([debit(`a:${id}`), debit(`b:${id}`)]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(await getCreditBalance(id), 0);
      const successful = outcomes.find((result) => result.status === "fulfilled")!;
      assert.equal(successful.status, "fulfilled");
      if (successful.status === "fulfilled") await debit(successful.value.operationKey);
      await assert.rejects(db.update(user).set({ creditBalance: -1 }).where(eq(user.id, id)));
      assert.equal(await getCreditBalance(id), 0);
      await assert.rejects(
        db.transaction((tx) =>
          recordCreditChange(tx, {
            userId: id,
            operationKey: `a:${id}`,
            amount: -1.5,
            type: "usage",
          }),
        ),
      );
    });
    await t.test(
      "92-credit page with 72 credits stores only paid results, then refuses old runner",
      async () => {
        const id = await account(72);
        const row = await job(id);
        const settled = await settleFetchPage(page(row, tweets(1840)));
        assert.equal(settled?.storedTweets, 1440);
        assert.equal(settled?.chargedCredits, 72);
        assert.equal(settled?.status, "stopped");
        assert.equal(settled?.errorCode, "INSUFFICIENT_CREDITS");
        assert.equal(settled?.runnerId, null);
        assert.equal(await getCreditBalance(id), 0);
        assert.equal(await settleFetchPage(page(row, tweets(1840))), null);
        assert.equal((await entries(id)).length, 2);
        assert.equal(
          (await db.select().from(fetchTweets).where(eq(fetchTweets.jobId, row.id))).length,
          1440,
        );
      },
    );
    await t.test(
      "final page commits completion with its debit, so a crash cannot replay it",
      async () => {
        const id = await account(2);
        const row = await job(id);
        const input = { ...page(row, tweets(20)), hasNextPage: false, nextCursor: null };
        const settled = await settleFetchPage(input);
        assert.equal(settled?.status, "completed");
        assert.equal(settled?.runnerId, null);
        assert.equal(settled?.chargedCredits, 1);
        assert.equal(settled?.storedTweets, 20);
        assert.equal(settled?.hasNextPage, false);
        assert.equal(settled?.nextCursor, null);
        assert.ok(settled?.finishedAt);
        // No runner finalization call: this is the durable state immediately after settlement.
        const [persisted] = await db.select().from(fetchJobs).where(eq(fetchJobs.id, row.id));
        assert.equal(persisted.status, "completed");
        assert.equal(await settleFetchPage(input), null);
        assert.equal(await getCreditBalance(id), 1);
        assert.equal((await entries(id)).length, 2);
      },
    );
    await t.test("duplicate tweets, paid capacity at zero, and empty-page minimum", async () => {
      const id = await account(1);
      const row = await job(id);
      const first = await settleFetchPage(page(row, [tweets(1)[0], tweets(1)[0]]));
      assert.equal(first?.chargedCredits, 1);
      assert.equal(first?.storedTweets, 1);
      const second = await settleFetchPage(page(first!, tweets(21)));
      assert.equal(second?.storedTweets, 20);
      assert.equal(second?.chargedCredits, 1);
      assert.equal(second?.status, "stopped");
      const empty = await job(await account(0));
      assert.equal((await settleFetchPage(page(empty, [])))?.status, "stopped");
      const paidEmpty = await job(await account(1));
      assert.equal((await settleFetchPage(page(paidEmpty, [])))?.chargedCredits, 1);
    });
    await t.test(
      "two jobs compete for last credit; stale ownership and stopped jobs cannot settle",
      async () => {
        const id = await account(1);
        const a = await job(id),
          b = await job(id);
        const results = await Promise.all([
          settleFetchPage(page(a, tweets(20))),
          settleFetchPage(page(b, tweets(20))),
        ]);
        assert.equal(
          results.reduce((sum, row) => sum + row!.storedTweets, 0),
          20,
        );
        assert.equal(await getCreditBalance(id), 0);
        await db.update(fetchJobs).set({ runnerId: "replacement" }).where(eq(fetchJobs.id, a.id));
        assert.equal(await settleFetchPage(page(a, tweets(1))), null);
        const stopped = await job(await account(1));
        await db.update(fetchJobs).set({ stopRequested: true }).where(eq(fetchJobs.id, stopped.id));
        assert.equal((await settleFetchPage(page(stopped, tweets(20))))?.runnerId, null);
        assert.equal(await getCreditBalance(stopped.ownerUserId), 1);
      },
    );
    await t.test("failed ledger settlement rolls back tweets and progress", async () => {
      const id = await account(2);
      const row = await job(id);
      await db.transaction((tx) =>
        recordCreditChange(tx, {
          userId: id,
          operationKey: `job:${row.id}:page:1`,
          amount: 1,
          type: "manual",
        }),
      );
      await assert.rejects(settleFetchPage(page(row, tweets(20))));
      assert.equal(
        (await db.select().from(fetchTweets).where(eq(fetchTweets.jobId, row.id))).length,
        0,
      );
      const [unchanged] = await db.select().from(fetchJobs).where(eq(fetchJobs.id, row.id));
      assert.equal(unchanged.pagesFetched, 0);
      assert.equal(await getCreditBalance(id), 3);
    });
    await t.test(
      "direct concurrent retries return one paid response and reject changed input",
      async () => {
        const id = await account(1),
          key = `direct:${id}:retry`;
        const [a, b] = await Promise.all([
          settleDirectResult(key, id, "article:1", { payload: { text: "a" }, credits: 1 }),
          settleDirectResult(key, id, "article:1", { payload: { text: "b" }, credits: 1 }),
        ]);
        assert.deepEqual(a, b);
        assert.equal(await getCreditBalance(id), 0);
        await assert.rejects(settleDirectResult(key, id, "article:2", { payload: {}, credits: 1 }));
      },
    );
    await t.test(
      "signup, purchase, and manual grants are idempotent; opening balance suppresses imported grants",
      async () => {
        const id = await account(0);
        await Promise.all([grantSignupCredits(id), grantSignupCredits(id)]);
        assert.equal(await getCreditBalance(id), 50);
        process.env.SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID = "product-test";
        const paid = {
          data: {
            id: randomUUID(),
            product_id: "product-test",
            paid: true,
            customer: { external_id: id },
          },
        } as webhooks.WebhookOrderPaidPayload;
        await Promise.all([grantPurchaseCredits(paid), grantPurchaseCredits(paid)]);
        assert.equal(await getCreditBalance(id), 175);
        const manual = () =>
          db.transaction((tx) =>
            recordCreditChange(tx, {
              userId: id,
              operationKey: `manual:${id}`,
              amount: 2,
              type: "manual",
              metadata: { reason: "test" },
            }),
          );
        await Promise.all([manual(), manual()]);
        assert.equal(await getCreditBalance(id), 177);
        const imported = await account(0);
        await db.transaction((tx) =>
          recordCreditChange(tx, {
            userId: imported,
            operationKey: `polar-opening-balance:v1:${imported}`,
            amount: 72,
            type: "opening",
            metadata: { includedOrderIds: [paid.data.id] },
          }),
        );
        await grantSignupCredits(imported);
        await grantPurchaseCredits({
          ...paid,
          data: { ...paid.data, customer: { ...paid.data.customer, external_id: imported } },
        });
        assert.equal(await getCreditBalance(imported), 72);
        await assert.rejects(
          grantPurchaseCredits({ ...paid, data: { ...paid.data, product_id: "unknown" } }),
        );
      },
    );
    await t.test(
      "Polar outage/unknown success retries without local double debit; concurrent deliveries claim once",
      async () => {
        await deliverCreditReports(async () => {});
        const id = await account(1),
          key = `delivery:${id}`;
        await db.transaction((tx) =>
          recordCreditChange(tx, {
            userId: id,
            operationKey: key,
            amount: -1,
            type: "usage",
            report: true,
          }),
        );
        const externalEvents = new Set<string>();
        await deliverCreditReports(async (payload) => {
          externalEvents.add(payload.externalId);
          throw new Error("Connection lost after provider accepted event");
        });
        assert.equal(await getCreditBalance(id), 0);
        const [failed] = await db
          .select()
          .from(creditTransactions)
          .where(eq(creditTransactions.operationKey, key));
        assert.equal(failed.polarDeliveredAt, null);
        assert.equal(failed.polarAttempts, 1);
        await db
          .update(creditTransactions)
          .set({ polarNextAttemptAt: new Date(0) })
          .where(eq(creditTransactions.operationKey, key));
        let sends = 0;
        const send = async (payload: NonNullable<typeof failed.polarPayload>) => {
          sends++;
          externalEvents.add(payload.externalId);
          await delay(20);
        };
        await Promise.all([deliverCreditReports(send), deliverCreditReports(send)]);
        assert.equal(sends, 1);
        assert.equal(externalEvents.size, 1);
        assert.equal(await getCreditBalance(id), 0);
        const [delivered] = await db
          .select()
          .from(creditTransactions)
          .where(eq(creditTransactions.operationKey, key));
        assert.ok(delivered.polarDeliveredAt);
        assert.deepEqual(delivered.metadata, failed.metadata);
        assert.equal(delivered.amount, failed.amount);
        await deliverCreditReports(async () =>
          assert.fail("Delivered/null-payload entries must not be sent"),
        );
      },
    );
    await t.test("Polar delivery pins its API version and preserves queued event IDs", async () => {
      await deliverCreditReports(async () => {});
      const id = await account(2);
      const originalFetch = globalThis.fetch;
      const responses = [{ inserted: 1 }, { inserted: 0, duplicates: 1 }];
      try {
        globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          assert.equal(request.url, "https://sandbox-api.polar.sh/v1/events/ingest");
          assert.equal(request.headers.get("Polar-Version"), "2026-10");
          assert.deepEqual((await request.json()).events, [
            {
              name: "usage",
              external_id: `sdk:${id}:${responses.length}`,
              external_customer_id: id,
              metadata: { credits: 1 },
            },
          ]);
          return Response.json(responses.shift());
        };
        for (const suffix of [2, 1]) {
          await db.transaction((tx) =>
            recordCreditChange(tx, {
              userId: id,
              operationKey: `sdk:${id}:${suffix}`,
              amount: -1,
              type: "usage",
              report: true,
            }),
          );
          assert.equal(await deliverCreditReports(), 1);
        }
        assert.equal(responses.length, 0);
        assert.equal(await getCreditBalance(id), 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
    await t.test(
      "real local HTTP routes: balance, article billing/retry/failure, partial job/export",
      async () => {
        let upstreamCalls = 0;
        const upstream = createServer((req, res) => {
          upstreamCalls++;
          const url = new URL(req.url!, "http://localhost");
          res.setHeader("Content-Type", "application/json");
          if (url.searchParams.get("tweet_id") === "999") {
            res.writeHead(502);
            res.end('{"error":"test failure"}');
            return;
          }
          if (url.pathname === "/twitter/article") {
            res.end(
              JSON.stringify({
                status: "success",
                article: {
                  title: "Test article",
                  contents: [{ type: "unstyled", text: "Paid content" }],
                  author: tweets(1)[0].author,
                  createdAt: "2026-09-29T00:00:00Z",
                },
              }),
            );
            return;
          }
          if (url.pathname === "/twitter/user/info") {
            res.end(
              JSON.stringify({
                status: "success",
                data: { id: "source-user", userName: "example" },
              }),
            );
            return;
          }
          if (url.pathname === "/twitter/user/tweet_timeline") {
            res.end(
              JSON.stringify({
                status: "success",
                data: { tweets: tweets(40) },
                has_next_page: false,
              }),
            );
            return;
          }
          res.end(
            JSON.stringify({
              status: "success",
              tweets: tweets(40),
              has_next_page: url.searchParams.get("tweetId") === "888",
              next_cursor: url.searchParams.get("tweetId") === "888" ? "repeat" : "",
            }),
          );
        });
        upstream.listen(0, "127.0.0.1");
        await once(upstream, "listening");
        const address = upstream.address() as { port: number };
        const base = "http://localhost:3108";
        const app = spawn(
          process.execPath,
          [
            "node_modules/vite/bin/vite.js",
            "--host",
            "127.0.0.1",
            "--port",
            "3108",
            "--strictPort",
          ],
          {
            cwd: new URL("..", import.meta.url),
            env: {
              ...process.env,
              BETTER_AUTH_URL: base,
              BETTER_AUTH_SECRET: "local-billing-test-secret-at-least-32-characters",
              POLAR_ENV: "sandbox",
              SANDBOX_POLAR_ACCESS_TOKEN: "local-test-only",
              POLAR_ACCESS_TOKEN: "",
              POLAR_WEBHOOK_SECRET: "local-test-only",
              X_API_URL: `http://127.0.0.1:${address.port}`,
              X_API_KEY: "local-test-only",
              POSTHOG_API_KEY: "",
              POSTHOG_KEY: "",
              PUBLIC_POSTHOG_KEY: "",
              VITE_POSTHOG_KEY: "",
              BILLING_MAINTENANCE: "false",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let logs = "";
        app.stdout.on("data", (chunk) => {
          logs = (logs + chunk).slice(-12_000);
        });
        app.stderr.on("data", (chunk) => {
          logs = (logs + chunk).slice(-12_000);
        });
        try {
          let ready = false;
          for (let i = 0; i < 120; i++) {
            try {
              const res = await fetch(`${base}/api/cli/me`);
              if (res.status === 401) {
                ready = true;
                break;
              }
            } catch {
              /* Wait for Vite. */
            }
            if (app.exitCode !== null) break;
            await delay(500);
          }
          assert.ok(ready, logs);
          const id = await account(3),
            token = randomUUID();
          await db.insert(session).values({
            id: randomUUID(),
            userId: id,
            token,
            expiresAt: new Date(Date.now() + 3600_000),
          });
          const headers = { Authorization: `Bearer ${token}`, "Idempotency-Key": randomUUID() };
          const balance = await fetch(`${base}/api/cli/me`, { headers });
          assert.equal(balance.status, 200, logs);
          assert.equal((await balance.json()).credits, 3);
          for (const body of [null, [], { input: 42 }, { input: {} }]) {
            const invalid = await fetch(`${base}/api/fetch-jobs`, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            assert.equal(invalid.status, 400);
          }

          const article = await fetch(`${base}/api/article?input=123`, { method: "POST", headers });
          assert.equal(article.status, 200, await article.clone().text());
          assert.equal(article.headers.get("X-Xport-Credits-Charged"), "1");
          const calls = upstreamCalls;
          const retry = await fetch(`${base}/api/article?input=123`, { method: "POST", headers });
          assert.deepEqual(await retry.json(), await article.json());
          assert.equal(upstreamCalls, calls);
          assert.equal(await getCreditBalance(id), 2);
          assert.equal(
            (await fetch(`${base}/api/article?input=124`, { method: "POST", headers })).status,
            409,
          );
          assert.equal(
            (
              await fetch(`${base}/api/article?input=999`, {
                method: "POST",
                headers: { ...headers, "Idempotency-Key": randomUUID() },
              })
            ).status,
            502,
          );
          assert.equal(await getCreditBalance(id), 2);
          const created = await fetch(`${base}/api/fetch-jobs`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ input: "https://x.com/example/status/123" }),
          });
          assert.equal(created.status, 201, await created.clone().text());
          const { jobId } = await created.json();
          let status;
          for (let i = 0; i < 50; i++) {
            status = await (
              await fetch(`${base}/api/fetch-jobs/${jobId}/status`, { headers })
            ).json();
            if (["stopped", "completed", "failed"].includes(status.status)) break;
            await delay(100);
          }
          assert.equal(status.status, "completed", JSON.stringify(status));
          assert.equal(status.storedTweets, 40);
          assert.equal(status.chargedCredits, 2);
          assert.equal(await getCreditBalance(id), 0);
          const exports = await fetch(`${base}/api/fetch-jobs/${jobId}/tweets?limit=100`, {
            headers,
          });
          assert.equal(exports.status, 200);
          assert.equal((await exports.json()).tweets.length, 40);
          assert.equal(
            (
              await fetch(`${base}/api/article?input=125`, {
                method: "POST",
                headers: { ...headers, "Idempotency-Key": randomUUID() },
              })
            ).status,
            402,
          );
          const [finished] = await db.select().from(fetchJobs).where(eq(fetchJobs.id, jobId));
          assert.equal(finished.runnerId, null);
          await db.transaction((tx) =>
            recordCreditChange(tx, {
              userId: id,
              operationKey: `manual:http:${id}`,
              amount: 1,
              type: "manual",
            }),
          );
          const limited = await fetch(`${base}/api/fetch-jobs`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ input: "https://x.com/example/status/456" }),
          });
          const limitedId = (await limited.json()).jobId;
          for (let i = 0; i < 50; i++) {
            status = await (
              await fetch(`${base}/api/fetch-jobs/${limitedId}/status`, { headers })
            ).json();
            if (status.status === "stopped") break;
            await delay(100);
          }
          assert.equal(status.status, "stopped");
          assert.equal(status.error.code, "INSUFFICIENT_CREDITS");
          assert.equal(status.storedTweets, 20);
          assert.equal(status.chargedCredits, 1);
          const partial = await (
            await fetch(`${base}/api/fetch-jobs/${limitedId}/tweets?limit=100`, { headers })
          ).json();
          assert.equal(partial.tweets.length, 20);
          const exportResult = buildFetchJobResult(
            "thread",
            normalizeTweetCards(partial.tweets),
            null,
            status,
            "example",
          );
          for (const format of ["markdown", "json"] as const) {
            const download = getDownloadPayload(exportResult, format, { isPartial: true });
            assert.match(download.filename, /example-thread-partial\.(md|json)$/);
            assert.match(download.content, /Post 20/);
            assert.doesNotMatch(download.content, /Post 21/);
          }
          assert.equal(await getCreditBalance(id), 0);
          assert.equal((await fetch(`${base}/api/article?input=123`, { headers })).status, 405);
          assert.equal(
            (
              await fetch(`${base}/api/article?input=123`, {
                method: "POST",
                headers: { ...headers, Origin: "https://untrusted.example" },
              })
            ).status,
            403,
          );

          const { body, headers: webhookHeaders } = paidOrder(id);
          const rejected = await fetch(`${base}/api/auth/polar/webhooks`, {
            method: "POST",
            headers: { ...webhookHeaders, "webhook-signature": "v1,invalid" },
            body,
          });
          assert.equal(rejected.status, 403);
          for (let i = 0; i < 2; i++) {
            const paid = await fetch(`${base}/api/auth/polar/webhooks`, {
              method: "POST",
              headers: webhookHeaders,
              body,
            });
            assert.equal(paid.status, 200, await paid.text());
          }
          assert.equal(await getCreditBalance(id), 125);
          for (const route of [
            "user-info?username=example",
            "thread?tweetId=789",
            "user-tweets?username=example",
          ]) {
            const res = await fetch(`${base}/api/${route}`, {
              method: "POST",
              headers: { ...headers, "Idempotency-Key": randomUUID() },
            });
            assert.equal(res.status, 200, await res.clone().text());
          }
          assert.equal(await getCreditBalance(id), 120);
          const repeated = await fetch(`${base}/api/fetch-jobs`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ input: "https://x.com/example/status/888" }),
          });
          assert.equal(repeated.status, 201);
          const repeatedId = (await repeated.json()).jobId;
          for (let i = 0; i < 50; i++) {
            status = await (
              await fetch(`${base}/api/fetch-jobs/${repeatedId}/status`, { headers })
            ).json();
            if (status.status === "completed") break;
            await delay(100);
          }
          assert.equal(status.status, "completed");
          assert.equal(status.pagesFetched, 2);
          assert.equal(status.storedTweets, 40);
          assert.equal(status.chargedCredits, 2);
          assert.equal(status.hasNextPage, false);
          assert.equal(await getCreditBalance(id), 118);

          const output = await mkdtemp(join(tmpdir(), "xport-cli-export-"));
          try {
            await promisify(execFile)(
              process.execPath,
              [
                "../cli/dist/cli/src/index.js",
                "export",
                "--format",
                "markdown",
                "--out",
                output,
                "https://x.com/example/article/123",
              ],
              { env: { ...process.env, XPORT_BASE_URL: base, XPORT_TOKEN: token } },
            );
            assert.match(await readFile(join(output, "test-article.md"), "utf8"), /Paid content/);
          } finally {
            await rm(output, { recursive: true, force: true });
          }
        } catch (error) {
          console.error(logs);
          throw error;
        } finally {
          app.kill("SIGTERM");
          await once(app, "exit");
          upstream.closeAllConnections();
          await new Promise<void>((resolve) => upstream.close(() => resolve()));
        }
      },
    );
    const mismatches = await db.execute(
      sql`SELECT u.id FROM "user" u LEFT JOIN xport_credit_transactions t ON t.user_id = u.id GROUP BY u.id HAVING u.credit_balance <> COALESCE(SUM(t.amount), 0)`,
    );
    assert.equal(mismatches.rows.length, 0);
  } finally {
    if (users.length) {
      await db.delete(creditTransactions).where(inArray(creditTransactions.userId, users));
      await db.delete(user).where(inArray(user.id, users));
    }
    await db.$client.end();
  }
});
