import { createFileRoute } from "@tanstack/react-router";
import { fetchThreadContext } from "@/lib/x-api";
import { parseTweetId } from "@/lib/url-parser";
import { assertSufficientCredits } from "@/lib/billing-access";
import { calculateTweetListCredits, MIN_PREFLIGHT_CREDITS } from "@/lib/credits";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  withApiRouteErrors,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/thread")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const input = firstSearchParam(url, ["tweetId", "id", "url", "input"]);

        if (!input) {
          return errorJson("Missing required query param: tweetId (or id/url/input).", 400);
        }

        const tweetId = parseTweetId(input);
        if (!tweetId) {
          return errorJson("Invalid tweet input. Provide a valid tweet URL or tweet ID.", 400);
        }

        const cursor = url.searchParams.get("cursor") ?? undefined;
        return withApiRouteErrors(async () => {
          await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
          const data = await fetchThreadContext(tweetId, cursor);
          const tweetCount = Array.isArray(data.tweets) ? data.tweets.length : 0;
          const chargedCredits = calculateTweetListCredits(tweetCount);
          return jsonWithChargedUsage(request, data, {
            credits: chargedCredits,
            tweetCount,
          });
        }, "Unexpected error while fetching thread context.");
      },
    },
  },
});
