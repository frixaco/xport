import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  MessagesSquare,
  Square,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { HomeSearch } from "./search";
import { examples } from "./input";
import { estimateCostCredits, formatCount, formatCreditLabel } from "./display";
import { ResultDisplay, ResultDisplayLoading } from "./result-display";
import type { FetchJobStatusResponse } from "./types";
import { useExportFlow } from "./use-export-flow";
import type { ResultExportFormat } from "./copy-formats";

function jobStatusLabel({
  isJobActive,
  isStopRequested,
  status,
}: {
  isJobActive: boolean;
  isStopRequested: boolean;
  status: FetchJobStatusResponse["status"];
}) {
  if (isStopRequested && isJobActive) return "Stopping...";
  if (status === "running" || status === "queued") return "Fetching...";
  if (status === "stopped") return "Stopped";
  if (status === "completed") return "Complete";
  return "Failed";
}

const capabilities = [
  { title: "Unroll threads", icon: MessagesSquare },
  { title: "Export profiles", icon: Download },
  { title: "Save articles", icon: FileText },
] as const;

interface ExportActionsProps {
  actions: Array<{ value: ResultExportFormat; label: string }>;
  disabled: boolean;
  markdownCopied: boolean;
  showCopyAction: boolean;
  onCopyMarkdown: () => void;
  onDownload: (format: ResultExportFormat) => void;
}

