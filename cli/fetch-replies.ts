import { mkdir, readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.API_KEY!;
const X_API_URL = process.env.X_API_URL!;
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
  text: string;
  createdAt: string;
  author?: {
    id: string;
    userName: string;
  };
  extendedEntities?: {
    media?: MediaItem[];
  };
  inReplyToId?: string;
  inReplyToUserName?: string;
}

interface ApiResponse {
  tweets: Tweet[];
  has_next_page: boolean;
  next_cursor: string;
}

interface ExtractedReply {
  id: string;
  date: string;
  text: string;
  media: Array<{ type: "image" | "video"; url: string }>;
  replyToId?: string;
  replyToUser?: string;
}

const userName = process.argv[2];
if (!userName) {
  console.error("Usage: node fetch-replies.ts <username>");
  process.exit(1);
}

async function fetchReplies(cursor: string = ""): Promise<ApiResponse> {
  const url = new URL(BASE_URL);
  url.searchParams.set("query", `from:${userName} filter:replies`);
  url.searchParams.set("queryType", "Latest");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-API-Key": API_KEY },
  });

  const json = (await response.json()) as any;

  if (!response.ok) {
    console.error("API Response:", JSON.stringify(json, null, 2));
    throw new Error(`API error: ${response.status} - ${json.msg}`);
  }

  return json;
}

function extractMedia(tweet: Tweet): ExtractedReply["media"] {
  const media: ExtractedReply["media"] = [];
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

async function loadExistingReplies(path: string): Promise<ExtractedReply[]> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function main() {
  await mkdir("data", { recursive: true });
  const outputPath = `./data/${userName}-replies.json`;
  const existingReplies = await loadExistingReplies(outputPath);
  const existingIds = new Set(existingReplies.map((p) => p.id).filter(Boolean));

  const newReplies: ExtractedReply[] = [];
  const newIds = new Set<string>();
  let cursor = "";

  console.log(`Fetching replies from @${userName} via advanced search...`);
  if (existingReplies.length > 0) {
    console.log(`Found ${existingReplies.length} existing replies.`);
  }

  while (true) {
    const response = await fetchReplies(cursor);
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
      newReplies.push({
        id: tweet.id,
        date: tweet.createdAt,
        text: tweet.text,
        media: extractMedia(tweet),
        replyToId: tweet.inReplyToId,
        replyToUser: tweet.inReplyToUserName,
      });
    }

    if (newReplies.length % 500 === 0 || newReplies.length < 100) {
      console.log(`Fetched ${newReplies.length} new replies...`);
    }

    if (!response.has_next_page) {
      console.log("Reached end of results");
      break;
    }
    cursor = response.next_cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  newReplies.sort(
    (a, b) => parseTwitterDate(a.date).getTime() - parseTwitterDate(b.date).getTime(),
  );

  const allReplies = [...existingReplies];
  for (const reply of newReplies) {
    if (!existingIds.has(reply.id)) {
      allReplies.push(reply);
    }
  }

  allReplies.sort(
    (a, b) => parseTwitterDate(a.date).getTime() - parseTwitterDate(b.date).getTime(),
  );

  await writeFile(outputPath, JSON.stringify(allReplies, null, 2), "utf8");

  if (newReplies.length > 0) {
    console.log(`Added ${newReplies.length} new replies. Total: ${allReplies.length} replies.`);
  } else {
    console.log(`No new replies. Total: ${allReplies.length} replies.`);
  }

  if (allReplies.length > 0) {
    console.log(`Date range: ${allReplies[0].date} → ${allReplies.slice(-1)[0].date}`);
  }
}

main().catch(console.error);
