import { XApiError, type XPost } from "@/lib/x-api";

const X_API_BASE_URL = "https://api.x.com/2";
export const X_SCOPES = ["tweet.read", "users.read", "bookmark.read", "offline.access"];

interface V2User {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  verified?: boolean;
}

interface V2Media {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: Array<{ url: string; bit_rate?: number; content_type?: string }>;
}

interface V2Post {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  note_tweet?: { text?: string };
  attachments?: { media_keys?: string[] };
  referenced_tweets?: Array<{ type: "retweeted" | "quoted" | "replied_to"; id: string }>;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
  entities?: {
    hashtags?: Array<{ tag: string }>;
    urls?: Array<{ url?: string; display_url?: string; expanded_url?: string }>;
    mentions?: Array<{ id?: string; username?: string }>;
  };
}

interface V2BookmarksResponse {
  data?: V2Post[];
  includes?: { users?: V2User[]; media?: V2Media[]; tweets?: V2Post[] };
  meta?: { next_token?: string; result_count?: number };
}

export const MAX_BOOKMARKS_PER_PAGE = 100;
/** X returns only the most recent 800 bookmarks. */
export const MAX_BOOKMARKS = 800;
const BOOKMARK_QUERY = {
  "tweet.fields":
    "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,entities,attachments,lang,note_tweet",
  expansions:
    "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id,in_reply_to_user_id",
  "user.fields": "id,name,username,profile_image_url,verified",
  "media.fields": "type,url,preview_image_url,variants",
};

async function xGet<T>(accessToken: string, path: string, query: Record<string, string>) {
  const url = new URL(`${X_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { title?: string; detail?: string })
    | null;
  if (response.status === 401 || response.status === 403) {
    throw new XApiError("X rejected the access token.", 409, payload, "X_AUTH_REQUIRED");
  }
  if (!response.ok || !payload) {
    throw new XApiError(
      payload?.detail ?? payload?.title ?? "X API request failed.",
      response.status,
      payload,
    );
  }
  return payload;
}

export async function fetchXMe(accessToken: string): Promise<V2User> {
  const { data } = await xGet<{ data: V2User }>(accessToken, "/users/me", {});
  return data;
}

export async function fetchBookmarksPage(
  accessToken: string,
  xUserId: string,
  maxResults: number,
  cursor?: string,
): Promise<{ tweets: XPost[]; nextCursor?: string }> {
  // X bills every returned bookmark, so request only what the job can store and charge.
  const query: Record<string, string> = { ...BOOKMARK_QUERY, max_results: String(maxResults) };
  if (cursor) query.pagination_token = cursor;
  const response = await xGet<V2BookmarksResponse>(
    accessToken,
    `/users/${encodeURIComponent(xUserId)}/bookmarks`,
    query,
  );
  const users = new Map(response.includes?.users?.map((user) => [user.id, user]));
  const media = new Map(response.includes?.media?.map((item) => [item.media_key, item]));
  const posts = new Map(response.includes?.tweets?.map((post) => [post.id, post]));

  function toXPost(post: V2Post, depth = 0): XPost {
    const author = users.get(post.author_id ?? "");
    const userName = author?.username ?? "i";
    const replyTo = post.referenced_tweets?.find((ref) => ref.type === "replied_to");
    const nested = (type: "quoted" | "retweeted") => {
      const id = post.referenced_tweets?.find((ref) => ref.type === type)?.id;
      const target = id ? posts.get(id) : undefined;
      return target && depth === 0 ? toXPost(target, depth + 1) : undefined;
    };
    return {
      type: "tweet",
      id: post.id,
      url: `https://x.com/${userName}/status/${post.id}`,
      // Long posts keep their full text in note_tweet; `text` is truncated.
      text: post.note_tweet?.text ?? post.text,
      createdAt: post.created_at ?? "",
      lang: post.lang,
      conversationId: post.conversation_id,
      retweetCount: post.public_metrics?.retweet_count,
      replyCount: post.public_metrics?.reply_count,
      likeCount: post.public_metrics?.like_count,
      quoteCount: post.public_metrics?.quote_count,
      bookmarkCount: post.public_metrics?.bookmark_count,
      viewCount: post.public_metrics?.impression_count,
      isReply: Boolean(replyTo),
      inReplyToId: replyTo?.id,
      inReplyToUserId: post.in_reply_to_user_id,
      inReplyToUsername: users.get(post.in_reply_to_user_id ?? "")?.username,
      author: {
        type: "user",
        id: post.author_id ?? "",
        userName,
        name: author?.name ?? userName,
        profilePicture: author?.profile_image_url,
        isBlueVerified: author?.verified,
      },
      extendedEntities: {
        media: (post.attachments?.media_keys ?? []).flatMap((key) => {
          const item = media.get(key);
          if (!item) return [];
          return [
            {
              type: item.type,
              media_url_https: item.url ?? item.preview_image_url,
              video_info: item.variants
                ? {
                    variants: item.variants.map((variant) => ({
                      url: variant.url,
                      bitrate: variant.bit_rate,
                    })),
                  }
                : undefined,
            },
          ];
        }),
      },
      entities: {
        hashtags: post.entities?.hashtags?.map((tag) => ({ text: tag.tag })),
        urls: post.entities?.urls,
        user_mentions: post.entities?.mentions?.map((mention) => ({
          id_str: mention.id,
          screen_name: mention.username,
        })),
      },
      quoted_tweet: nested("quoted"),
      retweeted_tweet: nested("retweeted"),
    };
  }

  return {
    tweets: (response.data ?? []).map((post) => toXPost(post)),
    nextCursor: response.meta?.next_token,
  };
}
