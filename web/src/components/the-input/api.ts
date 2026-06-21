import type {
  FetchJobRequestType,
  FetchJobResumeResponse,
  FetchJobStatusResponse,
  ResultState,
  TweetCardModel,
} from "./types";
import { extractErrorMessage, normalizeResult } from "./result-normalization";
import { normalizeTweetCards } from "./tweet-card";

const EXPORT_FETCH_PAGE_SIZE = 100;

export interface ActiveFetchJob {
  jobId: string;
  requestType: FetchJobRequestType;
}

export interface JobTweetPage {
  cards: TweetCardModel[];
  mainTweet: TweetCardModel | null;
  total: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

export async function fetchArticleResult(input: string): Promise<ResultState> {
  const payload = await fetchJson<unknown>(`/api/article?input=${encodeURIComponent(input)}`, {
    method: "GET",
    cache: "no-store",
  });
  return normalizeResult(payload, "article", input);
}

export async function createFetchJob(input: string): Promise<{ jobId: string }> {
  return fetchJson<{ jobId: string }>("/api/fetch-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

export async function fetchJobStatus(jobId: string): Promise<FetchJobResumeResponse> {
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

export async function stopFetchJob(jobId: string): Promise<FetchJobStatusResponse> {
  const response = await fetch(`/api/fetch-jobs/${jobId}/stop`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}).`);
  }

  return (await response.json()) as FetchJobStatusResponse;
}

export async function fetchJobTweetPage(
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

export async function fetchAllTweetsForExport(
  job: ActiveFetchJob,
  status: FetchJobStatusResponse,
): Promise<{ tweets: TweetCardModel[]; mainTweet: TweetCardModel | null }> {
  const tweets: TweetCardModel[] = [];
  const seenIds = new Set<string>();
  let mainTweet: TweetCardModel | null = null;
  let offset = 0;
  let total = 0;

  while (true) {
    // Fetch pages sequentially because each offset depends on the previous response.
    // eslint-disable-next-line no-await-in-loop
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
