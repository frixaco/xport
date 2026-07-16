import { extractUsernameFromTweetCard } from "./tweet-card.ts";
import type {
  FetchJobRequestType,
  FetchJobStatus,
  FetchJobStatusResponse,
  ResultState,
  ThreadResultState,
  TweetCardModel,
  UserTweetsResultState,
} from "./types.ts";

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

  return {
    kind: "user-tweets",
    tweets: mainTweet ? [mainTweet, ...tweets] : tweets,
    username,
    label: "User posts",
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
