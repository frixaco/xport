import { createFileRoute } from "@tanstack/react-router";
import { fetchUserInfo } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { assertSufficientCredits } from "@/lib/billing-access";
import { MIN_PREFLIGHT_CREDITS } from "@/lib/credits";
import {
  errorJson,
  firstSearchParam,
  jsonWithChargedUsage,
  withApiRouteTelemetry,
} from "@/lib/api-routes";

export const Route = createFileRoute("/api/user-info")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/user-info",
            fallbackMessage: "Unexpected error while fetching user info.",
            requestType: "user-info",
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
            await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
            const data = await fetchUserInfo(userName);
            return jsonWithChargedUsage(request, data, { credits: 1 });
          },
        );
      },
    },
  },
});
