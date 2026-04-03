import { NextRequest, NextResponse } from "next/server";
import { fetchUserInfo, XApiError } from "@/lib/x-api";
import { parseUsername } from "@/lib/url-parser";
import { ApiAccessError, assertSufficientCredits, ingestCreditsUsage } from "@/lib/api-access";
import { buildUsageMetadata, MIN_PREFLIGHT_CREDITS, withUsageMetadata } from "@/lib/credits";

export const runtime = "nodejs";
const CHARGED_CREDITS = 1;

function getSafeStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 500;
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

  try {
    await assertSufficientCredits(request, MIN_PREFLIGHT_CREDITS);
    const data = await fetchUserInfo(userName);
    const charged = await ingestCreditsUsage(request, {
      credits: CHARGED_CREDITS,
    });
    const usageMetadata = buildUsageMetadata({
      charged,
      chargedCredits: CHARGED_CREDITS,
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
      { error: "Unexpected error while fetching user info." },
      { status: 500 },
    );
  }
}
