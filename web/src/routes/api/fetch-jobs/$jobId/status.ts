import { createFileRoute } from "@tanstack/react-router";
import { getOwnedJobOrResponse, jobStatusJson, withApiRouteTelemetry } from "@/lib/api-routes";
import { startFetchJobInBackground } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/status")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/fetch-jobs/:jobId/status",
            fallbackMessage: "Unexpected error while fetching job status.",
            jobId: params.jobId,
          },
          async (telemetry) => {
            const result = await getOwnedJobOrResponse(request, params.jobId);
            if ("response" in result) return result.response;

            telemetry.userId = result.job.ownerUserId;
            telemetry.requestType = result.job.requestType;
            telemetry.inputNormalized = result.job.inputNormalized;

            if (result.job.status === "queued" || result.job.status === "running") {
              startFetchJobInBackground(params.jobId, request.headers);
            }

            return Response.json(jobStatusJson(result.job, { includeInput: true }));
          },
        );
      },
    },
  },
});
