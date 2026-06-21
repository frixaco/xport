import { ArrowLeft, ArrowRight, Check, Copy, Download, LoaderCircle, Square } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToolCards } from "@/components/tool-cards";
import { cn } from "@/lib/utils";
import type { HomeSearch } from "./search";
import { examples } from "./input";
import { ResultDisplay, ResultDisplayLoading } from "./result-display";
import type { FetchJobStatusResponse } from "./types";
import { useExportFlow } from "./use-export-flow";

function jobStatusLabel({
  isStopping,
  isJobActive,
  status,
}: {
  isStopping: boolean;
  isJobActive: boolean;
  status: FetchJobStatusResponse["status"];
}) {
  if (isStopping && isJobActive) return "Stopping...";
  if (status === "running" || status === "queued") return "Fetching...";
  if (status === "stopped") return "Stopped";
  if (status === "completed") return "Complete";
  return "Failed";
}

export function TheInput({ search }: { search: HomeSearch }) {
  const {
    activeJob,
    canLoadMore,
    detected,
    displayedResult,
    error,
    handleBackToHome,
    handleCopyMarkdown,
    handleDownload,
    handleLoadMore,
    handleSubmit,
    isActive,
    isJobActive,
    isLoading,
    isStopping,
    jobStatus,
    loadingMore,
    markdownCopied,
    setValue,
    showDownloadBar,
    showMarkdownCopyButton,
    showResultLayout,
    value,
    visibleDownloadActions,
  } = useExportFlow(search);
  const formDisabled = isLoading || isStopping;
  const SubmitIcon = formDisabled ? LoaderCircle : isJobActive ? Square : ArrowRight;

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4 px-6">
      {!isActive && (
        <div className="flex animate-in flex-col items-center gap-2 text-center duration-300 fade-in">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Export Tweets, Unroll Threads & Save Posts from X
          </h1>
          <p className="text-muted-foreground">
            Export tweets, unroll threads, and save X articles — online.
          </p>
        </div>
      )}

      <form
        className={cn(
          "relative flex w-full items-center gap-2 pt-4 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          showResultLayout && "md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
          isActive && "-translate-y-10",
        )}
        onSubmit={handleSubmit}
        role="search"
      >
        {showResultLayout && (
          <Button
            type="button"
            variant="outline"
            className="size-12 shrink-0 p-0"
            aria-label="Back to home"
            title="Back to home"
            disabled={formDisabled}
            onClick={handleBackToHome}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="relative flex-1">
          <label htmlFor="hero-url-input" className="sr-only">
            Twitter/X URL or username
          </label>
          <Input
            id="hero-url-input"
            value={value}
            type="text"
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste any Twitter/X URL or @username..."
            className="h-12 pr-20 pl-4"
            aria-describedby={detected ? "hero-url-type" : undefined}
            autoComplete="off"
            disabled={formDisabled}
          />
          {detected && (
            <Badge
              id="hero-url-type"
              variant="secondary"
              aria-live="polite"
              className="absolute top-1/2 right-4 -translate-y-1/2 rounded-sm border-0 bg-chart-2/20 text-chart-2"
            >
              {detected}
            </Badge>
          )}
        </div>
        <Button
          size="lg"
          className="h-12 px-5 font-bold"
          aria-label={isJobActive ? "Stop" : "Submit"}
          type="submit"
          disabled={formDisabled}
        >
          <SubmitIcon className={cn("size-4", formDisabled && "animate-spin")} />
        </Button>
      </form>

      {activeJob && jobStatus && (
        <div
          aria-live="polite"
          className={cn(
            "flex w-full flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
          )}
        >
          <span className="font-medium capitalize">
            {jobStatusLabel({ isStopping, isJobActive, status: jobStatus.status })}
          </span>
          <span>{jobStatus.pagesFetched} pages</span>
          <span>{jobStatus.storedTweets} tweets</span>
          {jobStatus.chargedCredits > 0 && <span>{jobStatus.chargedCredits} credits</span>}
          {jobStatus.error && (
            <span className="text-destructive">{jobStatus.error.message ?? "Unknown error"}</span>
          )}
          {isJobActive && <LoaderCircle className="size-3.5 animate-spin" />}
        </div>
      )}

      {showDownloadBar && (
        <div
          className={cn(
            "flex w-full animate-in flex-wrap items-center gap-1.5 rounded-md border bg-muted/20 p-1.5 duration-300 fade-in md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
          )}
        >
          <span className="px-2 text-[11px] tracking-wide text-muted-foreground uppercase">
            Download as
          </span>
          {visibleDownloadActions.map((action) => (
            <Button
              key={action.value}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-sm px-2.5 text-xs"
              onClick={() => handleDownload(action.value)}
            >
              <Download className="size-3.5" />
              {action.label}
            </Button>
          ))}
          {showMarkdownCopyButton && (
            <Button
              type="button"
              variant={markdownCopied ? "secondary" : "outline"}
              size="sm"
              className="h-8 rounded-sm px-2.5 text-xs"
              onClick={handleCopyMarkdown}
            >
              {markdownCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              Copy Markdown
            </Button>
          )}
        </div>
      )}

      {!isActive && (
        <div className="flex animate-in flex-wrap items-center justify-center gap-2 duration-300 fade-in">
          <span className="text-xs text-muted-foreground">Try:</span>
          {examples.map((ex) => (
            <Badge
              key={ex.value}
              onClick={() => setValue(ex.value)}
              className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {ex.label}
            </Badge>
          ))}
        </div>
      )}

      {isLoading && !activeJob && <ResultDisplayLoading />}

      {!isLoading && error && !displayedResult && (
        <p className="animate-in pt-2 text-sm text-destructive fade-in">{error}</p>
      )}

      {displayedResult && (
        <ResultDisplay
          result={displayedResult}
          jobStatus={jobStatus ?? undefined}
          onLoadMore={canLoadMore ? handleLoadMore : undefined}
          loadingMore={loadingMore}
        />
      )}

      {!isActive && <ToolCards className="animate-in duration-300 fade-in" />}
    </div>
  );
}
