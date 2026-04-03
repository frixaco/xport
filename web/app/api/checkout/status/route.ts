import { NextRequest, NextResponse } from "next/server";
import { polarClient } from "@/lib/polar";

export async function GET(request: NextRequest) {
  const checkoutId = request.nextUrl.searchParams.get("id");

  if (!checkoutId) {
    return NextResponse.json({ error: "Missing checkout ID" }, { status: 400 });
  }

  try {
    const checkout = await polarClient.checkouts.get({ id: checkoutId });
    return NextResponse.json({ status: checkout.status });
  } catch {
    return NextResponse.json({ error: "Failed to fetch checkout status" }, { status: 500 });
  }
}
