import { createFileRoute } from "@tanstack/react-router";
import { errorJson, getOwnedJobOrResponse, jobStatusJson } from "@/lib/api-routes";
import { requestJobStop } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/stop")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const result = await getOwnedJobOrResponse(request, params.jobId);
        if ("response" in result) return result.response;

        const updated = await requestJobStop(params.jobId);
        if (!updated) {
          return errorJson("Job not found.", 404);
        }

        return Response.json(jobStatusJson(updated));
      },
    },
  },
});
