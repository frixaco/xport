const X_API_KEY = process.env.X_API_KEY;
const X_API_URL = process.env.X_API_URL;
if (!X_API_KEY) throw new Error("X_API_KEY environment variable is required");
if (!X_API_URL) throw new Error("X_API_URL environment variable is required");
const BASE_URL = X_API_URL + "/twitter/user/info";

interface UserData {
  type: string;
  userName: string;
  url: string;
  twitterUrl?: string;
  id: string;
  name: string;
  isVerified?: boolean;
  isBlueVerified: boolean;
  verifiedType?: string;
  profilePicture: string;
  coverPicture?: string;
  description: string;
  location?: string;
  followers: number;
  following: number;
  canDm: boolean;
  canMediaTag?: boolean;
  createdAt: string;
  favouritesCount: number;
  mediaCount: number;
  statusesCount: number;
  fastFollowersCount?: number;
  protected?: boolean;
  isAutomated?: boolean;
  automatedBy?: string | null;
  unavailable?: boolean;
  message?: string;
  unavailableReason?: string;
  pinnedTweetIds?: string[];
  withheldInCountries?: string[];
  affiliatesHighlightedLabel?: object;
  profile_bio?: {
    description?: string;
    entities?: {
      description?: { urls?: Array<Record<string, unknown>> };
      url?: { urls?: Array<Record<string, unknown>> };
    };
  };
  entities?: {
    description?: { urls?: Array<Record<string, unknown>> };
    url?: { urls?: Array<Record<string, unknown>> };
  };
}

interface ApiResponse {
  status: string;
  data: UserData;
}

async function fetchUserInfo(userName: string): Promise<UserData> {
  const url = new URL(BASE_URL);
  url.searchParams.set("userName", userName);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-API-Key": X_API_KEY },
  });

  const json = (await response.json()) as ApiResponse;

  if (!response.ok || json.status !== "success") {
    console.error("API Response:", JSON.stringify(json, null, 2));
    throw new Error(`API error: ${response.status}`);
  }

  return json.data;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function main() {
  const userName = process.argv[2];
  if (!userName) {
    console.error("Usage: node fetch-user-info.ts <username>");
    process.exit(1);
  }

  console.log(`Fetching user info for @${userName}...\n`);

  const user = await fetchUserInfo(userName);

  console.log(`@${user.userName} (${user.name})`);
  console.log(`ID: ${user.id}`);
  console.log(`URL: ${user.url}`);
  console.log(
    `Verified: ${user.isBlueVerified ? "✓" : "✗"}${user.verifiedType ? ` (${user.verifiedType})` : ""}`,
  );
  console.log(`\nBio: ${user.description || "(none)"}`);
  console.log(`Location: ${user.location || "(none)"}`);
  console.log(`\nFollowers: ${formatNumber(user.followers)}`);
  console.log(`Following: ${formatNumber(user.following)}`);
  console.log(`Posts: ${formatNumber(user.statusesCount)}`);
  console.log(`Likes: ${formatNumber(user.favouritesCount)}`);
  console.log(`Media: ${formatNumber(user.mediaCount)}`);
  console.log(`\nCreated: ${formatDate(user.createdAt)}`);
  console.log(`Can DM: ${user.canDm ? "Yes" : "No"}`);
  if (user.pinnedTweetIds?.length) {
    console.log(`Pinned: ${user.pinnedTweetIds.join(", ")}`);
  }
  console.log(`\nProfile: ${user.profilePicture}`);
  if (user.coverPicture) {
    console.log(`Cover: ${user.coverPicture}`);
  }
}

main().catch(console.error);
