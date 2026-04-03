import { NextRequest, NextResponse } from "next/server";
import { fetchThreadContext, XApiError } from "@/lib/x-api";
import { parseTweetId } from "@/lib/url-parser";
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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input =
    searchParams.get("tweetId") ??
    searchParams.get("id") ??
    searchParams.get("url") ??
    searchParams.get("input");

  if (!input) {
    return NextResponse.json(
      { error: "Missing required query param: tweetId (or id/url/input)." },
      { status: 400 },
    );
  }

  const tweetId = parseTweetId(input);
  if (!tweetId) {
    return NextResponse.json(
      { error: "Invalid tweet input. Provide a valid tweet URL or tweet ID." },
      { status: 400 },
    );
  }

  const cursor = searchParams.get("cursor") ?? undefined;
  try {
    await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
    const data = await fetchThreadContext(tweetId, cursor);
    const tweetCount = Array.isArray(data.tweets) ? data.tweets.length : 0;
    const chargedCredits = calculateTweetListCredits(tweetCount);
    const charged = await ingestCreditsUsage(request, {
      credits: chargedCredits,
    });
    const usageMetadata = buildUsageMetadata({
      charged,
      chargedCredits,
      tweetCount,
    });

    return NextResponse.json(withUsageMetadata(data, usageMetadata), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Xport-Credits-Charged": String(usageMetadata.chargedCredits),
      },
    });
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
      { error: "Unexpected error while fetching thread context." },
      { status: 500 },
    );
  }
}
