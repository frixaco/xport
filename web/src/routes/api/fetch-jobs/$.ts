import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { parseTweetId, parseUsername } from "@/lib/url-parser";
import { ApiAccessError, assertSufficientCredits } from "@/lib/api-access";
import { createFetchJob, runFetchLoop, type FetchJobRequestType } from "@/lib/fetch-job";

export const Route = createFileRoute("/api/fetch-jobs/$")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) {
          return Response.json({ error: "Authentication required." }, { status: 401 });
        }

        let body: { input?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }

        const input = body.input?.trim();
        if (!input) {
          return Response.json({ error: "Missing required field: input." }, { status: 400 });
        }

        let requestType: FetchJobRequestType;
        let inputNormalized: string;

        const tweetId = parseTweetId(input);
        if (tweetId) {
          requestType = "thread";
          inputNormalized = tweetId;
        } else {
          const username = parseUsername(input);
          if (username) {
            requestType = "user";
            inputNormalized = username;
          } else {
            return Response.json(
              { error: "Invalid input. Provide a valid tweet URL/ID or username." },
              { status: 400 },
            );
          }
        }

        try {
          await assertSufficientCredits(request, 1);
        } catch (error) {
          if (error instanceof ApiAccessError) {
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.status },
            );
          }
          return Response.json({ error: "Could not verify credits." }, { status: 500 });
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
