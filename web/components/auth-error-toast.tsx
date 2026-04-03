"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

export function AuthErrorToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const authError = searchParams.get("auth_error");
    if (!authError) return;

    if (authError === "cancelled") {
      toast.info("Sign-in was cancelled.");
    } else {
      toast.error("Sign-in failed. Please try again.");
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("auth_error");
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/?${nextSearch}` : "/", { scroll: false });
  }, [searchParams, router]);

  return null;
}
