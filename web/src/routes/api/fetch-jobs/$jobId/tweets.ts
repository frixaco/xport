import { createFileRoute } from "@tanstack/react-router";
import { getOwnedJobOrResponse } from "@/lib/api-routes";
import { getJobTweets } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/tweets")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const ownedJob = await getOwnedJobOrResponse(request, params.jobId);
        if ("response" in ownedJob) return ownedJob.response;

        const url = new URL(request.url);
        const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
        const limit = Math.min(
          100,
          Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
        );

        const result = await getJobTweets(params.jobId, offset, limit);

        if (ownedJob.job.requestType === "thread") {
          return Response.json({
            mainTweet: result.mainTweet,
            tweets: result.tweets,
            total: result.total,
          });
        }

        return Response.json({
          tweets: result.tweets,
          total: result.total,
        });
      },
    },
  },
});
