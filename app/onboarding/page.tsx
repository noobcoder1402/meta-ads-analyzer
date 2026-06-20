"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProfileShape = {
  company_name: string;
  what_we_do: string;
  who_we_serve: string;
  how_were_different: string;
};

type StepKey = "input" | "fallback" | "progress" | "confirm";

type ProgressEvent =
  | { type: "step"; step: "scrape" | "profile"; status: "running" | "done" | "error"; message: string }
  | { type: "result"; profile: ProfileShape; websiteUrl: string; metaPageUrl?: string; scrapeText?: string }
  | { type: "error"; message: string }
  | { type: "needs_fallback"; message: string };

const COUNTRIES = [
  { code: "ALL", label: "All countries" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "IN", label: "India" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>("input");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [metaPageUrl, setMetaPageUrl] = useState("");
  const [fallbackText, setFallbackText] = useState("");
  const [progress, setProgress] = useState<{
    scrape: "pending" | "running" | "done" | "error";
    profile: "pending" | "running" | "done" | "error";
    messages: Array<{ step: string; message: string; status: string }>;
  }>({ scrape: "pending", profile: "pending", messages: [] });
  const [profile, setProfile] = useState<ProfileShape | null>(null);
  const [country, setCountry] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function start(useFallback = false) {
    setError(null);
    setProgress({ scrape: "pending", profile: "pending", messages: [] });
    setStep("progress");

    const res = await fetch("/api/onboarding/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        websiteUrl,
        metaPageUrl: metaPageUrl || undefined,
        fallbackText: useFallback ? fallbackText : undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      setError(`Failed to start onboarding: ${text || res.statusText}`);
      setStep("input");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!raw.startsWith("data: ")) continue;
        let event: ProgressEvent;
        try {
          event = JSON.parse(raw.slice(6));
        } catch {
          continue;
        }
        handleEvent(event);
      }
    }
  }

  function handleEvent(event: ProgressEvent) {
    if (event.type === "step") {
      setProgress((p) => ({
        ...p,
        [event.step]: event.status,
        messages: [...p.messages, { step: event.step, message: event.message, status: event.status }],
      }));
    } else if (event.type === "needs_fallback") {
      setError(event.message);
      setStep("fallback");
    } else if (event.type === "result") {
      setProfile(event.profile);
      setStep("confirm");
    } else if (event.type === "error") {
      setError(event.message);
      setStep("input");
    }
  }

  async function confirm() {
    if (!profile) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/onboarding/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        websiteUrl,
        metaPageUrl: metaPageUrl || null,
        country,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      setError(`Failed to save profile: ${text || res.statusText}`);
      return;
    }
    router.push("/competitors");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      {step === "input" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Welcome — let&apos;s set up your workspace</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              We&apos;ll scrape your site, generate a profile of your company, and use it to find competitors and surface insights.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">What is your company name or website URL?</label>
              <Input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="acme.com or https://acme.com"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Meta Ad Library page URL (optional)</label>
              <Input
                value={metaPageUrl}
                onChange={(e) => setMetaPageUrl(e.target.value)}
                placeholder="https://www.facebook.com/ads/library/?view_all_page_id=…"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Don&apos;t have one handy? Leave blank — you can add it later from your company card.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end">
              <Button
                onClick={() => start(false)}
                disabled={!websiteUrl.trim()}
              >
                Continue →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "fallback" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">We couldn&apos;t fetch your site</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              {error ?? "Tell us about your company in a few sentences and we&apos;ll generate the profile from that."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              placeholder="Acme is a tool for X that helps Y do Z. We&apos;re different from competitors because…"
              rows={6}
            />
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("input")}>
                ← Back
              </Button>
              <Button
                onClick={() => start(true)}
                disabled={fallbackText.trim().length < 30}
              >
                Continue →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "progress" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Setting things up…</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressStrip
              steps={[
                { key: "scrape", label: "Scraping your website…", status: progress.scrape },
                { key: "profile", label: "Generating profile…", status: progress.profile },
              ]}
            />
            <div className="mt-6 space-y-1 text-xs text-muted-foreground">
              {progress.messages.map((m, i) => (
                <p key={i}>
                  <span className="opacity-50">[{m.step}]</span> {m.message}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === "confirm" && profile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Here&apos;s what we understood about your company</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              Edit anything before continuing. You can also refine this later from your company card.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProfileField
              label="Company name"
              value={profile.company_name}
              onChange={(v) => setProfile({ ...profile, company_name: v })}
              singleLine
            />
            <ProfileField
              label="What we do"
              value={profile.what_we_do}
              onChange={(v) => setProfile({ ...profile, what_we_do: v })}
            />
            <ProfileField
              label="Who we serve"
              value={profile.who_we_serve}
              onChange={(v) => setProfile({ ...profile, who_we_serve: v })}
            />
            <ProfileField
              label="How we're different"
              value={profile.how_were_different}
              onChange={(v) => setProfile({ ...profile, how_were_different: v })}
            />
            <div>
              <label className="text-sm font-medium">Which country&apos;s ads should we analyze?</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Meta&apos;s Ad Library is country-scoped. You can change this later per scrape.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("input")}>
                ← Start over
              </Button>
              <Button onClick={confirm} disabled={submitting}>
                {submitting ? "Saving…" : "Looks good — continue →"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProgressStrip({
  steps,
}: {
  steps: Array<{ key: string; label: string; status: "pending" | "running" | "done" | "error" }>;
}) {
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.key} className="flex items-center gap-3 text-sm">
          <span className="w-5 inline-flex items-center justify-center">
            {s.status === "done" && <span className="text-green-500">✓</span>}
            {s.status === "running" && <span className="animate-pulse">⋯</span>}
            {s.status === "error" && <span className="text-red-500">✗</span>}
            {s.status === "pending" && <span className="opacity-30">○</span>}
          </span>
          <span className={s.status === "pending" ? "text-muted-foreground" : ""}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  singleLine,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  singleLine?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      {singleLine ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
      ) : (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="mt-1" />
      )}
    </div>
  );
}
