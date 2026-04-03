import { writeFile } from "node:fs/promises";

const API_KEY = process.env.API_KEY!;
const X_API_URL = process.env.X_API_URL!;
const BASE_URL = X_API_URL + "/twitter/user/followings";

interface UserData {
  userName: string;
  name: string;
  id: string;
  description: string;
  followers: number;
  following: number;
  statusesCount: number;
  location?: string;
  url?: string;
  profilePicture: string;
  isBlueVerified?: boolean;
}

interface ApiResponse {
  status: string;
  followings: UserData[];
  has_next_page: boolean;
  next_cursor: string;
}

async function fetchFollowings(userName: string): Promise<UserData[]> {
  const allFollowings: UserData[] = [];
  let cursor = "";
  let page = 1;

  while (true) {
    const url = new URL(BASE_URL);
    url.searchParams.set("userName", userName);
    if (cursor) url.searchParams.set("cursor", cursor);

    console.log(`Fetching page ${page}...`);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "X-API-Key": API_KEY },
    });

    const json = (await response.json()) as ApiResponse;

    if (!response.ok || json.status !== "success") {
      console.error("API Response:", JSON.stringify(json, null, 2));
      throw new Error(`API error: ${response.status}`);
    }

    allFollowings.push(...json.followings);
    console.log(`  Got ${json.followings.length} users (total: ${allFollowings.length})`);

    if (!json.has_next_page || !json.next_cursor) break;

    cursor = json.next_cursor;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  }

  return allFollowings;
}

async function main() {
  const userName = process.argv[2];
  if (!userName) {
    console.error("Usage: node fetch-followings.ts <username>");
    process.exit(1);
  }

  console.log(`Fetching accounts @${userName} follows...\n`);

  const followings = await fetchFollowings(userName);

  const output = followings.map((u) => ({
    userName: u.userName,
    name: u.name,
    id: u.id,
    bio: u.description || "",
    followers: u.followers,
    following: u.following,
    posts: u.statusesCount,
    location: u.location || "",
    url: u.url || "",
  }));

  const outPath = `data/${userName}-followings.json`;
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`\nSaved ${output.length} accounts to ${outPath}`);
}

main().catch(console.error);
