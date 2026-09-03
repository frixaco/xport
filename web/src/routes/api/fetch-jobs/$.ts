import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { parseTwitterInput } from "@/lib/url-parser";
import { assertSufficientCredits } from "@/lib/billing-access";
import { errorJson, withApiRouteTelemetry } from "@/lib/api-routes";
import {
  createFetchJob,
  startFetchJobInBackground,
  type FetchJobRequestType,
} from "@/lib/fetch-job";
import { captureServerEvent } from "@/lib/server-telemetry";

export const Route = createFileRoute("/api/fetch-jobs/$")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/fetch-jobs",
            fallbackMessage: "Unexpected error while creating fetch job.",
          },
          async (telemetry) => {
            const session = await auth.api.getSession({ headers: request.headers });
            telemetry.userId = session?.user.id ?? null;
            if (!session) {
              return errorJson("Authentication required.", 401);
            }

            let body: { input?: string; mode?: unknown };
            try {
              body = await request.json();
            } catch {
              return errorJson("Invalid JSON body.", 400);
            }

            const input = body.input?.trim();
            if (!input) {
              return errorJson("Missing required field: input.", 400);
            }

            const parsed = parseTwitterInput(input);
            if (!parsed) {
              return errorJson("Invalid input. Provide a valid tweet URL/ID or username.", 400);
            }
            const mode = body.mode ?? "posts";
            if (mode !== "posts" && mode !== "timeline" && mode !== "replies") {
              return errorJson("Invalid mode. Use posts, timeline, or replies.", 400);
            }
            if (parsed.type === "tweet" && body.mode !== undefined) {
              return errorJson("Mode is only valid for account exports.", 400);
            }

            const requestType: FetchJobRequestType =
              parsed.type === "tweet"
                ? "thread"
                : mode === "timeline"
                  ? "timeline"
                  : mode === "replies"
                    ? "replies"
                    : "user";
            const inputNormalized = parsed.type === "tweet" ? parsed.tweetId : parsed.username;
            telemetry.requestType = requestType;
            telemetry.inputNormalized = inputNormalized;

            await assertSufficientCredits(request, 1);

            const jobId = await createFetchJob({
              ownerUserId: session.user.id,
              requestType,
              inputRaw: input,
              inputNormalized,
            });
            telemetry.jobId = jobId;

            captureServerEvent("fetch job created", {
              distinctId: session.user.id,
              properties: {
                job_id: jobId,
                request_type: requestType,
                input_normalized: inputNormalized,
              },
            });
            startFetchJobInBackground(jobId, request.headers);

            return Response.json({ jobId }, { status: 201 });
          },
        );
      },
    },
  },
});
