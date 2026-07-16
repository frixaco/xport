import { constants } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildFetchJobResult,
  buildRequestConfig,
  detectUrlType,
  getDownloadPayload,
  hasExportablePosts,
  isTerminalFetchJobStatus,
  normalizeResult,
  normalizeTweetCards,
  parseUsername,
  type FetchJobRequestType,
  type FetchJobResumeResponse,
  type FetchJobStatusResponse,
  type ResultExportFormat,
  type ResultState,
  type TweetCardModel,
} from "./core.ts";
import { CliError, log, sleep, type CommandContext } from "./common.ts";
import { requireToken } from "./config.ts";
import { requestJson } from "./http.ts";

const EXPORT_FETCH_PAGE_SIZE = 100;

interface ExportOptions {
  format: ResultExportFormat;
  input: string;
  out: string | null;
  quiet: boolean;
  stdout: boolean;
}

interface ActiveFetchJob {
  jobId: string;
  requestType: FetchJobRequestType;
}

interface JobTweetPage {
  tweets: TweetCardModel[];
  mainTweet: TweetCardModel | null;
  total: number;
}

function printExportHelp(): void {
  process.stdout.write(`Usage:
  xport export [options] <input>

Options:
  --format <markdown|json>  Export format (default: markdown)
  --out <path>              Write to a file or existing directory (default: current directory)
  --stdout                  Write export content to stdout
  --quiet                   Hide progress logs
  -h, --help                Show help

Examples:
  xport export --format markdown --out . "https://x.com/burakeregar/status/2020852442230120752"
  xport export --format json --stdout "@frixaco"
`);
}

function printStopHelp(): void {
  process.stdout.write(`Usage:
  xport stop <jobId>

Stops a running export job created by xport export.
`);
}

function readOptionValue(
  args: string[],
  index: number,
  name: string,
): { value: string; nextIndex: number } {
  const arg = args[index]!;
  const equalsValue = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
  if (equalsValue !== null) {
    if (!equalsValue) throw new CliError(`Missing value for ${name}.`);
    return { value: equalsValue, nextIndex: index };
  }

  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new CliError(`Missing value for ${name}.`);
  return { value, nextIndex: index + 1 };
}

function parseFormat(value: string): ResultExportFormat {
  if (value === "markdown" || value === "md") return "markdown";
  if (value === "json") return "json";
  throw new CliError(`Unsupported format: ${value}. Use markdown or json.`);
}

function parseExportArgs(args: string[]): ExportOptions | "help" {
  let format: ResultExportFormat = "markdown";
  let out: string | null = ".";
  let quiet = false;
  let stdout = false;
  let input: string | null = null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") return "help";

    if (arg === "--") {
      input = args[index + 1] ?? null;
      if (!input) throw new CliError("Missing input after --.");
      if (args.length > index + 2) {
        throw new CliError("Unexpected extra arguments after input.");
      }
      break;
    }

    if (!arg.startsWith("-")) {
      input = arg;
      if (args.length > index + 1) {
        const next = args[index + 1]!;
        if (next.startsWith("-")) {
          throw new CliError(
            'Options must come before the input. Use `xport export --format markdown "https://x.com/..."`.',
          );
        }
        throw new CliError(`Unexpected extra argument: ${next}`);
      }
      break;
    }

    if (arg === "--stdout") {
      stdout = true;
      out = null;
      continue;
    }
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const result = readOptionValue(args, index, "--format");
      format = parseFormat(result.value);
      index = result.nextIndex;
      continue;
    }
    if (arg === "--out" || arg.startsWith("--out=")) {
      const result = readOptionValue(args, index, "--out");
      out = result.value;
      stdout = false;
      index = result.nextIndex;
      continue;
    }

    throw new CliError(`Unknown export option: ${arg}`);
  }

  if (!input) throw new CliError("Missing input. Use `xport export [options] <input>`.");
  return { format, input, out, quiet, stdout };
}

function statusSummary(status: FetchJobStatusResponse): string {
  const base = `${status.status}: ${status.storedTweets} stored posts, ${status.chargedCredits} credits charged`;
  return status.error?.message ? `${base} (${status.error.message})` : base;
}

function parseStopArgs(args: string[]): string | "help" {
  if (args.includes("--help") || args.includes("-h")) return "help";
  const [jobId, extra] = args;
  if (!jobId) throw new CliError("Missing job ID. Use `xport stop <jobId>`.");
  if (extra) throw new CliError(`Unexpected extra argument: ${extra}`);
  return jobId;
}

async function createFetchJob(
  ctx: CommandContext,
  token: string,
  input: string,
): Promise<{ jobId: string }> {
  return requestJson<{ jobId: string }>(ctx, "/api/fetch-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    token,
  });
}

async function fetchJobStatus(
  ctx: CommandContext,
  token: string,
  jobId: string,
): Promise<FetchJobResumeResponse> {
  return requestJson<FetchJobResumeResponse>(
    ctx,
    `/api/fetch-jobs/${encodeURIComponent(jobId)}/status`,
    { token },
  );
}

async function stopFetchJob(
  ctx: CommandContext,
  token: string,
  jobId: string,
): Promise<FetchJobStatusResponse> {
  return requestJson<FetchJobStatusResponse>(
    ctx,
    `/api/fetch-jobs/${encodeURIComponent(jobId)}/stop`,
    {
      method: "POST",
      token,
    },
  );
}

