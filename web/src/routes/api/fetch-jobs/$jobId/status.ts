import { createFileRoute } from "@tanstack/react-router";
import { getOwnedJobOrResponse, jobStatusJson } from "@/lib/api-routes";

export const Route = createFileRoute("/api/fetch-jobs/$jobId/status")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const result = await getOwnedJobOrResponse(request, params.jobId);
        if ("response" in result) return result.response;

        return Response.json(jobStatusJson(result.job, { includeInput: true }));
      },
    },
  },
});
