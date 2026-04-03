import { notFound, redirect } from "next/navigation";

const ALLOWED_SOURCE_HOSTS = new Set(["x.com", "twitter.com"]);

function buildSourceUrl(
  sourceHost: string,
  sourcePath: string[],
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const encodedPath = sourcePath.map((segment) => encodeURIComponent(segment));
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      query.append(key, value);
      continue;
    }

    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      query.append(key, entry);
    }
  }

  const pathname = encodedPath.join("/");
  const sourceUrl = `https://${sourceHost}/${pathname}`;
  const queryString = query.toString();
  return queryString ? `${sourceUrl}?${queryString}` : sourceUrl;
}

export default async function SourceUrlRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ sourceHost: string; sourcePath: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sourceHost, sourcePath } = await params;
  const normalizedHost = sourceHost.toLowerCase();

  if (!ALLOWED_SOURCE_HOSTS.has(normalizedHost)) {
    notFound();
  }

  const input = buildSourceUrl(normalizedHost, sourcePath, await searchParams);
  redirect(`/?input=${encodeURIComponent(input)}`);
}
