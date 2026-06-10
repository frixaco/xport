import { getAccessToken } from "./x-auth";

const SCOPES = ["list.write", "users.read", "tweet.read", "offline.access"];
const TOKEN_PATH = "data/list-auth.json";

interface UserLookupResponse {
  data: {
    id: string;
    username?: string;
    name?: string;
  };
}

async function lookupUserByUsername(accessToken: string, username: string): Promise<string> {
  const url = new URL(`https://api.x.com/2/users/by/username/${username}`);
  url.searchParams.set("user.fields", "id,username,name");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`User lookup failed: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText) as UserLookupResponse;
  return data.data.id;
}

async function addUserToList(accessToken: string, listId: string, userId: string): Promise<void> {
  const response = await fetch(`https://api.x.com/2/lists/${listId}/members`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Add to list failed: ${response.status} - ${responseText}`);
  }

  console.log(`Added user ${userId} to list ${listId}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: pnpm exec tsx add-to-list.ts <list-id> <username>");
    process.exit(1);
  }

  const [listId, username] = args;

  try {
    console.log("Authenticating...");
    const accessToken = await getAccessToken(SCOPES, TOKEN_PATH);

    console.log(`Looking up @${username}...`);
    const userId = await lookupUserByUsername(accessToken, username);

    console.log(`Adding to list ${listId}...`);
    await addUserToList(accessToken, listId, userId);

    console.log(`✅ Added @${username} to list ${listId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error:", message);
    process.exit(1);
  }
}

main();
