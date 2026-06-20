"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Candidate = {
  pageId: string;
  pageName: string;
  adCount: number;
  verified: boolean;
  profilePictureUrl: string | null;
  canonicalUrl: string;
};

type Props = {
  competitorId: string;
  competitorName: string;
  /** Render-prop for the trigger so the parent can use any button style. */
  trigger: React.ReactNode;
};

/**
 * Two-step dialog: paste → verify (Playwright round-trip, slow) → confirm save.
 * The verify step is the safety net — we never save a page_id without first proving
 * it resolves to a real page on Meta's side, so we can show the user the discovered
 * name + ad count before commit.
 */
export function SetMetaPageDialog({ competitorId, competitorName, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setInput("");
    setCandidate(null);
    setError(null);
    setVerifying(false);
    setSaving(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function verify() {
    setVerifying(true);
    setError(null);
    setCandidate(null);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/meta-page/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Verify failed (HTTP ${res.status}).`);
        setVerifying(false);
        return;
      }
      setCandidate(data.candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed unexpectedly.");
    }
    setVerifying(false);
  }

  async function save() {
    if (!candidate) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/meta-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: candidate.pageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (HTTP ${res.status}).`);
        setSaving(false);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed unexpectedly.");
      setSaving(false);
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Meta page for {competitorName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!candidate && (
              <>
                <p className="text-sm text-muted-foreground">
                  Open <a className="underline" href="https://www.facebook.com/ads/library/" target="_blank" rel="noopener noreferrer">Meta&apos;s Ad Library</a>, search for the brand, click into their page, and paste the URL from your address bar here. You can also paste just the numeric page ID.
                </p>
                <div>
                  <label className="text-sm font-medium">Ad Library URL or page ID</label>
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="https://www.facebook.com/ads/library/?view_all_page_id=…"
                    className="mt-1"
                    disabled={verifying}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && input.trim() && !verifying) verify();
                    }}
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                {verifying && (
                  <p className="text-xs text-muted-foreground">
                    Checking with Meta… this takes 10-30 seconds (we open a real browser to look up the page).
                  </p>
                )}
              </>
            )}

            {candidate && (
              <>
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 flex items-start gap-3">
                  {candidate.profilePictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={candidate.profilePictureUrl}
                      alt=""
                      className="w-10 h-10 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center font-semibold shrink-0">
                      {candidate.pageName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{candidate.pageName}</p>
                      {candidate.verified && (
                        <span className="text-xs text-blue-400" title="Meta-verified page">✓ verified</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Page ID <span className="font-mono">{candidate.pageId}</span>
                      {candidate.adCount > 0 && ` · ${candidate.adCount} ad${candidate.adCount === 1 ? "" : "s"} visible`}
                    </p>
                    <a
                      href={candidate.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline mt-1 inline-block"
                    >
                      Open in Ad Library →
                    </a>
                  </div>
                </div>
                {candidate.pageName.toLowerCase() !== competitorName.toLowerCase() && (
                  <p className="text-xs text-yellow-400">
                    Heads up: the page name &ldquo;{candidate.pageName}&rdquo; doesn&apos;t exactly match &ldquo;{competitorName}&rdquo;. Double-check it&apos;s the right brand.
                  </p>
                )}
                {error && <p className="text-sm text-red-500">{error}</p>}
              </>
            )}
          </div>

          <DialogFooter>
            {!candidate && (
              <>
                <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={verifying}>
                  Cancel
                </Button>
                <Button onClick={verify} disabled={verifying || input.trim().length < 4}>
                  {verifying ? "Verifying…" : "Verify"}
                </Button>
              </>
            )}
            {candidate && (
              <>
                <Button variant="ghost" onClick={() => setCandidate(null)} disabled={saving}>
                  ← Try another
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Confirm and save"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
