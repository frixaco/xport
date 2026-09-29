import { createFileRoute } from "@tanstack/react-router";
import { fetchUserInfo, fetchUserTimeline } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { calculateTweetListCredits } from "@/lib/credits";
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
      GET: () =>
        Response.json(
          { error: "Use POST with an Idempotency-Key header." },
          { status: 405, headers: { Allow: "POST" } },
        ),
      POST: async ({ request }) => {
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
            return jsonWithChargedUsage(
              request,
              JSON.stringify(["user-tweets", userName.toLowerCase(), cursor, includeReplies]),
              async () => {
                const userInfo = await fetchUserInfo(userName);
                const data = await fetchUserTimeline(userInfo.data.id, cursor);
                const tweets = data.data?.tweets ?? [];
                const tweetCount = tweets.length;
                return {
                  payload: includeReplies
                    ? data
                    : {
                        ...data,
                        data: {
                          ...data.data,
                          tweets: tweets.filter((tweet) => !(tweet.isReply || tweet.inReplyToId)),
                        },
                      },
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
