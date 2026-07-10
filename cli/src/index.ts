#!/usr/bin/env node
import process from "node:process";
import { commandCredits, commandLogin, commandLogout, commandWhoami } from "./auth.ts";
import { CliError, DEFAULT_BASE_URL, normalizeBaseUrl, type CommandContext } from "./common.ts";
import { commandExport } from "./export.ts";

function printHelp(): void {
  process.stdout.write(`Xport CLI

Usage:
  xport login [--no-open]
  xport logout
  xport whoami
  xport credits
  xport export [options] <input>

Export options must come before the input.

Options:
  --format <markdown|json>  Export format (default: markdown)
  --out <path>              Write to a file or existing directory (default: current directory)
  --stdout                  Write export content to stdout
  --quiet                   Hide progress logs
  -h, --help                Show help

Environment:
  XPORT_BASE_URL            API base URL (default: ${DEFAULT_BASE_URL})
  XPORT_TOKEN               Bearer token for non-interactive use

Examples:
  xport login
  xport export --format markdown --out . "https://x.com/burakeregar/status/2020852442230120752"
  xport export --format json --stdout "@frixaco"
`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const ctx: CommandContext = {
    baseUrl: normalizeBaseUrl(process.env.XPORT_BASE_URL),
  };

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "login":
      await commandLogin(ctx, args);
      return;
    case "logout":
      await commandLogout(args);
      return;
    case "whoami":
      await commandWhoami(ctx, args);
      return;
    case "credits":
      await commandCredits(ctx, args);
      return;
    case "export":
      await commandExport(ctx, args);
      return;
    default:
      throw new CliError(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
