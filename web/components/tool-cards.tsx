import Link from "next/link";
import { MessagesSquare, Download, FileText, ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";

const tools = [
  {
    title: "Unroll Threads",
    desc: "Paste any tweet from a thread. Get the full thread in clean, readable format. Export to Markdown or plain text.",
    icon: MessagesSquare,
    href: "/thread",
    color: "text-chart-2",
  },
  {
    title: "Export Tweets",
    desc: "Enter a username or profile URL. Download all their tweets as CSV, Markdown, or JSON.",
    icon: Download,
    href: "/export",
    color: "text-chart-2",
  },
  {
    title: "Read Articles",
    desc: "Twitter/X articles rendered clean. No distractions, no login wall. Save as Markdown.",
    icon: FileText,
    href: "/article",
    color: "text-chart-2",
  },
] as const;

export function ToolCards() {
  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-3 px-6 sm:grid-cols-2">
      {tools.map((tool) => (
        <Link key={tool.href} href={tool.href} className="group">
          <Card className="bg-background h-full transition-colors hover:bg-input/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <tool.icon className={`size-4 ${tool.color}`} />
                <CardTitle className="font-bold">{tool.title}</CardTitle>
              </div>
              <CardAction>
                <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardAction>
              <CardDescription className="leading-relaxed">{tool.desc}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
