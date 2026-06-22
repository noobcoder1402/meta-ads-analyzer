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
import { COUNTRY_OPTIONS } from "@/lib/markets";

type ScrapeEvent =
  | { type: "log"; message: string }
  | { type: "navigate"; url: string; country: string; maxAds: number }
  | { type: "progress"; matchingAds: number; totalObserved: number }
  | { type: "saved-ad"; libraryId: string; mediaType: string; captionPreview: string; isNew: boolean }
  | {
      type: "done";
      result: {
        status: "success" | "partial" | "failed";
        totalObserved: number;
        matchedBrand: number;
        saved: number;
        adsNew: number;
        adsUnchanged: number;
        adsWentInactive: number;
        errorMessage: string | null;
        runId: string;
      };
    }
  | { type: "error"; message: string };

type Props = {
  competitorId: string;
  competitorName: string;
  trigger: React.ReactNode;
  /** Pre-selects the "Specific country" dropdown. Defaults to US. */
  defaultCountry?: string;
};

/** The market modes the scrape can run in. */
type MarketMode = "single" | "all";

/** Which slice of the library to pull (mirrors ScrapeMode in the scraper). */
type ScrapeMode = "active" | "active_plus_sample" | "active_plus_all";

/**
 * UI for the "Scrape ads" button. Two phases:
 *   1. Pre-flight — pick max ads (25/50/100) + market mode, click Start.
 *   2. Live — SSE log scroll showing each saved ad, then a final summary.
 *
 * Market modes (COUNTRY_OPTIONS comes from lib/markets, a pure module that's safe
 * to import into the browser bundle):
 *   - all:    Meta's global "ALL" view (fast). Total volume + authoritative
 *             live/paused status. The DEFAULT.
 *   - single: one country library (fast). For investigating a specific market.
 *
 * The stream is the API's POST /api/competitors/[id]/scrape. We close it the
 * moment we see `type: done` or `type: error`.
 */
