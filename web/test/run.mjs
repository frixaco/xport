import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { Polar } from "@polar-sh/sdk";
import { startPolarRelay } from "./polar-relay.mjs";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const name = `xport-test-${randomUUID()}`;
const env = {
  ...process.env,
  BETTER_AUTH_URL: "http://localhost:3210",
  SITE_URL: "http://localhost:3210",
  BETTER_AUTH_SECRET: "xport-test-secret-only-at-least-32-characters",
  POLAR_ENV: "sandbox",
  SANDBOX_POLAR_ACCESS_TOKEN: "test-only",
  POLAR_ACCESS_TOKEN: "",
  SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID: "product-test",
  SANDBOX_POLAR_CREDITS_500_CREDITS_PRODUCT_ID: "product-large-test",
  POLAR_WEBHOOK_SECRET: "local-test-only",
  GITHUB_CLIENT_ID: "test-only",
  GITHUB_CLIENT_SECRET: "test-only",
  GOOGLE_CLIENT_ID: "test-only",
  GOOGLE_CLIENT_SECRET: "test-only",
  X_API_URL: "http://localhost:3211",
  X_API_KEY: "test-only",
  PUBLIC_POSTHOG_KEY: "",
  POSTHOG_KEY: "",
  BILLING_MAINTENANCE: "false",
};
const oauth = process.argv.includes("--oauth");
const live = oauth || process.argv.includes("--live");
const abort = new AbortController();
if (live) {
  const local = parseEnv(readFileSync(".env.local", "utf8"));
  if (local.POLAR_ENV !== "sandbox") throw new Error("Live tests require POLAR_ENV=sandbox");
  for (const key of [
    "SANDBOX_POLAR_ACCESS_TOKEN",
    ...(oauth
      ? ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
      : [
          "SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID",
          "SANDBOX_POLAR_CREDITS_500_CREDITS_PRODUCT_ID",
          "X_API_URL",
          "X_API_KEY",
        ]),
  ]) {
    if (!local[key]) throw new Error(`Live test configuration missing: ${key}`);
    env[key] = local[key];
  }
  if (!oauth) {
    env.XPORT_TEST_EMAIL = local.XPORT_TEST_EMAIL || process.env.XPORT_TEST_EMAIL;
    if (!env.XPORT_TEST_EMAIL) {
      const source = new URL(local.DATABASE_URL);
      if (!["localhost", "127.0.0.1"].includes(source.hostname))
        throw new Error("Set XPORT_TEST_EMAIL for live sandbox customers");
      const sourceDb = new Pool({ connectionString: local.DATABASE_URL });
      try {
        env.XPORT_TEST_EMAIL = (
          await sourceDb.query('SELECT email FROM "user" ORDER BY created_at LIMIT 1')
        ).rows[0]?.email;
      } finally {
        await sourceDb.end();
      }
    }
    if (!env.XPORT_TEST_EMAIL) throw new Error("No stored test identity; set XPORT_TEST_EMAIL");
  }
  const port = Number(process.env.XPORT_TEST_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid XPORT_TEST_PORT");
  env.BETTER_AUTH_URL = env.SITE_URL = `http://localhost:${port}`;
}
env.E2E_MODE = oauth ? "oauth" : live ? "live" : "local";
let child;
async function run(command, args) {
  abort.signal.throwIfAborted();
  child =
    command === "pnpm"
      ? spawn("/bin/sh", ["-c", 'exec pnpm "$@"', "pnpm", ...args], {
          env,
          stdio: "inherit",
          detached: true,
        })
      : spawn(command, args, { env, stdio: "inherit", detached: true });
  const [code] = await once(child, "exit");
  child = undefined;
  abort.signal.throwIfAborted();
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed (${code})`);
}
function cancel(reason) {
  abort.abort(reason);
  if (child) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => cancel(new Error(`Test run interrupted (${signal})`)));
try {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_PASSWORD=test-only",
      "-e",
      "POSTGRES_DB=xport_test",
      "-p",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    ],
    { stdio: "pipe" },
  );
  const port = execFileSync("docker", ["port", name, "5432"], { encoding: "utf8" })
    .trim()
    .split(":")
    .at(-1);
  env.DATABASE_URL = `postgresql://postgres:test-only@127.0.0.1:${port}/xport_test`;
  for (let attempt = 0; ; attempt++) {
    try {
      execFileSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], {
        stdio: "pipe",
      });
      break;
    } catch {
      if (attempt === 60) throw new Error("Test PostgreSQL did not start");
      await delay(500, undefined, { signal: abort.signal });
    }
  }
  if (live) {
    await run("pnpm", ["db:migrate"]);
    const polar = new Polar({ accessToken: env.SANDBOX_POLAR_ACCESS_TOKEN, server: "sandbox" });
    if (oauth) {
      // Reuse provider identities, never reassign an existing Polar customer to a new user ID.
      const target = new Pool({ connectionString: env.DATABASE_URL });
      try {
        for await (const page of await polar.customers.list({ limit: 100 })) {
          for (const customer of page.result.items) {
            if (!customer.externalId || customer.metadata.xport_test || customer.deletedAt)
              continue;
            await target.query(
              'INSERT INTO "user"(id,name,email,email_verified) VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING',
              [customer.externalId, customer.name || "Test account", customer.email],
            );
            await target.query(
              "INSERT INTO xport_credit_transactions(operation_key,user_id,amount,type) VALUES($1,$2,0,'opening') ON CONFLICT DO NOTHING",
              [`polar-opening-balance:v1:${customer.externalId}`, customer.externalId],
            );
          }
        }
      } finally {
        await target.end();
      }
    } else {
      const product = await polar.products.get({
        id: env.SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID,
      });
      const relay = await startPolarRelay(
        env.SANDBOX_POLAR_ACCESS_TOKEN,
        product.organizationId,
        `${env.BETTER_AUTH_URL}/api/auth/polar/webhooks`,
        abort.signal,
      );
      env.POLAR_WEBHOOK_SECRET = relay.secret;
      relay.stream.catch((error) => {
        if (!abort.signal.aborted) cancel(error);
      });
    }
  } else {
    await run("pnpm", ["--filter", "@frixaco/xport", "build"]);
    await run("node", [
      "--test",
      "../core/test/account-replies.test.ts",
      "../core/test/url-parser.test.ts",
      "test/runner.test.mjs",
    ]);
    await run("node", ["--test", "test/billing.test.ts"]);
  }
  await run("pnpm", ["build"]);
  await run("pnpm", [
    "exec",
    "playwright",
    "test",
    ...process.argv.slice(2).filter((arg) => arg !== "--live" && arg !== "--oauth"),
  ]);
} finally {
  abort.abort();
  execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}
