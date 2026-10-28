import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { polar, checkout, portal, webhooks } from "@polar-sh/better-auth";
import { assertBillingEnabled, grantSignupCredits } from "./credit-ledger.ts";
import { grantPurchaseCredits } from "./billing-grants.ts";
import { creditProducts } from "./billing-products.ts";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { captureServerEvent } from "@/lib/server-telemetry";
import { polarClient } from "./polar";
import { and, eq } from "drizzle-orm";
import { fetchXMe, X_SCOPES } from "./x-bookmarks";
import { XApiError } from "./x-api";

const CLI_CLIENT_ID = "xport-cli";
const BETTER_AUTH_BASE_URL = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");
const DEVICE_VERIFICATION_URI = BETTER_AUTH_BASE_URL ? `${BETTER_AUTH_BASE_URL}/device` : "/device";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  databaseHooks: {
    session: {
      create: {
        before: async (createdSession) => {
          // Recover a signup interrupted after user creation; the ledger key makes this a no-op otherwise.
          await grantSignupCredits(createdSession.userId);
          return { data: createdSession };
        },
      },
    },
    user: {
      create: {
        before: async (createdUser) => {
          assertBillingEnabled();
          return { data: createdUser };
        },
        after: async (createdUser) => {
          await grantSignupCredits(createdUser.id);
          captureServerEvent("user signed up", {
            distinctId: createdUser.id,
            properties: {
              user_id: createdUser.id,
            },
          });
        },
      },
    },
  },
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    // X is link-only: it grants bookmark access to an existing Xport user.
    twitter: {
      clientId: process.env.X_CLIENT_ID!,
      clientSecret: process.env.X_CLIENT_SECRET!,
      disableSignUp: true,
      disableDefaultScope: true,
      scope: X_SCOPES,
      // The default makes a second /users/me call for users.email, which the X app does not request.
      getUserInfo: async ({ accessToken }) => {
        if (!accessToken) return null;
        const me = await fetchXMe(accessToken);
        return {
          user: {
            name: me.name,
            email: `${me.id}@twitter.placeholder`,
            image: me.profile_image_url,
            emailVerified: false,
          },
          data: { data: me },
        };
      },
    },
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      trustedProviders: ["twitter"],
      // X does not return an email that could match the Xport user's email.
      allowDifferentEmails: true,
    },
  },
  onAPIError: {
    errorURL: "/auth-error",
  },
  plugins: [
    deviceAuthorization({
      schema: {},
      verificationUri: DEVICE_VERIFICATION_URI,
      validateClient: (clientId) => clientId === CLI_CLIENT_ID,
    }),
    bearer(),
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: creditProducts(),
          successUrl: `${process.env.BETTER_AUTH_URL}/checkout/success?checkout_id={CHECKOUT_ID}`,
          authenticatedUsersOnly: true,
        }),
        portal(),
        webhooks({
          secret: process.env.POLAR_WEBHOOK_SECRET!,
          onOrderPaid: grantPurchaseCredits,
        }),
      ],
    }),
    tanstackStartCookies(),
  ],
});

/** Returns a valid access token for the user's linked X account, refreshing it when needed. */
export async function getXAccessToken(userId: string): Promise<string> {
  const [linked] = await db
    .select({ id: schema.account.id, scope: schema.account.scope })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "twitter")))
    .limit(1);
  if (!linked) {
    throw new XApiError("No linked X account.", 409, null, "X_NOT_LINKED");
  }
  if (!linked.scope?.split(/[ ,]/).includes("bookmark.read")) {
    throw new XApiError("Linked X account lacks bookmark.read.", 409, null, "X_AUTH_REQUIRED");
  }
  try {
    const { accessToken } = await auth.api.getAccessToken({
      body: { accountId: linked.id, userId },
    });
    return accessToken;
  } catch (error) {
    throw new XApiError("Could not refresh the X access token.", 409, error, "X_AUTH_REQUIRED");
  }
}
