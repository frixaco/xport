import { parseTweetId, parseTwitterInput } from "@/lib/url-parser";
import type { DetectedType, RequestConfig } from "./types";

export const examples = [
  { label: "@NASA", value: "@NASA" },
  {
    label: "NASA post",
    value: "https://x.com/NASA/status/2039490150237909144",
  },
  {
    label: "Burak thread",
    value: "https://x.com/burakeregar/status/2020852442230120752",
  },
  {
    label: "JavaRevisited article",
    value: "https://x.com/javarevisited/article/2020886352838225926",
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
