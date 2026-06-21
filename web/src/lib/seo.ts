const LOCAL_DEV_SITE_URL = "http://localhost:3000";

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    try {
      return new URL(`https://${trimmed}`).origin;
    } catch {
      return null;
    }
  }
}

export function getSiteUrl(): string {
  const candidates = [process.env.SITE_URL, process.env.BETTER_AUTH_URL];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }

  return LOCAL_DEV_SITE_URL;
}

export const SITE_NAME = "Xport";
export const SITE_TITLE = "Xport | Export Twitter and X Posts, Threads, and Articles";
export const SITE_DESCRIPTION =
  "Export Twitter and X posts, unroll threads, and save articles online.";
export const SITE_KEYWORDS = [
  "export twitter posts",
  "export x posts",
  "download tweets",
  "twitter x thread reader",
  "unroll twitter thread",
  "save x article",
  "twitter export tool",
];
