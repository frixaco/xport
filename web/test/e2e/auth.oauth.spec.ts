import { test, expect, chromium } from "@playwright/test";
import { db } from "./fixtures";

// Explicitly invoked only: reuses the signed-in Helium profile, never closes its tabs.
const baseURL = process.env.BETTER_AUTH_URL!;
for (const provider of ["GitHub", "Google"])
  test(`live ${provider} OAuth round trip`, async () => {
    const browser = await chromium.connectOverCDP(
      process.env.XPORT_BROWSER_CDP || "http://127.0.0.1:9222",
      { noDefaults: true }, // Preserve settings in the existing personal browser.
    );
    const context = browser.contexts()[0];
    if (!context)
      throw new Error(
        "Open Helium with the existing signed-in profile and remote debugging on port 9222",
      );
    const savedCookies = (await context.cookies(baseURL)).filter((c) =>
      c.name.startsWith("better-auth."),
    );
    const page = await context.newPage();
    try {
      await context.clearCookies({ domain: "localhost", name: /^better-auth\./ });
      await page.goto(baseURL);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: `Continue with ${provider}` }).click();
      await expect(async () => {
        if (
          page.url().includes("redirect_uri_mismatch") ||
          (await page.locator("body").innerText()).includes("redirect_uri_mismatch")
        ) {
          throw new Error(
            `Register ${baseURL}/api/auth/callback/${provider.toLowerCase()} with the OAuth client`,
          );
        }
        // Existing Google sessions may show an account chooser; choose a known sandbox identity.
        if (page.url().includes("/accountchooser")) {
          const accounts = await db.query('SELECT email FROM "user"');
          for (const { email } of accounts.rows) {
            const option = page.getByRole("link").filter({ hasText: email });
            if (await option.first().isVisible()) {
              await option.first().click();
              break;
            }
          }
        }
        const authorize = page.getByRole("button", {
          name: /^(Authorize|Continue$)/i,
        });
        if (await authorize.first().isVisible()) await authorize.first().click();
        await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
          timeout: 3000,
        });
      }).toPass({ timeout: 60000 });
      const session = await page.evaluate(async () =>
        (await fetch("/api/auth/get-session")).json(),
      );
      expect(session.user.id).toBeTruthy();
      const stored = await db.query(
        "SELECT count(*)::int AS count FROM account WHERE user_id=$1 AND provider_id=$2",
        [session.user.id, provider.toLowerCase()],
      );
      expect(stored.rows[0].count).toBe(1);
      const grants = await db.query(
        "SELECT count(*)::int AS count FROM xport_credit_transactions WHERE user_id=$1 AND type='signup'",
        [session.user.id],
      );
      expect(grants.rows[0].count).toBe(0);
      // Keyboard navigation stays usable when a personal browser extension overlays the header.
      await page.getByRole("button", { name: "Account menu" }).focus();
      await page.getByRole("button", { name: "Account menu" }).press("Enter");
      await page.getByRole("menuitem", { name: "Sign out" }).focus();
      await page.getByRole("menuitem", { name: "Sign out" }).press("Enter");
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    } finally {
      try {
        await page.close();
      } finally {
        try {
          await context.clearCookies({ domain: "localhost", name: /^better-auth\./ });
          await context.addCookies(savedCookies);
        } finally {
          // For connectOverCDP, close disconnects this client; it does not terminate Helium.
          await browser.close();
        }
      }
    }
  });
