"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type AnalyzeEvent =
  | { type: "log"; message: string }
  | { type: "progress"; completed: number; total: number }
  | {
      type: "analyzed-ad";
      adId: string;
      libraryId: string;
      hook: string;
      angle: string;
    }
  | {
      type: "failed-ad";
      adId: string;
      libraryId: string;
      error: string;
    }
  | {
      type: "done";
      result: {
        status: "success" | "partial" | "failed";
        total: number;
        analyzed: number;
        failed: number;
        skipped: number;
        analyzerVersion: string;
      };
    }
  | { type: "error"; message: string };

type Props = {
  competitorId: string;
  competitorName: string;
  /** How many ads currently need analysis (no row, stale version, or failed). */
  pendingCount: number;
  trigger: React.ReactNode;
};

/**
 * UI for the "Analyze N ads" button. Same two-phase shape as ScrapeAdsDialog:
 *   1. Pre-flight — pick batch size (default = min(pendingCount, 25)).
 *   2. Live — SSE log showing each ad as it's analyzed, then a summary.
 *
 * Closing the dialog mid-run only stops the client stream; the server-side
 * worker pool keeps going and writes its rows. Same trade-off as the scraper.
 */
export function AnalyzeAdsDialog({
  competitorId,
  competitorName,
  pendingCount,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Default batch size: 10 if pending <= 10, else 25, capped at 50.
  const defaultBatch = Math.min(50, Math.max(1, Math.min(pendingCount, 25)));
  const [maxAds, setMaxAds] = useState(defaultBatch);

  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<AnalyzeEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  function reset() {
    setPhase("idle");
    setProgress({ completed: 0, total: 0 });
    setLogs([]);
    setResult(null);
    setError(null);
    setMaxAds(defaultBatch);
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function handleOpenChange(next: boolean) {
    if (!next && phase === "running") return; // can't close mid-run except via Cancel
    setOpen(next);
    if (!next) reset();
  }

  async function start() {
    setPhase("running");
    setLogs([]);
    setProgress({ completed: 0, total: 0 });
    setResult(null);
    setError(null);

    const ctl = new AbortController();
    abortRef.current = ctl;

    let res: Response;
    try {
      res = await fetch(`/api/competitors/${competitorId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAds }),
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to start analyzer.");
      setPhase("error");
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      setError(`Failed to start analyzer: ${text || res.statusText}`);
      setPhase("error");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith("data: ")) continue;
          let evt: AnalyzeEvent;
          try {
            evt = JSON.parse(raw.slice(6));
          } catch {
            continue;
          }
          handleEvent(evt);
        }
      }
    } catch (e) {
      if (!ctl.signal.aborted) {
        setError(e instanceof Error ? e.message : "Stream interrupted.");
        setPhase("error");
      }
    }
  }

  function handleEvent(e: AnalyzeEvent) {
    if (e.type === "log") {
      setLogs((l) => [...l, e.message]);
    } else if (e.type === "progress") {
      setProgress({ completed: e.completed, total: e.total });
    } else if (e.type === "analyzed-ad") {
      const truncated = e.hook.length > 80 ? `${e.hook.slice(0, 80)}…` : e.hook;
      setLogs((l) => [
        ...l,
        `✓ ${e.libraryId} — [${e.angle}] ${truncated}`,
      ]);
    } else if (e.type === "failed-ad") {
      setLogs((l) => [
        ...l,
        `✗ ${e.libraryId} — ${e.error.slice(0, 200)}`,
      ]);
    } else if (e.type === "done") {
      setResult(e);
      setPhase(e.result.status === "failed" ? "error" : "done");
      router.refresh();
    } else if (e.type === "error") {
      setError(e.message);
      setPhase("error");
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    // Like the scraper: aborting the fetch doesn't kill server-side work;
    // it'll finish its in-flight ads and write rows. We just stop watching.
    setError("Cancelled — server may still finish the current batch in the background.");
    setPhase("error");
  }

  // Estimate cost — rough numbers from docs/ai-pipeline.md.
  // Cached ~$0.002/ad, uncached ~$0.004/ad. We show cached price since prompt
  // caching is required and warm within a single run.
  const estimatedCost = (maxAds * 0.002).toFixed(2);

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Analyze ads — {competitorName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {phase === "idle" && (
              <>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll send each ad&apos;s image + caption to an AI vision model and save a structured analysis (hook, angle, themes, conversion goal, brand voice) into your database. Cached prompts keep cost low — roughly $0.002 per ad.
                </p>
                <div>
                  <label className="text-sm font-medium">
                    How many to analyze this run?
                  </label>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[10, 25, 50].map((n) => {
                      const disabled = n > pendingCount && pendingCount > 0;
                      return (
                        <button
                          key={n}
                          type="button"
                          disabled={disabled}
                          onClick={() => setMaxAds(Math.min(n, pendingCount))}
                          className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                            maxAds === Math.min(n, pendingCount)
                              ? "border-foreground bg-foreground/10"
                              : "border-input hover:bg-muted"
                          } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pendingCount} ad{pendingCount === 1 ? "" : "s"} pending · Estimated cost ~${estimatedCost}
                  </p>
                </div>
              </>
            )}

            {(phase === "running" || phase === "done" || phase === "error") && (
              <>
                <div className="rounded-md border border-input bg-muted/30 p-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className={phase === "running" ? "animate-pulse" : ""}>
                      {phase === "running" && "⋯"}
                      {phase === "done" &&
                        result?.type === "done" &&
                        result.result.status === "success" &&
                        "✓"}
                      {(phase === "error" ||
                        (result?.type === "done" &&
                          result.result.status !== "success")) &&
                        "✗"}
                    </span>
                    <span className="font-medium">
                      {phase === "running" && "Analyzing in progress…"}
                      {phase === "done" && "Analysis complete"}
                      {phase === "error" && "Analyzer failed"}
                    </span>
                    {phase === "running" && progress.total > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {progress.completed} / {progress.total}
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-input bg-background h-48 overflow-y-auto p-2 font-mono text-xs">
                  {logs.length === 0 ? (
                    <p className="text-muted-foreground p-1">Warming up…</p>
                  ) : (
                    logs.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap py-0.5">
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>

                {result?.type === "done" && (
                  <div className="rounded-md border border-input bg-muted/30 p-3 text-sm space-y-1">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">Status</span>
                      <span>{result.result.status}</span>
                      <span className="text-muted-foreground">Analyzed</span>
                      <span className="text-green-400">
                        {result.result.analyzed}
                      </span>
                      <span className="text-muted-foreground">Failed</span>
                      <span
                        className={
                          result.result.failed > 0 ? "text-red-400" : ""
                        }
                      >
                        {result.result.failed}
                      </span>
                      <span className="text-muted-foreground">
                        Skipped (no image)
                      </span>
                      <span>{result.result.skipped}</span>
                      <span className="text-muted-foreground">
                        Analyzer version
                      </span>
                      <span className="font-mono text-xs">
                        {result.result.analyzerVersion}
                      </span>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-500 whitespace-pre-wrap">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            {phase === "idle" && (
              <>
                <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={start} disabled={pendingCount === 0}>
                  Analyze {maxAds} ad{maxAds === 1 ? "" : "s"}
                </Button>
              </>
            )}
            {phase === "running" && (
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
            {(phase === "done" || phase === "error") && (
              <Button onClick={() => handleOpenChange(false)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
