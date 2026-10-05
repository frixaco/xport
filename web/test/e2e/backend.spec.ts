import { randomUUID } from "node:crypto";
import { test, expect, db, jobRow, balance } from "./fixtures";
import { paidOrder } from "../polar-fixture";

test("ownership, expired results, CSRF and unauthenticated API access", async ({
  page,
  account,
  playwright,
}) => {
  const stranger = await playwright.request.newContext({
    baseURL: "http://localhost:3210",
    extraHTTPHeaders: { Origin: "http://localhost:3210" },
  });
  const other = randomUUID(),
    id = randomUUID();
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
    other,
    "Other",
    `${other}@example.test`,
  ]);
  await db.query(
    "INSERT INTO xport_fetch_jobs(id,owner_user_id,request_type,input_raw,input_normalized,status,expires_at) VALUES($1,$2,'thread','123','123','completed',now()+interval '1 hour')",
    [id, other],
  );
  try {
    for (const route of ["status", "tweets", "stop"]) {
      const method = route === "stop" ? "post" : "get";
      expect((await page.request[method](`/api/fetch-jobs/${id}/${route}`)).status()).toBe(404);
      expect((await stranger[method](`/api/fetch-jobs/${id}/${route}`)).status()).toBe(401);
    }
    expect(
      (
        await page.request.post("/api/fetch-jobs", {
          headers: { Origin: "https://evil.test" },
          data: { input: "123" },
        })
      ).status(),
    ).toBe(403);
    expect((await stranger.post("/api/article?input=123")).status()).toBe(401);
    expect((await page.request.get("/api/checkout/status?id=nonexistent")).status()).toBe(404);
    expect((await page.request.get(`/api/checkout/status?id=${randomUUID()}`)).status()).toBe(404);
    expect(
      (
        await page.request.get("/api/checkout/status?id=00000000-0000-0000-0000-000000000000")
      ).status(),
    ).toBe(404);
    await db.query(
      "UPDATE xport_fetch_jobs SET owner_user_id=$1,expires_at=now()-interval '1 hour' WHERE id=$2",
      [account.id, id],
    );
    const created = await page.request.post("/api/fetch-jobs", { data: { input: "123" } });
    expect(created.status()).toBe(201);
    const fresh = await created.json();
    await expect.poll(async () => (await jobRow(fresh.jobId)).status).toBe("completed");
    expect((await page.request.get(`/api/fetch-jobs/${id}/tweets`)).status()).toBe(404);
  } finally {
    await stranger.dispose();
    await db.query('DELETE FROM "user" WHERE id=$1', [other]);
  }
});

test("stale worker is reclaimed through status polling, preserving ledger consistency", async ({
  page,
  account,
}) => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO xport_fetch_jobs(id,owner_user_id,request_type,input_raw,input_normalized,status,runner_id,updated_at,expires_at) VALUES($1,$2,'thread','123','123','running','dead-worker',now()-interval '6 minutes',now()+interval '1 hour')",
    [id, account.id],
  );
  await page.goto(`/?jobId=${id}`);
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  expect((await jobRow(id)).runner_id).toBeNull();
  expect(await balance(account.id)).toBe(98);
  const entries = await db.query(
    "SELECT * FROM xport_credit_transactions WHERE user_id=$1 AND type='usage'",
    [account.id],
  );
  expect(entries.rows).toHaveLength(1);
});

for (const mode of ["posts", "timeline", "replies"])
  test(`account API mode ${mode} filters and bills the right content`, async ({
    page,
    account,
  }) => {
    const response = await page.request.post("/api/fetch-jobs", {
      data: { input: "@mixed", mode },
    });
    expect(response.status()).toBe(201);
    const { jobId } = await response.json();
    await expect.poll(async () => (await jobRow(jobId)).status).toBe("completed");
    const tweets = await (
      await page.request.get(`/api/fetch-jobs/${jobId}/tweets?limit=100`)
    ).json();
    expect(tweets.total).toBe(mode === "timeline" ? 40 : 20);
    expect(tweets.tweets).toHaveLength(tweets.total);
    if (mode !== "timeline")
      expect(
        tweets.tweets.every(
          (t: { isReply?: boolean }) => Boolean(t.isReply) === (mode === "replies"),
        ),
      ).toBe(true);
    expect(await balance(account.id)).toBe(mode === "timeline" ? 98 : 99);
  });

test("empty export minimum charge and no results UI", async ({ page, account }) => {
  const response = await page.request.post("/api/fetch-jobs", { data: { input: "@empty" } });
  const { jobId } = await response.json();
  await page.goto(`/?jobId=${jobId}`);
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  await expect(page.getByText("No results returned.")).toBeVisible();
  expect(await balance(account.id)).toBe(99);
});

test("concurrent webhook replay grants once; invalid signature and stale timestamp do not grant", async ({
  page,
  account,
}) => {
  const event = paidOrder(account.id, "product-large-test");
  const send = () =>
    page.request.post("/api/auth/polar/webhooks", { headers: event.headers, data: event.body });
  const responses = await Promise.all([send(), send()]);
  expect(responses.map((r) => r.status())).toEqual([200, 200]);
  expect(await balance(account.id)).toBe(1350);
  for (const headers of [
    { ...event.headers, "webhook-signature": "v1,bad" },
    { ...event.headers, "webhook-timestamp": "1" },
  ]) {
    expect(
      (await page.request.post("/api/auth/polar/webhooks", { headers, data: event.body })).status(),
    ).toBe(403);
  }
  expect(await balance(account.id)).toBe(1350);
});

test("active job cap rejects third export and stopping queued jobs clears ownership", async ({
  page,
  account,
}) => {
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids)
    await db.query(
      "INSERT INTO xport_fetch_jobs(id,owner_user_id,request_type,input_raw,input_normalized,status) VALUES($1,$2,'thread','123','123','queued')",
      [id, account.id],
    );
  expect((await page.request.post("/api/fetch-jobs", { data: { input: "123" } })).status()).toBe(
    429,
  );
  for (const id of ids) {
    expect((await page.request.post(`/api/fetch-jobs/${id}/stop`)).ok()).toBe(true);
    const row = await jobRow(id);
    expect(row.status).toBe("stopped");
    expect(row.runner_id).toBeNull();
  }
  expect(await balance(account.id)).toBe(100);
});

test("published CLI authenticates with bearer token and exports account modes", async ({
  account,
}) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = (args: string[]) =>
    promisify(execFile)(process.execPath, ["../cli/dist/cli/src/index.js", ...args], {
      env: {
        ...process.env,
        XPORT_BASE_URL: process.env.BETTER_AUTH_URL,
        XPORT_TOKEN: account.token,
      },
    });
  expect((await run(["whoami"])).stdout).toContain("Browser Test");
  expect((await run(["credits"])).stdout.trim()).toBe("100");
  for (const mode of ["posts", "replies"]) {
    const result = await run([mode, "--format", "json", "--stdout", "@mixed"]);
    const exported = JSON.parse(result.stdout);
    expect(exported.tweets).toHaveLength(20);
    expect(result.stderr).toContain("Job ID:");
  }
  expect(await balance(account.id)).toBe(98);
});
