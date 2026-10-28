import { extractUsernameFromTweetCard } from "./tweet-card.ts";
import type {
  AccountExportMode,
  FetchJobRequestType,
  FetchJobStatus,
  FetchJobStatusResponse,
  ResultState,
  ThreadResultState,
  TweetCardModel,
  UserTweetsResultState,
} from "./types.ts";

const ACCOUNT_RESULTS: Record<
  Exclude<FetchJobRequestType, "thread">,
  { mode: AccountExportMode; label: string }
> = {
  user: { mode: "posts", label: "User posts" },
  timeline: { mode: "timeline", label: "User timeline" },
  replies: { mode: "replies", label: "User replies" },
  bookmarks: { mode: "bookmarks", label: "Bookmarks" },
};

export function buildFetchJobResult(
  requestType: FetchJobRequestType,
  tweets: TweetCardModel[],
  mainTweet: TweetCardModel | null,
  jobStatus: FetchJobStatusResponse,
  sourceUsername: string | null,
): FetchJobResult {
  const usage = {
    charged: jobStatus.chargedCredits > 0,
    chargedCredits: jobStatus.chargedCredits,
    tweetCount: jobStatus.storedTweets,
  };
  const username =
    sourceUsername ??
    extractUsernameFromTweetCard(mainTweet) ??
    extractUsernameFromTweetCard(tweets[0]);

  if (requestType === "thread") {
    const threadTweets = mainTweet ? tweets.filter((tweet) => tweet.id !== mainTweet.id) : tweets;
    return {
      kind: "thread",
      mainTweet,
      tweets: threadTweets,
      username,
      label: "Thread posts",
      usage,
    };
  }

  const { mode, label } = ACCOUNT_RESULTS[requestType];
  return {
    kind: "user-tweets",
    mode,
    tweets: mainTweet ? [mainTweet, ...tweets] : tweets,
    username,
    label,
    usage,
  };
}

export function hasExportablePosts(result: ResultState): boolean {
  if (result.kind === "thread") return Boolean(result.mainTweet) || result.tweets.length > 0;
  if (result.kind === "user-tweets") return result.tweets.length > 0;
  return false;
}

export function isTerminalFetchJobStatus(status: FetchJobStatus): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}

type FetchJobResult = ThreadResultState | UserTweetsResultState;