async function fetchJobTweetPage(
  ctx: CommandContext,
  token: string,
  job: ActiveFetchJob,
  offset: number,
): Promise<JobTweetPage> {
  const data = await requestJson<{ tweets?: unknown[]; mainTweet?: unknown; total?: number }>(
    ctx,
    `/api/fetch-jobs/${encodeURIComponent(job.jobId)}/tweets?offset=${offset}&limit=${EXPORT_FETCH_PAGE_SIZE}`,
    { token },
  );
  const mainTweet =
    job.requestType === "thread" && data.mainTweet
      ? (normalizeTweetCards([data.mainTweet])[0] ?? null)
      : null;

  return {
    tweets: normalizeTweetCards(data.tweets ?? []),
    mainTweet,
    total: typeof data.total === "number" ? data.total : 0,
  };
}

async function fetchAllTweets(
  ctx: CommandContext,
  token: string,
  job: ActiveFetchJob,
  status: FetchJobStatusResponse,
): Promise<{ tweets: TweetCardModel[]; mainTweet: TweetCardModel | null }> {
  const tweets: TweetCardModel[] = [];
  const seenIds = new Set<string>();
  let mainTweet: TweetCardModel | null = null;
  let offset = 0;
  let total = 0;

  while (true) {
    const page = await fetchJobTweetPage(ctx, token, job, offset);
    total = Math.max(total, page.total);
    if (page.mainTweet) mainTweet = page.mainTweet;

    for (const tweet of page.tweets) {
      if (seenIds.has(tweet.id)) continue;
      seenIds.add(tweet.id);
      tweets.push(tweet);
    }

    if (page.tweets.length === 0) break;

    offset += page.tweets.length;
    if (total > 0 && offset >= total) break;
  }

  if (status.storedTweets > 0 && tweets.length < status.storedTweets) {
    throw new CliError("Export is still syncing. Try again in a moment.");
  }

  return { tweets, mainTweet };
}

async function pollJob(
  ctx: CommandContext,
  token: string,
  jobId: string,
  options: Pick<ExportOptions, "quiet">,
): Promise<FetchJobResumeResponse> {
  let previousSummary = "";

  while (true) {
    const status = await fetchJobStatus(ctx, token, jobId);
    const summary = statusSummary(status);
    if (summary !== previousSummary) {
      log(options, summary);
      previousSummary = summary;
    }
    if (isTerminalFetchJobStatus(status.status)) return status;
    await sleep(2000);
  }
}

async function exportArticle(
  ctx: CommandContext,
  token: string,
  input: string,
): Promise<{ result: ResultState; isPartial: boolean }> {
  const payload = await requestJson<unknown>(
    ctx,
    `/api/article?input=${encodeURIComponent(input)}`,
    { token },
  );
  return { result: normalizeResult(payload, "article", input), isPartial: false };
}

async function exportFetchJob(
  ctx: CommandContext,
  token: string,
  input: string,
  options: Pick<ExportOptions, "quiet">,
): Promise<{ result: ResultState; isPartial: boolean }> {
  const created = await createFetchJob(ctx, token, input);
  process.stderr.write(`Job ID: ${created.jobId}\n`);

  const status = await pollJob(ctx, token, created.jobId, options);
  const job: ActiveFetchJob = { jobId: created.jobId, requestType: status.requestType };
  const { tweets, mainTweet } = await fetchAllTweets(ctx, token, job, status);
  const sourceUsername = parseUsername(status.inputRaw);
  const result = buildFetchJobResult(status.requestType, tweets, mainTweet, status, sourceUsername);
  const isPartial =
    status.status === "stopped" || (status.status === "failed" && hasExportablePosts(result));

  if (status.status === "failed" && !hasExportablePosts(result)) {
    throw new CliError(status.error?.message ?? "Fetch job failed.");
  }

  return { result, isPartial };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveOutputPath(output: string | null, filename: string): Promise<string> {
  const target = path.resolve(output ?? ".");
  if (await pathExists(target)) {
    const targetStat = await stat(target);
    return targetStat.isDirectory() ? path.join(target, filename) : target;
  }

  if (output && (output.endsWith(path.sep) || output.endsWith("/") || output.endsWith("\\"))) {
    await mkdir(target, { recursive: true });
    return path.join(target, filename);
  }

  await mkdir(path.dirname(target), { recursive: true });
  return target;
}

async function writeExport(
  payload: { content: string; filename: string; label: string; mimeType: string },
  options: ExportOptions,
): Promise<void> {
  if (options.stdout) {
    process.stdout.write(payload.content);
    return;
  }

  const target = await resolveOutputPath(options.out, payload.filename);
  await writeFile(target, payload.content, "utf8");
  log(options, `${payload.label} written to ${target}.`);
}

export async function commandExport(ctx: CommandContext, args: string[]): Promise<void> {
  const options = parseExportArgs(args);
  if (options === "help") {
    printExportHelp();
    return;
  }

  const inputType = detectUrlType(options.input);
  const requestConfig = buildRequestConfig(options.input, inputType);
  if (inputType === "Bookmarks") {
    throw new CliError("Bookmarks export is not available yet.");
  }
  if (!requestConfig) {
    throw new CliError("Invalid input. Provide a valid X (ex-Twitter) URL or @username.");
  }

  const token = await requireToken(ctx);
  const exported =
    requestConfig.type === "article"
      ? await exportArticle(ctx, token, options.input)
      : await exportFetchJob(ctx, token, options.input, options);

  const payload = getDownloadPayload(exported.result, options.format, {
    isPartial: exported.isPartial,
  });
  await writeExport(payload, options);
}

export async function commandStop(ctx: CommandContext, args: string[]): Promise<void> {
  const jobId = parseStopArgs(args);
  if (jobId === "help") {
    printStopHelp();
    return;
  }

  const token = await requireToken(ctx);
  let status = await stopFetchJob(ctx, token, jobId);
  while (!isTerminalFetchJobStatus(status.status)) {
    await sleep(2000);
    status = await fetchJobStatus(ctx, token, jobId);
  }
  process.stdout.write(`${statusSummary(status)}\n`);
}
