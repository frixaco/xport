"use client";

import { SubmitEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Copy, Download, LoaderCircle, Square } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToolCards } from "@/components/tool-cards";
import { cn } from "@/lib/utils";
import { parseUsername } from "@/lib/url-parser";
import type {
  FetchJobRequestType,
  FetchJobResumeResponse,
  FetchJobStatusResponse,
  ResultState,
  TweetCardModel,
} from "./types";
import {
  buildRequestConfig,
  detectUrlType,
  detectedBadgeColor,
  examples,
  extractErrorMessage,
  extractUsernameFromTweetCard,
  hasRenderableContent,
  normalizeResult,
  normalizeTweetCards,
} from "./utils";
import { ResultDisplay, ResultDisplayLoading } from "./result-display";
import {
  downloadActions,
  getDownloadPayload,
  getMarkdownCopyPayload,
  type ResultExportFormat,
} from "./copy-formats";

const POLL_INTERVAL_MS = 2000;
const TWEETS_PAGE_SIZE = 20;
const EXPORT_FETCH_PAGE_SIZE = 100;
const JOB_ID_QUERY_PARAM = "jobId";
const INPUT_QUERY_PARAM = "input";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}

function buildJobResult(
  requestType: FetchJobRequestType,
  tweets: TweetCardModel[],
  mainTweet: TweetCardModel | null,
  jobStatus: FetchJobStatusResponse,
  sourceUsername: string | null,
): ResultState {
  const usage = {
    charged: jobStatus.chargedCredits > 0,
    chargedCredits: jobStatus.chargedCredits,
    tweetCount: jobStatus.storedTweets,
  };
  const username =
    sourceUsername ??
    extractUsernameFromTweetCard(mainTweet) ??
    extractUsernameFromTweetCard(tweets[0]);

  if (requestType === "thread") {
    const threadTweets = mainTweet ? tweets.filter((tweet) => tweet.id !== mainTweet.id) : tweets;
    return {
      kind: "thread",
      mainTweet,
      tweets: threadTweets,
      username,
      label: "Thread posts",
      usage,
    };
  }

  return {
    kind: "user-tweets",
    tweets: mainTweet ? [mainTweet, ...tweets] : tweets,
    username,
    label: "User posts",
    usage,
  };
}

interface JobTweetPage {
  cards: TweetCardModel[];
  mainTweet: TweetCardModel | null;
  total: number;
}

