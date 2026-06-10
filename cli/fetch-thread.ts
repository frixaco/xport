import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";

const X_API_KEY = process.env.X_API_KEY;
const X_API_URL = process.env.X_API_URL;
if (!X_API_KEY) throw new Error("X_API_KEY environment variable is required");
if (!X_API_URL) throw new Error("X_API_URL environment variable is required");
const BASE_URL = X_API_URL + "/twitter/tweet/thread_context";

function getApiKey(): string {
  return X_API_KEY;
}

// ============ Types ============

interface Author {
  type: string;
  userName: string;
  twitterUrl?: string;
  id: string;
  name: string;
  profilePicture?: string;
  isVerified?: boolean;
  isBlueVerified?: boolean;
  verifiedType?: string;
  followers?: number;
  following?: number;
  canDm?: boolean;
  canMediaTag?: boolean;
  fastFollowersCount?: number;
  protected?: boolean;
  isAutomated?: boolean;
  automatedBy?: string | null;
  unavailable?: boolean;
  message?: string;
  unavailableReason?: string;
  pinnedTweetIds?: string[];
  withheldInCountries?: string[];
  affiliatesHighlightedLabel?: object;
  profile_bio?: {
    description?: string;
    entities?: {
      description?: { urls?: Array<Record<string, unknown>> };
      url?: { urls?: Array<Record<string, unknown>> };
    };
  };
  entities?: {
    description?: { urls?: Array<Record<string, unknown>> };
    url?: { urls?: Array<Record<string, unknown>> };
  };
}

interface MediaItem {
  type: string;
  media_url_https?: string;
  url?: string;
  video_info?: {
    variants?: Array<{ url: string; bitrate?: number }>;
  };
}

interface ThreadTweet {
  type: string;
  id: string;
  url: string;
  twitterUrl?: string;
  text: string;
  source?: string;
  createdAt: string;
  lang?: string;
  author: Author;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  isReply?: boolean;
  isLimitedReply?: boolean;
  inReplyToId?: string;
  inReplyToUserId?: string;
  inReplyToUsername?: string;
  conversationId?: string;
  displayTextRange?: number[];
  extendedEntities?: {
    media?: MediaItem[];
  };
  entities?: {
    hashtags?: Array<{ text: string }>;
    urls?: Array<{ url: string; expanded_url: string }>;
    user_mentions?: Array<{ screen_name: string }>;
  };
  quoted_tweet?: ThreadTweet | null;
  retweeted_tweet?: ThreadTweet | null;
  card?: object;
  place?: object;
  communityInfo?: object;
  article?: object;
}

interface ThreadContextResponse {
  status: string;
  tweets: ThreadTweet[];
  has_next_page: boolean;
  next_cursor?: string;
  msg?: string;
}

interface ProcessedTweet {
  id: string;
  url: string;
  twitterUrl?: string;
  date: string;
  author: {
    name: string;
    username: string;
    verified: boolean;
  };
  text: string;
  source?: string;
  lang?: string;
  media: Array<{ type: "image" | "video"; url: string }>;
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views: number;
    bookmarks: number;
  };
  isReply: boolean;
  quotedTweet?: ThreadTweet | null;
  retweetedTweet?: ThreadTweet | null;
}

interface LocalMedia {
  type: "image" | "video";
  originalUrl: string;
  localPath: string;
}

interface ProcessedTweetWithLocalMedia extends Omit<ProcessedTweet, "media"> {
  media: LocalMedia[];
}

// ============ API Functions ============

function extractTweetId(input: string): string {
  const urlPattern = /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/;
  const match = input.match(urlPattern);
  if (match?.[1]) return match[1];
  if (/^\d+$/.test(input)) return input;
  throw new Error(`Invalid input: "${input}". Provide a tweet URL or numeric ID.`);
}

async function fetchThreadPage(tweetId: string, cursor?: string): Promise<ThreadContextResponse> {
  const url = new URL(BASE_URL);
  url.searchParams.set("tweetId", tweetId);
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-API-Key": getApiKey() },
  });

  const json = (await response.json()) as any;

  if (!response.ok || json.status === "error") {
    console.error("API Response:", JSON.stringify(json, null, 2));
    throw new Error(`API error: ${response.status} - ${json.msg || "Unknown error"}`);
  }

  return json;
}

