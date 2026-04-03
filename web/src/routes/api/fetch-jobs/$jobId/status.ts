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
        if (!job || job.owner_user_id !== session.user.id) {
          return Response.json({ error: "Job not found." }, { status: 404 });
        }

        return Response.json({
          requestType: job.request_type,
          inputRaw: job.input_raw,
          inputNormalized: job.input_normalized,
          status: job.status,
          pagesFetched: job.pages_fetched,
          rawFetchedTweets: job.raw_fetched_tweets,
          storedTweets: job.stored_tweets,
          chargedCredits: job.charged_credits,
          hasNextPage: job.has_next_page,
          error:
            job.error_code || job.error_message
              ? { code: job.error_code, message: job.error_message }
              : null,
          updatedAt: job.updated_at,
        });
      },
    },
  },
});
