import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { getAccessToken, getUserId } from "./x-auth";

const SCOPES = ["bookmark.read", "tweet.read", "users.read", "offline.access"];
const TOKEN_PATH = "data/bookmarks-auth.json";
const BOOKMARKS_DIR = "data/bookmarks";
const BOOKMARKS_MARKDOWN_PATH = "data/bookmarks.md";
const MEDIA_DIR = join(BOOKMARKS_DIR, "media");

interface Bookmark {
  edit_history_tweet_ids?: string[];
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  attachments?: {
    media_keys?: string[];
  };
  referenced_tweets?: Array<{
    type: string;
    id: string;
  }>;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
  note_tweet?: {
    text?: string;
  };
}

interface ApiUser {
  id: string;
  username?: string;
  name?: string;
}

interface ApiMediaVariant {
  bit_rate?: number;
  content_type?: string;
  url: string;
}

interface ApiMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  public_metrics?: {
    view_count?: number;
  };
  variants?: ApiMediaVariant[];
}

interface BookmarkRecord {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author?: {
    id: string;
    username?: string;
    name?: string;
  };
  public_metrics?: Bookmark["public_metrics"];
  media: BookmarkMedia[];
  referenced_tweets: Array<{
    type: string;
    id: string;
  }>;
  quoted_tweet?: QuotedTweetRecord;
}

interface BookmarkMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  view_count?: number;
  local_path?: string;
}

interface QuotedTweetRecord {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author?: {
    id: string;
    username?: string;
    name?: string;
  };
  public_metrics?: Bookmark["public_metrics"];
  media: BookmarkMedia[];
}

interface BookmarkResponse {
  data?: Bookmark[];
  includes?: {
    users?: ApiUser[];
    media?: ApiMedia[];
    tweets?: Bookmark[];
  };
  meta?: {
    result_count: number;
    next_token?: string;
  };
}

function getTweetText(tweet: Bookmark): string {
  return tweet.note_tweet?.text || tweet.text;
}

function buildUserMap(users: ApiUser[] = []): Map<string, ApiUser> {
  return new Map(users.map((user) => [user.id, user]));
}

function buildMediaMap(media: ApiMedia[] = []): Map<string, ApiMedia> {
  return new Map(media.map((item) => [item.media_key, item]));
}

function buildTweetMap(tweets: Bookmark[] = []): Map<string, Bookmark> {
  return new Map(tweets.map((tweet) => [tweet.id, tweet]));
}

function selectMediaUrl(media: ApiMedia): string | undefined {
  if (media.url) {
    return media.url;
  }

  if (media.variants?.length) {
    return [...media.variants]
      .filter((variant) => variant.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0]?.url;
  }

  return media.preview_image_url;
}

function getExtension(url: string, type: string): string {
  const cleanUrl = url.split("?")[0] ?? url;
  const ext = extname(cleanUrl);
  if (ext) {
    return ext;
  }

  return type === "photo" ? ".jpg" : ".mp4";
}

async function downloadMediaFile(url: string, outputPath: string, type: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    writeFileSync(outputPath, Buffer.from(buffer));
  } catch (error) {
    if (type === "video" || type === "animated_gif") {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("yt-dlp", ["-q", "-o", outputPath, url], { stdio: "ignore" });
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`yt-dlp exited with ${code}`)),
        );
        proc.on("error", reject);
      });
      return;
    }

    throw error;
  }
}

function extractMedia(tweet: Bookmark, mediaByKey: Map<string, ApiMedia>): BookmarkMedia[] {
  const mediaKeys = tweet.attachments?.media_keys ?? [];
  const media: BookmarkMedia[] = [];

  for (const mediaKey of mediaKeys) {
    const item = mediaByKey.get(mediaKey);
    if (!item) {
      continue;
    }

    media.push({
      media_key: item.media_key,
      type: item.type,
      url: selectMediaUrl(item),
      preview_image_url: item.preview_image_url,
      alt_text: item.alt_text,
      width: item.width,
      height: item.height,
      duration_ms: item.duration_ms,
      view_count: item.public_metrics?.view_count,
    });
  }

  return media;
}

function formatAuthor(authorId: string, usersById: Map<string, ApiUser>): BookmarkRecord["author"] {
  const user = usersById.get(authorId);
  if (!user) {
    return { id: authorId };
  }

  return {
    id: authorId,
    username: user.username,
    name: user.name,
  };
}

function formatQuotedTweet(
  tweet: Bookmark,
  usersById: Map<string, ApiUser>,
  mediaByKey: Map<string, ApiMedia>,
): QuotedTweetRecord {
  return {
    id: tweet.id,
    text: getTweetText(tweet),
    created_at: tweet.created_at,
    author_id: tweet.author_id,
    author: formatAuthor(tweet.author_id, usersById),
    public_metrics: tweet.public_metrics,
    media: extractMedia(tweet, mediaByKey),
  };
}

