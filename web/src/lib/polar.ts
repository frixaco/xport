import { createPolarCore } from "@polar-sh/sdk/2026-10";

const isSandbox = process.env.POLAR_ENV !== "production";

export const polarClient = createPolarCore({
  accessToken: isSandbox
    ? process.env.SANDBOX_POLAR_ACCESS_TOKEN!
    : process.env.POLAR_ACCESS_TOKEN!,
  environment: isSandbox ? "sandbox" : "production",
});
