import { spawn } from "node:child_process";
import process from "node:process";
import { assertNoArgs, CliError, sleep, type CommandContext } from "./common.ts";
import { clearConfig, requireToken, writeStoredToken } from "./config.ts";
import { extractErrorMessage, isObject } from "./core.ts";
import { apiUrl, readResponsePayload, requestJson } from "./http.ts";

const CLIENT_ID = "xport-cli";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface DeviceTokenError {
  error?: string;
  error_description?: string;
  message?: string;
}

interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
  };
  credits: number | null;
}

async function requestDeviceCode(ctx: CommandContext): Promise<DeviceCodeResponse> {
  return requestJson<DeviceCodeResponse>(ctx, "/api/auth/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "export",
    }),
  });
}

async function requestDeviceToken(
  ctx: CommandContext,
  deviceCode: string,
): Promise<{ ok: true; payload: DeviceTokenResponse } | { ok: false; payload: DeviceTokenError }> {
  const response = await fetch(apiUrl(ctx, "/api/auth/device/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: DEVICE_GRANT_TYPE,
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  const payload = await readResponsePayload(response);
  return response.ok
    ? { ok: true, payload: payload as DeviceTokenResponse }
    : { ok: false, payload: isObject(payload) ? payload : {} };
}

function openBrowser(url: string): boolean {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function parseLoginArgs(args: string[]): { open: boolean } | "help" {
  let open = true;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    throw new CliError(`Unknown login option: ${arg}`);
  }
  return { open };
}

export async function commandLogin(ctx: CommandContext, args: string[]): Promise<void> {
  const options = parseLoginArgs(args);
  if (options === "help") {
    process.stdout.write("Usage:\n  xport login [--no-open]\n");
    return;
  }

  const code = await requestDeviceCode(ctx);
  process.stdout.write(
    `Open this URL to authorize the CLI:\n${code.verification_uri_complete}\n\n`,
  );
  process.stdout.write(`Code: ${code.user_code}\n\n`);

  if (options.open) {
    const opened = openBrowser(code.verification_uri_complete);
    if (opened) process.stdout.write("Opened your browser.\n");
  }

  process.stdout.write("Waiting for authorization...\n");
  let pollIntervalMs = Math.max(1, code.interval || DEFAULT_POLL_INTERVAL_SECONDS) * 1000;
  const expiresAt = Date.now() + Math.max(1, code.expires_in) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(pollIntervalMs);
    const result = await requestDeviceToken(ctx, code.device_code);
    if (result.ok) {
      const expiresAtIso = new Date(Date.now() + result.payload.expires_in * 1000).toISOString();
      const me = await requestJson<MeResponse>(ctx, "/api/cli/me", {
        token: result.payload.access_token,
      });
      await writeStoredToken(ctx, {
        token: result.payload.access_token,
        tokenType: result.payload.token_type,
        expiresAt: expiresAtIso,
      });
      process.stdout.write(`Logged in as ${me.user.email}.\n`);
      return;
    }

    if (result.payload.error === "authorization_pending") continue;
    if (result.payload.error === "slow_down") {
      pollIntervalMs += 5000;
      continue;
    }
    if (result.payload.error === "access_denied") {
      throw new CliError("Authorization denied.");
    }
    if (result.payload.error === "expired_token") {
      throw new CliError("Authorization code expired. Run `xport login` again.");
    }

    throw new CliError(extractErrorMessage(result.payload) ?? "Device authorization failed.");
  }

  throw new CliError("Authorization timed out. Run `xport login` again.");
}

export async function commandLogout(args: string[]): Promise<void> {
  if (!assertNoArgs("logout", args)) return;
  await clearConfig();
  process.stdout.write("Logged out.\n");
}

async function fetchMe(ctx: CommandContext): Promise<MeResponse> {
  const token = await requireToken(ctx);
  return requestJson<MeResponse>(ctx, "/api/cli/me", { token });
}

export async function commandWhoami(ctx: CommandContext, args: string[]): Promise<void> {
  if (!assertNoArgs("whoami", args)) return;
  const me = await fetchMe(ctx);
  process.stdout.write(`${me.user.name} <${me.user.email}>\n`);
  process.stdout.write(`Credits: ${me.credits ?? "unavailable"}\n`);
}

export async function commandCredits(ctx: CommandContext, args: string[]): Promise<void> {
  if (!assertNoArgs("credits", args)) return;
  const me = await fetchMe(ctx);
  if (me.credits === null) throw new CliError("Credit balance unavailable.");
  process.stdout.write(`${me.credits}\n`);
}