function formatMissingQuotedTweet(id: string): QuotedTweetRecord {
  return {
    id,
    text: "",
    created_at: "",
    author_id: "",
    media: [],
  };
}

function enrichBookmarks(response: BookmarkResponse): BookmarkRecord[] {
  const usersById = buildUserMap(response.includes?.users);
  const mediaByKey = buildMediaMap(response.includes?.media);
  const tweetsById = buildTweetMap(response.includes?.tweets);

  return (response.data ?? []).map((tweet) => {
    const quotedReference = tweet.referenced_tweets?.find(
      (reference) => reference.type === "quoted",
    );
    const quotedTweet = quotedReference ? tweetsById.get(quotedReference.id) : undefined;

    return {
      id: tweet.id,
      text: getTweetText(tweet),
      created_at: tweet.created_at,
      author_id: tweet.author_id,
      author: formatAuthor(tweet.author_id, usersById),
      public_metrics: tweet.public_metrics,
      media: extractMedia(tweet, mediaByKey),
      referenced_tweets: tweet.referenced_tweets ?? [],
      quoted_tweet: quotedReference
        ? quotedTweet
          ? formatQuotedTweet(quotedTweet, usersById, mediaByKey)
          : formatMissingQuotedTweet(quotedReference.id)
        : undefined,
    };
  });
}

