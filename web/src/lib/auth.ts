import { betterAuth } from "better-auth";
import { polar, checkout, portal, usage } from "@polar-sh/better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Pool } from "pg";
import { polarClient } from "./polar";

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL!,
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
      ],
    }),
    tanstackStartCookies(),
  ],
});
