import { NextRequest, NextResponse } from "next/server";
import { fetchUserLastTweets, XApiError } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { ApiAccessError, assertSufficientCredits, ingestCreditsUsage } from "@/lib/api-access";
import {
  buildUsageMetadata,
  calculateTweetListCredits,
  MIN_PREFLIGHT_CREDITS,
  withUsageMetadata,
} from "@/lib/credits";

export const runtime = "nodejs";

function getSafeStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 500;
}

function parseBooleanParam(value: string | null): boolean | null {
  if (value === null) return null;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawUserInput =
    searchParams.get("userName") ??
    searchParams.get("username") ??
    searchParams.get("url") ??
    searchParams.get("input");

  if (!rawUserInput) {
    return NextResponse.json(
      {
        error: "Missing required query param: userName (or username/url/input).",
      },
      { status: 400 },
    );
  }

  const userName = parseUsername(rawUserInput);
  if (!userName) {
    return NextResponse.json(
      {
        error: "Invalid user input. Provide a valid @username, username, or profile URL.",
      },
      { status: 400 },
    );
  }

  const includeRepliesRaw = searchParams.get("includeReplies");
  const parsedIncludeReplies = parseBooleanParam(includeRepliesRaw);
  if (includeRepliesRaw !== null && parsedIncludeReplies === null) {
    return NextResponse.json(
      { error: "Invalid includeReplies value. Use true or false." },
      { status: 400 },
    );
  }

  const includeReplies = parsedIncludeReplies ?? false;
  const cursor = searchParams.get("cursor") ?? undefined;
  try {
    await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
    const data = await fetchUserLastTweets(userName, cursor);
    const tweetCount = Array.isArray(data.data?.tweets) ? data.data.tweets.length : 0;
    const chargedCredits = calculateTweetListCredits(tweetCount);
    const charged = await ingestCreditsUsage(request, {
      credits: chargedCredits,
    });
    const usageMetadata = buildUsageMetadata({
      charged,
      chargedCredits,
      tweetCount,
    });

    if (includeReplies) {
      return NextResponse.json(withUsageMetadata(data, usageMetadata), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Xport-Credits-Charged": String(usageMetadata.chargedCredits),
        },
      });
    }

    const tweets = data.data?.tweets ?? [];
    const filteredTweets = tweets.filter((tweet) => !(tweet.isReply || tweet.inReplyToId));

    return NextResponse.json(
      withUsageMetadata(
        {
          ...data,
          data: {
            ...data.data,
            tweets: filteredTweets,
          },
        },
        usageMetadata,
      ),
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Xport-Credits-Charged": String(usageMetadata.chargedCredits),
        },
      },
    );
  } catch (error) {
    if (error instanceof ApiAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: getSafeStatus(error.status) },
      );
    }

    if (error instanceof XApiError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: getSafeStatus(error.status) },
      );
    }

    return NextResponse.json(
      { error: "Unexpected error while fetching user tweets." },
      { status: 500 },
    );
  }
}
