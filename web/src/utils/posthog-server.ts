import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function getPostHogClient() {
  const apiKey = process.env.PUBLIC_POSTHOG_KEY;

  if (!apiKey) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, {
      host: process.env.PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}
