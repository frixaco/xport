import { createFileRoute } from "@tanstack/react-router";
import { getCheckouts } from "@polar-sh/sdk/2026-10/services/checkouts";
import { polarClient } from "@/lib/polar";
import { errorJson, withApiRouteTelemetry } from "@/lib/api-routes";
import { auth } from "@/lib/auth";

export const Route = createFileRoute("/api/checkout/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return withApiRouteTelemetry(
          request,
          {
            route: "/api/checkout/status",
            fallbackMessage: "Failed to fetch checkout status",
          },
          async (telemetry) => {
            const session = await auth.api.getSession({ headers: request.headers });
            telemetry.userId = session?.user.id ?? null;
            if (!session) {
              return errorJson("Authentication required.", 401);
            }

            const url = new URL(request.url);
            const checkoutId = url.searchParams.get("id");

            if (!checkoutId) {
              return errorJson("Missing checkout ID", 400);
            }

            const checkout = await getCheckouts(polarClient)(checkoutId).catch((error) => {
              if (
                typeof error === "object" &&
                error !== null &&
                "statusCode" in error &&
                error.statusCode === 404
              ) {
                return null;
              }
              throw error;
            });
            if (!checkout || checkout.external_customer_id !== session.user.id) {
              return errorJson("Checkout not found.", 404);
            }

            return Response.json({ status: checkout.status });
          },
        );
      },
    },
  },
});
