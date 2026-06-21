import { useEffect, useEffectEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { creditsQueryKey } from "@/lib/credits-store";

const POLL_INTERVAL = 1500;
const MAX_ATTEMPTS = 20;

type CheckoutStatus = "succeeded" | "failed" | "expired" | string;
type CheckoutResult = "succeeded" | "failed" | "expired" | "timeout" | "error";

async function fetchCheckoutStatus(checkoutId: string): Promise<CheckoutStatus> {
  const res = await fetch(`/api/checkout/status?id=${encodeURIComponent(checkoutId)}`);
  if (!res.ok) throw new Error("Could not verify payment.");
  const data = (await res.json()) as { status?: CheckoutStatus };
  return data.status ?? "unknown";
}

function isFinalCheckoutStatus(status: CheckoutStatus): status is CheckoutResult {
  return status === "succeeded" || status === "failed" || status === "expired";
}

function checkoutToastMessage(result: CheckoutResult): { kind: "success" | "error"; text: string } {
  if (result === "succeeded") {
    return { kind: "success", text: "Payment successful! Credits added." };
  }
  if (result === "timeout") {
    return { kind: "error", text: "Payment verification timed out. Credits will appear shortly." };
  }
  if (result === "error") {
    return { kind: "error", text: "Could not verify payment. Please check your balance." };
  }
  return { kind: "error", text: "Payment failed. Please try again." };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function CheckoutToast() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const verifyCheckout = useEffectEvent(
    async (id: string, toastId: string | number, isCancelled: () => boolean) => {
      let result: CheckoutResult = "timeout";

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const status = await queryClient.fetchQuery({
            queryKey: ["checkout", "status", id],
            queryFn: () => fetchCheckoutStatus(id),
            staleTime: 0,
          });
          if (isFinalCheckoutStatus(status)) {
            result = status;
            break;
          }
        } catch {
          result = "error";
          break;
        }

        await wait(POLL_INTERVAL);
      }

      if (isCancelled()) return;
      if (result === "succeeded") {
        queryClient.invalidateQueries({ queryKey: creditsQueryKey });
      }

      const { kind, text } = checkoutToastMessage(result);
      toast[kind](text, { id: toastId });
    },
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const checkoutId = searchParams.get("checkout_id");
    if (!checkoutId) return;

    let cancelled = false;
    const toastId = toast.loading("Verifying payment...");

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("checkout_id");
    const nextSearch = Object.fromEntries(nextParams);
    navigate({
      to: "/",
      search: Object.keys(nextSearch).length > 0 ? nextSearch : undefined,
      replace: true,
    });

    void verifyCheckout(checkoutId, toastId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
