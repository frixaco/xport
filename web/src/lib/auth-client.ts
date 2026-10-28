import { BOOKMARKS_URL } from "@xport/core";
import { createAuthClient } from "better-auth/react";
import { polarClient } from "@polar-sh/better-auth/client";

export const authClient = createAuthClient({
  plugins: [polarClient()],
});

/** Links the user's X account, then returns to Xport and starts a bookmarks export. */
export function connectXAccount() {
  return authClient.linkSocial({
    provider: "twitter",
    callbackURL: `/?input=${encodeURIComponent(BOOKMARKS_URL)}`,
  });
}
