"use client";

import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

const POLL_INTERVAL = 1500;
const MAX_ATTEMPTS = 20;

export function CheckoutToast() {
  const navigate = useNavigate();
  const pollingRef = useRef(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const checkoutId = searchParams.get("checkout_id");
    if (!checkoutId || pollingRef.current) return;

    pollingRef.current = true;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("checkout_id");
    const nextSearch = nextParams.toString();
    navigate({ to: "/", search: nextSearch || undefined, replace: true });

    const toastId = toast.loading("Verifying payment...");

    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout/status?id=${encodeURIComponent(checkoutId)}`);
        const data = await res.json();

        if (data.status === "succeeded") {
          toast.success("Payment successful! Credits added.", {
            id: toastId,
          });
          return;
        }

        if (data.status === "failed" || data.status === "expired") {
          toast.error("Payment failed. Please try again.", { id: toastId });
          return;
        }

        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          toast.error("Payment verification timed out. Credits will appear shortly.", {
            id: toastId,
          });
          return;
        }

        setTimeout(poll, POLL_INTERVAL);
      } catch {
        toast.error("Could not verify payment. Please check your balance.", {
          id: toastId,
        });
      }
    };

    poll();
  }, [navigate]);

  return null;
}
