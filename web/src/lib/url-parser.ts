const TWEET_ID_PATTERN = /^\d+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

const RESERVED_PATH_SEGMENTS = new Set([
  "compose",
  "explore",
  "hashtag",
  "home",
  "i",
  "intent",
  "login",
  "messages",
  "notifications",
  "search",
  "settings",
  "share",
  "signup",
]);

export type ParsedURL =
  | { type: "tweet"; tweetId: string; username?: string }
  | { type: "user"; username: string };

function normalizeInput(input: string): string {
  return input.trim();
}

function toTwitterUrl(input: string): URL | null {
  const trimmed = normalizeInput(input);
  if (!trimmed) return null;

  const maybeUrl = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(?:www\.)?(?:x\.com|twitter\.com)\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;

  if (!maybeUrl) return null;

  try {
    const url = new URL(maybeUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeUsername(raw: string): string | null {
  const candidate = raw.replace(/^@/, "");
  if (!candidate) return null;
  if (!USERNAME_PATTERN.test(candidate)) return null;
  return candidate;
}

function parseUserSegment(segment: string): string | null {
  const decoded = decodeURIComponent(segment);
  if (RESERVED_PATH_SEGMENTS.has(decoded.toLowerCase())) return null;
  return normalizeUsername(decoded);
}

export function parseTwitterInput(input: string): ParsedURL | null {
  const trimmed = normalizeInput(input);
  if (!trimmed) return null;

  if (TWEET_ID_PATTERN.test(trimmed)) {
    return { type: "tweet", tweetId: trimmed };
  }

  if (trimmed.startsWith("@")) {
    const username = normalizeUsername(trimmed);
    return username ? { type: "user", username } : null;
  }

  if (USERNAME_PATTERN.test(trimmed)) {
    return { type: "user", username: trimmed };
  }

  const url = toTwitterUrl(trimmed);
  if (!url) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (
    segments[0] === "i" &&
    segments[1] === "status" &&
    segments[2] &&
    TWEET_ID_PATTERN.test(segments[2])
  ) {
    return { type: "tweet", tweetId: segments[2] };
  }

  const userSegment = parseUserSegment(segments[0]);
  if (!userSegment) return null;

  if (segments[1] === "status" && segments[2] && TWEET_ID_PATTERN.test(segments[2])) {
    return { type: "tweet", tweetId: segments[2], username: userSegment };
  }

  if (segments[1] === "article" && segments[2] && TWEET_ID_PATTERN.test(segments[2])) {
    return { type: "tweet", tweetId: segments[2], username: userSegment };
  }

  if (segments[1] === "thread" && segments[2] && TWEET_ID_PATTERN.test(segments[2])) {
    return { type: "tweet", tweetId: segments[2], username: userSegment };
  }

  return { type: "user", username: userSegment };
}

export function parseTweetId(input: string): string | null {
  const parsed = parseTwitterInput(input);
  return parsed?.type === "tweet" ? parsed.tweetId : null;
}

export function parseUsername(input: string): string | null {
  const parsed = parseTwitterInput(input);
  if (!parsed) return null;
  if (parsed.type === "user") return parsed.username;
  return parsed.username ?? null;
}
