import { ArrowRight, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Header } from "@/components/header";
import { SiteFooter } from "@/components/site-footer";
import { getSiteUrl, SITE_NAME } from "@/lib/seo";

export interface SeoLandingPageContent {
  path: string;
  eyebrow: string;
  heading: string;
  intro: string;
  steps: Array<{ title: string; description: string }>;
  benefits: Array<{ title: string; description: string }>;
  faqs: Array<{ question: string; answer: string }>;
}

export function SeoLandingPage({ content }: { content: SeoLandingPageContent }) {
  const pageUrl = `${getSiteUrl()}${content.path}`;
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: content.heading,
      url: pageUrl,
      description: content.intro,
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: getSiteUrl() },
      inLanguage: "en-US",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Header />
      <main className="flex-1">
        <section className="border-y bg-muted/20 px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-xs font-semibold tracking-widest text-chart-2 uppercase">
              {content.eyebrow}
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              {content.heading}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {content.intro}
            </p>
            <Link
              to="/"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-4xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-80"
            >
              Try Xport
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <section className="px-6 py-14 sm:py-20" aria-labelledby="how-it-works">
          <div className="mx-auto max-w-5xl">
            <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {content.steps.map((step, index) => (
                <li key={step.title} className="border bg-background p-5">
                  <span className="text-xs font-semibold text-chart-2">0{index + 1}</span>
                  <h3 className="mt-3 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="border-y bg-muted/20 px-6 py-14 sm:py-20"
          aria-labelledby="what-you-get"
        >
          <div className="mx-auto max-w-5xl">
            <h2 id="what-you-get" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              What you get
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {content.benefits.map((benefit) => (
                <article key={benefit.title} className="flex gap-3">
                  <Check className="mt-0.5 size-5 shrink-0 text-chart-2" />
                  <div>
                    <h3 className="font-semibold">{benefit.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {benefit.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-14 sm:py-20" aria-labelledby="faq">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Frequently asked questions
            </h2>
            <div className="mt-8 divide-y border-y">
              {content.faqs.map((faq) => (
                <article key={faq.question} className="py-5">
                  <h3 className="font-semibold">{faq.question}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/20 px-6 py-14 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Ready to make a portable copy?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste a public X (ex-Twitter) URL or username and preview the result before downloading.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-4xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-80"
          >
            Start an export
            <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
