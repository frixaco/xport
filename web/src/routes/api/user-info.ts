import { createFileRoute } from "@tanstack/react-router";
import { fetchUserInfo } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { assertSufficientCredits } from "@/lib/billing-access";
import { MIN_PREFLIGHT_CREDITS } from "@/lib/credits";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  withApiRouteErrors,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/user-info")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawUserInput = firstSearchParam(url, ["userName", "username", "url", "input"]);

        if (!rawUserInput) {
          return errorJson("Missing required query param: userName (or username/url/input).", 400);
        }

        const userName = parseUsername(rawUserInput);
        if (!userName) {
          return errorJson(
            "Invalid user input. Provide a valid @username, username, or profile URL.",
            400,
          );
        }

        return withApiRouteErrors(async () => {
          await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
          const data = await fetchUserInfo(userName);
          return jsonWithChargedUsage(request, data, { credits: 1 });
        }, "Unexpected error while fetching user info.");
      },
    },
  },
});
