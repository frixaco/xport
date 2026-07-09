// oxlint-disable-next-line import/no-unassigned-import -- global stylesheet side effect import.
import "../../globals.css";
import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { PostHogProvider } from "@posthog/react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => ({
    posthog: {
      apiKey: process.env.PUBLIC_POSTHOG_KEY ?? "",
      apiHost: process.env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    },
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Xport — Export X (ex-Twitter) Data" },
      {
        name: "description",
        content: "Export posts, threads, and user posts from X (ex-Twitter) in multiple formats.",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { posthog } = Route.useLoaderData();
  const app = (
    <>
      {children}
      <Toaster />
    </>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="xport-theme">
          {posthog.apiKey ? (
            <PostHogProvider
              apiKey={posthog.apiKey}
              options={{
                api_host: posthog.apiHost,
                defaults: "2026-01-30",
                capture_exceptions: true,
              }}
            >
              {app}
            </PostHogProvider>
          ) : (
            app
          )}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
