# AI Pipeline

Read this before writing/editing any prompt, Zod schema, or provider integration.

## Provider abstraction

Only `lib/ai/client.ts` knows whether we're calling Anthropic or Gemini. Everything else imports a typed `aiClient` that exposes:

```ts
aiClient.generate<T>({ schema: ZodSchema<T>, prompt: string, images?: ImageInput[] }): Promise<T>
```

The selection is driven by `process.env.MODEL_PROVIDER`:

- `anthropic` (default) — Claude Sonnet 4.6 for synthesis/recommendations, Claude Haiku 4.5 for per-ad analysis. Vision supported natively.
- `gemini` — Gemini 2.5 Flash for everything. Vision supported. Generous free tier — this is the default for the README quickstart.

Add a new provider by:
1. Adding an env enum value
2. Implementing `generate` in `lib/ai/client.ts` with the same Zod-validated contract
3. Documenting model defaults in this file

Never import `@anthropic-ai/sdk` or `@google/generative-ai` outside `lib/ai/client.ts`.

## Structured outputs (the most important rule)

Every AI call returns a Zod-validated object. Never parse model text with regex or string operations.

```ts
// GOOD
const result = await aiClient.generate({
  schema: CreativeAnalysisSchema,
  prompt: buildAnalyzerPrompt(ad),
  images: [{ url: ad.media_paths[0] }],
});
// result is fully typed and validated.

// BAD
const text = await llm.complete("...");
const angle = text.match(/Angle: (.+)/)?.[1];  // never do this
```

If validation fails: retry once with the validation error appended to the prompt. If it fails again, log to `data/analysis-errors/` and skip that ad. Don't crash the pipeline.

## The four AI tasks

Each lives in `lib/ai/analyzers/` and follows the same shape: load DB row → build prompt → call `aiClient.generate` → write result to DB.

### 1. Competitor suggester (`suggest-competitors.ts`)

- **Input**: contents of `context/company.md` (the auto-generated, user-edited company profile from onboarding)
- **Schema**: `CompetitorSuggestionsSchema` (10 items, each `{ name, why, likely_meta_page_url? }`)
- **Model**: Haiku 4.5 (Anthropic) / Flash (Gemini). Pattern-matching from training data — Sonnet's reasoning headroom is wasted here.
- **Prompt** lives in `lib/ai/prompts/competitor-suggester.ts`
- **DB**: writes to `competitors` with status=`suggested`. The user's own company is never returned (it's already in the table with status=`self`).

### 2. Creative analyzer (`analyze-creative.ts`)

- **Input**: ad row + first image (videos: first-frame screenshot)
- **Schema**: `CreativeAnalysisSchema` (matches the `ad_analyses` columns)
- **Model**: Haiku 4.5 (Anthropic) / Flash (Gemini) — vision
- **Prompt** lives in `lib/ai/prompts/creative-analyzer.ts`
- **DB**: writes to `ad_analyses`. Every row carries `analyzer_version` — an 8-char SHA-1 hash of the static prompt block + the JSON-serialized `CreativeAnalysisSchema`, computed once at module load:

```ts
// lib/ai/analyzers/analyze-creative.ts
import { createHash } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CREATIVE_ANALYZER_PROMPT_STATIC } from '../prompts/creative-analyzer';
import { CreativeAnalysisSchema } from '../schemas';

export const ANALYZER_VERSION = createHash('sha1')
  .update(CREATIVE_ANALYZER_PROMPT_STATIC)
  .update(JSON.stringify(zodToJsonSchema(CreativeAnalysisSchema)))
  .digest('hex')
  .slice(0, 8);
```

