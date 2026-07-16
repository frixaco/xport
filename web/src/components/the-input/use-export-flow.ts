import { SubmitEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { toast } from "sonner";
import { parseTwitterInput, parseUsername } from "@/lib/url-parser";
import { createFetchJob, fetchArticleResult, fetchJobStatus, stopFetchJob } from "./api";
import type { JobTweetPage } from "./api";
import { fetchJobQueries, fetchJobQueryKeys } from "./queries";
import { isValidJobId, type HomeSearch, withoutEmptySearchValues } from "./search";
import type {
  FetchJobResumeResponse,
  FetchJobStatusResponse,
  FetchJobRequestType,
  ResultState,
  TweetCardModel,
} from "./types";
import { buildRequestConfig, detectUrlType } from "./input";
import {
  buildFetchJobResult,
  hasExportablePosts,
  hasRenderableContent,
  isTerminalFetchJobStatus,
} from "./result-normalization";
import {
  downloadActions,
  getDownloadPayload,
  getMarkdownCopyPayload,
  type ResultExportFormat,
} from "./copy-formats";

const POLL_INTERVAL_MS = 2000;

type TelemetryProperties = Record<string, string | number | boolean | null | undefined>;

interface ActiveJob {
  jobId: string;
  requestType: FetchJobRequestType;
  inputNormalized: string | null;
  sourceUsername: string | null;
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

function createActiveJobFromResume(jobId: string, payload: FetchJobResumeResponse): ActiveJob {
  return {
    jobId,
    requestType: payload.requestType,
    inputNormalized: payload.inputNormalized,
    sourceUsername: parseUsername(payload.inputRaw),
  };
}

function createActiveJobFromInput(jobId: string, input: string): ActiveJob {
  const parsed = parseTwitterInput(input);

  return {
    jobId,
    requestType: parsed?.type === "tweet" ? "thread" : "user",
    inputNormalized: parsed?.type === "tweet" ? parsed.tweetId : (parsed?.username ?? null),
    sourceUsername: parsed?.username ?? null,
  };
}

function getJobTelemetryProperties(
  activeJob: ActiveJob,
  jobStatus?: FetchJobStatusResponse | null,
): TelemetryProperties {
  return {
    job_id: activeJob.jobId,
    request_type: activeJob.requestType,
    input_normalized: activeJob.inputNormalized,
    status: jobStatus?.status,
    pages_fetched: jobStatus?.pagesFetched,
    raw_fetched_tweets: jobStatus?.rawFetchedTweets,
    stored_tweets: jobStatus?.storedTweets,
    charged_credits: jobStatus?.chargedCredits,
    error_code: jobStatus?.error?.code,
  };
}

function getResultTelemetryProperties(
  result: ResultState,
  properties: TelemetryProperties = {},
): TelemetryProperties {
  const renderedTweetCount =
    result.kind === "article"
      ? undefined
      : result.kind === "thread"
        ? result.tweets.length + (result.mainTweet ? 1 : 0)
        : result.tweets.length;

  return {
    result_kind: result.kind,
    tweet_count: result.usage?.tweetCount ?? renderedTweetCount,
    charged_credits: result.usage?.chargedCredits,
    ...properties,
  };
}

function compactTelemetryProperties(
  properties: TelemetryProperties,
): Record<string, string | number | boolean | null> {
  const compacted: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) compacted[key] = value;
  }
  return compacted;
}

