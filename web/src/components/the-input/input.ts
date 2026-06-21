import { parseTweetId, parseTwitterInput } from "@/lib/url-parser";
import type { DetectedType, RequestConfig } from "./types";

export const examples = [
  { label: "@elonmusk", value: "@elonmusk" },
  {
    label: "x.com/.../status/123",
    value: "https://x.com/elonmusk/status/1234567890",
  },
  {
    label: "x.com/.../thread/123",
    value: "https://x.com/thorstenball/thread/2020131132965036386",
  },
  {
    label: "x.com/.../article/...",
    value: "https://x.com/elonmusk/status/1234567890/article",
  },
  {
    label: "x.com/.../bookmarks",
    value: "https://x.com/i/bookmarks",
  },
];

export function detectUrlType(value: string): DetectedType {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/\/(i\/)?bookmarks/i.test(trimmed)) return "Bookmarks";
  if (/\/article\/\d+/.test(trimmed)) return "Article";
  if (/\/thread\/\d+/.test(trimmed)) return "Thread";
  if (/\/status\/\d+/.test(trimmed)) {
    if (/\/article/i.test(trimmed)) return "Article";
    return "Tweet";
  }
  if (
    /^https?:\/\/(twitter\.com|x\.com)\/\w+\/?$/i.test(trimmed) ||
    /^(twitter\.com|x\.com)\/\w+\/?$/i.test(trimmed)
  ) {
    return "User";
  }
  if (/^@\w+$/.test(trimmed)) return "User";
  if (/^\d+$/.test(trimmed)) return "Tweet";

  return null;
}

export function buildRequestConfig(
  input: string,
  detectedType: DetectedType,
): RequestConfig | null {
  const trimmed = input.trim();
  if (!trimmed || detectedType === "Bookmarks") return null;

  if (detectedType === "Article") {
    const tweetId = parseTweetId(trimmed);
    return tweetId ? { type: "article" } : null;
  }

  if (detectedType === "Thread" || detectedType === "Tweet") {
    return { type: "thread" };
  }

  if (detectedType === "User") {
    return { type: "user-tweets" };
  }

  const parsed = parseTwitterInput(trimmed);
  if (!parsed) return null;

  if (parsed.type === "tweet") {
    return { type: "thread" };
  }

  return { type: "user-tweets" };
}
