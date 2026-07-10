export const DEFAULT_BASE_URL = "https://xport.frixaco.com";

export interface CommandContext {
  baseUrl: string;
}

export class CliError extends Error {
  exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function normalizeBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new CliError(`Invalid XPORT_BASE_URL: ${raw}`);
  }
}

export function log(options: { quiet?: boolean }, message: string): void {
  if (options.quiet) return;
  process.stderr.write(`${message}\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertNoArgs(command: string, args: string[]): boolean {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`Usage:\n  xport ${command}\n`);
    return false;
  }
  if (args.length > 0) {
    throw new CliError(`Unexpected argument for ${command}: ${args[0]}`);
  }
  return true;
}
