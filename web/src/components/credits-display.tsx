import { useMutation, useQuery } from "@tanstack/react-query";
import { Coins, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { authClient } from "@/lib/auth-client";
import { TWEETS_PER_CREDIT } from "@/lib/credits";
import { creditsQueryKey, fetchCreditsBalance, type CreditCheckoutSlug } from "@/lib/credits-store";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const creditPlans = [
  { slug: "credits-125", credits: 125, price: "$1" },
  { slug: "credits-1250", credits: 1250, price: "$10" },
] as const satisfies ReadonlyArray<{
  slug: CreditCheckoutSlug;
  credits: number;
  price: string;
}>;

export function CreditsDisplay({ signedIn }: { signedIn: boolean }) {
  if (!signedIn) {
    return (
      <div className="flex items-center gap-2 opacity-50">
        <Coins className="size-4" />
        <span className="tabular-nums">—</span>
        <Button variant="outline" size="sm" className="h-7 px-2" disabled>
          <Plus className="size-3" />
          Top up
        </Button>
      </div>
    );
  }

  return <CreditsDisplayInner />;
}

function CreditsDisplayInner() {
  const balanceQuery = useQuery({
    queryKey: creditsQueryKey,
    queryFn: fetchCreditsBalance,
    refetchInterval: 15_000,
  });
  const checkoutMutation = useMutation({
    mutationFn: async (slug: CreditCheckoutSlug) => {
      await authClient.checkout({ slug });
    },
  });
  const checkoutSlug = checkoutMutation.isPending ? checkoutMutation.variables : null;

  return (
    <div className="flex items-center gap-2">
      <Coins className="size-4 text-muted-foreground" />
      {balanceQuery.isLoading ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <span className="tabular-nums">{balanceQuery.data ?? 0}</span>
      )}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              aria-label="Top up credits"
              disabled={checkoutSlug !== null}
            />
          }
        >
          <Plus className="size-3" />
          Top up
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-72">
          <PopoverHeader className="gap-1 pb-2">
            <PopoverTitle className="font-semibold">Add credits</PopoverTitle>
            <PopoverDescription>
              ~{TWEETS_PER_CREDIT} posts / credit (threads/users).
              <br />1 article / credit.
              <br />
              Rounded up per export (min 1 credit). Stop early bills only fetched posts.
            </PopoverDescription>
          </PopoverHeader>
          <div className="flex flex-col gap-2">
            {creditPlans.map((plan) => (
              <Button
                key={plan.slug}
                variant="outline"
                className="h-auto w-full justify-between px-3 py-2.5 text-left"
                disabled={checkoutSlug !== null}
                onClick={() => checkoutMutation.mutate(plan.slug)}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold tabular-nums">
                    {numberFormatter.format(plan.credits)} credits
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ~{numberFormatter.format(plan.credits * TWEETS_PER_CREDIT)} posts
                  </span>
                </div>
                {checkoutSlug === plan.slug ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="font-semibold">{plan.price}</span>
                )}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
