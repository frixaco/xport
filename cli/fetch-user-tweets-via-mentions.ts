import { mkdir, writeFile } from "node:fs/promises";

const API_KEY = process.env.API_KEY!;
const X_API_URL = process.env.X_API_URL!;

interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author?: { userName: string };
  inReplyToId?: string;
  inReplyToUsername?: string;
  isQuote?: boolean;
  quoted_tweet?: Tweet | null;
}

interface ExtractedPost {
  id: string;
  date: string;
  text: string;
  quotedUser?: string;
  quotedText?: string;
}

const userName = process.argv[2];
if (!userName) {
  console.error("Usage: node fetch-user-tweets-via-mentions.ts <username>");
  process.exit(1);
}

async function searchMentions(
  cursor: string = "",
): Promise<{ tweets: Tweet[]; has_next_page: boolean; next_cursor: string }> {
  const url = new URL(X_API_URL + "/twitter/tweet/advanced_search");
  url.searchParams.set("query", `@${userName}`);
  url.searchParams.set("queryType", "Latest");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url.toString(), {
    headers: { "X-API-Key": API_KEY },
  });
  return response.json() as any;
}

async function fetchTweetsByIds(ids: string[]): Promise<Tweet[]> {
  if (!ids.length) return [];
  const url = new URL(X_API_URL + "/twitter/tweets");
  url.searchParams.set("tweet_ids", ids.join(","));

  const response = await fetch(url.toString(), {
    headers: { "X-API-Key": API_KEY },
  });
  const json = (await response.json()) as any;
  return json.tweets || [];
}

async function main() {
  await mkdir("data", { recursive: true });
  const outputPath = `./data/${userName}-tweets-via-mentions.json`;

  const tweetIds = new Set<string>();
  let cursor = "";

  console.log(`Searching for mentions of @${userName} to find their tweet IDs...`);

  while (true) {
    const response = await searchMentions(cursor);
    const tweets = response.tweets || [];

    if (!tweets.length) break;

    for (const tweet of tweets) {
      if (tweet.inReplyToUsername?.toLowerCase() === userName.toLowerCase() && tweet.inReplyToId) {
        tweetIds.add(tweet.inReplyToId);
      }
      if (tweet.author?.userName?.toLowerCase() === userName.toLowerCase()) {
        tweetIds.add(tweet.id);
      }
    }

    console.log(`Found ${tweetIds.size} unique tweet IDs so far...`);

    if (!response.has_next_page) break;
    cursor = response.next_cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nFetching ${tweetIds.size} tweets by ID...`);

  const idArray = Array.from(tweetIds);
  const allTweets: Tweet[] = [];

  for (let i = 0; i < idArray.length; i += 100) {
    const batch = idArray.slice(i, i + 100);
    const tweets = await fetchTweetsByIds(batch);
    allTweets.push(...tweets);
    if (i + 100 < idArray.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const userTweets = allTweets.filter(
    (t) => t.author?.userName?.toLowerCase() === userName.toLowerCase(),
  );

  const posts: ExtractedPost[] = userTweets.map((t) => ({
    id: t.id,
    date: t.createdAt,
    text: t.text,
    ...(t.quoted_tweet && {
      quotedUser: t.quoted_tweet.author?.userName,
      quotedText: t.quoted_tweet.text,
    }),
  }));

  posts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  await writeFile(outputPath, JSON.stringify(posts, null, 2), "utf8");
  console.log(`\nSaved ${posts.length} tweets to ${outputPath}`);

  if (posts.length > 0) {
    console.log(`Date range: ${posts[0].date} → ${posts.at(-1)!.date}`);
  }
}

main().catch(console.error);
