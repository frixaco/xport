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
