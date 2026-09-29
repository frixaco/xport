import { createFileRoute } from "@tanstack/react-router";
import { SeoLandingPage, type SeoLandingPageContent } from "@/components/seo-landing-page";
import { getSiteUrl, SITE_NAME } from "@/lib/seo";

const title = "Export and Unroll X (ex-Twitter) Threads | Xport";
const description =
  "Unroll a public X (ex-Twitter) thread and export its posts, metadata, and media links as Markdown or JSON.";
const path = "/export-x-threads";

const content: SeoLandingPageContent = {
  path,
  eyebrow: "X thread exporter",
  heading: "Unroll an X thread into one clean document",
  intro:
    "Paste a public X (ex-Twitter) thread URL to collect its connected posts in reading order. Preview the full thread, then download a readable Markdown document or structured JSON file.",
  steps: [
    {
      title: "Paste the thread URL",
      description: "Use an x.com or twitter.com status URL from any public thread.",
    },
    {
      title: "Let Xport unroll it",
      description:
        "Xport finds the connected posts and presents them together in their original order.",
    },
    {
      title: "Export the result",
      description: "Copy the Markdown or download the complete thread as Markdown or JSON.",
    },
  ],
  benefits: [
    {
      title: "A distraction-free thread",
      description:
        "Read the complete sequence without unrelated feed content or repeated page navigation.",
    },
    {
      title: "Portable Markdown",
      description:
        "Save a human-readable document that works in notes apps, repositories, and static sites.",
    },
    {
      title: "Structured JSON",
      description:
        "Keep the result in a machine-readable form for scripts, analysis, or later conversion.",
    },
    {
      title: "Source and media links",
      description:
        "Retain links back to X (ex-Twitter) and references to available images or videos.",
    },
  ],
  faqs: [
    {
      question: "Does Xport preserve the order of a thread?",
      answer:
        "Yes. Connected thread posts are exported in reading order, starting with the main post.",
    },
    {
      question: "Can I export a thread as Markdown?",
      answer:
        "Yes. You can copy the generated Markdown or download it as a .md file. JSON is also available.",
    },
    {
      question: "Will images and videos be included?",
      answer:
        "The export preserves available media links. It does not bundle the original media files into the download.",
    },
  ],
};

export const Route = createFileRoute("/export-x-threads")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${getSiteUrl()}${path}` },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: `${getSiteUrl()}${path}` }],
  }),
  component: () => <SeoLandingPage content={content} />,
});