function ExportActions({
  actions,
  disabled,
  markdownCopied,
  showCopyAction,
  onCopyMarkdown,
  onDownload,
}: ExportActionsProps) {
  const primaryAction = actions[0] ?? null;
  const showDownloadMenu = actions.length > 1;

  return (
    <>
      {primaryAction &&
        (showDownloadMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 pr-2 pl-2.5"
                  aria-label="Download export"
                  disabled={disabled}
                />
              }
            >
              <Download className="size-4" />
              Download
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-44">
              {actions.map((action) => (
                <DropdownMenuItem key={action.value} onClick={() => onDownload(action.value)}>
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5"
            disabled={disabled}
            onClick={() => onDownload(primaryAction.value)}
          >
            <Download className="size-4" />
            Download
          </Button>
        ))}
      {showCopyAction && (
        <Button
          type="button"
          variant={markdownCopied ? "secondary" : "outline"}
          size="sm"
          className="h-8 px-2.5"
          disabled={disabled}
          onClick={onCopyMarkdown}
        >
          {markdownCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {markdownCopied ? "Copied" : "Copy"}
        </Button>
      )}
    </>
  );
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
    isResultContentLoading,
    isStopRequested,
    jobStatus,
    loadingMore,
    markdownCopied,
    setValue,
    showExportActions,
    showCopyAction,
    showResultLayout,
    value,
    visibleDownloadActions,
  } = useExportFlow(search);
  const formDisabled = isLoading || isStopRequested;
  const submitButtonBusy = isLoading || isJobActive || isStopRequested;
  const SubmitIcon =
    isLoading || isStopRequested ? LoaderCircle : isJobActive ? Square : ArrowRight;
  const submitLabel = isStopRequested
    ? "Stopping fetch"
    : isJobActive
      ? "Stop fetching"
      : isLoading
        ? "Fetching"
        : "Submit";
  const exportActionsDisabled = isLoading || isJobActive || isStopRequested;
  const showJobStatusRow =
    Boolean(activeJob) || (showResultLayout && (isLoading || showExportActions || Boolean(error)));
  const resultIsArticle = displayedResult?.kind === "article";
  const jobStatusText = resultIsArticle
    ? "Fetched article"
    : jobStatus
      ? jobStatusLabel({ isJobActive, isStopRequested, status: jobStatus.status })
      : "Starting...";
  const resultCreditLabel = displayedResult
    ? `${formatCreditLabel(estimateCostCredits(displayedResult))}${
        displayedResult.usage?.charged ? " charged" : ""
      }`
    : null;
  const showResultLoading = (isLoading && !activeJob) || Boolean(activeJob && !displayedResult);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-3 px-6">
      {!isActive && (
        <div className="flex animate-in flex-col items-center gap-1.5 text-center duration-300 fade-in">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
            Export X (ex-Twitter) posts
          </h1>
          <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {capabilities.map(({ icon: Icon, title }) => (
              <span key={title} className="inline-flex items-center gap-1.5">
                <Icon className="size-3 text-chart-2 sm:size-3.5" />
                <span className="font-medium text-foreground/90">{title}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <form
        className={cn(
          "relative flex w-full items-center gap-2 pt-3 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          showResultLayout && "md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
          isActive && "-translate-y-10",
        )}
        onSubmit={handleSubmit}
      >
        {showResultLayout ? (
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
        ) : (
          <div className="hidden size-12 shrink-0 sm:block" aria-hidden="true" />
        )}
        <div className="relative flex-1">
          <label htmlFor="hero-url-input" className="sr-only">
            X (ex-Twitter) URL or username
          </label>
          <Input
            id="hero-url-input"
            value={value}
            type="text"
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste any X (ex-Twitter) URL or @username..."
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
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-sm border-0 bg-chart-2/10 px-1.5 py-0 text-[10px] font-medium text-chart-2"
            >
              {detected}
            </Badge>
          )}
        </div>
        <Button
          size="lg"
          className={cn(
            "h-12 px-5 font-bold",
            submitButtonBusy &&
              !isStopRequested &&
              "border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25 disabled:opacity-100",
            isStopRequested &&
              "border-amber-500/40 bg-amber-500/15 text-amber-600 hover:bg-amber-500/20 disabled:opacity-100 dark:text-amber-400",
          )}
          aria-label={submitLabel}
          title={isJobActive || isStopRequested ? submitLabel : undefined}
          type="submit"
          disabled={formDisabled}
        >
          <SubmitIcon className={cn("size-4", (isLoading || isStopRequested) && "animate-spin")} />
        </Button>
      </form>

      {showJobStatusRow && (
        <div
          aria-live="polite"
          className={cn(
            "flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
          )}
        >
          <span className="font-medium capitalize">{jobStatusText}</span>
          {resultIsArticle ? (
            <>
              <span>{formatCount(displayedResult.sections.length, "section")}</span>
              {resultCreditLabel && <span>{resultCreditLabel}</span>}
            </>
          ) : (
            <>
              <span>{jobStatus?.pagesFetched ?? 0} pages</span>
              <span>{jobStatus?.storedTweets ?? 0} tweets</span>
              {Boolean(jobStatus?.chargedCredits) && (
                <span>{formatCreditLabel(jobStatus?.chargedCredits ?? 0)}</span>
              )}
            </>
          )}
          {jobStatus?.error && (
            <span className="text-destructive">{jobStatus.error.message ?? "Unknown error"}</span>
          )}
          {isJobActive && <LoaderCircle className="size-3.5 animate-spin" />}
          <div className="ml-auto flex items-center gap-2">
            <ExportActions
              actions={visibleDownloadActions}
              disabled={exportActionsDisabled}
              markdownCopied={markdownCopied}
              showCopyAction={showCopyAction}
              onCopyMarkdown={handleCopyMarkdown}
              onDownload={handleDownload}
            />
          </div>
        </div>
      )}

      {!isActive && (
        <div className="flex animate-in flex-wrap items-center justify-center gap-2 duration-300 fade-in">
          <span className="text-xs text-muted-foreground">Try:</span>
          {examples.map((ex) => (
            <button
              type="button"
              key={ex.value}
              onClick={() => setValue(ex.value)}
              className="min-h-8 rounded-sm bg-secondary px-2.5 text-xs text-muted-foreground transition-[background-color,color,transform] hover:bg-accent hover:text-foreground active:scale-[0.96]"
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}

      {showResultLoading && <ResultDisplayLoading />}

      {!isLoading && error && !displayedResult && (
        <p className="animate-in pt-2 text-sm text-destructive fade-in">{error}</p>
      )}

      {displayedResult && (
        <ResultDisplay
          result={displayedResult}
          jobStatus={jobStatus ?? undefined}
          isFetching={isResultContentLoading}
          onLoadMore={canLoadMore ? handleLoadMore : undefined}
          loadingMore={loadingMore}
        />
      )}
    </div>
  );
}
