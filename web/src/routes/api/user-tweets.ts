import { createFileRoute } from "@tanstack/react-router";
import { fetchUserInfo, fetchUserTimeline } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { assertSufficientCredits } from "@/lib/billing-access";
import { calculateTweetListCredits, MIN_PREFLIGHT_CREDITS } from "@/lib/credits";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  parseBooleanSearchParam,
  withApiRouteTelemetry,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/user-tweets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/user-tweets",
            fallbackMessage: "Unexpected error while fetching user tweets.",
            requestType: "user",
          },
          async (telemetry) => {
            const url = new URL(request.url);
            const rawUserInput = firstSearchParam(url, ["userName", "username", "url", "input"]);

            if (!rawUserInput) {
              return errorJson(
                "Missing required query param: userName (or username/url/input).",
                400,
              );
            }

            const userName = parseUsername(rawUserInput);
            if (!userName) {
              return errorJson(
                "Invalid user input. Provide a valid @username, username, or profile URL.",
                400,
              );
            }

            telemetry.inputNormalized = userName;
            const includeReplies = parseBooleanSearchParam(url.searchParams.get("includeReplies"));
            const cursor = url.searchParams.get("cursor") ?? undefined;
            await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
            const userInfo = await fetchUserInfo(userName);
            const data = await fetchUserTimeline(userInfo.data.id, cursor);
            const tweetCount = Array.isArray(data.data?.tweets) ? data.data.tweets.length : 0;
            const chargedCredits = calculateTweetListCredits(tweetCount);

            if (includeReplies) {
              return jsonWithChargedUsage(request, data, { credits: chargedCredits, tweetCount });
            }

            const tweets = data.data?.tweets ?? [];
            const filteredTweets = tweets.filter((tweet) => !(tweet.isReply || tweet.inReplyToId));

            return jsonWithChargedUsage(
              request,
              {
                ...data,
                data: {
                  ...data.data,
                  tweets: filteredTweets,
                },
              },
              { credits: chargedCredits, tweetCount },
            );
          },
        );
      },
    },
  },
});
