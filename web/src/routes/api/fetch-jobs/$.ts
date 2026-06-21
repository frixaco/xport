import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { parseTwitterInput } from "@/lib/url-parser";
import { BillingAccessError, assertSufficientCredits } from "@/lib/billing-access";
import { errorJson } from "@/lib/api-routes";
import { createFetchJob, runFetchLoop, type FetchJobRequestType } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return errorJson("Authentication required.", 401);
        }

        let body: { input?: string };
        try {
          body = await request.json();
        } catch {
          return errorJson("Invalid JSON body.", 400);
        }

        const input = body.input?.trim();
        if (!input) {
          return errorJson("Missing required field: input.", 400);
        }

        const parsed = parseTwitterInput(input);
        if (!parsed) {
          return errorJson("Invalid input. Provide a valid tweet URL/ID or username.", 400);
        }
        const requestType: FetchJobRequestType = parsed.type === "tweet" ? "thread" : "user";
        const inputNormalized = parsed.type === "tweet" ? parsed.tweetId : parsed.username;

        try {
          await assertSufficientCredits(request, 1);
        } catch (error) {
          if (error instanceof BillingAccessError) {
            return errorJson(error.message, error.status, { code: error.code });
          }
          return errorJson("Could not verify credits.", 500);
        }

        const jobId = await createFetchJob({
          ownerUserId: session.user.id,
          requestType,
          inputRaw: input,
          inputNormalized,
        });

        const authHeaders = new Headers();
        const cookie = request.headers.get("cookie");
        if (cookie) authHeaders.set("cookie", cookie);
        const authorization = request.headers.get("authorization");
        if (authorization) authHeaders.set("authorization", authorization);

        runFetchLoop(jobId, requestType, inputNormalized, authHeaders).catch(console.error);

        return Response.json({ jobId }, { status: 201 });
      },
    },
  },
});
