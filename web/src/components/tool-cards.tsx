import { MessagesSquare, Download, FileText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const tools = [
  {
    title: "Unroll Threads",
    desc: "Paste any tweet from a thread. Get the full thread in clean, readable format. Export to Markdown or plain text.",
    icon: MessagesSquare,
  },
  {
    title: "Export Tweets",
    desc: "Enter a username or profile URL. Download all their tweets as CSV, Markdown, or JSON.",
    icon: Download,
  },
  {
    title: "Read Articles",
    desc: "Twitter/X articles rendered clean. No distractions, no login wall. Save as Markdown.",
    icon: FileText,
  },
] as const;

export function ToolCards({ className }: { className?: string }) {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {tools.map(({ icon: Icon, title, desc }) => (
        <Card key={title} className="h-full bg-background">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-bold">
              <Icon className="size-4 text-chart-2" />
              {title}
            </CardTitle>
            <CardDescription className="leading-relaxed">{desc}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
