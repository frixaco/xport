"use client";

import { useEffect, useState } from "react";
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
import { useCreditsStore } from "@/lib/credits-store";

export function CreditsDisplay({ signedIn }: { signedIn: boolean }) {
  const reset = useCreditsStore((state) => state.reset);

  useEffect(() => {
    if (!signedIn) {
      reset();
    }
  }, [reset, signedIn]);

  if (!signedIn) {
    return (
      <div className="flex items-center gap-1.5 opacity-50">
        <Coins className="size-4" />
        <span className="tabular-nums">—</span>
        <Button variant="outline" size="sm" className="ml-1 h-7 px-2" disabled>
          <Plus className="size-3" />
          Top up
        </Button>
      </div>
    );
  }

  return <CreditsDisplayInner />;
}

function CreditsDisplayInner() {
  const balance = useCreditsStore((state) => state.balance);
  const loading = useCreditsStore((state) => state.loading);
  const fetchBalance = useCreditsStore((state) => state.fetchBalance);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [checkoutSlug, setCheckoutSlug] = useState<"credits-125" | "credits-1250" | null>(null);

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value);
  };

  useEffect(() => {
    let isMounted = true;
    let inFlight = false;

    const poll = async (setLoading: boolean) => {
      if (!isMounted || inFlight) return;
      inFlight = true;
      try {
        await fetchBalance({ setLoading });
      } finally {
        inFlight = false;
      }
    };

    void poll(true);
    const intervalId = window.setInterval(() => {
      void poll(false);
    }, 15_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [fetchBalance]);

  const handleTopUp = async (slug: "credits-125" | "credits-1250") => {
    try {
      setCheckoutSlug(slug);
      await authClient.checkout({ slug });
    } finally {
      setCheckoutSlug(null);
    }
  };

  const creditPlans = [
    {
      slug: "credits-125" as const,
      credits: 125,
      price: "$1",
    },
    {
      slug: "credits-1250" as const,
      credits: 1250,
      price: "$10",
    },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <Coins className="size-4 text-muted-foreground" />
      {loading ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <span className="tabular-nums">{balance}</span>
      )}
      <Popover
        open={topUpOpen}
        onOpenChange={(open) => {
          if (checkoutSlug !== null) return;
          setTopUpOpen(open);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="ml-1 h-7 px-2"
              disabled={checkoutSlug !== null}
            />
          }
        >
          <Plus className="size-3" />
          Top up
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-72">
          <PopoverHeader className="gap-1 pb-1">
            <PopoverTitle className="font-semibold">Add credits</PopoverTitle>
            <PopoverDescription>
              ~{TWEETS_PER_CREDIT} posts / credit (threads/users).
              <br />1 article / credit.
            </PopoverDescription>
          </PopoverHeader>
          <div className="pb-2 text-xs text-muted-foreground">
            Rounded up per export (min 1 credit). Stop early bills only fetched posts.
          </div>
          <div className="space-y-2">
            {creditPlans.map((plan) => (
              <Button
                key={plan.slug}
                variant="outline"
                className="h-auto w-full justify-between px-3 py-2.5 text-left"
                disabled={checkoutSlug !== null}
                onClick={() => handleTopUp(plan.slug)}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold tabular-nums">
                    {formatNumber(plan.credits)} credits
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    ~{formatNumber(plan.credits * TWEETS_PER_CREDIT)} posts
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