async function downloadBookmarkMedia(
  bookmarks: BookmarkRecord[],
): Promise<{ downloaded: number; failed: number }> {
  mkdirSync(MEDIA_DIR, { recursive: true });

  let mediaIndex = 1;
  let failed = 0;
  const downloadedByKey = new Map<string, string>();

  const attachLocalPath = async (media: BookmarkMedia, prefix: string): Promise<void> => {
    const sourceUrl = media.url || media.preview_image_url;
    if (!sourceUrl) {
      return;
    }

    const cachedPath = downloadedByKey.get(media.media_key);
    if (cachedPath) {
      media.local_path = cachedPath;
      return;
    }

    const ext = getExtension(sourceUrl, media.type);
    const filename = `${prefix}-${String(mediaIndex).padStart(3, "0")}${ext}`;
    const absolutePath = join(MEDIA_DIR, filename);
    const relativePath = `media/${filename}`;

    try {
      console.log(`Downloading ${media.type}: ${relativePath}`);
      await downloadMediaFile(sourceUrl, absolutePath, media.type);
      media.local_path = relativePath;
      downloadedByKey.set(media.media_key, relativePath);
      mediaIndex++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to download ${sourceUrl}: ${message}`);
    }
  };

  for (const bookmark of bookmarks) {
    for (const media of bookmark.media) {
      await attachLocalPath(media, `bookmark-${bookmark.id}`);
    }

    for (const media of bookmark.quoted_tweet?.media ?? []) {
      await attachLocalPath(media, `quote-${bookmark.quoted_tweet?.id ?? bookmark.id}`);
    }
  }

  return {
    downloaded: downloadedByKey.size,
    failed,
  };
}

function getBookmarkUrl(bookmark: BookmarkRecord): string {
  const username = bookmark.author?.username;
  if (username) {
    return `https://x.com/${username}/status/${bookmark.id}`;
  }

  return `https://x.com/i/status/${bookmark.id}`;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return num.toLocaleString();
}

function renderMediaMarkdown(media: BookmarkMedia[]): string {
  let markdown = "";

  for (const item of media) {
    const path = item.local_path ? `bookmarks/${item.local_path}` : item.url;
    if (!path) {
      continue;
    }

    if (item.type === "photo") {
      markdown += `![](${path})\n\n`;
      continue;
    }

    markdown += `[${item.type === "animated_gif" ? "GIF" : "Video"}](${path})\n\n`;
  }

  return markdown;
}

function renderQuotedTweetMarkdown(quotedTweet: QuotedTweetRecord): string {
  const author = quotedTweet.author?.username
    ? `@${quotedTweet.author.username}`
    : quotedTweet.author_id || "unknown";

  let markdown = `> Quoted from ${author}\n`;

  if (quotedTweet.text) {
    const quotedLines = escapeMarkdownText(quotedTweet.text)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    markdown += `${quotedLines}\n`;
  } else {
    markdown += `> [Quoted tweet unavailable]\n`;
  }

  markdown += `>\n\n`;

  const mediaMarkdown = renderMediaMarkdown(quotedTweet.media);
  if (mediaMarkdown) {
    markdown += mediaMarkdown;
  }

  return markdown;
}

function generateBookmarksMarkdown(bookmarks: BookmarkRecord[]): string {
  let markdown = `# Bookmarks\n\n`;
  markdown += `> Exported ${bookmarks.length} bookmarks\n\n`;
  markdown += `---\n\n`;

  for (let index = 0; index < bookmarks.length; index++) {
    const bookmark = bookmarks[index]!;
    const author = bookmark.author?.username ? `@${bookmark.author.username}` : bookmark.author_id;

    markdown += `## ${index + 1}. ${author}\n\n`;
    markdown += `> ${bookmark.created_at}  \n`;
    markdown += `> [View on X](${getBookmarkUrl(bookmark)})\n\n`;
    markdown += `${escapeMarkdownText(bookmark.text)}\n\n`;

    const mediaMarkdown = renderMediaMarkdown(bookmark.media);
    if (mediaMarkdown) {
      markdown += mediaMarkdown;
    }

    if (bookmark.quoted_tweet) {
      markdown += `${renderQuotedTweetMarkdown(bookmark.quoted_tweet)}`;
    }

    if (bookmark.public_metrics) {
      const m = bookmark.public_metrics;
      const stats = [
        m.like_count ? `❤️ ${formatNumber(m.like_count)}` : null,
        m.retweet_count ? `🔁 ${formatNumber(m.retweet_count)}` : null,
        m.reply_count ? `💬 ${formatNumber(m.reply_count)}` : null,
        m.quote_count ? `💬 ${formatNumber(m.quote_count)}` : null,
        m.impression_count ? `👁 ${formatNumber(m.impression_count)}` : null,
        m.bookmark_count ? `🔖 ${formatNumber(m.bookmark_count)}` : null,
      ].filter(Boolean);
      if (stats.length > 0) {
        markdown += `*${stats.join(" · ")}*\n\n`;
      }
    }

    if (index < bookmarks.length - 1) {
      markdown += `---\n\n`;
    }
  }

  return markdown;
}

async function fetchBookmarks(accessToken: string): Promise<BookmarkRecord[]> {
  const userId = await getUserId(accessToken);
  const allBookmarks: BookmarkRecord[] = [];
  let paginationToken: string | undefined;

  do {
    const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
    url.searchParams.set(
      "tweet.fields",
      [
        "attachments",
        "author_id",
        "created_at",
        "note_tweet",
        "public_metrics",
        "referenced_tweets",
      ].join(","),
    );
    url.searchParams.set("user.fields", ["id", "name", "username"].join(","));
    url.searchParams.set(
      "media.fields",
      [
        "alt_text",
        "duration_ms",
        "height",
        "media_key",
        "preview_image_url",
        "public_metrics",
        "type",
        "url",
        "variants",
        "width",
      ].join(","),
    );
    url.searchParams.set(
      "expansions",
      [
        "attachments.media_keys",
        "author_id",
        "referenced_tweets.id",
        "referenced_tweets.id.attachments.media_keys",
        "referenced_tweets.id.author_id",
      ].join(","),
    );
    url.searchParams.set("max_results", "100");
    if (paginationToken) {
      url.searchParams.set("pagination_token", paginationToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Bookmarks fetch failed: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText) as BookmarkResponse;
    const enriched = enrichBookmarks(data);

    if (enriched.length > 0) {
      allBookmarks.push(...enriched);
      console.log(`Fetched ${allBookmarks.length} bookmarks so far...`);
    }

    paginationToken = data.meta?.next_token;
    if (paginationToken) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } while (paginationToken);

  return allBookmarks;
}

async function main() {
  try {
    console.log("Getting access token...");
    const accessToken = await getAccessToken(SCOPES, TOKEN_PATH);

    console.log("Fetching bookmarks...");
    const bookmarks = await fetchBookmarks(accessToken);

    console.log(`Downloading media to ${MEDIA_DIR}/...`);
    const mediaResult = await downloadBookmarkMedia(bookmarks);

    if (!existsSync(BOOKMARKS_DIR)) {
      mkdirSync(BOOKMARKS_DIR, { recursive: true });
    }

    writeFileSync("data/bookmarks.json", JSON.stringify(bookmarks, null, 2));
    writeFileSync(BOOKMARKS_MARKDOWN_PATH, generateBookmarksMarkdown(bookmarks));
    console.log(`Saved ${bookmarks.length} bookmarks to data/bookmarks.json`);
    console.log(`Saved markdown to ${BOOKMARKS_MARKDOWN_PATH}`);
    console.log(
      `Saved ${mediaResult.downloaded} media files to ${MEDIA_DIR}/` +
        (mediaResult.failed ? ` (${mediaResult.failed} failed)` : ""),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error:", message);
    process.exit(1);
  }
}

main();
