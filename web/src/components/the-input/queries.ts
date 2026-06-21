import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { fetchAllTweetsForExport, fetchJobStatus, fetchJobTweetPage } from "./api";
import type { ActiveFetchJob, JobTweetPage } from "./api";
import type { FetchJobStatusResponse } from "./types";

const TWEETS_PAGE_SIZE = 20;

function getLoadedTweetCount(pages: JobTweetPage[]): number {
  return pages.reduce((sum, page) => sum + page.cards.length, 0);
}

export const fetchJobQueryKeys = {
  all: ["fetch-job"] as const,
  status: (jobId: string | null) => ["fetch-job", "status", jobId] as const,
  tweets: (jobId: string | null) => ["fetch-job", "tweets", jobId] as const,
  export: (jobId: string, updatedAt: string) => ["fetch-job", "export", jobId, updatedAt] as const,
};

export const fetchJobQueries = {
  status: (jobId: string | null) =>
    queryOptions({
      queryKey: fetchJobQueryKeys.status(jobId),
      queryFn: () => {
        if (!jobId) throw new Error("Missing fetch job id.");
        return fetchJobStatus(jobId);
      },
    }),

  tweets: (job: ActiveFetchJob | null) =>
    infiniteQueryOptions({
      queryKey: fetchJobQueryKeys.tweets(job?.jobId ?? null),
      queryFn: ({ pageParam }) => {
        if (!job) throw new Error("Missing fetch job.");
        return fetchJobTweetPage(job.jobId, job.requestType, pageParam, TWEETS_PAGE_SIZE);
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage: JobTweetPage, pages: JobTweetPage[]) => {
        const loadedCount = getLoadedTweetCount(pages);
        return loadedCount < lastPage.total ? loadedCount : undefined;
      },
    }),

  export: (job: ActiveFetchJob, status: FetchJobStatusResponse) =>
    queryOptions({
      queryKey: fetchJobQueryKeys.export(job.jobId, status.updatedAt),
      queryFn: () => fetchAllTweetsForExport(job, status),
    }),
};