export function useExportFlow(search: HomeSearch) {
  const navigate = useNavigate();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [markdownCopied, setMarkdownCopied] = useState(false);

  const initialSearchRef = useRef(search);
  const currentSearchRef = useRef(search);
  const markdownCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  currentSearchRef.current = search;

  const detected = detectUrlType(value);

  function captureEvent(event: string, properties: TelemetryProperties = {}) {
    posthog?.capture(event, compactTelemetryProperties(properties));
  }

  function captureException(error: unknown, properties: TelemetryProperties = {}) {
    const exception = error instanceof Error ? error : new Error("Client export flow error");
    posthog?.captureException(exception, compactTelemetryProperties(properties));
  }

  function setJobIdInUrl(jobId: string | null, options?: { clearInput?: boolean }) {
    const nextSearch: HomeSearch = { ...currentSearchRef.current };
    const currentJobId = nextSearch.jobId;
    const clearInput = options?.clearInput ?? false;
    let hasChanges = false;

    if (jobId) {
      if (currentJobId !== jobId) {
        nextSearch.jobId = jobId;
        hasChanges = true;
      }
    } else if (currentJobId) {
      delete nextSearch.jobId;
      hasChanges = true;
    }

    if (clearInput && nextSearch.input) {
      delete nextSearch.input;
      hasChanges = true;
    }

    if (!hasChanges) return;

    const normalizedSearch = withoutEmptySearchValues(nextSearch);
    currentSearchRef.current = normalizedSearch ?? {};
    navigate({
      to: "/",
      search: normalizedSearch,
      replace: true,
    });
  }

  const articleMutation = useMutation({
    mutationFn: fetchArticleResult,
    onError: (error) => {
      captureException(error, {
        operation: "fetch_article",
        request_type: "article",
      });
    },
  });
  const createJobMutation = useMutation({
    mutationFn: createFetchJob,
    onSuccess: ({ jobId }) => {
      setJobIdInUrl(jobId);
    },
    onError: (error) => {
      captureException(error, {
        operation: "create_fetch_job",
      });
    },
  });
  const resumeJobMutation = useMutation({
    mutationFn: fetchJobStatus,
    onSuccess: (payload, jobId) => {
      setValue(payload.inputRaw);
      queryClient.setQueryData(fetchJobQueryKeys.status(jobId), payload);
    },
    onError: (error, jobId) => {
      captureException(error, {
        operation: "resume_fetch_job",
        job_id: jobId,
      });
    },
  });

  const activeJob: ActiveJob | null =
    resumeJobMutation.data && resumeJobMutation.variables
      ? createActiveJobFromResume(resumeJobMutation.variables, resumeJobMutation.data)
      : createJobMutation.data && createJobMutation.variables
        ? createActiveJobFromInput(createJobMutation.data.jobId, createJobMutation.variables)
        : null;

  const jobStatusQuery = useQuery({
    ...fetchJobQueries.status(activeJob?.jobId ?? null),
    enabled: Boolean(activeJob),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalFetchJobStatus(status) ? false : POLL_INTERVAL_MS;
    },
  });
  const jobStatus = jobStatusQuery.data ?? null;
  const jobTweetsQuery = useInfiniteQuery({
    ...fetchJobQueries.tweets(activeJob),
    enabled: Boolean(activeJob),
    refetchInterval:
      jobStatus && !isTerminalFetchJobStatus(jobStatus.status) ? POLL_INTERVAL_MS : false,
  });
  const stopJobMutation = useMutation({
    mutationFn: stopFetchJob,
    onSuccess: (status) => {
      if (!activeJob) return;
      queryClient.setQueryData(fetchJobQueryKeys.status(activeJob.jobId), {
        ...jobStatusQuery.data,
        ...status,
      });
      queryClient.invalidateQueries({ queryKey: fetchJobQueryKeys.status(activeJob.jobId) });
    },
    onError: (error) => {
      if (activeJob) {
        captureException(error, {
          operation: "stop_fetch_job",
          ...getJobTelemetryProperties(activeJob, jobStatusQuery.data),
        });
      }
      toast.error("Failed to stop fetch.");
    },
  });

  const isLoading =
    articleMutation.isPending || createJobMutation.isPending || resumeJobMutation.isPending;
  const isStopping = stopJobMutation.isPending;
  const isJobActive = Boolean(jobStatus && !isTerminalFetchJobStatus(jobStatus.status));
  const isStopRequested = Boolean(isJobActive && (isStopping || jobStatus?.stopRequested));
  const jobPages = jobTweetsQuery.data?.pages ?? [];
  const jobTweets = getUniqueTweets(jobPages);
  const jobMainTweet = jobPages.find((page) => page.mainTweet)?.mainTweet ?? null;
  const jobResult =
    activeJob && jobStatus
      ? buildFetchJobResult(
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
  const showResultLayout =
    isLoading || Boolean(activeJob) || Boolean(displayedResult) || Boolean(error) || isJobActive;
  const isResultContentLoading = Boolean(
    displayedResult &&
    displayedResult.kind !== "article" &&
    !hasResults &&
    (isJobActive || jobTweetsQuery.isFetching),
  );
  const isActive =
    isLoading || Boolean(activeJob) || Boolean(displayedResult) || Boolean(error) || isJobActive;

  function clearAsyncResults() {
    articleMutation.reset();
    createJobMutation.reset();
    resumeJobMutation.reset();
    stopJobMutation.reset();
    queryClient.removeQueries({ queryKey: fetchJobQueryKeys.all });
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
      setValidationError("Invalid input. Provide a valid X (ex-Twitter) URL or @username.");
      return;
    }

    const parsedInput = parseTwitterInput(trimmed);
    captureEvent("export started", {
      request_type: requestConfig.type === "user-tweets" ? "user" : requestConfig.type,
      input_normalized:
        parsedInput?.type === "tweet" ? parsedInput.tweetId : (parsedInput?.username ?? null),
      input_type: inputType,
    });

    if (requestConfig.type === "article") {
      articleMutation.mutate(trimmed);
      return;
    }

    createJobMutation.mutate(trimmed);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isJobActive) {
      if (isStopRequested || !activeJob) return;
      captureEvent("fetch job stop requested", getJobTelemetryProperties(activeJob, jobStatus));
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
    const initialSearch = initialSearchRef.current;
    const jobId = initialSearch.jobId;
    if (jobId) {
      if (isValidJobId(jobId)) resumeUrlJob(jobId);
      else rejectUrlJob();
      return;
    }

    if (initialSearch.input) startUrlInput(initialSearch.input);
  }, []);

  async function prepareExportResult(): Promise<ResultState | null> {
    if (!displayedResult) return null;
    if (!activeJob || !jobStatus || displayedResult.kind === "article") return displayedResult;

    const { tweets, mainTweet } = await queryClient.fetchQuery(
      fetchJobQueries.export(activeJob, jobStatus),
    );

    return buildFetchJobResult(
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
      captureException(exportError, {
        operation: "prepare_download",
        format,
      });
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
      captureException(new Error("Download object URL unavailable"), {
        operation: "download_export",
        format,
      });
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
      captureEvent(
        "export downloaded",
        getResultTelemetryProperties(exportResult, {
          format,
          is_partial: isPartialExport,
        }),
      );
    } catch (downloadError) {
      captureException(downloadError, {
        operation: "download_export",
        format,
      });
      toast.error("Download failed. Try again.");
    }
  }

  async function handleCopyMarkdown() {
    let exportResult: ResultState | null;
    try {
      exportResult = await prepareExportResult();
    } catch (exportError) {
      captureException(exportError, {
        operation: "prepare_markdown_copy",
      });
      toast.error(exportError instanceof Error ? exportError.message : "Failed to prepare export.");
      return;
    }
    if (!exportResult) return;

    const payload = getMarkdownCopyPayload(exportResult);

    if (!navigator?.clipboard?.writeText) {
      captureException(new Error("Clipboard API unavailable"), {
        operation: "copy_markdown",
      });
      toast.error("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(payload.content);
      setMarkdownCopied(true);
      if (markdownCopiedTimerRef.current) clearTimeout(markdownCopiedTimerRef.current);
      markdownCopiedTimerRef.current = setTimeout(() => setMarkdownCopied(false), 1500);
      toast.success(`${payload.label} copied to clipboard.`);
      captureEvent("markdown copied", getResultTelemetryProperties(exportResult));
    } catch (copyError) {
      captureException(copyError, {
        operation: "copy_markdown",
      });
      toast.error("Copy failed. Check clipboard permission and try again.");
    }
  }

  const visibleDownloadActions =
    displayedResult?.kind === "article"
      ? downloadActions.filter((action) => action.value === "markdown")
      : downloadActions;
  const showCopyAction = Boolean(displayedResult);
  const showExportActions =
    !isLoading && displayedResult && (!jobStatus || isTerminalFetchJobStatus(jobStatus.status));
  const canLoadMore = Boolean(jobTweetsQuery.hasNextPage);

  return {
    activeJob,
    canLoadMore,
    detected,
    displayedResult,
    error,
    handleBackToHome,
    handleCopyMarkdown,
    handleDownload,
    handleLoadMore: () => jobTweetsQuery.fetchNextPage(),
    handleSubmit,
    isActive,
    isJobActive,
    isLoading,
    isResultContentLoading,
    isStopRequested,
    jobStatus,
    loadingMore: jobTweetsQuery.isFetchingNextPage,
    markdownCopied,
    setValue,
    showExportActions,
    showCopyAction,
    showResultLayout,
    value,
    visibleDownloadActions,
  };
}
