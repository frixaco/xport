import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { getJobStatus, getJobTweets } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/tweets")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return Response.json({ error: "Authentication required." }, { status: 401 });
        }

        const job = await getJobStatus(params.jobId);
        if (!job || job.ownerUserId !== session.user.id) {
          return Response.json({ error: "Job not found." }, { status: 404 });
        }

        const url = new URL(request.url);
        const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
        const limit = Math.min(
          100,
          Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
        );

        const result = await getJobTweets(params.jobId, offset, limit);

        if (job.requestType === "thread") {
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
