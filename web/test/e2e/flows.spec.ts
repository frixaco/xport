import { randomUUID } from "node:crypto";
import { test, expect, db, submit, currentJob, jobRow, balance, download } from "./fixtures";

test("public home, SEO, invalid input, mobile layout and persistent theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Export X");
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    process.env.BETTER_AUTH_URL!,
  );
  expect(await page.locator('script[type="application/ld+json"]').count()).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Top up", exact: true })).toBeDisabled();
  await page.getByLabel("X (ex-Twitter) URL or username").fill("not a url!");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText(/valid|sign in/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Theme:/ }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const path of ["/export-x-posts", "/export-x-threads", "/save-x-articles"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

for (const provider of ["GitHub", "Google"])
  test(`${provider} OAuth callback creates user/customer and grants once; logout revokes session`, async ({
    page,
  }) => {
    const identity = randomUUID();
    await page.route(
      provider === "GitHub"
        ? "https://github.com/login/oauth/authorize**"
        : "https://accounts.google.com/o/oauth2/v2/auth**",
      async (route) => {
        const auth = new URL(route.request().url());
        const callback = new URL(auth.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", identity);
        callback.searchParams.set("state", auth.searchParams.get("state")!);
        await route.fulfill({ status: 302, headers: { location: callback.toString() } });
      },
    );
    try {
      for (let login = 0; login < 2; login++) {
        await page.goto("/");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.getByRole("button", { name: `Continue with ${provider}` }).click();
        await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
        const me = await (await page.request.get("/api/cli/me")).json();
        expect(me.credits).toBe(50);
        await page.getByRole("button", { name: "Account menu" }).click();
        await page.getByRole("menuitem", { name: "Sign out" }).click();
        await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
        expect((await page.request.get("/api/cli/me")).status()).toBe(401);
      }
      const rows = await db.query(
        'SELECT t.* FROM xport_credit_transactions t JOIN "user" u ON u.id=t.user_id WHERE u.email=$1',
        [`${identity}@example.test`],
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await db.query(
        'DELETE FROM xport_credit_transactions WHERE user_id IN (SELECT id FROM "user" WHERE email=$1)',
        [`${identity}@example.test`],
      );
      await db.query('DELETE FROM "user" WHERE email=$1', [`${identity}@example.test`]);
    }
  });

for (const input of ["https://x.com/example/status/123", "@paged"]) {
  test(`complete export, both downloads and reload: ${input}`, async ({ page, account }) => {
    await submit(page, input);
    const id = await currentJob(page);
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();
    const job = await jobRow(id);
    expect(job.runner_id).toBeNull();
    expect(job.stored_tweets).toBe(input === "@paged" ? 120 : 40);
    expect(await balance(account.id)).toBe(100 - job.charged_credits);
    if (input === "@paged") {
      const preview = page.getByRole("region", { name: "Export preview" });
      await expect(async () => {
        await preview.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await expect(preview.getByText("Post 120", { exact: true })).toBeVisible({ timeout: 500 });
      }).toPass({ timeout: 15000 });
    }
    for (const format of ["Markdown", "JSON"] as const) {
      const file = await download(page, format);
      expect(file.filename).toMatch(
        input === "@paged" ? /paged-user-posts\.(md|json)$/ : /example-thread\.(md|json)$/,
      );
      expect(file.text).toContain(`Post ${job.stored_tweets}`);
      if (format === "JSON") {
        const exported = JSON.parse(file.text);
        expect(exported.tweets.length + (exported.mainTweet ? 1 : 0)).toBe(job.stored_tweets);
      }
    }
    await page.reload();
    await expect(page.getByText("Complete", { exact: true })).toBeVisible();
    expect(await balance(account.id)).toBe(100 - job.charged_credits);
    await page.getByRole("button", { name: "Back to home" }).click();
    await expect(page).not.toHaveURL(/jobId=/);
  });
}

test("article preview escapes HTML, preserves formatting, copies and downloads", async ({
  page,
  context,
  account,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await submit(page, "https://x.com/example/article/123");
  await expect(page.getByRole("heading", { name: "Test article" })).toBeVisible();
  await expect(page.locator("article strong")).toHaveText("bold");
  await expect(
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "Test article", exact: true }) })
      .locator("img"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "articleXss" in window)).toBe(false);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Paid content");
  const file = await download(page, "Markdown", true);
  expect(file.filename).toBe("test-article.md");
  expect(file.text).toContain("Paid content");
  expect(await balance(account.id)).toBe(99);
});

test("stop early keeps partial export, reload retains it without restarting", async ({
  page,
  account,
}) => {
  await submit(page, "@slow");
  const id = await currentJob(page);
  await expect.poll(async () => (await jobRow(id)).pages_fetched).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Stop fetching", exact: true }).click();
  await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible();
  const row = await jobRow(id);
  expect(row.pages_fetched).toBeLessThanOrEqual(2);
  expect(row.runner_id).toBeNull();
  const file = await download(page, "JSON");
  expect(file.filename).toBe("slow-user-posts-partial.json");
  expect(file.text).toContain("Post 1");
  await page.reload();
  await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible();
  expect((await jobRow(id)).pages_fetched).toBe(row.pages_fetched);
  expect(await balance(account.id)).toBe(100 - row.charged_credits);
});

