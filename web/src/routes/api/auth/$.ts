import { auth } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { withApiRouteTelemetry } from "@/lib/api-routes";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withApiRouteTelemetry(
          request,
          {
            route: "/api/auth",
            fallbackMessage: "Unexpected authentication error.",
          },
          () => auth.handler(request),
        ),
      POST: async ({ request }) =>
        withApiRouteTelemetry(
          request,
          {
            route: "/api/auth",
            fallbackMessage: "Unexpected authentication error.",
          },
          () => auth.handler(request),
        ),
    },
  },
});
