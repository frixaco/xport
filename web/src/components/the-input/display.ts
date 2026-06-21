import { TWEETS_PER_CREDIT } from "@/lib/credits";
import type { ResultState } from "./types";

export function estimateCostCredits(result: ResultState): number {
  if (result.usage?.charged) {
    return Math.max(1, result.usage.chargedCredits);
  }

  if (typeof result.usage?.tweetCount === "number") {
    return Math.max(1, Math.ceil(result.usage.tweetCount / TWEETS_PER_CREDIT));
  }

  if (result.kind === "article") return 1;
  return 1;
}

export function formatCreditLabel(value: number): string {
  return `${value} credit${value === 1 ? "" : "s"}`;
}
