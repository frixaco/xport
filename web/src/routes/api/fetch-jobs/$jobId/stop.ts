import { createFileRoute } from "@tanstack/react-router";
import {
  errorJson,
  getOwnedJobOrResponse,
  jobStatusJson,
  withApiRouteTelemetry,
} from "@/lib/api-routes";
import { requestJobStop } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/stop")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/fetch-jobs/:jobId/stop",
            fallbackMessage: "Unexpected error while stopping fetch job.",
            jobId: params.jobId,
          },
          async (telemetry) => {
            const result = await getOwnedJobOrResponse(request, params.jobId);
            if ("response" in result) return result.response;

            telemetry.userId = result.job.ownerUserId;
            telemetry.requestType = result.job.requestType;
            telemetry.inputNormalized = result.job.inputNormalized;

            const updated = await requestJobStop(params.jobId);
            if (!updated) {
              return errorJson("Job not found.", 404);
            }

            return Response.json(jobStatusJson(updated));
          },
        );
      },
    },
  },
});
