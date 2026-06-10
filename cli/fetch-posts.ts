import { mkdir, readFile, writeFile } from "node:fs/promises";

const X_API_KEY = process.env.X_API_KEY;
const X_API_URL = process.env.X_API_URL;
if (!X_API_KEY) throw new Error("X_API_KEY environment variable is required");
if (!X_API_URL) throw new Error("X_API_URL environment variable is required");
const BASE_URL = X_API_URL + "/twitter/tweet/advanced_search";

interface MediaItem {
  type: string;
  media_url_https?: string;
  url?: string;
  video_info?: {
    variants?: Array<{ url: string; bitrate?: number }>;
  };
}

interface Tweet {
  id: string;
  url?: string;
  twitterUrl?: string;
  text: string;
  createdAt: string;
  source?: string;
  lang?: string;
  author?: {
    id: string;
    userName: string;
    twitterUrl?: string;
    name?: string;
    isVerified?: boolean;
    isBlueVerified?: boolean;
    verifiedType?: string;
    profilePicture?: string;
    canMediaTag?: boolean;
  };
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
  quoted_tweet?: Tweet | null;
  retweeted_tweet?: Tweet | null;
  card?: object;
  place?: object;
  communityInfo?: object;
  article?: object;
}

interface ApiResponse {
  tweets: Tweet[];
  has_next_page: boolean;
  next_cursor: string;
}

interface ExtractedPost {
  id: string;
  date: string;
  text: string;
  media: Array<{ type: "image" | "video"; url: string }>;
}

const userName = process.argv[2];
if (!userName) {
  console.error("Usage: node fetch-posts.ts <username>");
  process.exit(1);
}

async function fetchTweets(cursor: string = ""): Promise<ApiResponse> {
  const url = new URL(BASE_URL);
  url.searchParams.set("query", `from:${userName} -filter:replies`);
  url.searchParams.set("queryType", "Latest");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-API-Key": X_API_KEY },
  });

  const json = (await response.json()) as any;

  if (!response.ok) {
    console.error("API Response:", JSON.stringify(json, null, 2));
    throw new Error(
      `API error: ${response.status} - ${json.msg || json.message || "Unknown error"}`,
    );
  }

  return json;
}

function extractMedia(tweet: Tweet): ExtractedPost["media"] {
  const media: ExtractedPost["media"] = [];
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

function parseTwitterDate(dateStr: string): Date {
  return new Date(dateStr);
}

async function loadExistingPosts(path: string): Promise<ExtractedPost[]> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function main() {
  await mkdir("data", { recursive: true });
  const outputPath = `./data/${userName}-posts.json`;
  const existingPosts = await loadExistingPosts(outputPath);
  const existingIds = new Set(existingPosts.map((p) => p.id).filter(Boolean));

  const newPosts: ExtractedPost[] = [];
  const newIds = new Set<string>();
  let cursor = "";

  console.log(`Fetching posts from @${userName} via advanced search...`);
  if (existingPosts.length > 0) {
    console.log(`Found ${existingPosts.length} existing posts.`);
  }

  while (true) {
    const response = await fetchTweets(cursor);
    const tweets = response.tweets || [];

    if (!tweets.length) {
      console.log("No more tweets available");
      break;
    }

    for (const tweet of tweets) {
      if (existingIds.has(tweet.id) || newIds.has(tweet.id)) {
        continue;
      }

      newIds.add(tweet.id);
      newPosts.push({
        id: tweet.id,
        date: tweet.createdAt,
        text: tweet.text,
        media: extractMedia(tweet),
      });
    }

    if (newPosts.length % 500 === 0 || newPosts.length < 100) {
      console.log(`Fetched ${newPosts.length} new posts...`);
    }

    if (!response.has_next_page) {
      console.log("Reached end of results");
      break;
    }
    cursor = response.next_cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  newPosts.sort((a, b) => parseTwitterDate(a.date).getTime() - parseTwitterDate(b.date).getTime());

  const allPosts = [...existingPosts];
  for (const post of newPosts) {
    if (!existingIds.has(post.id)) {
      allPosts.push(post);
    }
  }

  allPosts.sort((a, b) => parseTwitterDate(a.date).getTime() - parseTwitterDate(b.date).getTime());

  await writeFile(outputPath, JSON.stringify(allPosts, null, 2), "utf8");

  if (newPosts.length > 0) {
    console.log(`Added ${newPosts.length} new posts. Total: ${allPosts.length} posts.`);
  } else {
    console.log(`No new posts. Total: ${allPosts.length} posts.`);
  }

  if (allPosts.length > 0) {
    console.log(`Date range: ${allPosts[0].date} → ${allPosts.slice(-1)[0].date}`);
  }
}

main().catch(console.error);
