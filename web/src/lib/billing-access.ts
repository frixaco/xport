import { auth } from "@/lib/auth";
import { extractCreditsBalance, normalizeUsageCredits } from "@/lib/credits";

const USAGE_EVENT_NAME = "usage";

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

export async function assertSufficientCredits(
  request: Request,
  requiredCredits: number,
): Promise<void> {
  await getSessionOrThrow(request);

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
