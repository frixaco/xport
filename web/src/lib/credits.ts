export const MIN_PREFLIGHT_CREDITS = 1;
export const TWEETS_PER_CREDIT = 20;

interface UsageMetadataInput {
  charged: boolean;
  chargedCredits: number;
  tweetCount?: number;
}

interface XportUsageMetadata {
  charged: boolean;
  chargedCredits: number;
  tweetCount?: number;
}

function asNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
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
