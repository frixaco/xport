import "../../app/globals.css";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { PostHogProvider } from "@posthog/react";
import { Toaster } from "@/components/ui/sonner";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export const Route = createRootRoute({
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
      { title: "Xport — Export Twitter/X Data" },
      {
        name: "description",
        content: "Export tweets, threads, and user posts from Twitter/X in multiple formats.",
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
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
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
        <Scripts />
      </body>
    </html>
  );
}
