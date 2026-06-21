import { parseTweetId, parseUsername } from "@/lib/url-parser";
import type { RequestType, ResultState, UsageMetadata } from "./types";
import { normalizeArticleContents } from "./article-content";
import { isNonEmptyString, isObject } from "./payload";
import { extractUsernameFromTweetCard, normalizeTweetCards } from "./tweet-card";

function normalizeUrlCandidate(value: string): string {
  return value.replace(/[),.;!?]+$/, "");
}

function formatDate(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatIsoDate(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0] ?? null;
}

function resolveArticleSourceUrl(sourceInput?: string): string | null {
  if (!isNonEmptyString(sourceInput)) return null;
  const trimmed = sourceInput.trim();
  if (!trimmed) return null;

  if (
    /^https?:\/\/(twitter\.com|x\.com)\//i.test(trimmed) ||
    /^(twitter\.com|x\.com)\//i.test(trimmed)
  ) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  const tweetId = parseTweetId(trimmed);
  return tweetId ? `https://x.com/i/status/${tweetId}` : null;
}

function extractUsageMetadata(payload: unknown): UsageMetadata | null {
  if (!isObject(payload) || !isObject(payload.xport)) return null;

  const charged = payload.xport.charged;
  const chargedCredits = payload.xport.chargedCredits;
  const tweetCount = payload.xport.tweetCount;
  if (typeof charged !== "boolean" || typeof chargedCredits !== "number") {
    return null;
  }

  return {
    charged,
    chargedCredits,
    tweetCount: typeof tweetCount === "number" ? tweetCount : undefined,
  };
}

export function normalizeResult(
  payload: unknown,
  type: RequestType,
  sourceInput?: string,
): ResultState {
  const usage = extractUsageMetadata(payload);
  const sourceUsername = sourceInput ? parseUsername(sourceInput) : null;
  if (!isObject(payload)) {
    if (type === "article") {
      return {
        kind: "article",
        title: "Article",
        authorUsername: null,
        publishedDate: null,
        sourceUrl: resolveArticleSourceUrl(sourceInput),
        byline: null,
        preview: null,
        coverImageUrl: null,
        sections: [],
        label: "Article",
        usage,
      };
    }

    if (type === "thread") {
      return {
        kind: "thread",
        mainTweet: null,
        tweets: [],
        username: sourceUsername,
        label: "Thread posts",
        usage,
      };
    }

    return {
      kind: "user-tweets",
      tweets: [],
      username: sourceUsername,
      label: "User posts",
      usage,
    };
  }

  if (type === "thread") {
    const tweets = Array.isArray(payload.tweets) ? payload.tweets : [];
    const cards = normalizeTweetCards(tweets);
    return {
      kind: "thread",
      mainTweet: cards[0] ?? null,
      tweets: cards.slice(1),
      username: extractUsernameFromTweetCard(cards[0]) ?? sourceUsername,
      label: "Thread posts",
      usage,
    };
  }

  if (type === "user-tweets") {
    const data = isObject(payload.data) ? payload.data : null;
    const tweets = data && Array.isArray(data.tweets) ? data.tweets : [];
    const normalizedTweets = normalizeTweetCards(tweets);
    return {
      kind: "user-tweets",
      tweets: normalizedTweets,
      username: extractUsernameFromTweetCard(normalizedTweets[0]) ?? sourceUsername,
      label: "User posts",
      usage,
    };
  }

  const article = isObject(payload.article) ? payload.article : null;
  const title = article && isNonEmptyString(article.title) ? article.title : "Article";
  const authorUsername =
    article && isObject(article.author) && isNonEmptyString(article.author.userName)
      ? article.author.userName
      : null;
  const date = article ? formatDate(article.createdAt) : null;
  const publishedDate = article ? formatIsoDate(article.createdAt) : null;
  const author = authorUsername ? `@${authorUsername}` : null;
  const byline = author && date ? `${author} · ${date}` : (author ?? date ?? null);
  const preview = article && isNonEmptyString(article.preview_text) ? article.preview_text : null;
  const coverImageUrl =
    article && isNonEmptyString(article.cover_media_img_url)
      ? normalizeUrlCandidate(article.cover_media_img_url)
      : null;
  const contents = article && Array.isArray(article.contents) ? article.contents : [];
  const sections = normalizeArticleContents(contents);

  return {
    kind: "article",
    title,
    authorUsername,
    publishedDate,
    sourceUrl: resolveArticleSourceUrl(sourceInput),
    byline,
    preview,
    coverImageUrl,
    sections,
    label: "Article",
    usage,
  };
}

export function hasRenderableContent(result: ResultState | null): boolean {
  if (!result) return false;
  if (result.kind === "article") {
    return Boolean(
      result.title.trim().length > 0 ||
      result.preview ||
      result.coverImageUrl ||
      result.sections.length > 0,
    );
  }
  if (result.kind === "thread") {
    return Boolean(result.mainTweet || result.tweets.length > 0);
  }
  return result.tweets.length > 0;
}

export function extractErrorMessage(payload: unknown): string | null {
  if (!isObject(payload)) return null;
  if (isNonEmptyString(payload.error)) return payload.error;
  if (isNonEmptyString(payload.message)) return payload.message;
  return null;
}
