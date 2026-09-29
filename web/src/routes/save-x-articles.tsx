import { createFileRoute } from "@tanstack/react-router";
import { SeoLandingPage, type SeoLandingPageContent } from "@/components/seo-landing-page";
import { SITE_NAME } from "@/lib/seo";

const title = "Save X (ex-Twitter) Articles as Markdown | Xport";
const description =
  "Save public X (ex-Twitter) articles as clean Markdown with headings, body text, links, and available media references.";
const path = "/save-x-articles";

const content: SeoLandingPageContent = {
  path,
  eyebrow: "X article exporter",
  heading: "Save an X article as clean Markdown",
  intro:
    "Convert a public X (ex-Twitter) article into a portable Markdown file for offline reading, notes, or archiving. Preview the article structure and media before downloading or copying it.",
  steps: [
    {
      title: "Paste the article URL",
      description: "Enter a public x.com or twitter.com article URL in the Xport input.",
    },
    {
      title: "Preview the article",
      description:
        "Check the title, author, sections, body content, links, and available media references.",
    },
    {
      title: "Save as Markdown",
      description: "Download a .md file or copy the complete Markdown directly to your clipboard.",
    },
  ],
  benefits: [
    {
      title: "Keep document structure",
      description:
        "Headings, paragraphs, lists, quotes, links, and code are converted into readable Markdown.",
    },
    {
      title: "Use it anywhere",
      description:
        "Open the result in plain-text editors, notes apps, repositories, or Markdown viewers.",
    },
    {
      title: "Preview before saving",
      description:
        "Inspect the fetched article and section count before you download the final file.",
    },
    {
      title: "Meaningful filenames",
      description:
        "Downloaded article files use a sanitized version of the article title rather than a generic name.",
    },
  ],
  faqs: [
    {
      question: "What format are X articles exported in?",
      answer: "Articles are exported as Markdown, either by direct download or clipboard copy.",
    },
    {
      question: "Does the export preserve article headings and links?",
      answer:
        "Yes. Xport converts supported headings, paragraphs, lists, quotes, links, and other article blocks into Markdown.",
    },
    {
      question: "Can Xport save private or subscriber-only articles?",
      answer:
        "No. The article must be publicly available to Xport's upstream data provider when the export runs.",
    },
  ],
};

export const Route = createFileRoute("/save-x-articles")({
  loader: ({ context }) => context.siteUrl,
  head: ({ loaderData: siteUrl }) => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:url", content: `${siteUrl}${path}` },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}${path}` }],
  }),
  component: () => <SeoLandingPage content={content} />,
});
