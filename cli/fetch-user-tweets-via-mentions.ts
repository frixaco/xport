import { mkdir, writeFile } from "node:fs/promises";

const X_API_KEY = process.env.X_API_KEY;
const X_API_URL = process.env.X_API_URL;
if (!X_API_KEY) throw new Error("X_API_KEY environment variable is required");
if (!X_API_URL) throw new Error("X_API_URL environment variable is required");

interface Tweet {
  id: string;
  url?: string;
  twitterUrl?: string;
  text: string;
  createdAt: string;
  source?: string;
  lang?: string;
  author?: {
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
    media?: Array<{
      type: string;
      media_url_https?: string;
      url?: string;
      video_info?: {
        variants?: Array<{ url: string; bitrate?: number }>;
      };
    }>;
  };
  entities?: {
    hashtags?: Array<{ text: string }>;
    urls?: Array<{ url: string; expanded_url: string }>;
    user_mentions?: Array<{ screen_name: string }>;
  };
  isQuote?: boolean;
  quoted_tweet?: Tweet | null;
  retweeted_tweet?: Tweet | null;
  card?: object;
  place?: object;
  communityInfo?: object;
  article?: object;
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

async function fetchTweetsByIds(ids: string[]): Promise<Tweet[]> {
  if (!ids.length) return [];
  const url = new URL(X_API_URL + "/twitter/tweets");
  url.searchParams.set("tweet_ids", ids.join(","));

  const response = await fetch(url.toString(), {
    headers: { "X-API-Key": X_API_KEY },
  });
  const json = (await response.json()) as any;
  if (!response.ok) {
    console.error("API Response:", JSON.stringify(json, null, 2));
    throw new Error(
      `API error: ${response.status} - ${json.msg || json.message || "Unknown error"}`,
    );
  }
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

  const posts: ExtractedPost[] = userTweets.map((tweet) => {
    const post: ExtractedPost = {
      id: tweet.id,
      date: tweet.createdAt,
      text: tweet.text,
    };
    if (tweet.quoted_tweet) {
      post.quotedUser = tweet.quoted_tweet.author?.userName;
      post.quotedText = tweet.quoted_tweet.text;
    }
    return post;
  });

  posts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  await writeFile(outputPath, JSON.stringify(posts, null, 2), "utf8");
  console.log(`\nSaved ${posts.length} tweets to ${outputPath}`);

  if (posts.length > 0) {
    console.log(`Date range: ${posts[0].date} → ${posts.at(-1)!.date}`);
  }
}

main().catch(console.error);
