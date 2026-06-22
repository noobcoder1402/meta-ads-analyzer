# AI Pipeline

Read this before writing/editing any prompt, Zod schema, or provider integration.

The product uses AI in exactly three places: two during onboarding (the company-profile generator and the competitor suggester) and one on the Insights page (the strategic-insights narrative). All run through the provider abstraction and return Zod-validated structured output. Bulk competitive analysis is deterministic (zero AI) — see `docs/analysis.md` (`lib/analysis/`); the strategic-insights task does NOT recompute any number, it only narrates the deterministic metrics. An optional fixed-enum AI pass over creatives may be layered on top later.

---

## Provider abstraction

Only `lib/ai/client.ts` knows whether we're calling Anthropic or Gemini. Everything else imports a typed client that exposes a single Zod-validated `generate` method:

```ts
aiClient.generate<T>({ schema: ZodSchema<T>, prompt: string, images?: ImageInput[] }): Promise<T>
```

The selection is driven by `process.env.MODEL_PROVIDER`:

- `anthropic` (default) — Claude Haiku 4.5 for the onboarding calls (cheap extraction/pattern-matching). Sonnet 4.6 and **Opus 4.1** are also wired up in the client (`ANTHROPIC_MODELS`) for heavier reasoning. The strategic-insights task defaults to **Opus** (highest-quality synthesis), overridable per-install via `INSIGHTS_MODEL=haiku|sonnet|opus` in `.env` (handy if a model id is ever retired). Vision supported natively.
- `gemini` — Gemini Flash for everything (provider stub; generous free tier).

The client's `model` option accepts `"haiku" | "sonnet" | "opus"`. Default is `haiku`.

Calls run at `temperature: 0.2` for reproducibility (see CLAUDE.md gotcha).

Add a new provider by:
1. Adding an env enum value
2. Implementing `generate` in `lib/ai/client.ts` with the same Zod-validated contract
3. Documenting model defaults in this file

Never import `@anthropic-ai/sdk` or a Gemini SDK outside `lib/ai/client.ts`.

## Structured outputs (the most important rule)

Every AI call returns a Zod-validated object. Never parse model text with regex or string operations.

```ts
// GOOD
const result = await aiClient.generate({
  schema: CompanyProfileSchema,
  prompt: buildCompanyProfilePrompt(input),
});
// result is fully typed and validated.

// BAD
const text = await llm.complete("...");
const name = text.match(/Company: (.+)/)?.[1];  // never do this
```

If validation fails: retry once with the validation error appended to the prompt. If it fails again, log and skip — don't crash the flow.

## The AI tasks

All live in `lib/ai/analyzers/` and follow the same shape: gather input → build prompt → call `aiClient.generate` → write result. Tasks 1–2 run during onboarding; task 3 runs on the Insights page when the user clicks "Generate". These are the only paid AI calls in the product.

### 1. Company profile generator (`generate-company-profile.ts`)

Runs during onboarding (and again whenever the user clicks `Re-scrape website`).

- **Input**: raw text from the website scrape (homepage + pricing + about, if available), plus an optional fallback textarea.
- **Schema**: `CompanyProfileSchema` (`company_name`, `what_we_do`, `who_we_serve`, `how_were_different` — markdown strings).
- **Model**: Haiku 4.5 / Flash. One-time extraction + summarization; cheap.
- **Prompt**: `lib/ai/prompts/company-profile.ts`.
- **Output**: serialized to `context/company.md` with markdown headings; a `## Goals` section is appended empty for the user to optionally fill in. Also writes the `status='self'` row into `competitors`.
- **Re-scrape behavior**: re-running produces a fresh draft; the UI shows a diff and preserves manual edits by default. Never silently overwrites.

### 2. Competitor suggester (`suggest-competitors.ts`)

- **Input**: contents of `context/company.md`.
- **Schema**: `CompetitorSuggestionsSchema` (a `suggestions` array of `{ name, why, likely_meta_page_url? }`).
- **Model**: Haiku 4.5 / Flash. Pattern-matching from training data — Sonnet's headroom is wasted here.
- **Prompt**: `lib/ai/prompts/competitor-suggester.ts`.
- **DB**: writes to `competitors` with `status='suggested'`. The user's own company (`status='self'`) is never returned.
- **Trigger**: the onboarding flow and the "Suggest competitors" action. User-confirmed (Accept/Reject) before a suggestion becomes tracked.

### 3. Strategic insights narrative (`generate-insights.ts`)

The one AI task that **interprets** the analysis. It reads the already-computed deterministic metrics and writes a strategic narrative for the `self` brand — the kind of read a senior growth marketer would give. It never sees raw ads and never recomputes a number.

