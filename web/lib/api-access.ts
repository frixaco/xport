import { auth } from "@/lib/auth";

const USAGE_EVENT_NAME = "usage";

interface MeterLike {
  balance?: unknown;
}

interface CustomerStateLike {
  activeMeters?: MeterLike[];
  active_meters?: MeterLike[];
}

export class ApiAccessError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiAccessError";
    this.status = status;
    this.code = code;
  }
}

export interface CreditsUsageMetadata {
  credits: number;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getActiveMeters(state: CustomerStateLike | null | undefined): MeterLike[] {
  if (!state) return [];
  if (Array.isArray(state.activeMeters)) return state.activeMeters;
  if (Array.isArray(state.active_meters)) return state.active_meters;
  return [];
}

function getBalanceFromState(state: CustomerStateLike | null | undefined): number {
  const meters = getActiveMeters(state);
  return meters.reduce((sum, meter) => sum + asNumber(meter.balance), 0);
}

async function getSessionOrThrow(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new ApiAccessError("Authentication required.", 401, "UNAUTHORIZED");
  }
  return session;
}

export async function assertSufficientCredits(
  request: Request,
  requiredCredits: number,
): Promise<void> {
  await getSessionOrThrow(request);

  let state: CustomerStateLike | null = null;
  try {
    state = (await auth.api.state({
      headers: request.headers,
    })) as CustomerStateLike;
  } catch {
    throw new ApiAccessError("Could not verify credit balance.", 500, "CREDITS_UNAVAILABLE");
  }

  const balance = getBalanceFromState(state);
  if (balance < requiredCredits) {
    throw new ApiAccessError(
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
  const credits = Math.max(1, Math.ceil(asNumber(metadata.credits)));

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
