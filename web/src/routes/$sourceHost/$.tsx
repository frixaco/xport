import { createFileRoute, redirect } from "@tanstack/react-router";

const ALLOWED_SOURCE_HOSTS = new Set(["x.com", "twitter.com"]);

export const Route = createFileRoute("/$sourceHost/$")({
  beforeLoad: ({ params, search }) => {
    const normalizedHost = params.sourceHost.toLowerCase();
    if (!ALLOWED_SOURCE_HOSTS.has(normalizedHost)) {
      throw redirect({ to: "/" });
    }

    const encodedPath = (params["_splat"] ?? "").split("/").map(encodeURIComponent);
    const sourceUrl = `https://${normalizedHost}/${encodedPath.join("/")}`;

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string") searchParams.append(key, value);
    }
    searchParams.set("input", sourceUrl);

    throw redirect({ to: "/", search: Object.fromEntries(searchParams) });
  },
  component: () => null,
});
