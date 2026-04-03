"use client";

import { SubmitEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  FetchJobState,
  FetchJobStatusResponse,
  ResultState,
  TweetCardModel,
} from "./types";
import {
  badgeColor,
  buildRequestConfig,
  detectUrlType,
  examples,
  extractErrorMessage,
  extractUsernameFromTweetCard,
  hasRenderableContent,
  normalizeTweetCards,
  normalizeResult,
  useDebouncedValue,
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

function toFetchJobStatus(payload: FetchJobStatusResponse): FetchJobStatusResponse {
  return {
    status: payload.status,
    pagesFetched: payload.pagesFetched,
    rawFetchedTweets: payload.rawFetchedTweets,
    storedTweets: payload.storedTweets,
    chargedCredits: payload.chargedCredits,
    hasNextPage: payload.hasNextPage,
    error: payload.error,
    updatedAt: payload.updatedAt,
  };
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

export function HeroInput() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [markdownCopied, setMarkdownCopied] = useState(false);

  const [fetchJob, setFetchJob] = useState<FetchJobState | null>(null);
  const [jobTweets, setJobTweets] = useState<TweetCardModel[]>([]);
  const [jobMainTweet, setJobMainTweet] = useState<TweetCardModel | null>(null);
  const [tweetsOffset, setTweetsOffset] = useState(0);
  const [tweetsTotal, setTweetsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeAttemptedRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);

  const debouncedValue = useDebouncedValue(value, 220);
  const detected = useMemo(() => detectUrlType(debouncedValue), [debouncedValue]);
  const hasResults = hasRenderableContent(result);
  const isJobActive = fetchJob !== null && !isTerminalStatus(fetchJob.status.status);
  const showResultLayout =
    hasSubmitted || isLoading || Boolean(result) || Boolean(error) || isJobActive;
  const isActive = hasSubmitted || isLoading || hasResults || Boolean(error) || isJobActive;

  const handleExample = useCallback((v: string) => setValue(v), []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const setJobIdInUrl = useCallback(
    (jobId: string | null, options?: { clearInput?: boolean }) => {
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
      } else {
        if (currentJobId) {
          url.searchParams.delete(JOB_ID_QUERY_PARAM);
          hasChanges = true;
        }
      }

      if (clearInput && url.searchParams.has(INPUT_QUERY_PARAM)) {
        url.searchParams.delete(INPUT_QUERY_PARAM);
        hasChanges = true;
      }

      if (!hasChanges) return;

      const nextUrl = url.searchParams.toString()
        ? `${url.pathname}?${url.searchParams.toString()}`
        : url.pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [router],
  );

  const handleBackToHome = useCallback(() => {
    if (isLoading) return;
    stopPolling();
    setJobIdInUrl(null);
    setValue("");
    setIsStopping(false);
    setResult(null);
    setError(null);
    setHasSubmitted(false);
    setMarkdownCopied(false);
    setFetchJob(null);
    setJobTweets([]);
    setJobMainTweet(null);
    setTweetsOffset(0);
    setTweetsTotal(0);
  }, [isLoading, setJobIdInUrl, stopPolling]);

  const fetchTweets = useCallback(
    async (jobId: string, requestType: FetchJobRequestType, offset: number, append: boolean) => {
      const res = await fetch(
        `/api/fetch-jobs/${jobId}/tweets?offset=${offset}&limit=${TWEETS_PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;

      const data = (await res.json()) as {
        tweets?: unknown[];
        mainTweet?: unknown;
        total?: number;
      };

      const cards = normalizeTweetCards(data.tweets ?? []);
      const total = typeof data.total === "number" ? data.total : 0;

      let main: TweetCardModel | null = null;
      if (requestType === "thread" && data.mainTweet) {
        const normalized = normalizeTweetCards([data.mainTweet]);
        main = normalized[0] ?? null;
      }

      if (append) {
        setJobTweets((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const fresh = cards.filter((c) => !existingIds.has(c.id));
          return [...prev, ...fresh];
        });
      } else {
        setJobTweets(cards);
      }

      if (main) setJobMainTweet(main);
      setTweetsTotal(total);
    },
    [],
  );

  const fetchAllTweetsForExport = useCallback(async (job: FetchJobState) => {
    const tweets: TweetCardModel[] = [];
    const seenIds = new Set<string>();
    let mainTweet: TweetCardModel | null = null;
    let offset = 0;
    let total = 0;

    while (true) {
      const res = await fetch(
        `/api/fetch-jobs/${job.jobId}/tweets?offset=${offset}&limit=${EXPORT_FETCH_PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`Request failed (${res.status}).`);
      }

      const data = (await res.json()) as {
        tweets?: unknown[];
        mainTweet?: unknown;
        total?: number;
      };
      const cards = normalizeTweetCards(data.tweets ?? []);
      const pageTotal = typeof data.total === "number" ? data.total : 0;
      total = Math.max(total, pageTotal);

      if (job.requestType === "thread" && data.mainTweet) {
        const normalizedMain = normalizeTweetCards([data.mainTweet]);
        const main = normalizedMain[0] ?? null;
        if (main) mainTweet = main;
      }

      cards.forEach((card) => {
        if (seenIds.has(card.id)) return;
        seenIds.add(card.id);
        tweets.push(card);
      });

      if (cards.length === 0) break;

      offset += cards.length;
      if (total > 0 && offset >= total) break;
    }

    if (job.status.storedTweets > 0 && tweets.length < job.status.storedTweets) {
      throw new Error("Export is still syncing. Try again in a moment.");
    }

    return { tweets, mainTweet };
  }, []);

  const startPolling = useCallback(
    (jobId: string, requestType: FetchJobRequestType, sourceUsername: string | null) => {
      stopPolling();

      const poll = async () => {
        try {
          const res = await fetch(`/api/fetch-jobs/${jobId}/status`, {
            cache: "no-store",
          });
          if (!res.ok) return;

          const status = toFetchJobStatus((await res.json()) as FetchJobStatusResponse);

          setFetchJob((prev) =>
            prev ? { ...prev, status } : { jobId, requestType, sourceUsername, status },
          );

          await fetchTweets(jobId, requestType, 0, false);

          if (isTerminalStatus(status.status)) {
            stopPolling();
            setIsStopping(false);
          }
        } catch {
          // Silently retry on next interval
        }
      };

      poll();
      pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    },
    [stopPolling, fetchTweets],
  );

  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (typeof window === "undefined") return;

    const searchParams = new URLSearchParams(window.location.search);
    const jobId = searchParams.get(JOB_ID_QUERY_PARAM);
    if (!jobId) return;

    resumeAttemptedRef.current = true;

    if (!UUID_PATTERN.test(jobId)) {
      setHasSubmitted(true);
      setError("Invalid job id.");
      setJobIdInUrl(null);
      return;
    }

    let cancelled = false;

    const resumeFromUrl = async () => {
      setHasSubmitted(true);
      setIsLoading(true);
      setError(null);
      setIsStopping(false);
      setResult(null);
      setFetchJob(null);
      setJobTweets([]);
      setJobMainTweet(null);
      setTweetsOffset(0);
      setTweetsTotal(0);
      stopPolling();

      try {
        const res = await fetch(`/api/fetch-jobs/${jobId}/status`, {
          cache: "no-store",
        });

        if (cancelled) return;

        if (res.status === 401) {
          setError("Sign in to resume this fetch job.");
          return;
        }

        if (res.status === 404) {
          setError("Fetch job not found.");
          setJobIdInUrl(null);
          return;
        }

        if (!res.ok) {
          throw new Error(`Request failed (${res.status}).`);
        }

        const payload = (await res.json()) as FetchJobResumeResponse;
        const requestType = payload.requestType;
        const sourceInput = payload.inputRaw;
        const sourceUsername = parseUsername(sourceInput);
        const status = toFetchJobStatus(payload);

        if (cancelled) return;

        setValue(sourceInput);
        setFetchJob({
          jobId,
          requestType,
          sourceUsername,
          status,
        });

        await fetchTweets(jobId, requestType, 0, false);

        if (cancelled) return;

        if (!isTerminalStatus(status.status)) {
          startPolling(jobId, requestType, sourceUsername);
        }
      } catch (requestError) {
        if (cancelled) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unexpected error while resuming fetch job.",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void resumeFromUrl();

    return () => {
      cancelled = true;
    };
  }, [fetchTweets, setJobIdInUrl, startPolling, stopPolling]);

  useEffect(() => {
    if (!fetchJob) return;

    const status = fetchJob.status;
    setResult(
      buildJobResult(
        fetchJob.requestType,
        jobTweets,
        jobMainTweet,
        status,
        fetchJob.sourceUsername,
      ),
    );
  }, [fetchJob, jobTweets, jobMainTweet]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleStopJob = useCallback(async () => {
    if (!fetchJob || isStopping) return;
    setIsStopping(true);

    try {
      const res = await fetch(`/api/fetch-jobs/${fetchJob.jobId}/stop`, {
        method: "POST",
      });
      if (!res.ok) {
        setIsStopping(false);
        return;
      }

      const status = toFetchJobStatus((await res.json()) as FetchJobStatusResponse);
      setFetchJob((prev) => (prev ? { ...prev, status } : null));

      if (isTerminalStatus(status.status)) {
        stopPolling();
        setIsStopping(false);
        return;
      }

      // Keep existing polling alive until terminal state is observed.
      if (!pollRef.current) {
        startPolling(fetchJob.jobId, fetchJob.requestType, fetchJob.sourceUsername);
      }
    } catch {
      setIsStopping(false);
      toast.error("Failed to stop fetch.");
    }
  }, [fetchJob, isStopping, stopPolling, startPolling]);

  const handleLoadMore = useCallback(async () => {
    if (!fetchJob || loadingMore) return;
    const nextOffset = tweetsOffset + TWEETS_PAGE_SIZE;
    if (nextOffset >= tweetsTotal) return;

    setLoadingMore(true);
    try {
      await fetchTweets(fetchJob.jobId, fetchJob.requestType, nextOffset, true);
      setTweetsOffset(nextOffset);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchJob, loadingMore, tweetsOffset, tweetsTotal, fetchTweets]);

  const runExport = useCallback(
    async (rawInput: string, options?: { clearInputQueryParam?: boolean }) => {
      if (isLoading) return;

      const trimmed = rawInput.trim();
      if (!trimmed) return;

      const clearInputQueryParam = options?.clearInputQueryParam ?? false;
      const inputType = detectUrlType(trimmed);
      const sourceUsername = parseUsername(trimmed);
      const currentRequestConfig = buildRequestConfig(trimmed, inputType);

      setHasSubmitted(true);
      setResult(null);
      setError(null);
      setMarkdownCopied(false);
      setIsStopping(false);
      setFetchJob(null);
      setJobTweets([]);
      setJobMainTweet(null);
      setTweetsOffset(0);
      setTweetsTotal(0);
      stopPolling();
      setJobIdInUrl(null, { clearInput: clearInputQueryParam });

      if (inputType === "Bookmarks") {
        setError("Bookmarks export is not available yet.");
        return;
      }

      if (!currentRequestConfig) {
        setError("Invalid input. Provide a valid Twitter/X URL or @username.");
        return;
      }

      if (currentRequestConfig.type === "article") {
        setIsLoading(true);
        try {
          const response = await fetch(currentRequestConfig.endpoint, {
            method: "GET",
            cache: "no-store",
          });

          const payload = (await response.json().catch(() => null)) as unknown;
          if (!response.ok) {
            throw new Error(extractErrorMessage(payload) ?? `Request failed (${response.status}).`);
          }

          setResult(normalizeResult(payload, currentRequestConfig.type, trimmed));
        } catch (requestError) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unexpected error while exporting.",
          );
        } finally {
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch("/api/fetch-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: trimmed }),
        });

        const payload = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          throw new Error(extractErrorMessage(payload) ?? `Request failed (${res.status}).`);
        }

        const jobId = (payload as { jobId: string }).jobId;
        const requestType: FetchJobRequestType =
          currentRequestConfig.type === "thread" ? "thread" : "user";

        const initialStatus: FetchJobStatusResponse = {
          status: "running",
          pagesFetched: 0,
          rawFetchedTweets: 0,
          storedTweets: 0,
          chargedCredits: 0,
          hasNextPage: true,
          error: null,
          updatedAt: new Date().toISOString(),
        };

        setFetchJob({
          jobId,
          requestType,
          sourceUsername,
          status: initialStatus,
        });
        setJobIdInUrl(jobId);
        startPolling(jobId, requestType, sourceUsername);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unexpected error while exporting.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, setJobIdInUrl, startPolling, stopPolling],
  );

  const handleSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (isJobActive) {
        if (isStopping) return;
        handleStopJob();
        return;
      }

      if (isLoading) return;
      void runExport(value);
    },
    [handleStopJob, isLoading, isJobActive, isStopping, runExport, value],
  );

  useEffect(() => {
    if (autoStartAttemptedRef.current) return;
    if (typeof window === "undefined") return;

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has(JOB_ID_QUERY_PARAM)) return;

    const input = searchParams.get(INPUT_QUERY_PARAM);
    if (!input) return;

    autoStartAttemptedRef.current = true;
    setValue(input);
    void runExport(input, { clearInputQueryParam: true });
  }, [runExport]);

  const handleDownload = useCallback(
    async (format: ResultExportFormat) => {
      if (!result) return;
      let exportResult = result;

      if (fetchJob && result.kind !== "article") {
        try {
          const { tweets, mainTweet } = await fetchAllTweetsForExport(fetchJob);
          exportResult = buildJobResult(
            fetchJob.requestType,
            tweets,
            mainTweet,
            fetchJob.status,
            fetchJob.sourceUsername,
          );
        } catch (exportError) {
          toast.error(
            exportError instanceof Error ? exportError.message : "Failed to prepare export.",
          );
          return;
        }
      }

      const hasExportedPosts =
        exportResult.kind === "thread"
          ? Boolean(exportResult.mainTweet) || exportResult.tweets.length > 0
          : exportResult.kind === "user-tweets"
            ? exportResult.tweets.length > 0
            : false;
      const isPartialExport =
        exportResult.kind !== "article" &&
        Boolean(
          fetchJob &&
          (fetchJob.status.status === "stopped" ||
            (fetchJob.status.status === "failed" && hasExportedPosts)),
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
    },
    [result, fetchJob, fetchAllTweetsForExport],
  );

  const handleCopyMarkdown = useCallback(async () => {
    if (!result) return;
    let exportResult = result;

    if (fetchJob && result.kind !== "article") {
      try {
        const { tweets, mainTweet } = await fetchAllTweetsForExport(fetchJob);
        exportResult = buildJobResult(
          fetchJob.requestType,
          tweets,
          mainTweet,
          fetchJob.status,
          fetchJob.sourceUsername,
        );
      } catch (exportError) {
        toast.error(
          exportError instanceof Error ? exportError.message : "Failed to prepare export.",
        );
        return;
      }
    }

    const payload = getMarkdownCopyPayload(exportResult);

    if (!navigator?.clipboard?.writeText) {
      toast.error("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(payload.content);
      setMarkdownCopied(true);
      toast.success(`${payload.label} copied to clipboard.`);
    } catch {
      toast.error("Copy failed. Check clipboard permission and try again.");
    }
  }, [result, fetchJob, fetchAllTweetsForExport]);

  useEffect(() => {
    if (!markdownCopied) return;
    const timer = window.setTimeout(() => setMarkdownCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [markdownCopied]);

  const visibleDownloadActions = useMemo(() => {
    if (result?.kind === "article") {
      return downloadActions.filter((action) => action.value === "markdown");
    }
    return downloadActions;
  }, [result]);
  const showMarkdownCopyButton = result?.kind === "article";

  const showDownloadBar =
    !isLoading && result && (!fetchJob || isTerminalStatus(fetchJob.status.status));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6">
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
        <div className="relative mt-4 flex w-full items-center gap-2" role="search">
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
                  badgeColor[detected],
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
            {isLoading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : isStopping ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : isJobActive ? (
              <Square className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </Button>
        </div>
      </form>

      {fetchJob && (
        <div
          aria-live="polite"
          className="w-full md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center"
        >
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium capitalize">
              {isStopping && isJobActive
                ? "Stopping..."
                : fetchJob.status.status === "running" || fetchJob.status.status === "queued"
                  ? "Fetching…"
                  : fetchJob.status.status === "stopped"
                    ? "Stopped"
                    : fetchJob.status.status === "completed"
                      ? "Complete"
                      : "Failed"}
            </span>
            <span>{fetchJob.status.pagesFetched} pages</span>
            <span>{fetchJob.status.storedTweets} tweets</span>
            {fetchJob.status.chargedCredits > 0 && (
              <span>{fetchJob.status.chargedCredits} credits</span>
            )}
            {fetchJob.status.error && (
              <span className="text-destructive">
                {fetchJob.status.error.message ?? "Unknown error"}
              </span>
            )}
            {isJobActive && <LoaderCircle className="size-3.5 animate-spin" />}
          </div>
        </div>
      )}

      {showDownloadBar && (
        <div className="animate-in fade-in mt-1 w-full duration-300 md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center">
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
              onClick={() => handleExample(ex.value)}
              className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {ex.label}
            </Badge>
          ))}
        </div>
      )}

      {isLoading && !fetchJob && <ResultDisplayLoading />}

      {!isLoading && error && !result && (
        <p className="animate-in fade-in mt-2 text-sm text-destructive">{error}</p>
      )}

      {result && (
        <ResultDisplay
          result={result}
          jobStatus={fetchJob?.status}
          onLoadMore={
            fetchJob && tweetsOffset + TWEETS_PAGE_SIZE < tweetsTotal ? handleLoadMore : undefined
          }
          loadingMore={loadingMore}
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
