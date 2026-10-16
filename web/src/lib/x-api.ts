const X_API_BASE_URL = process.env.X_API_URL!;

type QueryValue = string | number | boolean | null | undefined;

interface ErrorLikePayload {
  status?: string;
  msg?: string;
  message?: string;
  error?: string;
  detail?: string;
}

interface XAuthor {
  type?: "user";
  userName: string;
  name: string;
  id: string;
  profilePicture?: string;
  isBlueVerified?: boolean;
  followers?: number;
  following?: number;
  description?: string;
}

interface XMediaVariant {
  url: string;
  bitrate?: number;
}

interface XMediaItem {
  type: string;
  media_url_https?: string;
  url?: string;
  video_info?: {
    variants?: XMediaVariant[];
  };
}

export interface XPost {
  type?: "tweet";
  id: string;
  url: string;
  text: string;
  source?: string;
  retweetCount?: number;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  createdAt: string;
  lang?: string;
  bookmarkCount?: number;
  isReply?: boolean;
  inReplyToId?: string;
  inReplyToUserId?: string;
  inReplyToUsername?: string;
  conversationId?: string;
  author: XAuthor;
  extendedEntities?: {
    media?: XMediaItem[];
  };
  entities?: {
    hashtags?: Array<{ text: string }>;
    urls?: Array<{ display_url?: string; expanded_url?: string; url?: string }>;
    user_mentions?: Array<{
      id_str?: string;
      name?: string;
      screen_name?: string;
    }>;
  };
  quoted_tweet?: XPost;
  retweeted_tweet?: XPost;
}

export interface XThreadResponse {
  status: string;
  tweets: XPost[];
  has_next_page: boolean;
  next_cursor?: string;
  msg?: string;
}

export interface XUserTweetsResponse {
  status: string;
  // Live responses nest tweets under data; the published schema puts them at the top level.
  data?: {
    tweets?: XPost[];
  };
  tweets?: XPost[];
  has_next_page: boolean;
  next_cursor?: string;
  msg?: string;
}

interface XArticleInlineStyleRange {
  offset: number;
  length: number;
  style: string;
}

interface XArticleContent {
  type?: string;
  text?: string;
  url?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  inlineStyleRanges?: XArticleInlineStyleRange[];
}

interface XArticle {
  author: XAuthor;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number | string;
  createdAt: string;
  title: string;
  preview_text?: string;
  cover_media_img_url?: string;
  contents: XArticleContent[];
}

export interface XArticleResponse {
  status: string;
  article: XArticle;
  msg?: string;
  message?: string;
}

interface XUserInfo {
  type?: "user";
  userName: string;
  url: string;
  id: string;
  name: string;
  isBlueVerified: boolean;
  verifiedType?: string;
  profilePicture: string;
  coverPicture?: string;
  description: string;
  location?: string;
  followers: number;
  following: number;
  canDm: boolean;
  createdAt: string;
  favouritesCount: number;
  mediaCount: number;
  statusesCount: number;
  pinnedTweetIds?: string[];
  unavailable?: false;
}

// Suspended or otherwise unavailable accounts succeed with only these fields.
interface XUnavailableUser {
  unavailable: true;
  message?: string;
  unavailableReason?: string;
  id?: undefined;
}

export interface XUserInfoResponse {
  status: string;
  data: XUserInfo | XUnavailableUser;
  msg?: string;
}

export type XAccountErrorCode = "ACCOUNT_NOT_FOUND" | "ACCOUNT_UNAVAILABLE";

export class XApiError extends Error {
  status: number;
  details: unknown;
  code: XAccountErrorCode | null;

  constructor(message: string, status: number, details?: unknown, code?: XAccountErrorCode) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.details = details ?? null;
    this.code = code ?? null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getDefaultApiKey(): string {
  const apiKey = process.env.X_API_KEY;
  if (!apiKey) {
    throw new XApiError("Social API key is not configured on the server.", 500);
  }
  return apiKey;
}

function getErrorMessage(payload: unknown): string {
  if (!isObject(payload)) return "Social API request failed.";
  const errorPayload = payload as ErrorLikePayload;
  return (
    errorPayload.msg ||
    errorPayload.message ||
    errorPayload.error ||
    errorPayload.detail ||
    "Social API request failed."
  );
}

function hasErrorStatus(payload: unknown): boolean {
  if (!isObject(payload)) return false;
  const status = payload.status;
  return status === "error" || status === "failed";
}

function buildUrl(path: string, query: Record<string, QueryValue> = {}): string {
  const url = new URL(path, X_API_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function inferStatus(responseStatus: number, payload: unknown): number {
  if (responseStatus >= 400 && responseStatus <= 599) return responseStatus;
  if (isObject(payload) && payload.status === "failed") return 400;
  return 502;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return await response.text();
}

async function xApiGet<T>(
  path: string,
  query: Record<string, QueryValue> = {},
  options?: { apiKey?: string },
): Promise<T> {
  const apiKey = options?.apiKey ?? getDefaultApiKey();
  const url = buildUrl(path, query);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const payload = await parseResponse(response);

  if (!response.ok || hasErrorStatus(payload)) {
    throw new XApiError(getErrorMessage(payload), inferStatus(response.status, payload), payload);
  }

  return payload as T;
}

export async function fetchThreadContext(
  tweetId: string,
  cursor?: string,
  apiKey?: string,
): Promise<XThreadResponse> {
  return xApiGet<XThreadResponse>("/twitter/tweet/thread_context", { tweetId, cursor }, { apiKey });
}

export async function fetchUserTimeline(
  userId: string,
  cursor?: string,
  options?: { includeReplies?: boolean; apiKey?: string },
): Promise<XUserTweetsResponse> {
  return xApiGet<XUserTweetsResponse>(
    "/twitter/user/tweet_timeline",
    {
      userId,
      cursor,
      includeReplies: options?.includeReplies ?? false,
      includeParentTweet: false,
    },
    { apiKey: options?.apiKey },
  );
}

export async function fetchArticle(tweetId: string, apiKey?: string): Promise<XArticleResponse> {
  return xApiGet<XArticleResponse>("/twitter/article", { tweet_id: tweetId }, { apiKey });
}

export function getTimelineTweets(response: XUserTweetsResponse): XPost[] {
  return response.data?.tweets ?? response.tweets ?? [];
}

export async function fetchUserInfo(userName: string, apiKey?: string): Promise<XUserInfoResponse> {
  try {
    return await xApiGet<XUserInfoResponse>("/twitter/user/info", { userName }, { apiKey });
  } catch (error) {
    // Missing handles return HTTP 200 with status "error" and msg "user not found".
    if (error instanceof XApiError && /user not found/i.test(error.message)) {
      throw new XApiError(error.message, 404, error.details, "ACCOUNT_NOT_FOUND");
    }
    throw error;
  }
}

export async function fetchUserId(userName: string, apiKey?: string): Promise<string> {
  const { data } = await fetchUserInfo(userName, apiKey);
  if (!data.unavailable && data.id) return data.id;
  const message = (data.unavailable && data.message) || "Account unavailable.";
  throw new XApiError(message, 404, data, "ACCOUNT_UNAVAILABLE");
}
