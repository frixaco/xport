import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import type { WebhookCustomerCreatedPayload } from "@polar-sh/sdk/models/components/webhookcustomercreatedpayload";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { polarClient } from "./polar";

const USAGE_EVENT_NAME = "usage";
const SIGNUP_CREDIT_AMOUNT = 50;

async function grantSignupCredits(payload: WebhookCustomerCreatedPayload): Promise<void> {
  const polarCustomerId = payload.data.id;
  const externalId = `signup-credit:v1:${polarCustomerId}`;

  await polarClient.events.ingest({
    events: [
      {
        name: USAGE_EVENT_NAME,
        customerId: polarCustomerId,
        externalId,
        metadata: {
          credits: -SIGNUP_CREDIT_AMOUNT,
          reason: "signup-credit",
        },
      },
    ],
  });
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
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
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId:
                process.env.POLAR_ENV !== "production"
                  ? process.env.SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID!
                  : process.env.POLAR_CREDITS_50_CREDITS_PRODUCT_ID!,
              slug: "credits-125",
            },
            {
              productId:
                process.env.POLAR_ENV !== "production"
                  ? process.env.SANDBOX_POLAR_CREDITS_500_CREDITS_PRODUCT_ID!
                  : process.env.POLAR_CREDITS_500_CREDITS_PRODUCT_ID!,
              slug: "credits-1250",
            },
          ],
          successUrl: `${process.env.BETTER_AUTH_URL}/checkout/success?checkout_id={CHECKOUT_ID}`,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
        webhooks({
          secret: process.env.POLAR_WEBHOOK_SECRET!,
          onCustomerCreated: grantSignupCredits,
        }),
      ],
    }),
    tanstackStartCookies(),
  ],
});
