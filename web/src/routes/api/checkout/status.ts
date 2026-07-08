import { createFileRoute } from "@tanstack/react-router";
import { polarClient } from "@/lib/polar";
import { errorJson, withApiRouteTelemetry } from "@/lib/api-routes";

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
          async () => {
            const url = new URL(request.url);
            const checkoutId = url.searchParams.get("id");

            if (!checkoutId) {
              return errorJson("Missing checkout ID", 400);
            }

            const checkout = await polarClient.checkouts.get({ id: checkoutId });
            return Response.json({ status: checkout.status });
          },
        );
      },
    },
  },
});
