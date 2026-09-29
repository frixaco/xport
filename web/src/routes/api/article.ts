import { createFileRoute } from "@tanstack/react-router";
import { fetchArticle } from "@/lib/x-api";
import { parseTweetId } from "@/lib/url-parser";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  withApiRouteTelemetry,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/article")({
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
            route: "/api/article",
            fallbackMessage: "Unexpected error while fetching article.",
            requestType: "article",
          },
          async (telemetry) => {
            const url = new URL(request.url);
            const input = firstSearchParam(url, ["tweetId", "tweet_id", "id", "url", "input"]);

            if (!input) {
              return errorJson(
                "Missing required query param: tweetId (or tweet_id/id/url/input).",
                400,
              );
            }

            const tweetId = parseTweetId(input);
            if (!tweetId) {
              return errorJson("Invalid tweet input. Provide a valid tweet URL or tweet ID.", 400);
            }

            telemetry.inputNormalized = tweetId;
            return jsonWithChargedUsage(request, `article:${tweetId}`, async () => ({
              payload: await fetchArticle(tweetId),
              credits: 1,
            }));
          },
        );
      },
    },
  },
});
