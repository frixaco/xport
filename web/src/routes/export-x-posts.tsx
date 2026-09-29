import { createFileRoute } from "@tanstack/react-router";
import { SeoLandingPage, type SeoLandingPageContent } from "@/components/seo-landing-page";
import { SITE_NAME } from "@/lib/seo";

const title = "Export X (ex-Twitter) Posts to Markdown or JSON | Xport";
const description =
  "Export public X (ex-Twitter) posts and user timelines to clean Markdown or structured JSON with resumable progress.";
const path = "/export-x-posts";

const content: SeoLandingPageContent = {
  path,
  eyebrow: "X post exporter",
  heading: "Export X posts without copying them one by one",
  intro:
    "Turn a public X (ex-Twitter) profile or post into a portable Markdown or JSON file. Xport saves fetched results as it works, so long timeline exports can be stopped without losing completed pages.",
  steps: [
    {
      title: "Paste a URL or username",
      description: "Enter an x.com post URL, twitter.com post URL, or a public @username.",
    },
    {
      title: "Fetch and preview",
      description:
        "Watch page and post counts update, then inspect text and media links before exporting.",
    },
    {
      title: "Download your file",
      description:
        "Save readable Markdown or structured JSON for archiving and further processing.",
    },
  ],
  benefits: [
    {
      title: "Export public user timelines",
      description:
        "Fetch posts from a public account by entering its username instead of collecting URLs manually.",
    },
    {
      title: "Keep partial results",
      description:
        "Stop a long export after any completed page and download everything already stored.",
    },
    {
      title: "Preserve useful context",
      description:
        "Exports include post text, author metadata, source links, and available media URLs.",
    },
    {
      title: "Resume after a reload",
      description:
        "Background jobs use a durable job ID, allowing an active export to resume in the browser.",
    },
  ],
  faqs: [
    {
      question: "What formats can I export X posts to?",
      answer: "Post and timeline results can be downloaded as Markdown or JSON.",
    },
    {
      question: "Can I export posts from any account?",
      answer:
        "Xport works with public X (ex-Twitter) content available to its upstream data provider. Private or unavailable content cannot be exported.",
    },
    {
      question: "Do I lose results if I stop a long timeline export?",
      answer:
        "No. After at least one page has completed, you can stop the job and export the posts fetched so far as a partial result.",
    },
  ],
};

export const Route = createFileRoute("/export-x-posts")({
  loader: ({ context }) => context.siteUrl,
  head: ({ loaderData: siteUrl }) => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
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
