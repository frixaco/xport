import { test, expect, db, submit, currentJob, jobRow, balance, download } from "./fixtures";

test("real X API: article, complete thread, complete @frixaco and early stop/reload", async ({
  page,
  account,
}) => {
  await submit(page, "https://x.com/javarevisited/article/2020886352838225926");
  await expect(page.getByText("Fetched article", { exact: true })).toBeVisible();
  const article = await download(page, "Markdown", true);
  expect(article.text.length).toBeGreaterThan(200);
  expect(article.filename).toMatch(/\.md$/);
  expect(await balance(account.id)).toBe(99);
  for (const input of ["https://x.com/burakeregar/status/2020852442230120752", "@frixaco"]) {
    await submit(page, input);
    const id = await currentJob(page);
    await expect(page.getByText("Complete", { exact: true })).toBeVisible({ timeout: 120000 });
    const row = await jobRow(id);
    expect(row.stored_tweets).toBeGreaterThan(0);
    expect(row.runner_id).toBeNull();
    const stored = await db.query(
      "SELECT tweet_id FROM xport_fetch_tweets WHERE job_id=$1 ORDER BY seq",
      [id],
    );
    for (const format of ["Markdown", "JSON"] as const) {
      const exported = await download(page, format);
      for (const tweet of stored.rows) expect(exported.text).toContain(tweet.tweet_id);
      if (format === "JSON") {
        const result = JSON.parse(exported.text);
        const tweets = result.mainTweet ? [result.mainTweet, ...result.tweets] : result.tweets;
        expect(tweets).toHaveLength(stored.rows.length);
        expect(tweets.map((tweet: { id: string }) => tweet.id)).toEqual(
          expect.arrayContaining(stored.rows.map((tweet) => tweet.tweet_id)),
        );
      }
    }
  }
  await submit(page, "@frixaco");
  const id = await currentJob(page);
  await expect
    .poll(async () => (await jobRow(id)).pages_fetched, { intervals: [100] })
    .toBeGreaterThanOrEqual(1);
  await page.reload();
  await page.getByRole("button", { name: "Stop fetching", exact: true }).click();
  await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible();
  const row = await jobRow(id);
  expect(row.pages_fetched).toBeLessThanOrEqual(2);
  expect(row.runner_id).toBeNull();
  expect((await download(page, "JSON")).filename).toBe("frixaco-user-posts-partial.json");
});

test("real Polar sandbox: checkout, signed provider webhook, local credits and usage delivery", async ({
  page,
  account,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Top up credits" }).click();
  await page.getByRole("button", { name: /^125 credits/ }).click();
  await expect(page).toHaveURL(/sandbox.*polar\.sh/);
  // Stripe embeds payment fields; inspect each frame rather than relying on generated frame IDs.
  for (const [label, value] of [
    ["Card number", "4242424242424242"],
    ["Expiration", "1230"],
    ["Security code", "123"],
  ] as const) {
    await expect(async () => {
      const fields = page
        .frames()
        .map((frame) => frame.getByRole("textbox", { name: new RegExp(label, "i") }));
      for (const field of fields)
        if (await field.count()) {
          await field.first().fill(value);
          return;
        }
      throw new Error(`Payment field unavailable: ${label}`);
    }).toPass({ timeout: 30000 });
  }
  const name = page.getByRole("textbox", { name: /cardholder|billing name|full name/i });
  if (await name.count()) await name.first().fill("Xport Test");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Uzbekistan", exact: true }).click();
  await page.getByRole("button", { name: /^(pay|purchase|subscribe)/i }).click();
  await expect
    .poll(() => new URL(page.url()).origin, { timeout: 60000 })
    .toBe(process.env.BETTER_AUTH_URL);
  await expect.poll(() => balance(account.id), { timeout: 60000 }).toBe(225);
  await expect(page.locator("header").getByText("225", { exact: true })).toBeVisible();
  await submit(page, "https://x.com/javarevisited/article/2020886352838225926");
  await expect(page.getByText("Fetched article", { exact: true })).toBeVisible();
  expect(await balance(account.id)).toBe(224);
  await expect
    .poll(
      async () => {
        const r = await db.query(
          "SELECT count(*)::int AS delivered FROM xport_credit_transactions WHERE user_id=$1 AND type='usage' AND polar_payload IS NOT NULL AND polar_delivered_at IS NOT NULL",
          [account.id],
        );
        return r.rows[0].delivered;
      },
      { timeout: 90000 },
    )
    .toBe(1);
});
