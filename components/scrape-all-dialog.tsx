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

/** One brand the bulk scrape will run against (must already have a verified Meta page). */
export type ScrapeTarget = { id: string; name: string };

/** Which slice of the library to pull (mirrors ScrapeMode in the scraper). */
type ScrapeMode = "active" | "active_plus_sample" | "active_plus_all";
/** Market modes the scrape can run in. */
type MarketMode = "single" | "all";

/** Per-brand outcome once its scrape finishes (or fails). */
type BrandResult = {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "partial" | "failed";
  saved?: number;
  adsNew?: number;
  error?: string;
};

/**
 * "Scrape all" — runs the same single-competitor scrape endpoint for EVERY tracked brand
 * that has a verified Meta page (including the user's own `self` brand), one after another.
 *
 * Sequential on purpose: each scrape drives a headless browser (Playwright), so running
 * them in parallel would fight for resources. We stream each brand's SSE, surface a compact
 * per-brand status list + overall "i of N" progress, and never abort the whole batch if one
 * brand fails — it's recorded and we move on. Cancel stops the batch after the current brand.
 */
export function ScrapeAllDialog({ targets }: { targets: ScrapeTarget[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>("active_plus_sample");
  const [mode, setMode] = useState<MarketMode>("all");
  const [country, setCountry] = useState("US");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [results, setResults] = useState<BrandResult[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [progress, setProgress] = useState<{ matching: number; observed: number }>({
    matching: 0,
    observed: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  function reset() {
    setPhase("idle");
    setResults([]);
    setCurrentIdx(0);
    setProgress({ matching: 0, observed: 0 });
    cancelledRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function handleOpenChange(next: boolean) {
    if (!next && phase === "running") return; // can't close mid-run; use Cancel
    setOpen(next);
    if (!next) reset();
  }

  /** Stream one brand's scrape; resolve with its final BrandResult. */
  async function scrapeOne(target: ScrapeTarget): Promise<BrandResult> {
    const ctl = new AbortController();
    abortRef.current = ctl;
    const body = JSON.stringify({
      mode: scrapeMode,
      ...(mode === "all" ? { country: "ALL" } : { country }),
    });

    let res: Response;
    try {
      res = await fetch(`/api/competitors/${target.id}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) return { ...target, status: "failed", error: "Cancelled" };
      return { ...target, status: "failed", error: e instanceof Error ? e.message : "Failed to start" };
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { ...target, status: "failed", error: text || res.statusText };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let outcome: BrandResult = { ...target, status: "failed", error: "No result" };

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
          let evt: { type: string; [k: string]: unknown };
          try {
            evt = JSON.parse(raw.slice(6));
          } catch {
            continue;
          }
          if (evt.type === "progress") {
            setProgress({
              matching: (evt.matchingAds as number) ?? 0,
              observed: (evt.totalObserved as number) ?? 0,
            });
          } else if (evt.type === "done") {
            const r = evt.result as {
              status: "success" | "partial" | "failed";
              saved: number;
              adsNew: number;
              errorMessage: string | null;
            };
            outcome = {
              ...target,
              status: r.status,
              saved: r.saved,
              adsNew: r.adsNew,
              error: r.errorMessage ?? undefined,
            };
          } else if (evt.type === "error") {
            outcome = { ...target, status: "failed", error: (evt.message as string) ?? "Error" };
          }
        }
      }
    } catch (e) {
      if (ctl.signal.aborted) return { ...target, status: "failed", error: "Cancelled" };
      return { ...target, status: "failed", error: e instanceof Error ? e.message : "Stream error" };
    }
    return outcome;
  }

  async function start() {
    cancelledRef.current = false;
    setPhase("running");
    setResults(targets.map((t) => ({ ...t, status: "pending" })));

    for (let i = 0; i < targets.length; i++) {
      if (cancelledRef.current) break;
      setCurrentIdx(i);
      setProgress({ matching: 0, observed: 0 });
      setResults((rs) => rs.map((r, j) => (j === i ? { ...r, status: "running" } : r)));
      const outcome = await scrapeOne(targets[i]);
      setResults((rs) => rs.map((r, j) => (j === i ? outcome : r)));
    }

    setPhase("done");
    router.refresh();
  }

  function cancel() {
    cancelledRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  const doneCount = results.filter((r) => r.status !== "pending" && r.status !== "running").length;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Scrape all
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scrape all brands ({targets.length})</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {phase === "idle" && (
              <>
                <p className="text-sm text-muted-foreground">
                  We&apos;ll scrape every brand that has a verified Meta page — including
                  your own company — one after another. Brands without a verified page are
                  skipped. This can take several minutes.
                </p>

                <div>
                  <label className="text-sm font-medium">Which ads to pull?</label>
                  <div className="mt-2 space-y-2">
                    <RadioOption
                      active={scrapeMode === "active"}
                      onClick={() => setScrapeMode("active")}
                      title="All active ads"
                      description="Every ad each brand is running right now. Uncapped. Fastest — ignores paused ads."
                    />
                    <RadioOption
                      active={scrapeMode === "active_plus_sample"}
                      onClick={() => setScrapeMode("active_plus_sample")}
                      title="All active + sample of paused (recommended)"
                      description="Every active ad, plus up to 200 paused ads each as a sample. Balanced."
                    />
                    <RadioOption
                      active={scrapeMode === "active_plus_all"}
                      onClick={() => setScrapeMode("active_plus_all")}
                      title="All active + all paused"
                      description="Every ad ever, live and paused. Most complete — slowest."
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Which market?</label>
                  <div className="mt-2 space-y-2">
                    <RadioOption
                      active={mode === "all"}
                      onClick={() => setMode("all")}
                      title="All countries (recommended)"
                      description="Meta's global view. Fast, widest volume, most accurate live/paused status."
                    />
                    <RadioOption
                      active={mode === "single"}
                      onClick={() => setMode("single")}
                      title="Specific country"
                      description="Pull one country's Ad Library for every brand."
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
                    </RadioOption>
                  </div>
                </div>
              </>
            )}

            {(phase === "running" || phase === "done") && (
              <>
                <div className="rounded-md border border-input bg-muted/30 p-3 text-sm flex items-center gap-3">
                  <span className={phase === "running" ? "animate-pulse" : ""}>
                    {phase === "running" ? "⋯" : "✓"}
                  </span>
                  <span className="font-medium">
                    {phase === "running"
                      ? `Scraping ${currentIdx + 1} of ${targets.length}…`
                      : `Done — scraped ${doneCount} of ${targets.length}`}
                  </span>
                  {phase === "running" && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {progress.matching} matching · {progress.observed} observed
                    </span>
                  )}
                </div>

                <div className="rounded-md border border-input bg-background max-h-64 overflow-y-auto divide-y divide-border">
                  {results.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-4 shrink-0 text-center">
                        {r.status === "pending" && <span className="text-muted-foreground">·</span>}
                        {r.status === "running" && <span className="animate-pulse">⋯</span>}
                        {r.status === "success" && <span className="text-green-400">✓</span>}
                        {r.status === "partial" && <span className="text-yellow-400">⚠</span>}
                        {r.status === "failed" && <span className="text-red-500">✗</span>}
                      </span>
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.status === "success" || r.status === "partial"
                          ? `${r.saved ?? 0} saved · ${r.adsNew ?? 0} new`
                          : r.status === "failed"
                            ? "failed"
                            : r.status === "running"
                              ? "scraping…"
                              : "waiting"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            {phase === "idle" && (
              <>
                <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={start} disabled={targets.length === 0}>
                  Start scraping {targets.length} brand{targets.length === 1 ? "" : "s"}
                </Button>
              </>
            )}
            {phase === "running" && (
              <Button variant="ghost" onClick={cancel}>
                Cancel after this brand
              </Button>
            )}
            {phase === "done" && <Button onClick={() => handleOpenChange(false)}>Close</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RadioOption({
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
