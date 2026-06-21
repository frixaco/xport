import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { Header } from "@/components/header";
import { TheInput } from "@/components/the-input";
import { validateHomeSearch } from "@/components/the-input/search";
import { AuthErrorToast } from "@/components/auth-error-toast";
import { CheckoutToast } from "@/components/checkout-toast";
import { getSiteUrl, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE } from "@/lib/seo";

export const Route = createFileRoute("/")({
  validateSearch: validateHomeSearch,
  head: () => ({
    title: SITE_TITLE,
    meta: [
      { name: "description", content: SITE_DESCRIPTION },
      { name: "keywords", content: SITE_KEYWORDS.join(", ") },
      { rel: "canonical", href: "/" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: getSiteUrl() },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const search = Route.useSearch();
  const siteUrl = getSiteUrl();
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: siteUrl,
      description: SITE_DESCRIPTION,
      inLanguage: "en-US",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE_NAME,
      url: siteUrl,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any",
      description: SITE_DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Header />
      <Suspense>
        <AuthErrorToast />
        <CheckoutToast />
      </Suspense>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center py-6">
        <TheInput search={search} />
      </main>
    </div>
  );
}
