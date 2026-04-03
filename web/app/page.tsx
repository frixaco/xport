import { Suspense } from "react";
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { HeroInput } from "@/components/hero-input";
import { AuthErrorToast } from "@/components/auth-error-toast";
import { CheckoutToast } from "@/components/checkout-toast";
import {
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_OG_IMAGE_PATH,
  SITE_TITLE,
} from "@/lib/seo";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: SITE_OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE_PATH],
  },
};

export default function Page() {
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
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ];
  const structuredDataJson = JSON.stringify(structuredData).replace(/</g, "\\u003c");

  return (
    <div className="flex min-h-dvh flex-col">
      <script
        type="application/ld+json"
        // JSON-LD for landing page rich results.
        dangerouslySetInnerHTML={{ __html: structuredDataJson }}
      />
      <Header />
      <Suspense>
        <AuthErrorToast />
        <CheckoutToast />
      </Suspense>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6">
        <div className="w-full max-w-4xl px-6 py-6 sm:px-8">
          <div className="flex flex-col items-center gap-8">
            <HeroInput />
          </div>
        </div>
      </main>
      {/*
      <div className="fixed inset-0 z-9999 flex h-screen w-screen items-center justify-center bg-black/50 px-6">
        <p className="text-center text-4xl font-bold text-white sm:text-6xl">
          WIP, available in 1-2 days
        </p>
      </div>
      */}
    </div>
  );
}
