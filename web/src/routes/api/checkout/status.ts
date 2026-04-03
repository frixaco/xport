import { createFileRoute } from "@tanstack/react-router";
import { polarClient } from "@/lib/polar";

export const Route = createFileRoute("/api/checkout/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const checkoutId = url.searchParams.get("id");

        if (!checkoutId) {
          return Response.json({ error: "Missing checkout ID" }, { status: 400 });
        }

        try {
          const checkout = await polarClient.checkouts.get({ id: checkoutId });
          return Response.json({ status: checkout.status });
        } catch {
          return Response.json({ error: "Failed to fetch checkout status" }, { status: 500 });
        }
      },
    },
  },
});
