import { createFileRoute } from "@tanstack/react-router";
import { fetchThreadContext, XApiError } from "@/lib/x-api";
import { parseTweetId } from "@/lib/url-parser";
import { ApiAccessError, assertSufficientCredits, ingestCreditsUsage } from "@/lib/api-access";
import {
  buildUsageMetadata,
  calculateTweetListCredits,
  MIN_PREFLIGHT_CREDITS,
  withUsageMetadata,
} from "@/lib/credits";

export const Route = createFileRoute("/api/thread")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const input =
          url.searchParams.get("tweetId") ??
          url.searchParams.get("id") ??
          url.searchParams.get("url") ??
          url.searchParams.get("input");

        if (!input) {
          return Response.json(
            { error: "Missing required query param: tweetId (or id/url/input)." },
            { status: 400 },
          );
        }

        const tweetId = parseTweetId(input);
        if (!tweetId) {
          return Response.json(
            { error: "Invalid tweet input. Provide a valid tweet URL or tweet ID." },
            { status: 400 },
          );
        }

        const cursor = url.searchParams.get("cursor") ?? undefined;
        try {
          await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
          const data = await fetchThreadContext(tweetId, cursor);
          const tweetCount = Array.isArray(data.tweets) ? data.tweets.length : 0;
          const chargedCredits = calculateTweetListCredits(tweetCount);
          const charged = await ingestCreditsUsage(request, {
            credits: chargedCredits,
          });
          const usageMetadata = buildUsageMetadata({
            charged,
            chargedCredits,
            tweetCount,
          });

          return Response.json(withUsageMetadata(data, usageMetadata), {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "X-Xport-Credits-Charged": String(usageMetadata.chargedCredits),
            },
          });
        } catch (error) {
          if (error instanceof ApiAccessError) {
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.status >= 400 && error.status <= 599 ? error.status : 500 },
            );
          }

          if (error instanceof XApiError) {
            return Response.json(
              { error: error.message, details: error.details },
              { status: error.status >= 400 && error.status <= 599 ? error.status : 500 },
            );
          }

          return Response.json(
            { error: "Unexpected error while fetching thread context." },
            { status: 500 },
          );
        }
      },
    },
  },
});