test("active job survives browser reload and completes once", async ({ page, account }) => {
  await submit(page, "@slow");
  const id = await currentJob(page);
  await expect.poll(async () => (await jobRow(id)).pages_fetched).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(id));
  await expect(page.getByText("Complete", { exact: true })).toBeVisible({ timeout: 35000 });
  const row = await jobRow(id);
  expect(row.pages_fetched).toBe(10);
  expect(row.stored_tweets).toBe(400);
  expect(row.runner_id).toBeNull();
  expect(await balance(account.id)).toBe(80);
});

for (const kind of ["article", "status"])
  test(`direct ${kind} URL redirects and auto-starts`, async ({ page, account }) => {
    await page.goto(`/x.com/example/${kind}/123`);
    await expect(page).toHaveURL(/input=/);
    await expect(
      page.getByText(kind === "article" ? "Fetched article" : "Complete", { exact: true }),
    ).toBeVisible();
    expect(await balance(account.id)).toBe(kind === "article" ? 99 : 98);
  });

test("insufficient credits blocks new work and preserves paid partial results", async ({
  page,
  account,
}) => {
  await db.query('UPDATE "user" SET credit_balance=1 WHERE id=$1', [account.id]);
  await db.query("UPDATE xport_credit_transactions SET amount=1 WHERE user_id=$1", [account.id]);
  await submit(page, "https://x.com/example/status/123");
  const id = await currentJob(page);
  await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible();
  expect((await jobRow(id)).stored_tweets).toBe(20);
  expect(await balance(account.id)).toBe(0);
  const file = await download(page, "JSON");
  expect(file.text).toContain("Post 20");
  expect(file.text).not.toContain("Post 21");
  await submit(page, "https://x.com/example/article/123");
  await expect(page.getByText(/Insufficient credits/).first()).toBeVisible();
  expect(await balance(account.id)).toBe(0);
});

test("upstream failure is visible without charging; retryable response recovers", async ({
  page,
  account,
}) => {
  await submit(page, "https://x.com/example/article/999");
  await expect(
    page.getByText(/The source service could not complete the request/).first(),
  ).toBeVisible();
  expect(await balance(account.id)).toBe(100);
  await expect(page.getByRole("button", { name: "Download export" })).toBeDisabled();
  await submit(page, "https://x.com/example/status/999");
  const failed = await currentJob(page);
  await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
  expect((await jobRow(failed)).runner_id).toBeNull();
  expect(await balance(account.id)).toBe(100);
  await submit(page, "https://x.com/example/status/777");
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
  expect(await balance(account.id)).toBe(98);
});

for (const outcome of ["Pay", "Decline", "Cancel"])
  test(`checkout ${outcome}, signed webhook and visible balance`, async ({ page, account }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Top up credits" }).click();
    await page.getByRole("button", { name: /^125 credits/ }).click();
    await expect(page.getByRole("heading", { name: "Test checkout" })).toBeVisible();
    await page.getByRole("link", { name: outcome, exact: true }).click();
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
    if (outcome === "Pay") {
      await expect(page.getByText("Payment successful! Credits added.")).toBeVisible();
      expect(await balance(account.id)).toBe(225);
      await expect(page.locator("header").getByText("225", { exact: true })).toBeVisible();
    } else {
      if (outcome === "Decline")
        await expect(page.getByText("Payment failed. Please try again.")).toBeVisible();
      expect(await balance(account.id)).toBe(100);
    }
  });

for (const action of ["Authorize CLI", "Deny"])
  test(`CLI device flow: ${action}`, async ({ page, account }) => {
    const created = await page.request.post("/api/auth/device/code", {
      headers: { Origin: "http://localhost:3210" },
      data: { client_id: "xport-cli" },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const code = await created.json();
    await page.goto(`/device?user_code=${code.user_code}`);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(
      page.getByText(
        action === "Deny"
          ? "Authorization denied. You can close this page."
          : "CLI authorized. You can return to your terminal.",
      ),
    ).toBeVisible();
    const result = await page.request.post("/api/auth/device/token", {
      headers: { Origin: "http://localhost:3210" },
      data: {
        client_id: "xport-cli",
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
    });
    const payload = await result.json();
    if (action === "Deny") expect(payload.error).toBe("access_denied");
    else {
      expect(payload.access_token).toBeTruthy();
      const me = await page.request.get("/api/cli/me", {
        headers: { Authorization: `Bearer ${payload.access_token}` },
      });
      expect((await me.json()).credits).toBe(await balance(account.id));
    }
  });
