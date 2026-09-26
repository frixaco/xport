import { auth } from "@/lib/auth";
import { extractCreditsBalance, normalizeUsageCredits } from "@/lib/credits";

const USAGE_EVENT_NAME = "usage";
const PREFLIGHT_RATE_LIMIT = 30;
const PREFLIGHT_RATE_WINDOW_MS = 60_000;
const preflightWindows = new Map<string, { count: number; startedAt: number }>();

export class BillingAccessError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BillingAccessError";
    this.status = status;
    this.code = code;
  }
}

export interface CreditsUsageMetadata {
  credits: number;
}

async function getSessionOrThrow(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new BillingAccessError("Authentication required.", 401, "UNAUTHORIZED");
  }
  return session;
}

function enforcePreflightRateLimit(userId: string): void {
  const now = Date.now();
  if (preflightWindows.size > 10_000) {
    for (const [id, candidate] of preflightWindows) {
      if (now - candidate.startedAt >= PREFLIGHT_RATE_WINDOW_MS) preflightWindows.delete(id);
    }
  }

  const window = preflightWindows.get(userId);
  if (!window || now - window.startedAt >= PREFLIGHT_RATE_WINDOW_MS) {
    preflightWindows.set(userId, { count: 1, startedAt: now });
    return;
  }

  if (window.count >= PREFLIGHT_RATE_LIMIT) {
    throw new BillingAccessError(
      "Too many export requests. Try again shortly.",
      429,
      "RATE_LIMITED",
    );
  }
  window.count++;
}

export async function assertSufficientCredits(
  request: Request,
  requiredCredits: number,
): Promise<void> {
  const session = await getSessionOrThrow(request);
  enforcePreflightRateLimit(session.user.id);

  let state: unknown = null;
  try {
    state = await auth.api.state({
      headers: request.headers,
    });
  } catch {
    throw new BillingAccessError("Could not verify credit balance.", 500, "CREDITS_UNAVAILABLE");
  }

  const balance = extractCreditsBalance(state);
  if (balance < requiredCredits) {
    throw new BillingAccessError(
      `Insufficient credits. ${requiredCredits} credits required.`,
      402,
      "INSUFFICIENT_CREDITS",
    );
  }
}

export async function ingestCreditsUsage(
  request: Request,
  metadata: CreditsUsageMetadata,
): Promise<boolean> {
  const credits = normalizeUsageCredits(metadata.credits);

  try {
    await auth.api.ingestion({
      headers: request.headers,
      body: {
        event: USAGE_EVENT_NAME,
        metadata: {
          credits,
        },
      },
    });
    return true;
  } catch (error) {
    console.error("Failed to ingest Polar usage event", error);
    return false;
  }
}
