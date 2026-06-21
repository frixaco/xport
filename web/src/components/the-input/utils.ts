import { parseTweetId, parseTwitterInput, parseUsername } from "@/lib/url-parser";
import type {
  ContentBlock,
  DetectedType,
  MediaItem,
  RequestConfig,
  RequestType,
  ResultState,
  TweetCardModel,
  UsageMetadata,
} from "./types";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:$|\?)/i;
const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|m4v)(?:$|\?)/i;
const META_USERNAME_PATTERN = /^@([A-Za-z0-9_]{1,15})(?:\s|$|·)/;

export const detectedBadgeColor = "bg-chart-2/20 text-chart-2";

export const examples = [
  { label: "@elonmusk", value: "@elonmusk" },
  {
    label: "x.com/…/status/123",
    value: "https://x.com/elonmusk/status/1234567890",
  },
  {
    label: "x.com/…/thread/123",
    value: "https://x.com/thorstenball/thread/2020131132965036386",
  },
  {
    label: "x.com/…/article/…",
    value: "https://x.com/elonmusk/status/1234567890/article",
  },
  {
    label: "x.com/…/bookmarks",
    value: "https://x.com/i/bookmarks",
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

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

export function extractMediaFromText(text: string): MediaItem[] {
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

export function stripMediaUrls(text: string, media: MediaItem[]): string {
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

    const sortedVariants = item.video_info.variants
      .filter((variant): variant is { url: string; bitrate?: number } => {
        return isObject(variant) && isNonEmptyString(variant.url);
      })
      .sort((a, b) => {
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

function formatIsoDate(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0] ?? null;
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

export function estimateCostCredits(result: ResultState): number {
  if (result.usage?.charged) {
    return Math.max(1, result.usage.chargedCredits);
  }

  if (typeof result.usage?.tweetCount === "number") {
    return Math.max(1, Math.ceil(result.usage.tweetCount / 20));
  }

  if (result.kind === "article") return 1;
  return 1;
}

export function formatCreditLabel(value: number): string {
  return `${value} credit${value === 1 ? "" : "s"}`;
}

// ============ Article Content Processing ============

const STYLE_MAP: Record<string, { marker: string; markerEnd: string }> = {
  Bold: { marker: "**", markerEnd: "**" },
  Italic: { marker: "_", markerEnd: "_" },
  BoldItalic: { marker: "**_", markerEnd: "_**" },
  Underline: { marker: "<u>", markerEnd: "</u>" },
  Strikethrough: { marker: "~~", markerEnd: "~~" },
  Code: { marker: "`", markerEnd: "`" },
  ItalicCode: { marker: "_`", markerEnd: "`_" },
  BoldCode: { marker: "**`", markerEnd: "`**" },
};

interface InlineStyleRange {
  offset: number;
  length: number;
  style: string;
}

function applyInlineStyles(text: string, ranges: InlineStyleRange[] | undefined): string {
  if (!ranges || ranges.length === 0) return text;

  const sorted = [...ranges].sort((a, b) => b.offset - a.offset);
  let result = text;

  for (const range of sorted) {
    const style = STYLE_MAP[range.style];
    if (!style) continue;

    const before = result.slice(0, range.offset);
    const marked = result.slice(range.offset, range.offset + range.length);
    const after = result.slice(range.offset + range.length);
    result = `${before}${style.marker}${marked}${style.markerEnd}${after}`;
  }

  return result;
}

function renderContentBlock(
  block: {
    type?: string;
    text?: string;
    url?: string;
    previewUrl?: string;
    width?: number;
    height?: number;
    inlineStyleRanges?: InlineStyleRange[];
  },
  orderedIndex: number,
): { text: string; media: MediaItem[] } {
  const styledText = applyInlineStyles(block.text || "", block.inlineStyleRanges);
  const media: MediaItem[] = [];

  switch (block.type) {
    case "header-one":
      return { text: `## ${styledText}`, media };

    case "header-two":
      return { text: `### ${styledText}`, media };

    case "header-three":
      return { text: `#### ${styledText}`, media };

    case "unordered-list-item":
      return { text: `- ${styledText}`, media };

    case "ordered-list-item":
      return { text: `${orderedIndex + 1}. ${styledText}`, media };

    case "image": {
      if (!block.url) return { text: "", media };
      const displayUrl = block.previewUrl || block.url;
      const dims = block.width && block.height ? `=${block.width}x${block.height}` : "";
      return { text: `![](${displayUrl}${dims})`, media };
    }

    case "gif": {
      if (!block.url) return { text: "", media };
      const displayUrl = block.previewUrl || block.url;
      return { text: `![](${displayUrl})`, media };
    }

    case "divider":
      return { text: "---", media };

    case "blockquote":
      return { text: `> ${styledText}`, media };

    case "unstyled":
    case "markdown":
    default: {
      const textMedia = extractMediaFromText(block.text || "");
      textMedia.forEach((item) => {
        if (!media.some((m) => m.url === item.url)) {
          media.push(item);
        }
      });
      return { text: styledText, media };
    }
  }
}

function normalizeArticleContentBlock(content: unknown, orderedIndex: number): ContentBlock {
  if (!isObject(content)) {
    return { type: "unstyled", text: "", styledText: "" };
  }

  const type = isNonEmptyString(content.type) ? content.type : "unstyled";
  const text = isNonEmptyString(content.text) ? content.text : "";
  const url = isNonEmptyString(content.url) ? content.url : undefined;
  const previewUrl = isNonEmptyString(content.previewUrl) ? content.previewUrl : undefined;
  const width = typeof content.width === "number" ? content.width : undefined;
  const height = typeof content.height === "number" ? content.height : undefined;

  const inlineStyleRanges: InlineStyleRange[] = [];
  if (Array.isArray(content.inlineStyleRanges)) {
    for (const range of content.inlineStyleRanges) {
      if (
        isObject(range) &&
        typeof range.offset === "number" &&
        typeof range.length === "number" &&
        isNonEmptyString(range.style)
      ) {
        inlineStyleRanges.push({
          offset: range.offset,
          length: range.length,
          style: range.style,
        });
      }
    }
  }

  const rendered = renderContentBlock(
    { type, text, url, previewUrl, width, height, inlineStyleRanges },
    orderedIndex,
  );

  return {
    type,
    text: rendered.text,
    url,
    previewUrl,
    width,
    height,
    styledText: rendered.text,
  };
}

function normalizeArticleContents(contents: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let orderedIndex = 0;

  for (const content of contents) {
    const block = normalizeArticleContentBlock(content, orderedIndex);

    if (block.type === "ordered-list-item") {
      blocks.push(block);
      orderedIndex++;
    } else {
      blocks.push(block);
      if (block.type !== "unordered-list-item") {
        orderedIndex = 0;
      }
    }
  }

  return blocks;
}
