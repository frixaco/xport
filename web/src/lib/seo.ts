import { createServerFn } from "@tanstack/react-start";

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

export const getSiteUrl = createServerFn({ method: "GET" }).handler(() => {
  const candidates = [process.env.SITE_URL, process.env.BETTER_AUTH_URL];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }

  return LOCAL_DEV_SITE_URL;
});

export const SITE_NAME = "Xport";
export const SITE_TITLE = "Xport | Export X (ex-Twitter) Posts, Threads, Articles, and Bookmarks";
export const SITE_DESCRIPTION =
  "Export X (ex-Twitter) posts, unroll threads, save articles, and export your bookmarks online.";
export const SITE_KEYWORDS = [
  "export twitter posts",
  "export x posts",
  "download tweets",
  "twitter x thread reader",
  "unroll twitter thread",
  "save x article",
  "twitter export tool",
  "export twitter bookmarks",
  "export x bookmarks",
];
