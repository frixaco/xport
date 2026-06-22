import type { MediaItem, TweetCardModel } from "./types";
import { isNonEmptyString, isObject } from "./payload";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:$|\?)/i;
const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|m4v)(?:$|\?)/i;
const META_USERNAME_PATTERN = /^@([A-Za-z0-9_]{1,15})(?:\s|$|·)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUrlCandidate(value: string): string {
  return value.replace(/[),.;!?]+$/, "");
}

function getUrlHost(urlString: string): string | null {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isImageUrl(urlString: string): boolean {
  const normalized = normalizeUrlCandidate(urlString);
  if (IMAGE_EXTENSION_PATTERN.test(normalized)) return true;

  const host = getUrlHost(normalized);
  if (!host) return false;
  return host === "pbs.twimg.com" && normalized.includes("/media/");
}

function isVideoUrl(urlString: string): boolean {
  const normalized = normalizeUrlCandidate(urlString);
  if (VIDEO_EXTENSION_PATTERN.test(normalized)) return true;

  const host = getUrlHost(normalized);
  if (!host) return false;
  return host === "video.twimg.com" || host === "ton.twimg.com";
}

function addUniqueMedia(target: MediaItem[], item: MediaItem): void {
  if (target.some((existing) => existing.url === item.url)) return;
  target.push(item);
}

function extractMediaFromText(text: string): MediaItem[] {
  const media: MediaItem[] = [];
  const matches = text.matchAll(URL_PATTERN);

  for (const match of matches) {
    const raw = match[0];
    if (!raw) continue;
    const url = normalizeUrlCandidate(raw);
    if (isImageUrl(url)) {
      addUniqueMedia(media, { type: "image", url });
    } else if (isVideoUrl(url)) {
      addUniqueMedia(media, { type: "video", url });
    }
  }

  return media;
}

function stripMediaUrls(text: string, media: MediaItem[]): string {
  if (media.length === 0) return text.trim();

  let stripped = text;
  for (const item of media) {
    const escaped = escapeRegExp(item.url);
    stripped = stripped.replace(new RegExp(`\\s*${escaped}\\s*`, "g"), " ");
  }

  return stripped
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTweetMedia(tweet: Record<string, unknown>): MediaItem[] {
  const media: MediaItem[] = [];
  const extendedEntities = isObject(tweet.extendedEntities) ? tweet.extendedEntities : null;
  const items =
    extendedEntities && Array.isArray(extendedEntities.media) ? extendedEntities.media : [];

  for (const item of items) {
    if (!isObject(item) || !isNonEmptyString(item.type)) continue;

    if (item.type === "photo" && isNonEmptyString(item.media_url_https)) {
      addUniqueMedia(media, {
        type: "image",
        url: normalizeUrlCandidate(item.media_url_https),
      });
      continue;
    }

    if (item.type !== "video" && item.type !== "animated_gif") continue;
    if (!isObject(item.video_info) || !Array.isArray(item.video_info.variants)) {
      continue;
    }

    const variants = item.video_info.variants.filter(
      (variant): variant is { url: string; bitrate?: number } => {
        return isObject(variant) && isNonEmptyString(variant.url);
      },
    );

    // oxlint-disable-next-line unicorn/no-array-sort -- toSorted is not in this package's TS lib target.
    const sortedVariants = [...variants].sort((a, b) => {
      const bitrateA = typeof a.bitrate === "number" ? a.bitrate : -1;
      const bitrateB = typeof b.bitrate === "number" ? b.bitrate : -1;
      return bitrateB - bitrateA;
    });

    const preferred =
      sortedVariants.find((variant) => isVideoUrl(variant.url)) ?? sortedVariants[0];
    if (!preferred) continue;

    addUniqueMedia(media, {
      type: "video",
      url: normalizeUrlCandidate(preferred.url),
    });
  }

  return media;
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

export function extractUsernameFromMeta(meta: string | null | undefined): string | null {
  if (!isNonEmptyString(meta)) return null;
  const match = meta.trim().match(META_USERNAME_PATTERN);
  const username = match?.[1] ?? null;
  if (!username || username.toLowerCase() === "unknown") return null;
  return username;
}

export function extractUsernameFromTweetCard(
  tweet: TweetCardModel | null | undefined,
): string | null {
  return extractUsernameFromMeta(tweet?.meta);
}

export function normalizeTweetCards(tweets: unknown[]): TweetCardModel[] {
  return tweets.reduce<TweetCardModel[]>((rows, tweet, index) => {
    if (!isObject(tweet)) return rows;

    const id = isNonEmptyString(tweet.id) ? tweet.id : `item-${index}`;
    const rawText = isNonEmptyString(tweet.text) ? tweet.text : "";
    const url = isNonEmptyString(tweet.url) ? tweet.url : undefined;
    const author = isObject(tweet.author) ? tweet.author : null;
    const authorName = author && isNonEmptyString(author.userName) ? author.userName : "unknown";
    const date = formatDate(tweet.createdAt);
    const meta = date ? `@${authorName} · ${date}` : `@${authorName}`;
    const media = extractTweetMedia(tweet);
    const mediaFromText = extractMediaFromText(rawText);
    mediaFromText.forEach((item) => addUniqueMedia(media, item));
    const text = stripMediaUrls(rawText, media);
    const fallbackText = media.length > 0 ? "[media]" : "[no text]";

    rows.push({
      id,
      text: text || fallbackText,
      meta,
      url,
      media,
    });
    return rows;
  }, []);
}
