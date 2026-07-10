import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { errorJson } from "@/lib/api-routes";
import { extractCreditsBalance } from "@/lib/credits";

export const Route = createFileRoute("/api/cli/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return errorJson("Authentication required.", 401);
        }

        let credits: number | null = null;
        try {
          credits = extractCreditsBalance(
            await auth.api.state({
              headers: request.headers,
            }),
          );
        } catch {
          credits = null;
        }

        return Response.json({
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          },
          credits,
        });
      },
    },
  },
});
