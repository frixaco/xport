import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { CliError, normalizeBaseUrl, type CommandContext } from "./common.ts";
import { isObject } from "./core.ts";

interface ConfigFile {
  baseUrl?: string;
  token?: string;
  tokenType?: string;
  expiresAt?: string;
}

interface StoredTokenInput {
  token: string;
  tokenType: string;
  expiresAt: string;
}

function configDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  return xdgConfigHome && xdgConfigHome.trim().length > 0
    ? path.join(xdgConfigHome, "xport")
    : path.join(homedir(), ".config", "xport");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readConfig(): Promise<ConfigFile> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? (parsed as ConfigFile) : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeConfig(config: ConfigFile): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath(), 0o600).catch(() => undefined);
}

export async function clearConfig(): Promise<void> {
  await writeConfig({});
}

export async function writeStoredToken(
  ctx: CommandContext,
  token: StoredTokenInput,
): Promise<void> {
  await writeConfig({
    baseUrl: ctx.baseUrl,
    token: token.token,
    tokenType: token.tokenType,
    expiresAt: token.expiresAt,
  });
}

async function getStoredToken(ctx: CommandContext): Promise<string | null> {
  const envToken = process.env.XPORT_TOKEN?.trim();
  if (envToken) return envToken;

  const config = await readConfig();
  if (!config.token) return null;
  if (config.baseUrl && normalizeBaseUrl(config.baseUrl) !== ctx.baseUrl) return null;
  if (config.expiresAt && Date.parse(config.expiresAt) <= Date.now()) return null;
  return config.token;
}

export async function requireToken(ctx: CommandContext): Promise<string> {
  const token = await getStoredToken(ctx);
  if (!token) {
    throw new CliError("Not logged in. Run `xport login` first, or set XPORT_TOKEN.");
  }
  return token;
}
