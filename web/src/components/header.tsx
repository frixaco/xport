"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { authClient } from "@/lib/auth-client";
import { CreditsDisplay } from "@/components/credits-display";
import { useCreditsStore } from "@/lib/credits-store";

const ACCOUNT_SEEN_SESSION_KEY = "xport-account-seen";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function Header() {
  const posthog = usePostHog();
  const { data: session, isPending } = authClient.useSession();
  const resetCredits = useCreditsStore((state) => state.reset);
  const [signInOpen, setSignInOpen] = useState(false);

  const handleSignIn = (provider: "github" | "google") => {
    authClient.signIn.social({
      provider,
      callbackURL: "/",
    });
  };

  const handleSignOut = () => {
    resetCredits();
    posthog?.reset();
    authClient.signOut();
  };

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  useEffect(() => {
    if (!user?.id) return;

    posthog?.identify(user.id, {
      email: user.email,
      name: user.name,
    });

    if (typeof window === "undefined") return;
    const key = `${ACCOUNT_SEEN_SESSION_KEY}:${user.id}`;
    if (window.sessionStorage.getItem(key)) return;

    posthog?.capture("account_seen");
    window.sessionStorage.setItem(key, "1");
  }, [posthog, user?.email, user?.id, user?.name]);

  return (
    <header className="flex items-center justify-between px-6 py-3">
      <div className="flex gap-2 items-center text-lg font-bold tracking-tight">
        <svg viewBox="0 0 512 512" fill="none" className="size-7" aria-hidden="true">
          <defs>
            <linearGradient
              id="xport-bg"
              x1="0"
              y1="0"
              x2="512"
              y2="512"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#0a0a0a" />
              <stop offset="100%" stopColor="#171717" />
            </linearGradient>
            <linearGradient
              id="xport-accent"
              x1="128"
              y1="128"
              x2="384"
              y2="384"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#2b7fff" />
              <stop offset="100%" stopColor="#2b7fff" />
            </linearGradient>
          </defs>
          <rect width="512" height="512" rx="96" fill="url(#xport-bg)" />
          <path
            d="M148 136 L364 376"
            stroke="url(#xport-accent)"
            strokeWidth="44"
            strokeLinecap="round"
          />
          <path d="M148 376 L340 160" stroke="#f8fafc" strokeWidth="44" strokeLinecap="round" />
          <path
            d="M256 136 L364 136 L364 244"
            stroke="#f8fafc"
            strokeWidth="34"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span>Xport</span>
      </div>

      <div className="flex items-center gap-3">
        <CreditsDisplay signedIn={!isPending && !!user} />

        {isPending ? (
          <div className="size-8 animate-pulse rounded-full bg-muted" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="focus:outline-none"
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full bg-chart-2 font-bold text-white hover:bg-chart-2/80"
                />
              }
            >
              {initials}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{user.name}</span>
                    <span className="text-muted-foreground">{user.email}</span>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                <LogOut />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Popover open={signInOpen} onOpenChange={setSignInOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>Sign in</PopoverTrigger>
            <PopoverContent align="end" sideOffset={8}>
              <PopoverHeader>
                <PopoverTitle>Sign in to Xport</PopoverTitle>
                <PopoverDescription>Choose a provider to continue</PopoverDescription>
              </PopoverHeader>
              <div className="flex flex-col gap-2.5">
                <Button
                  variant="outline"
                  className="h-10 gap-2.5"
                  onClick={() => handleSignIn("google")}
                >
                  <GoogleIcon className="size-5" />
                  Continue with Google
                </Button>

                <Button
                  variant="outline"
                  className="h-10 gap-2.5"
                  onClick={() => handleSignIn("github")}
                >
                  <GitHubIcon className="size-5" />
                  Continue with GitHub
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </header>
  );
}
