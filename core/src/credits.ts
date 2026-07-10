import type { UsageMetadataInput, XportUsageMetadata } from "./types.ts";

export const MIN_PREFLIGHT_CREDITS = 1;
export const TWEETS_PER_CREDIT = 20;

interface MeterLike {
  balance?: unknown;
}

function asNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getActiveMeters(data: unknown): MeterLike[] {
  if (typeof data !== "object" || data === null) return [];

  const state = data as {
    activeMeters?: unknown;
    active_meters?: unknown;
  };
  if (Array.isArray(state.activeMeters)) return state.activeMeters as MeterLike[];
  if (Array.isArray(state.active_meters)) return state.active_meters as MeterLike[];
  return [];
}

export function extractCreditsBalance(data: unknown): number {
  const meters = getActiveMeters(data);
  return meters.reduce((sum, meter) => sum + asNumber(meter.balance), 0);
}

export function normalizeUsageCredits(value: unknown): number {
  return Math.max(1, Math.ceil(asNumber(value)));
}

export function calculateTweetListCredits(tweetCount: number): number {
  const normalizedTweetCount = asNonNegativeInteger(tweetCount);
  return Math.max(1, Math.ceil(normalizedTweetCount / TWEETS_PER_CREDIT));
}

export function buildUsageMetadata(input: UsageMetadataInput): XportUsageMetadata {
  const chargedCredits = input.charged
    ? Math.max(1, asNonNegativeInteger(input.chargedCredits))
    : 0;
  return {
    charged: input.charged,
    chargedCredits,
    tweetCount: input.tweetCount === undefined ? undefined : asNonNegativeInteger(input.tweetCount),
  };
}

export function withUsageMetadata<T extends object>(
  payload: T,
  metadata: XportUsageMetadata,
): T & { xport: XportUsageMetadata } {
  return {
    ...payload,
    xport: metadata,
  };
}