- **Input**: the deterministic `CrossAnalysisBundle` from `lib/analysis/load.ts` (per-brand metrics + cross-competitor head-to-head + self-gap), flattened to a text summary by `buildInsightsPrompt` in `lib/ai/prompts/strategic-insights.ts`. No images → cheap despite Opus.
- **Schema**: `StrategicInsightsSchema` (`headline`, `howToReadLongevity`, `insights[]` with `{title, category, narrative, evidence[], recommendation, confidence}`, `caveats[]`). The `category` enum includes `longevity` (how to read run length) — there is no `winners` category.
- **Model**: **Opus** by default (`INSIGHTS_MODEL` overrides). High-quality synthesis is the whole point.
- **Prompt**: `lib/ai/prompts/strategic-insights.ts`. The static prompt encodes the hard rules: critical-thinker persona, **never claim spend/reach/impressions/market-share** (Meta exposes none), label interpretation vs fact, and **lead with the longevity caveat** — a long run (90+ days live) is NOT proof of quality and is biased against high-velocity brands that deliberately churn creatives, so a low long-running count can understate them rather than mean "worse ads". (No "winner/flop" framing — that was removed from the whole product 2026-06-22.)
- **Caching (cost guardrail)**: unlike the deterministic analysis, this costs money, so it must NOT recompute on page load. The result is cached in the `ai_insight_reports` table (latest row wins). The Insights page reads the cached narrative for free and shows a "numbers changed — regenerate?" nudge when the live data's `fingerprintBundle` no longer matches the stored `dataFingerprint`. It never auto-regenerates.
- **Trigger**: the "Generate / Regenerate" button on the Insights page → `POST /api/insights/generate` (demo-guarded 403). There is **no `tsx` CLI** for this — the analysis chain statically imports `eld/large`, which fails under `tsx` (see CLAUDE.md gotcha); Next.js/vitest resolve it fine, so generation lives in the app.
- **Demo mode**: the button is hidden; the empty-state panel says generation is disabled. (Ship a pre-generated row in the demo seed to show a narrative there.)

## Conversion goal taxonomy (fixed enum — CTA-DERIVED, never model-inferred)

```
free-trial | demo-request | direct-purchase | waitlist | app-install |
lead-capture | content-download | awareness | other
```

- **Source of the value**: mapped deterministically from the ad's Meta CTA in `lib/ads/cta-to-goal.ts` — the model does NOT produce it. The map is the single source of truth (the real dataset is dominated by "Sign Up" → `free-trial` and "Learn More" → `awareness`). Unknown / missing CTAs fall to `other`, never to `awareness`.
- **Where it's written**: stored on `ad_analyses.primary_conversion_goal`. To re-derive goals for existing rows after changing the map, run `pnpm backfill:goals` (pure, zero AI).
- **Internal-only**: the goal is not shown to users — the UI displays the raw Meta CTA label ("Sign Up", "Learn More") instead. It's a clean, free, deterministic signal for aggregation.

Definitions:
- `free-trial` — "Sign Up", "Get Started". Self-serve product access.
- `demo-request` — "Book Now", "Get Quote", "Contact Us". Sales-assisted.
- `direct-purchase` — "Shop Now", "Buy Now", "Get Offer". E-commerce / one-click.
- `waitlist` — pre-launch capture.
- `app-install` — "Install Now", "Use App", "Get App".
- `lead-capture` — "Subscribe". Email/contact in exchange for content.
- `content-download` — "Download". Gated asset (ebook, template, whitepaper).
- `awareness` — "Learn More", "View Instagram Profile", "Watch More". Generic brand / site-visit CTAs with no conversion ask.
- `other` — genuine residue: an unmapped or absent CTA.

Defined as `ConversionGoalEnum` in `lib/ai/schemas.ts` and the `ad_analyses` column enum in `lib/db/schema.ts` — keep both in sync with the map. To re-derive goals for existing rows after changing the map, run `pnpm backfill:goals`.

## Prompt patterns

- **Always provide the schema in the prompt** in addition to the validation layer. Models behave better when they see the expected shape.
- **One-shot examples beat instructions** for classification tasks. If the model misclassifies, add a specific example rather than more rules.
- **Keep prompts in dedicated `.ts` files**, not inline. Export as `buildXPrompt(input)` so it's testable.
- **Version prompts in git, not in code**. A/B in a branch.

## Cost reference (Anthropic, May 2026)

- Haiku 4.5: $1/$5 per M input/output tokens
- Sonnet 4.6: $3/$15 per M input/output tokens
- Opus 4.1: $15/$75 per M input/output tokens
- One competitor suggestion run: ~$0.002 (Haiku, onboarding only)
- One profile generation: ~$0.001 (Haiku, onboarding only)
- One strategic-insights run: ~$0.05–0.15 (Opus, text-only; on-click only, then cached). Drops ~5× on Sonnet via `INSIGHTS_MODEL=sonnet`.

Gemini Flash equivalent: free within free-tier limits.

## Cost guardrails

1. **AI is user-triggered only** — never auto-run paid work on scrape or schedule. (The deterministic `lib/analysis` recomputes on read because it's free math; AI does not.)
2. **Structured outputs + one retry** — schema-validation failures retry exactly once, then skip. No retry loops.
3. **Prompt caching for any high-volume call** — the static-vs-variable token split is a 40-60% saving on batched runs; treat it as baseline, not an optimization.
4. **Batch caps with explicit cost estimates** — never let a single click trigger an unbounded paid run; show the user the estimate first.

## When you (Claude) edit a prompt

1. Run it against the fixture data in `data/demo-snapshot.json` first.
2. Check that schema validation still passes.
3. Spot-check 3 outputs manually for quality drift.
4. Don't change the schema and prompt in the same commit — change schema first, run migrations, then iterate.