No manual bumping. Edit the static prompt or the schema, the hash changes on next module load, the dashboard sees the drift, and the user gets a re-analyze banner. The analyzer skips ads whose existing `analyzer_version` matches the current hash; mismatches are queued for re-analysis (see Re-analyze policy below). `zod-to-json-schema` is used because Zod's internal shape doesn't serialize stably across versions.
- **Cost note**: this runs N times per scrape. Keep the prompt tight.
- **Prompt caching (required, not optional)**: the prompt has a large static portion (instructions + angle taxonomy + conversion-goal taxonomy + brand-voice taxonomy + examples + schema) and a small variable portion (the ad's caption + image). Use Anthropic's prompt caching on the static portion. This cuts analyzer input costs by 40-60% on batched runs and is what makes scraping 50 ads at a time economically sane. Implementation note: cache the system prompt + static instruction block; only the per-ad message varies.

**Re-analyze policy**: the `analyzer_version` hash updates automatically whenever the static prompt or `CreativeAnalysisSchema` changes. On next dashboard load, the home grid runs a count query (`SELECT count(*) FROM ad_analyses WHERE analyzer_version != ?` with the current hash) and, if non-zero, surfaces a banner: "Analyzer updated. 487 ads have outdated analyses (~$1.95 to re-analyze). [Re-analyze all]". The user clicks; the work runs in the background; per-ad `analyzer_version` updates as each row completes. Never auto-re-analyze without confirmation — surprise bills break trust.

**Concrete output example** (one call, structured + validated):

```ts
{
  hook: "Stop juggling 12 different tools",
  angle: "comparison",                              // primary, from fixed enum
  angle_secondary: "problem-agitation",             // optional, from same enum
  visual_summary: "Split-screen: chaotic desk with 
                   sticky notes vs clean ClickUp 
                   dashboard. Logo bottom-right.",
  dominant_colors: ["#7C3AED", "#FFFFFF", "#1F2937"],
  text_density: "med",                              // low | med | high
  subject: "product",                               // face | product | lifestyle | text-only | mixed
  themes: ["tool fatigue", "consolidation", "ROI"],
  pain_points: ["context switching", "wasted time", "subscription costs"],
  benefits: ["one platform", "saves hours", "lower TCO"],
  target_persona: "Operations leads at 50-500 person companies",
  emotional_tone: "frustrated-then-relieved",
  brand_voice: "professional"                       // fixed enum, see taxonomies below
}
```

**`primary_conversion_goal` is NOT a model output** (changed 2026-06-03). It is derived deterministically from the ad's Meta CTA via `lib/ads/cta-to-goal.ts`, written into the `ad_analyses` row at analyze time. The old approach asked the vision model to infer the goal from caption + CTA, which produced noise: an advertiser using the generic "Learn More" button on every ad (e.g. ClickUp) had identical ads scattered across lead-capture / demo-request / free-trial / other based on caption vibes alone. The button the advertiser actually chose is the ground truth for intent, so we map it directly — zero AI cost, fully reproducible, no hallucinated distinctions. The enum still defines the allowed values + the column type. See the taxonomy section below.

`brand_voice` is the analyzer's read of the overall tonal register from caption + visuals combined. Like angle, it's a constrained enum to make cross-ad and cross-competitor aggregation possible.

The prompt does multiple jobs in one call (classification + extraction + persona inference) for cost efficiency. ~$0.004 per ad on Haiku.

### 3. Competitor synthesizer (`synthesize-competitor.ts`)

> **As-built (2026-05-30):** shipped with a **hybrid split** that improves on the literal spec below. The frequency-count fields (`dominant_angles`, `dominant_conversion_goal`, `dominant_brand_voice`) and `always_on_winners` are computed **deterministically in code** from the analyzed-ad columns — counting enums is exactly what an LLM gets subtly wrong, and we already have the data. So `CompetitorSynthesisSchema` (in `lib/ai/schemas.ts`) covers ONLY the reasoning fields the model actually produces: `top_hooks`, `recent_pivots`, `active_experiments[]`, `abandoned_patterns[]`. The written DB row is identical to what's described below. Also: the API route is plain **JSON, not SSE** (single call), and the UI is the "Find patterns" / "Regenerate" card (`synthesis-panel.tsx`), not the per-bucket layout in `docs/dashboard.md`.

- **Input**: **all** `ad_analyses` rows for one competitor — no default cap. The vision cost was paid at the analyzer step; this step is text-only and cheap (see Cost reference). Capping by score would systematically hide newly scraped ads (low `days_active` → low longevity → low total score) and abandoned ads — both of which are signal, not noise.

  ```sql
  SELECT a.*, s.score, ads.days_active, ads.is_active, ads.last_seen_at,
         ads.variant_count, ads.first_seen_at
  FROM ad_analyses a
  JOIN ads ON ads.id = a.ad_id
  LEFT JOIN performance_scores s ON s.ad_id = a.ad_id
  WHERE ads.competitor_id = ?
  ORDER BY s.score DESC NULLS LAST,    -- ordering is for prompt presentation only
           ads.days_active DESC,
           ads.last_seen_at DESC
  ```

  No `LIMIT`. The prompt template groups the rows into labeled buckets before passing them to the model (see Stratified prompt structure below).

- **Stratified prompt structure**. The prompt presents ads to the model in four labeled buckets — **Proven winners**, **Active experiments**, **Abandoned**, **Other** — using the predicates in `lib/scoring/buckets.ts`. Bucket definitions and priority resolution live in `docs/scoring.md`. The model sees the bucket labels and uses them to populate the corresponding output fields (see Schema and Key job below). Categorization is a prompt-shaping device — it doesn't change the DB schema, and an ad's bucket is recomputed each synthesis run from current DB state.

- **Schema**: `CompetitorSynthesisSchema` (matches the `competitor_syntheses` columns)
- **Model**: Sonnet 4.6 / Flash. This is the reasoning layer; don't downgrade.
- **Prompt** lives in `lib/ai/prompts/synthesizer.ts`
- **DB**: writes to `competitor_syntheses`. The table includes `dominant_angles`, `top_hooks`, `always_on_winners`, `recent_pivots`, plus `dominant_conversion_goal`, `dominant_ctas`, and `dominant_brand_voice` (all stored with frequency counts, e.g., `{ "free-trial": 12, "demo-request": 3 }`). Two further fields capture the stratified-prompt outputs:
  - `active_experiments` — JSON array of `{ angle, hook_pattern, ad_count, first_seen }` for the active-experiments bucket. The "what they're testing right now" signal.
  - `abandoned_patterns` — JSON array of `{ angle, hook_pattern, ad_count, last_seen, typical_days_active }` for the abandoned/churned bucket. The "what they tried and walked away from" signal.

- **Additional deterministic roll-ups (added 2026-06-03, computed in code — NOT the model's job).** Like the frequency counts, these are pure aggregates over the analyzed-ad columns; the Sonnet call is unchanged (zero added tokens). They populate only on a re-synthesis (no backfill), but need no re-scrape/re-analyze.
  - `dominant_ctas` — frequency count of the raw `ads.cta_label` ("Sign Up", "Learn More", "Book Now", …), e.g. `{ "Sign Up": 18, "Learn More": 9 }`. **This is the user-facing "selling motion"** (added 2026-06-04). The dashboard's "Selling motion" fact, the synthesis takeaway, and the Insights scoreboard's "Top CTA" column all read this — the *raw button the advertiser chose*, not our derived goal taxonomy. `dominant_conversion_goal` (below) is still computed and stored but is now **internal-only — no longer surfaced anywhere in the UI** (kept for potential future use).
  - `creative_languages` — `{ languageCount, detectedFrom, undetected, languages: [{ code, label, flag, count, share, minor }] }`. A **localization-depth** read: how many languages the brand writes copy in. Detected by `lib/lang/detect-languages.ts` (**tinyld**, a short-text detector) over each ad's **`caption` (fallback `title`) — NEVER the CTA** (`cta_text` is localized to the *viewer*, the documented Kannada-CTA trap). **Switched from franc-min → tinyld (2026-06-03):** franc-min could not separate short Spanish from short Portuguese (sister languages within its margin gate), so it sent nearly every Spanish/Portuguese caption to "undetected" and erased a competitor's LATAM expansion (real bake-off: franc 3/7 on ES+PT, tinyld 7/7). An **English-prior tie-break** is retained: when a non-English winner beats English by less than `ENGLISH_PRIOR_MARGIN` (0.02) and English is top-3, trust English — recovers terse English fragments tinyld over-calls as Romanian/Estonian. tinyld returns ISO 639-1, mapped to ISO 639-3 (`ISO1_TO_3`) so the stored `code` shape is unchanged. Still **under-claims** rather than invent a language. `minor` flags incidental languages (1 ad or <5% of detected). **Language ≠ country** — this measures "how deeply they localize," not "where they run." (The old per-ad market `market_footprint` roll-up was removed — see the note below.)
  - `media_mix` — `{ image, video, carousel, total }` counts (from `ads.media_type`). Production-investment signal + a strong recommender format-gap driver ("they're 60% video, you're 100% static").
  - `top_pain_points` / `top_benefits` — `[{ value, count }]` (desc, top 8) flattened from the per-ad `pain_points[]`/`benefits[]` the analyzer already extracts — "what they hammer."
  - `launch_velocity` — `{ last14, last30 }`: new **LIVE** ads that *started running* in the last 14/30 days, computed as `isActive && daysActive <= N`. Uses Meta's `start_date` (encoded in `daysActive` for live ads), **NOT `firstSeenAt`** — `firstSeenAt` is when *our tool* first scraped the ad, so it reads "all new" on a brand's first scrape. Paused ads are excluded (their `daysActive` is total run length, which says nothing about recent launch activity).
  - `market_footprint` — **RETIRED legacy column (always null).** It once rolled up each ad's `countries[]` into a per-competitor market footprint, but the whole per-country/footprint feature was removed (Meta exposes essentially no reliable per-ad geography — see `docs/scraping.md`). The column is left in the schema (always null) to avoid a destructive SQLite migration, exactly like `variant_count` / `variant_pts`. Nothing reads or writes it.
- **Trigger**: user-clicked only. Never run automatically on scrape or schedule. The dashboard may surface "Synthesis is 5 days old — regenerate?" but the click is the user's.
- **Key job**: identify dominant angles, top-performing hooks, always-on winners (definition in `docs/scoring.md`), recent strategic pivots, dominant CTAs / selling motion, dominant brand voice, active-experiment patterns from the live bucket, and abandoned patterns from the churned bucket. The last two answer "what is the competitor trying now?" and "what didn't work for them?"

### 4. Recommendations engine (`generate-recommendations.ts`)

- **Input**:
  - All `competitor_syntheses` for competitors with status=`accepted` or `manual`.
  - The user's own synthesis (the `competitor_syntheses` row for the `self` competitor) **if they have analyzed ads**. This is the strongest comparison signal — it captures what the user actually runs, not what they say they run.
  - `context/company.md` (positioning, ICP, optional goals). Used as the primary input when the user has no Meta ads yet; otherwise used as a supplement for positioning context the ads alone don't reveal.
- **Schema**: `RecommendationsSchema` (5-10 items with title, rationale, evidence_ad_ids, priority)
- **Model**: Sonnet 4.6 / Flash. Highest-leverage output in the product — pay for quality.
- **Prompt** lives in `lib/ai/prompts/recommender.ts`
- **DB**: writes to `recommendations`. Each row carries `stable_hash` (SHA-1 of `title + sorted(evidence_ad_ids)`), `created_at`, `actioned_at` (nullable, DB-persisted not localStorage), `archived_at` (nullable).
- **Trigger**: user-clicked only. Never run automatically.
- **Key job**: cross-competitor pattern detection AND gap analysis vs the user's actual ads (or positioning, if no ads). The recommender looks for gaps along **four** dimensions: **angle** (story types competitors are winning with that the user isn't telling), **selling motion (CTA buttons)** (e.g., everyone runs "Sign Up" / free-trial CTAs and the user only runs "Book Now" demo asks), **brand voice** (e.g., playful-voice ads outlasting formal ones in this category), and **always-on patterns** (winners running across multiple competitors — definition in `docs/scoring.md`). Every recommendation must cite specific ad IDs as evidence.
- **Selling-motion dimension**: the recommender reads each synthesis's `dominant_ctas` (the raw Meta CTA tally) and reasons in terms of the actual buttons competitors run vs. the user's — *not* the internal conversion-goal taxonomy. (The old fifth dimension, **geographic / market expansion** off `market_footprint`, was removed along with the footprint feature — see `docs/scraping.md`. Don't reintroduce a geographic rec; the per-ad geo data it relied on isn't reliable.)

**Re-run deduplication**: when the recommender produces a new set of recs, the dedup layer runs before writing:

1. For each generated rec, compute `stable_hash`.
2. If the hash matches an existing non-archived row → preserve the existing row's `created_at` and `actioned_at`. Just bump its `last_generated_at` so the UI can show "still relevant" vs "stale."
3. If the hash is new → insert with `created_at = now()` and flag as "New" in the UI for a week.
4. If an existing non-archived row's hash is NOT in the new set → set `archived_at = now()` (soft-archive). User can still see it under an "Archive" tab on the Insights page.

This means re-running the recommender never silently destroys the user's `actioned` toggles, never duplicates suggestions they've already seen, and always shows what's genuinely new.

**Comparison logic — which signal takes precedence**:

| User state | Comparison basis |
|---|---|
| Has analyzed Meta ads | User synthesis (real ads) + profile as positioning supplement |
| Has profile only (no ads) | Profile only — recommendations are about market patterns the user could enter |
| Empty profile + no ads | Surface a UI warning before generating; output will be generic |

**Concrete output example** (one item from the array):

```ts
{
  title: "Test founder-story video angle",
  priority: "high",
  rationale: "3 of 5 tracked competitors run founder-voice 
              video ads (Monday CEO walkthrough, Notion founder 
              explainer, Asana founder origin story). Average 
              longevity on these is 94 days — proven winners. 
              Your own ads synthesis shows zero founder content — 
              you're entirely product-demo and comparison. Worth 
              testing 1-2 variants with your founder explaining 
              the problem you solve.",
  evidence_ad_ids: ["monday-7384", "notion-2901", "asana-1156"]
}
```

The `evidence_ad_ids` link the recommendation to the actual ads in the swipe file so users can see the reference creative inline. This grounds the AI output in observable data instead of pure assertion.

### 5. Company profile generator (`generate-company-profile.ts`)

Runs once during onboarding (and again whenever the user clicks `Re-scrape website`).

- **Input**: raw text from website scrape (homepage + pricing + about, if available), plus optional fallback textarea text
- **Schema**: `CompanyProfileSchema` (sections: `what_we_do`, `who_we_serve`, `how_were_different` — each markdown strings)
- **Model**: Haiku 4.5 / Flash. Extraction + summarization from scraped HTML text — cheap one-time call per user.
- **Prompt** lives in `lib/ai/prompts/company-profile.ts`
- **Output**: serialized to `context/company.md` with markdown headings. The `## Goals` section is appended empty for the user to optionally fill in.
- **DB**: also writes a row into `competitors` with status=`self` (one-time, during onboarding) so the user's company is treated as a tracked entity from then on.
- **Re-scrape behavior**: when re-run, the generator produces a fresh draft. The UI shows a diff against the saved file; manual edits are preserved by default. Never silently overwrites.



```
problem-agitation | social-proof | founder-story | fomo-scarcity |
comparison | ugc-style | product-demo | before-after | authority |
curiosity-hook | offer-led | educational | aspirational | ai-powered
```

Defined as a Zod enum in `lib/ai/schemas.ts`. **14 angles** as of 2026-06-04.

Most of these are *persuasion mechanics* (how the ad convinces you). One sits a bit apart as a *product-claim* angle, but lives in the same enum:

- **`ai-powered`** — AI/automation IS the headline selling point ("AI writes it for you", "let AI do the work"). Pick only when AI is the central claim, not when it's merely mentioned in passing.

Adding `ai-powered` bumped `ANALYZER_VERSION` (the auto-hash over the static prompt + schema), which surfaces the Re-analyze banner on existing rows as designed (see Re-analyze policy under task #2).

**Why a fixed enum, not free text**: the synthesis layer's whole job is detecting patterns like "all 3 competitors run comparison ads." If the model could output "comparison" for one ad and "vs-competitor" or "side-by-side" for another, the pattern detection would miss the connection. A constrained vocabulary is what makes cross-competitor synthesis possible. Sacrificing some classification nuance for grouping power is the right trade.

If you genuinely need a new category, add it to:
1. The Zod enum in `lib/ai/schemas.ts`
2. The analyzer prompt's classification instructions (with definition + example)
3. The UI badge color map in `components/angle-pill.tsx`
4. This doc

## Conversion goal taxonomy (fixed enum — CTA-DERIVED, not model-inferred)

```
free-trial | demo-request | direct-purchase | waitlist | app-install |
lead-capture | content-download | awareness | other
```

**Source of the value (changed 2026-06-03):** the goal is mapped deterministically from the ad's Meta CTA in `lib/ads/cta-to-goal.ts` — the model does NOT produce it. The map is the single source of truth (current dataset is dominated by just two CTAs: "Sign Up" → `free-trial`, "Learn More" → `awareness`). Unknown / missing CTAs fall to `other` — never to `awareness` (an unmapped CTA must never silently inflate awareness).

**Internal-only now (changed 2026-06-04):** `primary_conversion_goal` (and the synthesizer's `dominant_conversion_goal` roll-up) are still computed and stored, but **no longer shown to users** anywhere. The UI's "selling motion" — the dashboard fact, the synthesis takeaway, the Insights scoreboard's "Top CTA" column, and the recommender's reasoning — now displays the **raw Meta CTA labels** ("Sign Up", "Learn More") via the synthesizer's `dominant_ctas` roll-up instead of this derived taxonomy. The goal mapping is kept for potential future use; if you stop maintaining the map, nothing user-facing breaks.

Definitions:
- `free-trial` — "Sign Up", "Get Started". Self-serve product access.
- `demo-request` — "Book Now", "Get Quote", "Contact Us". Sales-assisted.
- `direct-purchase` — "Shop Now", "Buy Now", "Get Offer". E-commerce / one-click.
- `waitlist` — pre-launch capture (no CTA maps here in the current data).
- `app-install` — "Install Now", "Use App", "Get App".
- `lead-capture` — "Subscribe". Email/contact in exchange for content.
- `content-download` — "Download". Gated asset (ebook, template, whitepaper).
- `awareness` — "Learn More", "View Instagram Profile", "Watch More". Generic brand / site-visit CTAs with no conversion ask. (Added 2026-06-03 — previously these had no home and polluted `lead-capture`/`other`.)
- `other` — genuine residue: an unmapped or absent CTA.

Defined as a Zod enum in `lib/ai/schemas.ts` (and the `ad_analyses` column enum in `lib/db/schema.ts` — keep both in sync with the map). To re-derive goals for existing rows after changing the map, run `pnpm backfill:goals` (pure, zero AI; also refreshes the stored `dominant_conversion_goal` counts on synthesis rows).

## Brand voice taxonomy (fixed enum)

```
formal | professional | playful | technical | bold | warm
```

Definitions:
- `formal` — corporate, restrained, third-person. Common in enterprise/finance/legal.
- `professional` — direct, confident, second-person. The default B2B SaaS register.
- `playful` — humor, irreverence, internet-native phrasing. Wit > polish.
- `technical` — jargon-comfortable, spec-heavy, developer-oriented. Assumes domain literacy.
- `bold` — declarative, confrontational, strong claims. Common in challenger-brand positioning.
- `warm` — human-centered, empathetic, often personal-story-led. Common in consumer wellness, education.

Six is the deliberate ceiling — finer distinctions don't aggregate well across ads.

## Prompt patterns

- **Always provide the schema in the prompt** in addition to the validation layer. Models behave better when they see the expected shape.
- **One-shot examples beat instructions** for classification tasks. If the model is misclassifying, add a specific example to the prompt rather than adding more rules.
- **Keep prompts in dedicated `.ts` files**, not inline. Export as a function `buildXPrompt(input)` so it's testable.
- **Version prompts in git, not in code**. If you need to A/B prompts, do it in a branch.

## Cost reference (Anthropic, May 2026)

- Haiku 4.5: $1/$5 per M input/output tokens
- Sonnet 4.6: $3/$15 per M input/output tokens
- One ad analysis: ~$0.004 (Haiku, vision included; ~$0.002 with prompt caching on batches)
- One synthesis: ~$0.03 per 50 ads of input on Sonnet — scales roughly linearly. Typical competitor (20-80 analyzed ads) runs $0.02-$0.05; large competitor (200 ads) ~$0.12. No cap; even very large cases stay under $0.50.
- One recommendations run: ~$0.06 (Sonnet)
- One competitor suggestion run: ~$0.002 (Haiku, onboarding only)
- One profile generation: ~$0.001 (Haiku, onboarding only)
- Full demo seed (5 competitors × ~20 ads): ~$0.80 with caching

Gemini Flash equivalent: free within free tier limits (15 req/min, 1M tokens/day). Most demo seeds will fit.

## Cost guardrails (required, prevent runaway spend on repeat runs)

These are the rules that keep cost predictable as users re-scrape over time. None are optional.

1. **Analyzer batch cap**: never analyze more than `SCRAPE_MAX_ADS_PER_RUN` (default 50) in a single scrape→analyze chain. If a competitor's queue is larger, the user clicks `Analyze {N} ads` again for the next batch. Prevents a single click from triggering a $5+ run by surprise.

2. **Synthesis input — no cap**: synthesizer ingests all analyzed ads for a competitor. Vision cost is sunk at the analyzer step; this step runs ~$0.03 per 50 ads of text input. Even very large competitors (rare in practice) cost under $0.50 per synthesis — well within the user-triggered cost guardrail (#4) and not worth the extra mechanism of stratified sampling. See task #3.

3. **Re-analyze confirmation with cost estimate**: when `analyzer_version` is bumped (prompt or schema change), the dashboard shows a confirmation banner: "Analyzer updated. 487 ads have outdated analyses (~$1.95 to re-analyze). [Re-analyze all]". Never auto-runs. The estimate is `outdated_count × $0.002` (cached) or `× $0.004` (uncached) — be honest about which.

4. **Synthesis and recommendations are user-triggered only**: never auto-run on scrape, never on a schedule. This is the single biggest cost guardrail — it caps the aggregation layers to the user's deliberate intent.

5. **Prompt caching required for analyzer**: see task #2. Not an optimization, a baseline.

6. **No retry loops in the pipeline**: schema validation failures retry exactly once (per the structured outputs rule earlier in this doc). Failed-twice ads are skipped, not retried forever. Logged to `data/analysis-errors/`.

## When you (Claude) edit a prompt

1. Run it against the fixture ads in `data/demo-snapshot.json` first
2. Check that schema validation still passes
3. Spot-check 3 outputs manually for quality drift
4. Don't change the schema and prompt in the same commit — change schema first, run migrations, then iterate on the prompt

## Honest limitations (state these in the README, don't hide them)

These are real and should be acknowledged anywhere the project is described publicly:

1. **The score is correlated with performance, not measured.** A 90-day-old ad could be a great performer OR a forgotten one nobody paused. The variant-count signal is the strongest defense (nobody iterates on a forgotten ad), but the limitation stands. See `docs/scoring.md` for the full reasoning.

2. **Angle classification accuracy is roughly 80% on spot-checks.** Some ads genuinely fit multiple angles; the model picks one primary and one secondary. Practitioners will sometimes disagree with classifications. The value is in patterns across many ads, not individual labels.

3. **Recommendations quality depends on profile quality and whether the user runs Meta ads.** The auto-generated profile from a website scrape covers the basics, but a thin one-page site produces a thin profile and generic recommendations. If the user has their own Meta ads connected, recommendations get sharper because the system can compare their actual creative output against competitors. Users with neither rich website content nor running ads should expect generic market-pattern output, not personalized advice. The UI should nudge users to flesh out their profile when it's thin.

4. **No ground-truth calibration.** Scoring weights are based on practitioner heuristics, not empirical validation against actual ad performance data. Claim this honestly; don't oversell.

5. **Vision models only see one image per ad.** We analyze the first frame of videos and the first slide of carousels. Video hook strength depends on the first 3 seconds of motion, which we don't capture. Carousel narrative arcs — slide 1 establishes the problem, slide 5 reveals the product — are invisible to the analyzer; we see only the cover. A future enhancement could extract 3-5 video frames and pass all carousel slides as a sequence. Until then, ads where the story unfolds across the format are systematically under-analyzed.
