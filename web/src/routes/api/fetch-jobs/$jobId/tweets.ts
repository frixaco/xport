import { createFileRoute } from "@tanstack/react-router";
import { getOwnedJobOrResponse, withApiRouteTelemetry } from "@/lib/api-routes";
import { getJobTweets } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/tweets")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/fetch-jobs/:jobId/tweets",
            fallbackMessage: "Unexpected error while fetching job tweets.",
            jobId: params.jobId,
          },
          async (telemetry) => {
            const ownedJob = await getOwnedJobOrResponse(request, params.jobId);
            if ("response" in ownedJob) return ownedJob.response;

            telemetry.userId = ownedJob.job.ownerUserId;
            telemetry.requestType = ownedJob.job.requestType;
            telemetry.inputNormalized = ownedJob.job.inputNormalized;

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
        );
      },
    },
  },
});
