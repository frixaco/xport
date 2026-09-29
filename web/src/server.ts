import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { FastResponse } from "srvx";

globalThis.Response = FastResponse as typeof Response;

export default createServerEntry({
  fetch(request) {
    if (
      process.env.BILLING_MAINTENANCE === "true" &&
      request.method === "POST" &&
      new URL(request.url).pathname.startsWith("/api/") &&
      !/^\/api\/fetch-jobs\/[^/]+\/stop$/.test(new URL(request.url).pathname)
    ) {
      return Response.json(
        { error: "Billing maintenance in progress.", code: "BILLING_MAINTENANCE" },
        { status: 503 },
      );
    }
    return handler.fetch(request);
  },
});
