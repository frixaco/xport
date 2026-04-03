"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

let initialized = false;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (initialized) return;

    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
    if (!key) return;

    posthog.init(key, {
      api_host: "/ingest",
      ui_host: host,
      defaults: "2026-01-30",
      capture_pageview: "history_change",
      person_profiles: "identified_only",
      loaded: (instance) => {
        if (process.env.NODE_ENV === "development") {
          instance.debug();
        }
      },
    });

    initialized = true;
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