interface ActiveJob {
  jobId: string;
  requestType: FetchJobRequestType;
  sourceUsername: string | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

async function fetchArticleResult(input: string): Promise<ResultState> {
  const payload = await fetchJson<unknown>(`/api/article?input=${encodeURIComponent(input)}`, {
    method: "GET",
    cache: "no-store",
  });
  return normalizeResult(payload, "article", input);
}

async function createFetchJob(input: string): Promise<{ jobId: string }> {
  return fetchJson<{ jobId: string }>("/api/fetch-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

async function fetchJobStatus(jobId: string): Promise<FetchJobResumeResponse> {
  const response = await fetch(`/api/fetch-jobs/${jobId}/status`, {
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new Error("Sign in to resume this fetch job.");
  }

  if (response.status === 404) {
    throw new Error("Fetch job not found.");
  }

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }

  return (await response.json()) as FetchJobResumeResponse;
}

async function stopFetchJob(jobId: string): Promise<FetchJobStatusResponse> {
  const response = await fetch(`/api/fetch-jobs/${jobId}/stop`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }

  return (await response.json()) as FetchJobStatusResponse;
}

async function fetchJobTweetPage(
  jobId: string,
  requestType: FetchJobRequestType,
  offset: number,
  limit: number,
): Promise<JobTweetPage> {
  const response = await fetch(`/api/fetch-jobs/${jobId}/tweets?offset=${offset}&limit=${limit}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    tweets?: unknown[];
    mainTweet?: unknown;
    total?: number;
  };
  const mainTweet =
    requestType === "thread" && data.mainTweet
      ? (normalizeTweetCards([data.mainTweet])[0] ?? null)
      : null;

  return {
    cards: normalizeTweetCards(data.tweets ?? []),
    mainTweet,
    total: typeof data.total === "number" ? data.total : 0,
  };
}

async function fetchAllTweetsForExport(
  job: ActiveJob,
  status: FetchJobStatusResponse,
): Promise<{ tweets: TweetCardModel[]; mainTweet: TweetCardModel | null }> {
  const tweets: TweetCardModel[] = [];
  const seenIds = new Set<string>();
  let mainTweet: TweetCardModel | null = null;
  let offset = 0;
  let total = 0;

  while (true) {
    const page = await fetchJobTweetPage(
      job.jobId,
      job.requestType,
      offset,
      EXPORT_FETCH_PAGE_SIZE,
    );

    total = Math.max(total, page.total);
    if (page.mainTweet) mainTweet = page.mainTweet;

    page.cards.forEach((card) => {
      if (seenIds.has(card.id)) return;
      seenIds.add(card.id);
      tweets.push(card);
    });

    if (page.cards.length === 0) break;

    offset += page.cards.length;
    if (total > 0 && offset >= total) break;
  }

  if (status.storedTweets > 0 && tweets.length < status.storedTweets) {
    throw new Error("Export is still syncing. Try again in a moment.");
  }

  return { tweets, mainTweet };
}

function hasExportablePosts(result: ResultState): boolean {
  if (result.kind === "thread") return Boolean(result.mainTweet) || result.tweets.length > 0;
  if (result.kind === "user-tweets") return result.tweets.length > 0;
  return false;
}

function getLoadedTweetCount(pages: JobTweetPage[]): number {
  return pages.reduce((sum, page) => sum + page.cards.length, 0);
}

function getUniqueTweets(pages: JobTweetPage[]): TweetCardModel[] {
  const seenIds = new Set<string>();
  const tweets: TweetCardModel[] = [];

  pages.forEach((page) => {
    page.cards.forEach((tweet) => {
      if (seenIds.has(tweet.id)) return;
      seenIds.add(tweet.id);
      tweets.push(tweet);
    });
  });

  return tweets;
}

function getErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

export function HeroInput() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [markdownCopied, setMarkdownCopied] = useState(false);

  const markdownCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detected = detectUrlType(value);

  const articleMutation = useMutation({
    mutationFn: fetchArticleResult,
  });
  const createJobMutation = useMutation({
    mutationFn: createFetchJob,
    onSuccess: ({ jobId }) => {
      setJobIdInUrl(jobId);
    },
  });
  const resumeJobMutation = useMutation({
    mutationFn: fetchJobStatus,
    onSuccess: (payload, jobId) => {
      setValue(payload.inputRaw);
      queryClient.setQueryData(["fetch-job", "status", jobId], payload);
    },
  });

  const activeJob: ActiveJob | null =
    resumeJobMutation.data && resumeJobMutation.variables
      ? {
          jobId: resumeJobMutation.variables,
          requestType: resumeJobMutation.data.requestType,
          sourceUsername: parseUsername(resumeJobMutation.data.inputRaw),
        }
      : createJobMutation.data && createJobMutation.variables
        ? {
            jobId: createJobMutation.data.jobId,
            requestType:
              buildRequestConfig(
                createJobMutation.variables,
                detectUrlType(createJobMutation.variables),
              )?.type === "thread"
                ? "thread"
                : "user",
            sourceUsername: parseUsername(createJobMutation.variables),
          }
        : null;

  const jobStatusQuery = useQuery({
    queryKey: ["fetch-job", "status", activeJob?.jobId],
    queryFn: () => fetchJobStatus(activeJob!.jobId),
    enabled: Boolean(activeJob),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalStatus(status) ? false : POLL_INTERVAL_MS;
    },
  });
  const jobStatus = jobStatusQuery.data ?? null;
  const jobTweetsQuery = useInfiniteQuery({
    queryKey: ["fetch-job", "tweets", activeJob?.jobId],
    queryFn: ({ pageParam }) =>
      fetchJobTweetPage(activeJob!.jobId, activeJob!.requestType, pageParam, TWEETS_PAGE_SIZE),
    initialPageParam: 0,
    enabled: Boolean(activeJob),
    refetchInterval: jobStatus && !isTerminalStatus(jobStatus.status) ? POLL_INTERVAL_MS : false,
    getNextPageParam: (lastPage, pages) => {
      const loadedCount = getLoadedTweetCount(pages);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    },
  });
  const stopJobMutation = useMutation({
    mutationFn: stopFetchJob,
    onSuccess: (status) => {
      if (!activeJob) return;
      queryClient.setQueryData(["fetch-job", "status", activeJob.jobId], {
        ...jobStatusQuery.data,
        ...status,
      });
      queryClient.invalidateQueries({ queryKey: ["fetch-job", "status", activeJob.jobId] });
    },
    onError: () => {
      toast.error("Failed to stop fetch.");
    },
  });

  const isLoading =
    articleMutation.isPending || createJobMutation.isPending || resumeJobMutation.isPending;
  const isStopping = stopJobMutation.isPending;
  const isJobActive = Boolean(jobStatus && !isTerminalStatus(jobStatus.status));
  const jobPages = jobTweetsQuery.data?.pages ?? [];
  const jobTweets = getUniqueTweets(jobPages);
  const jobMainTweet = jobPages.find((page) => page.mainTweet)?.mainTweet ?? null;
  const jobResult =
    activeJob && jobStatus
      ? buildJobResult(
          activeJob.requestType,
          jobTweets,
          jobMainTweet,
          jobStatus,
          activeJob.sourceUsername,
        )
      : null;
  const displayedResult = articleMutation.data ?? jobResult;
  const error =
    validationError ??
    getErrorMessage(
      articleMutation.error ?? createJobMutation.error,
      "Unexpected error while exporting.",
    ) ??
    getErrorMessage(resumeJobMutation.error, "Unexpected error while resuming fetch job.") ??
    getErrorMessage(jobStatusQuery.error, "Unexpected error while fetching job status.");
  const hasResults = hasRenderableContent(displayedResult);
  const showResultLayout = isLoading || Boolean(displayedResult) || Boolean(error) || isJobActive;
  const isActive = isLoading || hasResults || Boolean(error) || isJobActive;

  function setJobIdInUrl(jobId: string | null, options?: { clearInput?: boolean }) {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const currentJobId = url.searchParams.get(JOB_ID_QUERY_PARAM);
    const clearInput = options?.clearInput ?? false;
    let hasChanges = false;

    if (jobId) {
      if (currentJobId !== jobId) {
        url.searchParams.set(JOB_ID_QUERY_PARAM, jobId);
        hasChanges = true;
      }
    } else if (currentJobId) {
      url.searchParams.delete(JOB_ID_QUERY_PARAM);
      hasChanges = true;
    }

    if (clearInput && url.searchParams.has(INPUT_QUERY_PARAM)) {
      url.searchParams.delete(INPUT_QUERY_PARAM);
      hasChanges = true;
    }

    if (!hasChanges) return;

    const nextUrl = url.searchParams.toString()
      ? `${url.pathname}?${url.searchParams.toString()}`
      : url.pathname;
    navigate({ to: nextUrl, replace: true });
  }

  function clearAsyncResults() {
    articleMutation.reset();
    createJobMutation.reset();
    resumeJobMutation.reset();
    stopJobMutation.reset();
    queryClient.removeQueries({ queryKey: ["fetch-job"] });
  }

  function handleBackToHome() {
    if (isLoading) return;
    setJobIdInUrl(null);
    setValidationError(null);
    setMarkdownCopied(false);
    setValue("");
    clearAsyncResults();
  }

  function runExport(rawInput: string, options?: { clearInputQueryParam?: boolean }) {
    if (isLoading) return;

    const trimmed = rawInput.trim();
    if (!trimmed) return;

    const clearInputQueryParam = options?.clearInputQueryParam ?? false;
    const inputType = detectUrlType(trimmed);
    const requestConfig = buildRequestConfig(trimmed, inputType);

    setValidationError(null);
    setMarkdownCopied(false);
    clearAsyncResults();
    setJobIdInUrl(null, { clearInput: clearInputQueryParam });

    if (inputType === "Bookmarks") {
      setValidationError("Bookmarks export is not available yet.");
      return;
    }

    if (!requestConfig) {
      setValidationError("Invalid input. Provide a valid Twitter/X URL or @username.");
      return;
    }

    if (requestConfig.type === "article") {
      articleMutation.mutate(trimmed);
      return;
    }

    createJobMutation.mutate(trimmed);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isJobActive) {
      if (isStopping || !activeJob) return;
      stopJobMutation.mutate(activeJob.jobId);
      return;
    }

    if (isLoading) return;
    runExport(value);
  }

  const startUrlInput = useEffectEvent((input: string) => {
    setValue(input);
    runExport(input, { clearInputQueryParam: true });
  });

  const resumeUrlJob = useEffectEvent((jobId: string) => {
    setValidationError(null);
    clearAsyncResults();
    resumeJobMutation.mutate(jobId);
  });

  const rejectUrlJob = useEffectEvent(() => {
    setValidationError("Invalid job id.");
    setJobIdInUrl(null);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const searchParams = new URLSearchParams(window.location.search);
    const jobId = searchParams.get(JOB_ID_QUERY_PARAM);
    if (jobId) {
      if (UUID_PATTERN.test(jobId)) resumeUrlJob(jobId);
      else rejectUrlJob();
      return;
    }

    const input = searchParams.get(INPUT_QUERY_PARAM);
    if (input) startUrlInput(input);
  }, []);

  async function prepareExportResult(): Promise<ResultState | null> {
    if (!displayedResult) return null;
    if (!activeJob || !jobStatus || displayedResult.kind === "article") return displayedResult;

    const { tweets, mainTweet } = await queryClient.fetchQuery({
      queryKey: ["fetch-job", "export", activeJob.jobId, jobStatus.updatedAt],
      queryFn: () => fetchAllTweetsForExport(activeJob, jobStatus),
    });

    return buildJobResult(
      activeJob.requestType,
      tweets,
      mainTweet,
      jobStatus,
      activeJob.sourceUsername,
    );
  }

  async function handleDownload(format: ResultExportFormat) {
    let exportResult: ResultState | null;
    try {
      exportResult = await prepareExportResult();
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "Failed to prepare export.");
      return;
    }
    if (!exportResult) return;

    const isPartialExport =
      exportResult.kind !== "article" &&
      Boolean(
        jobStatus &&
        (jobStatus.status === "stopped" ||
          (jobStatus.status === "failed" && hasExportablePosts(exportResult))),
      );

    const payload = getDownloadPayload(exportResult, format, {
      isPartial: isPartialExport,
    });

    if (!window.URL?.createObjectURL) {
      toast.error("Download is not available in this browser.");
      return;
    }

    try {
      const blob = new Blob([payload.content], {
        type: `${payload.mimeType};charset=utf-8`,
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = payload.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
      toast.success(`${payload.label} downloaded.`);
    } catch {
      toast.error("Download failed. Try again.");
    }
  }

  async function handleCopyMarkdown() {
    let exportResult: ResultState | null;
    try {
      exportResult = await prepareExportResult();
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "Failed to prepare export.");
      return;
    }
    if (!exportResult) return;

    const payload = getMarkdownCopyPayload(exportResult);

    if (!navigator?.clipboard?.writeText) {
      toast.error("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(payload.content);
      setMarkdownCopied(true);
      if (markdownCopiedTimerRef.current) clearTimeout(markdownCopiedTimerRef.current);
      markdownCopiedTimerRef.current = setTimeout(() => setMarkdownCopied(false), 1500);
      toast.success(`${payload.label} copied to clipboard.`);
    } catch {
      toast.error("Copy failed. Check clipboard permission and try again.");
    }
  }

  const visibleDownloadActions =
    displayedResult?.kind === "article"
      ? downloadActions.filter((action) => action.value === "markdown")
      : downloadActions;
  const showMarkdownCopyButton = displayedResult?.kind === "article";
  const showDownloadBar =
    !isLoading && displayedResult && (!jobStatus || isTerminalStatus(jobStatus.status));
  const canLoadMore = Boolean(jobTweetsQuery.hasNextPage);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4 px-6">
      {!isActive && (
        <div className="animate-in fade-in flex flex-col items-center gap-2 text-center duration-300">
          <h1 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Export Tweets, Unroll Threads & Save Posts from X
          </h1>
          <p className="text-muted-foreground">
            Export tweets, unroll threads, and save X articles — online.
          </p>
        </div>
      )}

      <form
        className={cn(
          "w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          showResultLayout && "md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
          isActive ? "-translate-y-10" : "translate-y-0",
        )}
        onSubmit={handleSubmit}
      >
        <div className="relative flex w-full items-center gap-2 pt-4" role="search">
          {showResultLayout && (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-12 shrink-0 p-0"
              aria-label="Back to home"
              title="Back to home"
              disabled={isLoading}
              onClick={handleBackToHome}
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div className="relative flex-1">
            <label htmlFor="hero-url-input" className="sr-only">
              Twitter/X URL or username
            </label>
            <Input
              id="hero-url-input"
              value={value}
              type="text"
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste any Twitter/X URL or @username..."
              className="h-12 pr-20 pl-4"
              aria-describedby={detected ? "hero-url-type" : undefined}
              autoComplete="off"
              disabled={isLoading || isStopping}
            />
            {detected && (
              <Badge
                id="hero-url-type"
                variant="secondary"
                aria-live="polite"
                className={cn(
                  "absolute right-4 top-1/2 -translate-y-1/2 border-0 rounded-sm",
                  detectedBadgeColor,
                )}
              >
                {detected}
              </Badge>
            )}
          </div>
          <Button
            size="lg"
            className="h-12 px-5 font-bold"
            aria-label={isJobActive ? "Stop" : "Submit"}
            type="submit"
            disabled={isLoading || isStopping}
          >
            {isLoading || isStopping ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : isJobActive ? (
              <Square className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </Button>
        </div>
      </form>

      {activeJob && jobStatus && (
        <div
          aria-live="polite"
          className="w-full md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center"
        >
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium capitalize">
              {isStopping && isJobActive
                ? "Stopping..."
                : jobStatus.status === "running" || jobStatus.status === "queued"
                  ? "Fetching…"
                  : jobStatus.status === "stopped"
                    ? "Stopped"
                    : jobStatus.status === "completed"
                      ? "Complete"
                      : "Failed"}
            </span>
            <span>{jobStatus.pagesFetched} pages</span>
            <span>{jobStatus.storedTweets} tweets</span>
            {jobStatus.chargedCredits > 0 && <span>{jobStatus.chargedCredits} credits</span>}
            {jobStatus.error && (
              <span className="text-destructive">{jobStatus.error.message ?? "Unknown error"}</span>
            )}
            {isJobActive && <LoaderCircle className="size-3.5 animate-spin" />}
          </div>
        </div>
      )}

      {showDownloadBar && (
        <div className="animate-in fade-in w-full pt-1 duration-300 md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/20 p-1.5">
            <span className="px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Download as
            </span>
            {visibleDownloadActions.map((action) => {
              return (
                <Button
                  key={action.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-sm px-2.5 text-xs"
                  onClick={() => handleDownload(action.value)}
                >
                  <Download className="size-3.5" />
                  {action.label}
                </Button>
              );
            })}
            {showMarkdownCopyButton && (
              <Button
                type="button"
                variant={markdownCopied ? "secondary" : "outline"}
                size="sm"
                className="h-8 rounded-sm px-2.5 text-xs"
                onClick={handleCopyMarkdown}
              >
                {markdownCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                Copy Markdown
              </Button>
            )}
          </div>
        </div>
      )}

      {!isActive && (
        <div className="animate-in fade-in flex flex-wrap items-center justify-center gap-2 duration-300">
          <span className="text-xs text-muted-foreground">Try:</span>
          {examples.map((ex) => (
            <Badge
              key={ex.value}
              onClick={() => setValue(ex.value)}
              className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {ex.label}
            </Badge>
          ))}
        </div>
      )}

      {isLoading && !activeJob && <ResultDisplayLoading />}

      {!isLoading && error && !displayedResult && (
        <p className="animate-in fade-in pt-2 text-sm text-destructive">{error}</p>
      )}

      {displayedResult && (
        <ResultDisplay
          result={displayedResult}
          jobStatus={jobStatus ?? undefined}
          onLoadMore={canLoadMore ? () => jobTweetsQuery.fetchNextPage() : undefined}
          loadingMore={jobTweetsQuery.isFetchingNextPage}
        />
      )}

      {!isActive && (
        <div className="animate-in fade-in w-full duration-300">
          <ToolCards />
        </div>
      )}
    </div>
  );
}
