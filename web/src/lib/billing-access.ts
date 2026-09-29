import { auth } from "@/lib/auth";
import { assertBillingEnabled, BillingAccessError } from "./credit-ledger.ts";
export { BillingAccessError } from "./credit-ledger.ts";

const preflightWindows = new Map<string, { count: number; startedAt: number }>();

export async function getBillingUser(request: Request): Promise<string> {
  assertBillingEnabled();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new BillingAccessError("Authentication required.", 401, "UNAUTHORIZED");
  const userId = session.user.id;
  const now = Date.now();
  if (preflightWindows.size > 10_000) {
    for (const [id, window] of preflightWindows) {
      if (now - window.startedAt >= 60_000) preflightWindows.delete(id);
    }
  }
  const window = preflightWindows.get(userId);
  if (!window || now - window.startedAt >= 60_000) {
    preflightWindows.set(userId, { count: 1, startedAt: now });
  } else {
    if (window.count >= 30)
      throw new BillingAccessError(
        "Too many export requests. Try again shortly.",
        429,
        "RATE_LIMITED",
      );
    window.count++;
  }
  return userId;
}
