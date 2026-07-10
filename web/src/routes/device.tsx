import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { extractErrorMessage } from "@xport/core";

type DeviceSearch = {
  user_code?: string;
};

type DeviceStatus = "pending" | "approved" | "denied";

interface DeviceVerifyResponse {
  user_code: string;
  status: DeviceStatus;
}

function validateSearch(search: Record<string, unknown>): DeviceSearch {
  return typeof search.user_code === "string" ? { user_code: search.user_code } : {};
}

export const Route = createFileRoute("/device")({
  validateSearch,
  component: DevicePage,
});

async function fetchSession(): Promise<typeof authClient.$Infer.Session | null> {
  const result = await authClient.getSession();
  return result.data ?? null;
}

function normalizeUserCode(value: string): string {
  return value.trim().toUpperCase();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

function verifyDeviceCode(userCode: string): Promise<DeviceVerifyResponse> {
  return fetchJson<DeviceVerifyResponse>(
    `/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );
}

function updateDeviceCodeStatus(
  action: "approve" | "deny",
  userCode: string,
): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`/api/auth/device/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ userCode }),
  });
}

function signIn(provider: "github" | "google", userCode: string) {
  const callbackURL = userCode ? `/device?user_code=${encodeURIComponent(userCode)}` : "/device";
  authClient.signIn.social({ provider, callbackURL });
}

function DevicePage() {
  const search = Route.useSearch();
  const [codeInput, setCodeInput] = useState(search.user_code ?? "");
  const userCode = useMemo(() => normalizeUserCode(codeInput), [codeInput]);
  const sessionQuery = useQuery({
    queryKey: ["auth", "session", "device"],
    queryFn: fetchSession,
  });
  const verifyQuery = useQuery({
    queryKey: ["device", "verify", userCode, Boolean(sessionQuery.data)],
    queryFn: () => verifyDeviceCode(userCode),
    enabled: Boolean(userCode),
    retry: false,
  });
  const approveMutation = useMutation({
    mutationFn: () => updateDeviceCodeStatus("approve", userCode),
  });
  const denyMutation = useMutation({
    mutationFn: () => updateDeviceCodeStatus("deny", userCode),
  });

  useEffect(() => {
    if (search.user_code) setCodeInput(search.user_code);
  }, [search.user_code]);

  const user = sessionQuery.data?.user;
  const status = approveMutation.isSuccess
    ? "approved"
    : denyMutation.isSuccess
      ? "denied"
      : verifyQuery.data?.status;
  const isBusy =
    sessionQuery.isLoading ||
    verifyQuery.isFetching ||
    approveMutation.isPending ||
    denyMutation.isPending;
  const error =
    verifyQuery.error ?? approveMutation.error ?? denyMutation.error ?? sessionQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/20 px-6 py-10">
      <section className="flex w-full max-w-md flex-col gap-6 rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex flex-col gap-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-chart-2/10 text-chart-2">
            {status === "approved" ? (
              <CheckCircle2 className="size-6" />
            ) : status === "denied" ? (
              <XCircle className="size-6" />
            ) : isBusy ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <ArrowLeft className="size-6" />
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Authorize Xport CLI</h1>
          <p className="text-sm text-muted-foreground">
            Confirm the code from your terminal to let the CLI access your Xport account.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="device-code" className="text-sm font-medium">
            Device code
          </label>
          <Input
            id="device-code"
            value={codeInput}
            placeholder="ABCD1234"
            className="text-center font-mono text-lg tracking-[0.25em] uppercase"
            disabled={isBusy || status === "approved" || status === "denied"}
            onChange={(event) => setCodeInput(event.target.value)}
          />
        </div>

        {errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {!user ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Sign in first. You’ll return here automatically after authentication.
            </p>
            <Button type="button" variant="outline" onClick={() => signIn("google", userCode)}>
              Continue with Google
            </Button>
            <Button type="button" variant="outline" onClick={() => signIn("github", userCode)}>
              Continue with GitHub
            </Button>
          </div>
        ) : status === "approved" ? (
          <div className="rounded-md border border-chart-2/30 bg-chart-2/10 px-3 py-2 text-sm text-chart-2">
            CLI authorized. You can return to your terminal.
          </div>
        ) : status === "denied" ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Authorization denied. You can close this page.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>.
            </p>
            <Button
              type="button"
              disabled={!userCode || isBusy}
              onClick={() => approveMutation.mutate()}
            >
              Authorize CLI
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!userCode || isBusy}
              onClick={() => denyMutation.mutate()}
            >
              Deny
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
