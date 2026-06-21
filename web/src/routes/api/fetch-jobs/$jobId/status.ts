import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { getJobStatus } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/status")({
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

        return Response.json({
          requestType: job.requestType,
          inputRaw: job.inputRaw,
          inputNormalized: job.inputNormalized,
          status: job.status,
          pagesFetched: job.pagesFetched,
          rawFetchedTweets: job.rawFetchedTweets,
          storedTweets: job.storedTweets,
          chargedCredits: job.chargedCredits,
          hasNextPage: job.hasNextPage,
          error:
            job.errorCode || job.errorMessage
              ? { code: job.errorCode, message: job.errorMessage }
              : null,
          updatedAt: job.updatedAt,
        });
      },
    },
  },
});