export function ScrapeAdsDialog({
  competitorId,
  competitorName,
  trigger,
  defaultCountry,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>("active_plus_sample");
  const [mode, setMode] = useState<MarketMode>("all");
  const [country, setCountry] = useState((defaultCountry ?? "US").toUpperCase());
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ matching: number; observed: number }>({
    matching: 0,
    observed: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<ScrapeEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  function reset() {
    setPhase("idle");
    setProgress({ matching: 0, observed: 0 });
    setLogs([]);
    setResult(null);
    setError(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function handleOpenChange(next: boolean) {
    // While running, ignore close attempts — the user can cancel via the Cancel button.
    if (!next && phase === "running") return;
    setOpen(next);
    if (!next) reset();
  }

  async function start() {
    setPhase("running");
    setLogs([]);
    setProgress({ matching: 0, observed: 0 });
    setResult(null);
    setError(null);

    const ctl = new AbortController();
    abortRef.current = ctl;

    let res: Response;
    try {
      res = await fetch(`/api/competitors/${competitorId}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: scrapeMode,
          // ALL (default) = Meta's global view; otherwise a single country.
          ...(mode === "all" ? { country: "ALL" } : { country }),
        }),
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to start scrape.");
      setPhase("error");
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      setError(`Failed to start scrape: ${text || res.statusText}`);
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
          let evt: ScrapeEvent;
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

  function handleEvent(e: ScrapeEvent) {
    if (e.type === "log") {
      setLogs((l) => [...l, e.message]);
    } else if (e.type === "navigate") {
      setLogs((l) => [...l, `Opening Meta Ad Library (country: ${e.country})…`]);
    } else if (e.type === "progress") {
      setProgress({ matching: e.matchingAds, observed: e.totalObserved });
    } else if (e.type === "saved-ad") {
      if (e.isNew) {
        setLogs((l) => [
          ...l,
          `+ ${e.libraryId} (${e.mediaType})${e.captionPreview ? ` — ${e.captionPreview}` : ""}`,
        ]);
      }
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
    // Note: aborting the fetch doesn't kill the server-side Playwright session;
    // the scrape will complete server-side and write its scrape_runs row. We just
    // stop watching the stream.
    setError("Cancelled — server may still be finishing in the background.");
    setPhase("error");
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scrape ads — {competitorName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {phase === "idle" && (
              <>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll open Meta&apos;s Ad Library for this brand in a
                  headless browser, scroll through their ads, and save each one
                  to your local database. Takes 30 seconds to a few minutes
                  depending on how many ads you pull.
                </p>
                <div>
                  <label className="text-sm font-medium">Which ads to pull?</label>
                  <div className="mt-2 space-y-2">
                    <MarketModeOption
                      active={scrapeMode === "active"}
                      onClick={() => setScrapeMode("active")}
                      title="All active ads"
                      description="Every ad the brand is running right now. Uncapped. Fastest — ignores paused ads."
                    />
                    <MarketModeOption
                      active={scrapeMode === "active_plus_sample"}
                      onClick={() => setScrapeMode("active_plus_sample")}
                      title="All active + sample of paused (recommended)"
                      description="Every active ad, plus up to 200 paused ads as a sample of what they've retired. Balanced."
                    />
                    <MarketModeOption
                      active={scrapeMode === "active_plus_all"}
                      onClick={() => setScrapeMode("active_plus_all")}
                      title="All active + all paused"
                      description="Every ad ever, live and paused. Most complete — can take several minutes for big brands."
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Which market?</label>
                  <div className="mt-2 space-y-2">
                    <MarketModeOption
                      active={mode === "all"}
                      onClick={() => setMode("all")}
                      title="All countries (recommended)"
                      description="Meta's global view. Fast, widest volume, and the most accurate live/paused status."
                    />

                    <MarketModeOption
                      active={mode === "single"}
                      onClick={() => setMode("single")}
                      title="Specific country"
                      description="Pull one country's Ad Library — for investigating a single market."
                    >
                      {mode === "single" && (
                        <select
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {COUNTRY_OPTIONS.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name} ({c.code})
                            </option>
                          ))}
                        </select>
                      )}
                    </MarketModeOption>
                  </div>
                </div>
              </>
            )}

            {(phase === "running" || phase === "done" || phase === "error") && (
              <>
                <div className="rounded-md border border-input bg-muted/30 p-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className={phase === "running" ? "animate-pulse" : ""}>
                      {phase === "running" && "⋯"}
                      {phase === "done" && result?.type === "done" && result.result.status === "success" && "✓"}
                      {(phase === "error" ||
                        (result?.type === "done" && result.result.status !== "success")) && "✗"}
                    </span>
                    <span className="font-medium">
                      {phase === "running" && "Scraping in progress…"}
                      {phase === "done" && "Scrape complete"}
                      {phase === "error" && "Scrape failed"}
                    </span>
                    {phase === "running" && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {progress.matching} matching · {progress.observed} total observed
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-input bg-background h-48 overflow-y-auto p-2 font-mono text-xs">
                  {logs.length === 0 ? (
                    <p className="text-muted-foreground p-1">Waiting for first batch…</p>
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
                      <span className="text-muted-foreground">Saved</span>
                      <span>{result.result.saved}</span>
                      <span className="text-muted-foreground">New this run</span>
                      <span className="text-green-400">{result.result.adsNew}</span>
                      <span className="text-muted-foreground">Unchanged</span>
                      <span>{result.result.adsUnchanged}</span>
                      <span className="text-muted-foreground">Went inactive</span>
                      <span>{result.result.adsWentInactive}</span>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-500 whitespace-pre-wrap">{error}</p>
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
                <Button onClick={start}>Start scrape</Button>
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

function MarketModeOption({
  active,
  onClick,
  title,
  description,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-md border text-sm transition-colors flex items-start gap-3 ${
        active ? "border-foreground bg-foreground/10" : "border-input hover:bg-muted"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          active ? "border-foreground" : "border-input"
        }`}
      >
        {active && <span className="h-2 w-2 rounded-full bg-foreground" />}
      </span>
      <span className="flex-1">
        <span className="font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{description}</span>
        {children}
      </span>
    </button>
  );
}
