import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/auth-error",
          "/checkout/success",
          "/x.com",
          "/x.com/",
          "/twitter.com",
          "/twitter.com/",
        ],
      },
    ],
    sitemap: [`${siteUrl}/sitemap.xml`],
  };
}
