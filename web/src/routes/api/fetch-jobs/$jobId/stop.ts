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
        if (!job || job.owner_user_id !== session.user.id) {
          return Response.json({ error: "Job not found." }, { status: 404 });
        }

        const updated = await requestJobStop(params.jobId);
        if (!updated) {
          return Response.json({ error: "Job not found." }, { status: 404 });
        }

        return Response.json({
          status: updated.status,
          pagesFetched: updated.pages_fetched,
          rawFetchedTweets: updated.raw_fetched_tweets,
          storedTweets: updated.stored_tweets,
          chargedCredits: updated.charged_credits,
          hasNextPage: updated.has_next_page,
          error:
            updated.error_code || updated.error_message
              ? { code: updated.error_code, message: updated.error_message }
              : null,
          updatedAt: updated.updated_at,
        });
      },
    },
  },
});
