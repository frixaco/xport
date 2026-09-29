import { createFileRoute } from "@tanstack/react-router";
import { parseTwitterInput } from "@/lib/url-parser";
import { getBillingUser } from "@/lib/billing-access";
import { getCreditBalance, BillingAccessError } from "@/lib/credit-ledger";
import { errorJson, requireTrustedMutation, withApiRouteTelemetry } from "@/lib/api-routes";
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
            const originError = requireTrustedMutation(request);
            if (originError) return originError;

            const userId = await getBillingUser(request);
            telemetry.userId = userId;

            let body: { input?: unknown; mode?: unknown } | null;
            try {
              body = await request.json();
            } catch {
              return errorJson("Invalid JSON body.", 400);
            }

            const input = typeof body?.input === "string" ? body.input.trim() : "";
            if (!input) {
              return errorJson("Missing required field: input.", 400);
            }

            const parsed = parseTwitterInput(input);
            if (!parsed) {
              return errorJson("Invalid input. Provide a valid tweet URL/ID or username.", 400);
            }
            const mode = body?.mode ?? "posts";
            if (mode !== "posts" && mode !== "timeline" && mode !== "replies") {
              return errorJson("Invalid mode. Use posts, timeline, or replies.", 400);
            }
            if (parsed.type === "tweet" && body?.mode !== undefined) {
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

            if ((await getCreditBalance(userId)) < 1) {
              throw new BillingAccessError("Insufficient credits.", 402, "INSUFFICIENT_CREDITS");
            }

            const jobId = await createFetchJob({
              ownerUserId: userId,
              requestType,
              inputRaw: input,
              inputNormalized,
            });
            telemetry.jobId = jobId;

            captureServerEvent("fetch job created", {
              distinctId: userId,
              properties: {
                job_id: jobId,
                request_type: requestType,
                input_normalized: inputNormalized,
              },
            });
            startFetchJobInBackground(jobId);

            return Response.json({ jobId }, { status: 201 });
          },
        );
      },
    },
  },
});
