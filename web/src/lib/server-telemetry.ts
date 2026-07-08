import { PostHog } from "posthog-node";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const SERVER_DISTINCT_ID = "server";

type TelemetryProperties = Record<string, string | number | boolean | null | undefined>;

interface CaptureServerEventOptions {
  distinctId?: string | null;
  properties?: TelemetryProperties;
}

let posthogClient: PostHog | null | undefined;

export function captureServerEvent(event: string, options: CaptureServerEventOptions = {}): void {
  const posthog = getPostHogClient();
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId: options.distinctId ?? SERVER_DISTINCT_ID,
      event,
      properties: compactProperties(options.properties),
    });
  } catch (error) {
    console.error("Failed to capture PostHog event", error);
  }
}

export function captureServerException(
  error: unknown,
  options: CaptureServerEventOptions = {},
): void {
  const posthog = getPostHogClient();
  if (!posthog) return;

  try {
    posthog.captureException(
      error,
      options.distinctId ?? SERVER_DISTINCT_ID,
      compactProperties(options.properties),
    );
  } catch (captureError) {
    console.error("Failed to capture PostHog exception", captureError);
  }
}

function getPostHogClient(): PostHog | null {
  if (posthogClient !== undefined) return posthogClient;

  const apiKey = process.env.POSTHOG_KEY ?? process.env.PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    posthogClient = null;
    return posthogClient;
  }

  posthogClient = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? process.env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    enableExceptionAutocapture: true,
    flushAt: 1,
    flushInterval: 0,
  });

  return posthogClient;
}

function compactProperties(
  properties: TelemetryProperties = {},
): Record<string, string | number | boolean | null> {
  const compacted: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) compacted[key] = value;
  }

  return compacted;
}
