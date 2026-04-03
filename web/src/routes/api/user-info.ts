import { createFileRoute } from "@tanstack/react-router";
import { fetchUserInfo, XApiError } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { ApiAccessError, assertSufficientCredits, ingestCreditsUsage } from "@/lib/api-access";
import { buildUsageMetadata, MIN_PREFLIGHT_CREDITS, withUsageMetadata } from "@/lib/credits";

export const Route = createFileRoute("/api/user-info")({
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

        try {
          await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
          const data = await fetchUserInfo(userName);
          const charged = await ingestCreditsUsage(request, {
            credits: 1,
          });
          const usageMetadata = buildUsageMetadata({
            charged,
            chargedCredits: 1,
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
            { error: "Unexpected error while fetching user info." },
            { status: 500 },
          );
        }
      },
    },
  },
});
