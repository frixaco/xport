import { Polar } from "@polar-sh/sdk";

const isSandbox = process.env.POLAR_ENV !== "production";

export const polarClient = new Polar({
  accessToken: isSandbox
    ? process.env.SANDBOX_POLAR_ACCESS_TOKEN!
    : process.env.POLAR_ACCESS_TOKEN!,
  server: isSandbox ? "sandbox" : "production",
});
