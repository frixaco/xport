import { authClient } from "@/lib/auth-client";
import { extractCreditsBalance } from "@/lib/credits";

export type CreditCheckoutSlug = "credits-125" | "credits-1250";

export const creditsQueryKey = ["credits", "balance"] as const;

export async function fetchCreditsBalance(): Promise<number> {
  const { data } = await authClient.customer.state({}, { cache: "no-store" });
  return extractCreditsBalance(data);
}
