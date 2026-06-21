import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { getJobStatus, requestJobStop } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/stop")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return Response.json({ error: "Authentication required." }, { status: 401 });
        }

        const job = await getJobStatus(params.jobId);
        if (!job || job.ownerUserId !== session.user.id) {
          return Response.json({ error: "Job not found." }, { status: 404 });
        }

        const updated = await requestJobStop(params.jobId);
        if (!updated) {
          return Response.json({ error: "Job not found." }, { status: 404 });
        }

        return Response.json({
          status: updated.status,
          pagesFetched: updated.pagesFetched,
          rawFetchedTweets: updated.rawFetchedTweets,
          storedTweets: updated.storedTweets,
          chargedCredits: updated.chargedCredits,
          hasNextPage: updated.hasNextPage,
          error:
            updated.errorCode || updated.errorMessage
              ? { code: updated.errorCode, message: updated.errorMessage }
              : null,
          updatedAt: updated.updatedAt,
        });
      },
    },
  },
});
