import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

export function AuthErrorToast() {
  const navigate = useNavigate();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const authError = searchParams.get("auth_error");
    if (!authError) return;

    if (authError === "cancelled") {
      toast.info("Sign-in was cancelled.");
    } else {
      toast.error("Sign-in failed. Please try again.");
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("auth_error");
    const nextSearch = Object.fromEntries(nextParams);
    navigate({
      to: "/",
      search: Object.keys(nextSearch).length > 0 ? nextSearch : undefined,
      replace: true,
    });
  }, [navigate]);

  return null;
}
