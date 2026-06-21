export type DetectedType = "Tweet" | "User" | "Thread" | "Article" | "Bookmarks" | null;

export type RequestType = "thread" | "user-tweets" | "article";

export interface RequestConfig {
  type: RequestType;
}

export interface MediaItem {
  type: "image" | "video";
  url: string;
}

export interface TweetCardModel {
  id: string;
  text: string;
  meta: string;
  url?: string;
  media: MediaItem[];
}

export interface UsageMetadata {
  charged: boolean;
  chargedCredits: number;
  tweetCount?: number;
}

export interface ThreadResultState {
  kind: "thread";
  mainTweet: TweetCardModel | null;
  tweets: TweetCardModel[];
  username: string | null;
  label: string;
  usage: UsageMetadata | null;
}

export interface UserTweetsResultState {
  kind: "user-tweets";
  tweets: TweetCardModel[];
  username: string | null;
  label: string;
  usage: UsageMetadata | null;
}

export interface ContentBlockStyle {
  marker: string;
  markerEnd: string;
}

export interface ContentBlock {
  type: string;
  text: string;
  url?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  styledText: string;
}

export interface ArticleResultState {
  kind: "article";
  title: string;
  authorUsername: string | null;
  publishedDate: string | null;
  sourceUrl: string | null;
  byline: string | null;
  preview: string | null;
  coverImageUrl: string | null;
  sections: ContentBlock[];
  label: string;
  usage: UsageMetadata | null;
}

export type ResultState = ThreadResultState | UserTweetsResultState | ArticleResultState;

export type FetchJobStatus = "running" | "queued" | "completed" | "stopped" | "failed";

export type FetchJobRequestType = "thread" | "user";

export interface FetchJobStatusResponse {
  status: FetchJobStatus;
  pagesFetched: number;
  rawFetchedTweets: number;
  storedTweets: number;
  chargedCredits: number;
  hasNextPage: boolean;
  error: { code: string | null; message: string | null } | null;
  updatedAt: string;
}

export interface FetchJobResumeResponse extends FetchJobStatusResponse {
  requestType: FetchJobRequestType;
  inputRaw: string;
  inputNormalized: string;
}

export interface FetchJobState {
  jobId: string;
  requestType: FetchJobRequestType;
  sourceUsername: string | null;
  status: FetchJobStatusResponse;
}
