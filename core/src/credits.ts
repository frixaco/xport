import type { FetchJobRequestType, UsageMetadataInput, XportUsageMetadata } from "./types.ts";

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

export interface CreditRate {
  items: number;
  credits: number;
}

const TWEET_RATE: CreditRate = { items: TWEETS_PER_CREDIT, credits: 1 };
/**
 * Bookmarks are sold at cost. X bills $0.005 per bookmark; a credit from the $10 / 1,250 pack
 * nets about $0.0074 after Polar's 4% + $0.40 fee, so 7 credits cover 10 bookmarks.
 */
export const BOOKMARK_RATE: CreditRate = { items: 10, credits: 7 };

export function creditRate(requestType: FetchJobRequestType): CreditRate {
  return requestType === "bookmarks" ? BOOKMARK_RATE : TWEET_RATE;
}

export function calculateTweetListCredits(
  tweetCount: number,
  rate: CreditRate = TWEET_RATE,
): number {
  const normalizedTweetCount = asNonNegativeInteger(tweetCount);
  return Math.max(1, Math.ceil((normalizedTweetCount * rate.credits) / rate.items));
}

/** Number of items that `credits` pays for at `rate`. */
export function affordableItems(credits: number, rate: CreditRate): number {
  return Math.floor((asNonNegativeInteger(credits) * rate.items) / rate.credits);
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
