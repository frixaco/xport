import { createFileRoute } from "@tanstack/react-router";
import { fetchThreadContext } from "@/lib/x-api";
import { parseTweetId } from "@/lib/url-parser";
import { calculateTweetListCredits } from "@/lib/credits";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  withApiRouteTelemetry,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/thread")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { error: "Use POST with an Idempotency-Key header." },
          { status: 405, headers: { Allow: "POST" } },
        ),
      POST: async ({ request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/thread",
            fallbackMessage: "Unexpected error while fetching thread context.",
            requestType: "thread",
          },
          async (telemetry) => {
            const url = new URL(request.url);
            const input = firstSearchParam(url, ["tweetId", "id", "url", "input"]);

            if (!input) {
              return errorJson("Missing required query param: tweetId (or id/url/input).", 400);
            }

            const tweetId = parseTweetId(input);
            if (!tweetId) {
              return errorJson("Invalid tweet input. Provide a valid tweet URL or tweet ID.", 400);
            }

            telemetry.inputNormalized = tweetId;
            const cursor = url.searchParams.get("cursor") ?? undefined;
            return jsonWithChargedUsage(
              request,
              JSON.stringify(["thread", tweetId, cursor]),
              async () => {
                const data = await fetchThreadContext(tweetId, cursor);
                const tweetCount = Array.isArray(data.tweets) ? data.tweets.length : 0;
                return {
                  payload: data,
                  credits: calculateTweetListCredits(tweetCount),
                  tweetCount,
                };
              },
            );
          },
        );
      },
    },
  },
});