async function fetchFullThread(tweetId: string): Promise<ThreadTweet[]> {
  const allTweets = new Map<string, ThreadTweet>();
  const processedTweetIds = new Set<string>();
  const tweetsToProcess = [tweetId];

  while (tweetsToProcess.length > 0) {
    const currentTweetId = tweetsToProcess.shift()!;

    if (processedTweetIds.has(currentTweetId)) continue;
    processedTweetIds.add(currentTweetId);

    let cursor: string | undefined;

    while (true) {
      console.log(
        `Fetching context for ${currentTweetId}${cursor ? ` (cursor: ${cursor.slice(0, 15)}...)` : ""}...`,
      );

      const response = await fetchThreadPage(currentTweetId, cursor);

      if (response.tweets?.length) {
        for (const tweet of response.tweets) {
          if (!allTweets.has(tweet.id)) {
            allTweets.set(tweet.id, tweet);
          }
        }
      }

      if (!response.has_next_page || !response.next_cursor) break;

      cursor = response.next_cursor;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const currentTweet = allTweets.get(currentTweetId);
    if (currentTweet) {
      const authorId = currentTweet.author.id;

      for (const tweet of allTweets.values()) {
        if (
          tweet.author.id === authorId &&
          tweet.inReplyToId &&
          allTweets.has(tweet.inReplyToId) &&
          !processedTweetIds.has(tweet.id)
        ) {
          tweetsToProcess.push(tweet.id);
        }
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return Array.from(allTweets.values());
}

// ============ Processing Functions ============

function sortChronologically(tweets: ThreadTweet[]): ThreadTweet[] {
  return [...tweets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function filterAuthorThread(tweets: ThreadTweet[]): ThreadTweet[] {
  if (tweets.length === 0) return [];

  const sorted = sortChronologically(tweets);
  const firstTweet = sorted[0]!;
  const originalAuthor = firstTweet.author.id;
  const threadTweetIds = new Set<string>();

  threadTweetIds.add(firstTweet.id);
  const result: ThreadTweet[] = [firstTweet];

  for (let i = 1; i < sorted.length; i++) {
    const tweet = sorted[i]!;
    if (tweet.author.id !== originalAuthor) continue;
    if (tweet.inReplyToId && threadTweetIds.has(tweet.inReplyToId)) {
      threadTweetIds.add(tweet.id);
      result.push(tweet);
    }
  }

  return result;
}

function extractMedia(tweet: ThreadTweet): ProcessedTweet["media"] {
  const media: ProcessedTweet["media"] = [];
  const items = tweet.extendedEntities?.media || [];

  for (const item of items) {
    if (item.type === "photo" && item.media_url_https) {
      media.push({ type: "image", url: item.media_url_https });
    } else if (
      (item.type === "video" || item.type === "animated_gif") &&
      item.video_info?.variants
    ) {
      const best = item.video_info.variants
        .filter((v) => v.bitrate !== undefined)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (best) media.push({ type: "video", url: best.url });
    }
  }

  return media;
}

function processTweets(tweets: ThreadTweet[]): ProcessedTweet[] {
  return tweets.map((tweet) => ({
    id: tweet.id,
    url: tweet.url,
    twitterUrl: tweet.twitterUrl,
    date: tweet.createdAt,
    author: {
      name: tweet.author.name || tweet.author.userName,
      username: tweet.author.userName,
      verified: tweet.author.isBlueVerified || false,
    },
    text: tweet.text,
    source: tweet.source,
    lang: tweet.lang,
    media: extractMedia(tweet),
    engagement: {
      likes: tweet.likeCount || 0,
      retweets: tweet.retweetCount || 0,
      replies: tweet.replyCount || 0,
      quotes: tweet.quoteCount || 0,
      views: tweet.viewCount || 0,
      bookmarks: tweet.bookmarkCount || 0,
    },
    isReply: tweet.isReply || false,
    quotedTweet: tweet.quoted_tweet,
    retweetedTweet: tweet.retweeted_tweet,
  }));
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return num.toLocaleString();
}

// ============ Media Download ============

function getExtension(url: string, type: "image" | "video"): string {
  const cleanUrl = url.split("?")[0] ?? url;
  const ext = extname(cleanUrl);
  if (ext) return ext;
  return type === "image" ? ".jpg" : ".mp4";
}

async function downloadMedia(
  url: string,
  outputPath: string,
  type: "image" | "video",
): Promise<void> {
  console.log(`  Downloading ${type}: ${outputPath}`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    await writeFile(outputPath, Buffer.from(buffer));
  } catch (error) {
    if (type === "video") {
      console.log(`  Retrying with yt-dlp...`);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("yt-dlp", ["-q", "-o", outputPath, url], { stdio: "ignore" });
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`yt-dlp exited with ${code}`)),
        );
        proc.on("error", reject);
      });
    } else {
      throw error;
    }
  }
}

async function downloadAllMedia(
  tweets: ProcessedTweet[],
  mediaDir: string,
  username: string,
): Promise<ProcessedTweetWithLocalMedia[]> {
  await mkdir(mediaDir, { recursive: true });

  const results: ProcessedTweetWithLocalMedia[] = [];
  let mediaIndex = 1;

  for (const tweet of tweets) {
    const localMedia: LocalMedia[] = [];

    for (const media of tweet.media) {
      const ext = getExtension(media.url, media.type);
      const filename = `${username}-${String(mediaIndex).padStart(2, "0")}${ext}`;
      const localPath = join(mediaDir, filename);

      await downloadMedia(media.url, localPath, media.type);

      localMedia.push({
        type: media.type,
        originalUrl: media.url,
        localPath: `${mediaDir}/${filename}`,
      });

      mediaIndex++;
    }

    results.push({ ...tweet, media: localMedia });
  }

  return results;
}

// ============ Obsidian Markdown Generation ============

function generateSlug(text: string): string {
  const words = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .toLowerCase();
  return words || "thread";
}

function formatTweetSection(
  tweet: ProcessedTweetWithLocalMedia,
  index: number,
  total: number,
): string {
  let md = `## ${index + 1}/${total}\n\n`;
  md += `${tweet.text}\n\n`;

  for (const media of tweet.media) {
    md += `![](${media.localPath})\n\n`;
  }

  if (tweet.quotedTweet) {
    md += `> Quoted from @${tweet.quotedTweet.author.userName}:\n`;
    md += `> ${tweet.quotedTweet.text.split("\n").join("\n> ")}\n\n`;
  }

  if (tweet.retweetedTweet) {
    md += `> 🔁 Retweeted from @${tweet.retweetedTweet.author.userName}:\n`;
    md += `> ${tweet.retweetedTweet.text.split("\n").join("\n> ")}\n\n`;
  }

  const e = tweet.engagement;
  const stats = [
    e.likes > 0 ? `${formatNumber(e.likes)} ❤️` : null,
    e.retweets > 0 ? `${formatNumber(e.retweets)} 🔁` : null,
    e.replies > 0 ? `${formatNumber(e.replies)} 💬` : null,
    e.quotes > 0 ? `${formatNumber(e.quotes)} 💬` : null,
    e.views > 0 ? `${formatNumber(e.views)} 👁` : null,
    e.bookmarks > 0 ? `${formatNumber(e.bookmarks)} 🔖` : null,
  ].filter(Boolean);
  if (stats.length > 0) {
    md += `*${stats.join(" · ")}*\n\n`;
  }

  if (tweet.source || tweet.lang) {
    const meta = [tweet.source, tweet.lang].filter(Boolean);
    if (meta.length > 0) {
      md += `_${meta.join(" · ")}_\n\n`;
    }
  }

  return md;
}

function generateObsidianMarkdown(
  tweets: ProcessedTweetWithLocalMedia[],
  originalUrl: string,
  username: string,
): string {
  if (tweets.length === 0) return "";

  const firstTweet = tweets[0]!;
  const date = new Date(firstTweet.date);
  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const titleText = (firstTweet.text.split("\n")[0] ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, 80);

  let md = `# ${titleText}\n\n`;
  md += `> **Author:** [@${username}](https://x.com/${username})`;
  if (firstTweet.author.verified) md += ` ✓`;
  md += `\n`;
  md += `> **Date:** ${dateStr}  \n`;
  md += `> **Thread:** [View on X](${originalUrl})  \n`;
  md += `> **Tweets:** ${tweets.length}\n\n`;
  md += `---\n\n`;

  for (let i = 0; i < tweets.length; i++) {
    md += formatTweetSection(tweets[i]!, i, tweets.length);
    if (i < tweets.length - 1) md += `---\n\n`;
  }

  const totalLikes = tweets.reduce((sum, t) => sum + t.engagement.likes, 0);
  const totalRetweets = tweets.reduce((sum, t) => sum + t.engagement.retweets, 0);
  const totalReplies = tweets.reduce((sum, t) => sum + t.engagement.replies, 0);
  const totalQuotes = tweets.reduce((sum, t) => sum + t.engagement.quotes, 0);
  const totalViews = tweets.reduce((sum, t) => sum + t.engagement.views, 0);
  const totalBookmarks = tweets.reduce((sum, t) => sum + t.engagement.bookmarks, 0);

  const totals = [
    totalLikes > 0 ? `${formatNumber(totalLikes)} likes` : null,
    totalRetweets > 0 ? `${formatNumber(totalRetweets)} retweets` : null,
    totalReplies > 0 ? `${formatNumber(totalReplies)} replies` : null,
    totalQuotes > 0 ? `${formatNumber(totalQuotes)} quotes` : null,
    totalViews > 0 ? `${formatNumber(totalViews)} views` : null,
    totalBookmarks > 0 ? `${formatNumber(totalBookmarks)} bookmarks` : null,
  ].filter(Boolean);

  md += `\n---\n\n`;
  md += `*📊 Total: ${totals.join(" · ")}*\n`;

  return md;
}

// ============ Main ============

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node fetch-thread.ts <tweet-url-or-id>");
    console.error("Example: node fetch-thread.ts https://x.com/user/status/1234567890");
    process.exit(1);
  }

  const tweetId = extractTweetId(input);
  console.log(`\n📥 Fetching thread: ${tweetId}\n`);

  const originalUrl =
    input.includes("twitter.com") || input.includes("x.com")
      ? input
      : `https://x.com/i/status/${tweetId}`;

  const rawTweets = await fetchFullThread(tweetId);
  console.log(`Fetched ${rawTweets.length} tweets total`);

  if (rawTweets.length === 0) {
    console.log("No tweets found.");
    process.exit(0);
  }

  const authorThread = filterAuthorThread(rawTweets);
  console.log(`Filtered to ${authorThread.length} author tweets\n`);

  const processedTweets = processTweets(authorThread);
  const username = processedTweets[0]?.author.username || "unknown";

  const slug = generateSlug(processedTweets[0]?.text || "");
  const baseDir = join("data", `${username}-${slug}`);
  const mediaDir = join(baseDir, "media");

  await mkdir(mediaDir, { recursive: true });

  console.log(`📁 Downloading media to ${mediaDir}/`);
  const tweetsWithLocalMedia = await downloadAllMedia(processedTweets, mediaDir, username);

  for (const tweet of tweetsWithLocalMedia) {
    for (const media of tweet.media) {
      media.localPath = media.localPath.replace(`${baseDir}/`, "");
    }
  }

  const markdown = generateObsidianMarkdown(tweetsWithLocalMedia, originalUrl, username);

  const filename = join(baseDir, `${username}-thread.md`);
  await writeFile(filename, markdown, "utf8");

  console.log(`\n✅ Saved to ${baseDir}/`);
  console.log(`   📄 ${filename}`);
  console.log(
    `   🎬 ${mediaDir}/ (${tweetsWithLocalMedia.reduce((n, t) => n + t.media.length, 0)} files)`,
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
