import { MessagesSquare, Download, FileText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const tools = [
  {
    title: "Unroll Threads",
    desc: "Paste any tweet from a thread. Get the full thread in clean, readable format. Export to Markdown or plain text.",
    icon: MessagesSquare,
    color: "text-chart-2",
  },
  {
    title: "Export Tweets",
    desc: "Enter a username or profile URL. Download all their tweets as CSV, Markdown, or JSON.",
    icon: Download,
    color: "text-chart-2",
  },
  {
    title: "Read Articles",
    desc: "Twitter/X articles rendered clean. No distractions, no login wall. Save as Markdown.",
    icon: FileText,
    color: "text-chart-2",
  },
] as const;

export function ToolCards({ className }: { className?: string }) {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {tools.map((tool) => (
        <Card key={tool.title} className="h-full bg-background">
          <CardHeader>
            <div className="flex items-center gap-2">
              <tool.icon className={`size-4 ${tool.color}`} />
              <CardTitle className="font-bold">{tool.title}</CardTitle>
            </div>
            <CardDescription className="leading-relaxed">{tool.desc}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
