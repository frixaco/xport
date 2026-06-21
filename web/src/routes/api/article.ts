import { createFileRoute } from "@tanstack/react-router";
import { fetchArticle } from "@/lib/x-api";
import { parseTweetId } from "@/lib/url-parser";
import { assertSufficientCredits } from "@/lib/billing-access";
import { MIN_PREFLIGHT_CREDITS } from "@/lib/credits";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  withApiRouteErrors,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/article")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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

        return withApiRouteErrors(async () => {
          await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
          const data = await fetchArticle(tweetId);
          return jsonWithChargedUsage(request, data, { credits: 1 });
        }, "Unexpected error while fetching article.");
      },
    },
  },
});
