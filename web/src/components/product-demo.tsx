import { ArrowRight, Check, Download, FileJson, FileText, Square } from "lucide-react";

const stages = [
  { label: "Accept", detail: "Post, thread, profile, or article" },
  { label: "Fetch", detail: "Live page and item progress" },
  { label: "Preview", detail: "Text and media before export" },
  { label: "Export", detail: "Markdown or JSON" },
] as const;

const examples = ["Post URL", "Thread URL", "@username", "Article URL"] as const;

export function ProductDemo() {
  return (
    <section
      className="w-full border-t bg-muted/20 px-4 py-12 sm:px-6 sm:py-16"
      aria-labelledby="demo-title"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-2 text-xs font-semibold tracking-widest text-chart-2 uppercase">
            See what you get
          </p>
          <h2 id="demo-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            From an X link to a portable archive
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Follow progress as Xport fetches each page, inspect the real content and media, then
            download a clean file. Long exports can be stopped without losing fetched results.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2" aria-label="Accepted input types">
          {examples.map((example) => (
            <span
              key={example}
              className="rounded-sm border bg-background px-3 py-1.5 text-xs font-medium"
            >
              <Check className="mr-1.5 inline size-3.5 text-chart-2" />
              {example}
            </span>
          ))}
        </div>

        <ol className="grid overflow-hidden rounded-lg border bg-background sm:grid-cols-4">
          {stages.map((stage, index) => (
            <li
              key={stage.label}
              className="relative flex gap-3 border-b p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chart-2/10 text-xs font-semibold text-chart-2">
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-medium">{stage.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {stage.detail}
                </span>
              </span>
              {index < stages.length - 1 && (
                <ArrowRight className="absolute top-1/2 -right-2.5 z-10 hidden size-5 -translate-y-1/2 rounded-full border bg-background p-1 text-muted-foreground sm:block" />
              )}
            </li>
          ))}
        </ol>

        <div className="mx-auto grid w-full max-w-5xl gap-6">
          <DemoCapture
            title="Preview a complete article"
            description="Article structure, cover media, section count, cost, and export actions stay visible together."
            image="/readme/article-fetch.png"
            imageAlt="Xport article result showing the input, article preview, media, section count, and download actions"
            badges={[
              { icon: FileText, label: "Markdown" },
              { icon: Download, label: "Download or copy" },
            ]}
          />
          <DemoCapture
            title="Stop early and keep partial results"
            description="Pause a long profile export after any page and export everything already saved. Reloading resumes active jobs by job ID."
            image="/readme/stop-early-user-fetch.png"
            imageAlt="Xport stopped profile export showing the input, partial fetched posts, and download actions"
            badges={[
              { icon: Square, label: "Stopped after 4 pages" },
              { icon: FileJson, label: "Markdown or JSON" },
            ]}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Screens show real Xport result states using public example content. No sign-in is required
          to explore this walkthrough.
        </p>
      </div>
    </section>
  );
}

function DemoCapture({
  title,
  description,
  image,
  imageAlt,
  badges,
}: {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  badges: Array<{ icon: typeof FileText; label: string }>;
}) {
  return (
    <article className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {badges.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 bg-secondary px-2 py-1 text-xs"
            >
              <Icon className="size-3.5" />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="border-t bg-muted/30 p-2 sm:p-3">
        <a
          href={image}
          target="_blank"
          rel="noreferrer"
          className="block"
          title="Open full-size capture"
        >
          <img src={image} alt={imageAlt} className="w-full rounded-sm border" loading="lazy" />
        </a>
        <p className="pt-2 text-center text-[11px] text-muted-foreground sm:hidden">
          Tap the capture to inspect it full size.
        </p>
      </div>
    </article>
  );
}
