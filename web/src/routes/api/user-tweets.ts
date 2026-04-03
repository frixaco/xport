import { createFileRoute } from "@tanstack/react-router";
import { fetchUserLastTweets, XApiError } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { ApiAccessError, assertSufficientCredits, ingestCreditsUsage } from "@/lib/api-access";
import {
  buildUsageMetadata,
  calculateTweetListCredits,
  MIN_PREFLIGHT_CREDITS,
  withUsageMetadata,
} from "@/lib/credits";

export const Route = createFileRoute("/api/user-tweets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawUserInput =
          url.searchParams.get("userName") ??
          url.searchParams.get("username") ??
          url.searchParams.get("url") ??
          url.searchParams.get("input");

        if (!rawUserInput) {
          return Response.json(
            {
              error: "Missing required query param: userName (or username/url/input).",
            },
            { status: 400 },
          );
        }

        const userName = parseUsername(rawUserInput);
        if (!userName) {
          return Response.json(
            {
              error: "Invalid user input. Provide a valid @username, username, or profile URL.",
            },
            { status: 400 },
          );
        }

        const includeRepliesRaw = url.searchParams.get("includeReplies");
        let includeReplies = false;
        if (includeRepliesRaw !== null) {
          const normalized = includeRepliesRaw.trim().toLowerCase();
          if (["1", "true", "yes"].includes(normalized)) includeReplies = true;
        }

        const cursor = url.searchParams.get("cursor") ?? undefined;
        try {
          await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
          const data = await fetchUserLastTweets(userName, cursor);
          const tweetCount = Array.isArray(data.data?.tweets) ? data.data.tweets.length : 0;
          const chargedCredits = calculateTweetListCredits(tweetCount);
          const charged = await ingestCreditsUsage(request, {
            credits: chargedCredits,
          });
          const usageMetadata = buildUsageMetadata({
            charged,
            chargedCredits,
            tweetCount,
          });

          if (includeReplies) {
            return Response.json(withUsageMetadata(data, usageMetadata), {
              status: 200,
              headers: {
                "Cache-Control": "no-store",
                "X-Xport-Credits-Charged": String(usageMetadata.chargedCredits),
              },
            });
          }

          const tweets = data.data?.tweets ?? [];
          const filteredTweets = tweets.filter((tweet) => !(tweet.isReply || tweet.inReplyToId));

          return Response.json(
            withUsageMetadata(
              {
                ...data,
                data: {
                  ...data.data,
                  tweets: filteredTweets,
                },
              },
              usageMetadata,
            ),
            {
              status: 200,
              headers: {
                "Cache-Control": "no-store",
                "X-Xport-Credits-Charged": String(usageMetadata.chargedCredits),
              },
            },
          );
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
            { error: "Unexpected error while fetching user tweets." },
            { status: 500 },
          );
        }
      },
    },
  },
});
