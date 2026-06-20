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

export function AddCompetitorDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [metaPageUrl, setMetaPageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        metaPageUrl: metaPageUrl.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to add competitor.");
      return;
    }
    setName("");
    setMetaPageUrl("");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        + Add competitor
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a competitor manually</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">Company name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Notion"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Meta Ad Library URL (optional)</label>
            <Input
              value={metaPageUrl}
              onChange={(e) => setMetaPageUrl(e.target.value)}
              placeholder="https://www.facebook.com/ads/library/?…"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              You can add this later from the competitor&apos;s card.
            </p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || !name.trim()}>
              {submitting ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
