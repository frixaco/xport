import { authClient } from "@/lib/auth-client";

export type CreditCheckoutSlug = "credits-125" | "credits-1250";

interface CustomerStateLike {
  activeMeters?: Array<Record<string, unknown>>;
  active_meters?: Array<Record<string, unknown>>;
}

interface MeterLike {
  balance?: unknown;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getActiveMeters(data: CustomerStateLike | null | undefined): MeterLike[] {
  if (!data) return [];
  if (Array.isArray(data.activeMeters)) return data.activeMeters;
  if (Array.isArray(data.active_meters)) return data.active_meters;
  return [];
}

export function extractBalance(data: CustomerStateLike | null | undefined): number {
  const meters = getActiveMeters(data);
  return meters.reduce((sum, meter) => sum + asNumber(meter.balance), 0);
}

export const creditsQueryKey = ["credits", "balance"] as const;

export async function fetchCreditsBalance(): Promise<number> {
  const { data } = await authClient.customer.state({}, { cache: "no-store" });
  return extractBalance(data as CustomerStateLike);
}
