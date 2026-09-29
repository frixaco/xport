export type CreditCheckoutSlug = "credits-125" | "credits-1250";

export const creditsQueryKey = ["credits", "balance"] as const;

export async function fetchCreditsBalance(): Promise<number> {
  const response = await fetch("/api/cli/me", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load credits.");
  const data = (await response.json()) as { credits: number | null };
  if (data.credits === null) throw new Error("Could not load credits.");
  return data.credits;
}
