# Changelog

A running history of changes to the project. Newest entries at the top.

Format per entry:
- **Date** — short title
  - What changed
  - Why

---

## Status

_Concise current-state summary. Full history is in the dated entries below._

### What's Built
- **Scraping** (`lib/scraper/`, `pnpm scrape` + the dashboard "Scrape ads" button): pulls a brand's ads from the Meta Ad Library via GraphQL-JSON intercept. Three scrape modes (active / active+sample-of-paused / active+all-paused) via the ordering-safe `scrapeCompetitorByMode` orchestrator. Defaults to the global `ALL` view (authoritative live/paused). Snapshot model — trusts Meta's `is_active`, never infers "paused" from absence. Creative **images are not downloaded** (only the media-type label + Meta's still-image URL are stored).
- **Deterministic Insights** (`lib/analysis/` → `app/insights/page.tsx`): zero-AI, recomputed on read. Side-by-side cross-brand comparison with a sticky All / Active / Inactive segment filter — longevity run-length tiers (neutral, not a quality score), creative mix, CTA mix (raw Meta labels), **phrase mining (3–5 word phrases) + an explicit "Mentions AI" count**, placements, landing domains, languages, distinct-creatives de-confound via Meta `collation_id`, advertiser context, launch velocity, plus head-to-head + self-gap. One fenced external-data block ("Company scale & regional reach", cited public figures). Neutral throughout — no winner/flop framing (Meta exposes no spend/reach/results). Raw-data CSV export.
- **AI (user-triggered + cached only)**: onboarding (company profile from website scrape + competitor suggestions) and a user-triggered "Strategic insights" Opus narrative over the deterministic numbers (cached in `ai_insight_reports`, never on page load).
- **Data**: ~1,846 ads across 3 competitors (ClickUp=`self` 606, Asana 323, Monday.com 917), global `ALL` view, fully re-scraped 2026-06-22 so all extended-capture fields (start_date, page_like_count, page_categories, …) are populated.
- **Build is green**: typecheck 0 errors / lint clean / 54 tests / app boots. Published to GitHub (public).
- **Live read-only demo**: deployed on Vercel (`DEMO_MODE=true`) with a committed curated snapshot `demo/demo.db`. Anyone can click through the full Insights comparison with no setup; linked from the README.

### In Progress / Next
- **(Proposed, not built)** A new per-ad AI analysis with FIXED enums (angle · hook_type · primary_benefit · primary_pain · audience · offer_type · tone · visual_style + has_social_proof · cta_strength + a 1-line summary) so results aggregate. The old free-text AI analyzer/synthesizer/recommender + scoring engine were removed (2026-06-22) for being low-value; this would replace them. (The `ad_analyses` table + the CTA→goal taxonomy were dropped 2026-06-22 — a new feature would add its own table.)
- **(Not built)** The Gemini provider — `GeminiClient.generate()` is a stub; only Anthropic works today.

### Known temporary
- Competitor suggester runs on Sonnet instead of Haiku (`suggest-competitors.ts`) due to a 2026-05-22 Haiku-capacity issue — revert to `"haiku"` once stable (Sonnet is ~10× the cost).

---

## 2026-06-22 — Live read-only demo on Vercel

**Why.** Make the dashboard clickable for anyone — a public, no-setup tour of the Insights comparison — without exposing the writable app or paid AI. The "demo-seeding mechanism" that prior docs listed as not-built is now built.

**The constraint that shaped it.** Scraping needs a real browser (Playwright) and can't run on Vercel's serverless hosts, and Vercel's filesystem is read-only. So the demo is the *viewing half* only, frozen on a bundled dataset, opened read-only.

**What changed.**
- **Read-only DB client** (`lib/db/client.ts`): when `DEMO_MODE=true`, opens SQLite with `{ readonly: true, fileMustExist: true }` + `pragma query_only=true` and **skips WAL** (WAL would create helper files and crash on the read-only filesystem). Local/normal use is unchanged (reads `data/app.db`, WAL on).
- **Committed demo snapshot** (`demo/demo.db`, 6.8 MB): a checkpointed, `.backup()`-copied, `journal_mode=DELETE`, VACUUMed single-file copy of the real scrape (11 competitors / 1,846 ads / 2 cached AI reports). Separate from the never-committed live `data/app.db`. The bundled `context/company.md` already carries an "example data" banner.
- **Next.js config** (`next.config.ts`): `outputFileTracingIncludes` ships `demo/demo.db` into the serverless bundle; `serverExternalPackages: ["better-sqlite3"]` keeps the native module unbundled.
- **Deployed to Vercel** with env `DEMO_MODE=true`, `DATABASE_URL=./demo/demo.db`, `MODEL_PROVIDER=anthropic` (no API key — AI disabled). Verified read-only (writes 403, pages 200, Insights renders the data).
- **README**: added a "🔗 Live demo" link at the top.

**Files.** `lib/db/client.ts`, `next.config.ts`, `demo/demo.db` (new), `README.md`, `CLAUDE.md`, `changelog.md`.

---

## 2026-06-22 — Phrases 3–5 words + explicit "Mentions AI" count; removed the dead conversion-goal apparatus

**Why.** (1) 2–4 word phrases still surfaced generic fragments; 3–5 words capture actual taglines. "AI" is too short to be a phrase but is a real positioning signal, so it gets surfaced explicitly. (2) The CTA→"conversion goal" mapping turned out to be **dead weight**: the Insights page already uses the raw Meta CTA label (`cta_label`) directly, and nothing read the derived goal — the only thing touching it was the `backfill:goals` script that wrote it. The table it wrote to (`ad_analyses`) was no longer populated either.

**What changed.**
- **Phrases 2–4 → 3–5 words** (`lib/analysis/phrases.ts`). Drops 1–2 word fragments entirely.
- **New explicit "Mentions AI" row** in the Insights Messaging section — `countAdsMentioningAi` counts ads whose copy says "AI" / "A.I." / "artificial intelligence" (word-boundaried, case-insensitive, once per ad), shown as its own row above the phrase ranks. Tests added.
- **Removed the conversion-goal apparatus**: deleted `lib/ads/` (`cta-to-goal.ts` + test), `scripts/backfill-conversion-goals.ts`, the `backfill:goals` script, `ConversionGoalEnum` (`lib/ai/schemas.ts`), and the `ad_analyses` table (migration `0010_bent_shape.sql` drops it). Docs updated (CLAUDE.md, ai-pipeline.md, analysis.md, architecture.md, README).
- **Removed `clean:ads`** (`scripts/clean-ads.ts` + the script + docs). It deleted paused, un-analyzed ads — but the analysis now *depends on* inactive ads (Inactive segment, longevity), so pruning them would harm the analysis. The snapshot model keeps inactive ads on purpose; there's nothing to prune.
- **Data-dependencies table corrected** (`docs/analysis.md`): advertiser context (`page_like_count`, `page_categories`) and launch velocity (`start_date`) flipped ❌→✅ — confirmed populated on all ~1,846 ads after the 2026-06-22 re-scrape.

**Files.** `lib/analysis/phrases.ts` (+test), `app/insights/page.tsx`, `lib/db/schema.ts`, `lib/ai/schemas.ts`, `drizzle/0010_bent_shape.sql`, `package.json`, deleted `lib/ads/` + `scripts/{backfill-conversion-goals,clean-ads}.ts`, `CLAUDE.md`, `README.md`, `docs/{analysis,ai-pipeline,architecture,scraping,dashboard}.md`, `changelog.md`.

---

## 2026-06-22 — Messaging phrases 2–4 words; docs/code audit cleanup; published to GitHub

**Why.** (1) Single-word "phrases" in the Insights Messaging section were too generic to show positioning. (2) A full sweep of the docs found many stale claims (a documented-but-never-built demo-snapshot mechanism, "creatives downloaded" claims after image download was removed, a `scraping.md` line contradicting the snapshot model, wrong test/ad counts, a boilerplate README) plus some half-removed code (orphan DB tables, a fresh clone that broke on the wrong AI-provider default).

**What changed.**
- **Phrase mining 1–3 → 2–4 words.** `lib/analysis/phrases.ts` now mines 2-, 3-, and 4-word phrases and drops single words entirely (kept the document-frequency ≥2-ads rule). Tests + `docs/analysis.md` + the Insights "(2–4 words)" label updated.
- **Dropped 2 dead DB tables** — `competitor_syntheses` and `recommendations` (truly unused; leftovers of the removed AI layer) via migration `0009_uneven_preak.sql`. `ad_analyses` was KEPT (still read by `clean:ads` + `backfill:goals`), but the docs now state it's legacy and no longer populated.
- **Fixed fresh-clone breakage**: `.env.example` default `MODEL_PROVIDER` flipped `gemini` → `anthropic` (the Gemini provider is a stub that throws). CLAUDE.md "works as a drop-in" claim corrected.
- **Removed demo-snapshot fiction** everywhere it was claimed to exist: dropped the broken `seed:demo` + `refresh:all` scripts from `package.json`, and the `data/demo-snapshot.json` references from CLAUDE.md, `.gitignore`, `architecture.md`, `ai-pipeline.md`. (The mechanism was documented but never built.)
- **Fixed stale "creatives" claims**: `architecture.md` (diagram + lifecycle), `dashboard.md` (`<Image>` + clean:ads "creative files"). Deleted the leftover **1.9 GB `data/ad-creatives/`** folder (dead, gitignored).
- **Fixed `scraping.md` snapshot-model contradiction** (line said missing ads get `is_active=false` — the opposite of how the code works) + a dead "task #5" cross-reference.
- **Rewrote `README.md`** from create-next-app boilerplate into a real setup guide (install → migrate → scrape → run; env vars; limitations).
- **Rewrote the changelog Status block** into a concise What's Built / In Progress / Next summary with correct counts (53 tests, 1,846 ads — was "78 tests / 781 ads"); removed a ~600-word block describing already-removed systems and an obsolete "re-analyze pending" action item.
- **Published the repo to GitHub** (public, `noobcoder1402/meta-ads-analyzer`); `context/company.md` marked as example data.

**Files.** `lib/analysis/phrases.ts` (+test), `lib/db/schema.ts`, `drizzle/0009_uneven_preak.sql`, `.env.example`, `.gitignore`, `package.json`, `app/layout.tsx`, `README.md`, `CLAUDE.md`, `docs/{architecture,ai-pipeline,scraping,dashboard,analysis}.md`, `changelog.md`.

---

## 2026-06-22 — Table text wraps (no more sideways scroll) + new docs/ui.md conventions home

**Why.** Long text in the Insights comparison tables ran off the side of the screen. Root cause: the shadcn table primitive (`components/ui/table.tsx`) hardcodes `whitespace-nowrap` on every cell, so a sentence-long metric hint (e.g. the run-length explanation) couldn't wrap and stretched its column to ~900px, forcing the whole table to scroll horizontally.

**What changed.**
- **Cells now wrap.** `comparison-table.tsx` + `company-scale-table.tsx`: the metric/hint column is constrained (`min-w-[160px] max-w-[300px]`) and all cells override the primitive with `whitespace-normal break-words` + `align-top`. The shared primitive is untouched (other tables still get `nowrap`). Verified live at 1280px: **all 13 Insights tables now have zero horizontal overflow** (was 359–587px); long hints wrap to 2 lines, page has no sideways scroll.
- **New `docs/ui.md`** — a dedicated, living "UI & UX conventions" doc (the user's call over a Claude Code skill, which suits packaged capabilities, not project reference knowledge). Seeded with two rules: **text-must-wrap / no-horizontal-overflow** and **plain-language copy for an external reader** (the latter moved here from `docs/dashboard.md`, which now points to it). Wired into `CLAUDE.md`'s "When to read what" index + the conventions list. The intent: every future UI gotcha gets a one-line rule added here.

**Files.** `app/insights/_components/{comparison-table,company-scale-table}.tsx`, new `docs/ui.md`, `docs/dashboard.md` (copy rule → pointer), `CLAUDE.md` (index + convention), `changelog.md`.

**Gates:** typecheck 0 · lint clean · 52 tests green · tables verified live (0 overflow, hints wrap, no console errors).

## 2026-06-22 — Insights copy rewritten for an external reader + raw-data CSV export

**Why.** Two asks. (1) The Insights page was written for the builder, not the eventual external audience — it was full of internal jargon (`collation_id`, "de-confound", "n-grams", "deterministic", "DCO", "ad-sets"). (2) The user wanted a way for anyone to do manual analysis on the scraped data, via a download/view on the UI.

**What changed.**
- **Plain-language sweep of the whole Insights surface** (`app/insights/page.tsx` + `self-gap-table.tsx` + `strategic-insights.tsx`): every description, hint, caption, and "Read" line rewritten for a non-technical marketer — short sentences, no field names, no acronyms without a plain gloss. Numbers/logic unchanged. Notable renames of user-facing labels: "Distinct live creatives" → **"Unique active ads"**, "Longevity tiers" → **"How long ads have run"**, "CTA mix" → **"Button mix"**, "Placement spread" → **"Where ads run"**, "Advertiser & cadence" → **"Advertiser & launch pace"**, "Median run length" → **"Typical run length"**. The DCO structure label (`lib/analysis/metrics.ts` `structureLabel`) is now plain **"Dynamic creative"** (acronym dropped; test updated). Verified live: zero banned jargon words render on the page.
- **Writing rule documented.** New **"Writing user-facing copy"** section in `docs/dashboard.md` (plain English, banned-word list, explain-inline, never verbose) + a one-line convention in `CLAUDE.md`. The same rule was added to the AI strategic-insights prompt (HARD RULE 8) so the generated narrative is plain too.
- **Raw-data CSV export.** New `GET /api/raw-data` route (`getAllAdsForExport` query — every scraped ad joined with its brand, ~24 human-labelled columns, signed/expiring media URLs + JSON blobs excluded, UTF-8 BOM for non-English copy). Surfaced as a **"Download raw data (CSV)"** button in the Insights header (styled `<a download>`, server-rendered). CSV opens directly in Excel/Sheets — zero new dependencies. It's a READ, so no demo guard and it works on the Vercel demo. Verified live: 200, correct headers, 3,989 rows across all brands. (User chose CSV + download-only, no on-screen preview page.)

**Files.** `app/insights/page.tsx`, `app/insights/_components/{self-gap-table,strategic-insights}.tsx`, `lib/analysis/metrics.ts` (+`metrics.test.ts`), `lib/ai/prompts/strategic-insights.ts`, `lib/db/queries.ts` (`getAllAdsForExport`), new `app/api/raw-data/route.ts`. Docs: `docs/dashboard.md` (writing rule + raw-data + the stale scrape-dialog section refreshed for the new scrape modes), `CLAUDE.md`, `changelog.md`.

**Gates:** typecheck 0 · lint clean · 52 tests green · Insights verified live (no jargon renders, download button works, CSV exports 3,989 rows, no console errors).

## 2026-06-22 — Scrape modes (active / +sample / +all paused) + creative-image download removed

**Why.** Two asks. (1) When adding competitors, the user wanted to choose *which slice* of a brand's library to pull, not a raw ad count — "all active", "all active + a sample of paused", or "all active + all paused". (2) The scraper was still downloading every ad's creative image to `data/ad-creatives/` on every scrape, but every page that displayed creatives (Swipe File, competitor-detail cards) was removed 2026-06-22 — so the download was pure waste (network + disk) feeding nothing.

**What changed (user-approved scope, params confirmed: paused sample = 200, active/all uncapped, image-metadata kept).**
- **Three scrape modes.** The "Scrape ads" dialog's old 25/50/100 *ad-count* picker is replaced by a **mode** picker: `active` (all live, uncapped) · `active_plus_sample` (all live + ≤200 paused — **the default/recommended**) · `active_plus_all` (everything, uncapped). The market picker (All countries / Specific country) is unchanged.
- **`scrapeCompetitorByMode` orchestrator** (`lib/scraper/scrape-competitor.ts`) maps a mode to 1–2 single-pass `scrapeCompetitor` calls and **always runs the active pass LAST** (the two-pass freshness rule — paused sample first), so the UI/`--mode` path can never hit the "Active segment goes empty" bug. It swallows the inner per-pass `done` events and emits one combined summary. The per-pass capture check (Meta's "~N results" vs. captured) still validates the uncapped active pass; the deliberately-capped paused sample is exempt (stops on `maxAds`, not a stall).
- **API + CLI wired.** `POST /api/competitors/[id]/scrape` now takes `mode` (defaults `active`) instead of `maxAds`. `pnpm scrape` gains `--mode=…` + `--paused-sample=N`, routed to the orchestrator; the low-level `--active-status` + `--max-ads` single-pass path is kept for power users.
- **Creative-image download removed.** Deleted `downloadMedia`/`guessExt`/`AD_CREATIVES_DIR` and the `mediaPaths` write from the scraper, the dead `app/api/creatives/[filename]/route.ts` serving route, and the on-disk file-deletion loop in `clean:ads`. **Kept** the cheap metadata: `media_type` (image/video/carousel — analysis reads this label) and the `media_urls` reference strings. `ads.media_paths` becomes a legacy column (always `[]`); the `data/ad-creatives/` directory is no longer written. Existing files on disk are left untouched (delete manually if desired).

**Net effect.** Adding a competitor now means choosing how deep to go (live-only → everything), with the active/paused ordering handled correctly under the hood, and no wasted image downloads.

**Files.** `lib/scraper/scrape-competitor.ts` (ScrapeMode + UNCAPPED/DEFAULT_PAUSED_SAMPLE + `scrapeCompetitorByMode`; removed download), `app/api/competitors/[id]/scrape/route.ts`, `components/scrape-ads-dialog.tsx`, `scripts/scrape.ts`, `scripts/clean-ads.ts`. Deleted: `app/api/creatives/`. Docs swept: `CLAUDE.md`, `docs/scraping.md`, `changelog.md`.

**Gates:** typecheck 0 · lint clean · 52 tests green · dialog verified live (three modes render, default = sample-of-paused, market picker intact, no console errors).

## 2026-06-22 — Neutral analysis: active/inactive filter, "winner/flop" framing removed, Swipe File + detail page + scoring engine deleted

**Why.** The product asserted value judgments it can't defend. Meta's public ad library exposes **no spend, reach, or conversions** for commercial ads, so calling an ad a "winner" or "flop" (or scoring it 0–100) was claiming knowledge we don't have. The user asked to strip that framing back to neutral facts and simplify the surface area.

**What changed (user-approved scope).**
- **Insights segment filter reworked** `All / Active / Winners / Dropped` → **`All ads / Active ads / Inactive ads`**. `active` = live now (`isLive`); `inactive` = the complement (paused/ended); they partition `all`. The `Segment` type + `inSegment` were simplified to match; the old `winners`/`flops` URL keys are gone.
- **Winner/flop framing removed from Insights.** Dropped the scoreboard's *Winners*, *Distinct winners*, and *Flop rate* rows (added an *Inactive ads* count instead) and the *"What your winners say differently"* section (and its `phraseLift` plumbing). Retired the now-dead `lib/analysis` helpers: `isWinner`, `isFlop`, `flopBreakdown`, `splitBy`/`SplitTally`, `landingDomainsSplit`, `WINNER_MIN_DAYS`, `FLOP_MAX_DAYS`. The creative mix is now plain `Tally` (no winner-split).
- **Longevity tiers kept, relabelled neutral.** The split the user likes stays, but `Proven winner` → **Long-running** and `Hall of fame` → **Veteran**, and every "winner/proven/profitable" caption was reworded to "run length is not a quality score."
- **AI narrative reframed.** `howToReadWinners` → `howToReadLongevity`; the `winners` insight category → `longevity`; the prompt now leads with "a long run is strategy-biased, NOT proof of quality." (Old cached reports simply don't render — the page reads them defensively; regenerate to refresh.)
- **Swipe File page (`app/swipe-file/`) and the per-competitor detail page (`app/competitors/[id]/`) deleted** — along with the ad grid, ad-detail dialog, and breakdown matrix. The Competitors *list* page stays (add/manage/scrape); its per-card "Open" link (which opened the detail page) became **"View on Meta ↗"** (opens the brand's Meta Ad Library page). Swipe File nav link removed.
- **Scoring engine removed cleanly.** Deleted `lib/scoring/` (performance-score + buckets + score-ads), dropped the `scoreCompetitorAds()` call from the scraper (+ its `scored-ads` SSE event), removed the score queries (`getAllScores`/`getSwipeFileAds`/`getScoreForAd`/`getScoresForCompetitor`/`upsertScore`), and **dropped the `performance_scores` table** (migration `0008_strange_lila_cheney.sql`, applied). `clean:ads` no longer cascades to it. The scoring engine only ever fed the two deleted pages, so it was dead code that still ran on every scrape.

**Net effect.** The product is now two surfaces — **Competitors** (add/scrape) and **Insights** (the deterministic, neutral cross-brand comparison) — and nothing in it claims an ad is good or bad.

**Files.** `lib/analysis/` (metrics, types, analyze-competitor, analyze-across, index, phrases + both tests), `app/insights/page.tsx` + `_components/strategic-insights.tsx`, `lib/ai/` (schemas, prompts/strategic-insights, the component), `app/layout.tsx`, `app/competitors/page.tsx`, `components/scrape-ads-dialog.tsx`, `lib/scraper/scrape-competitor.ts`, `lib/db/{schema,queries}.ts`, `scripts/clean-ads.ts`, `drizzle/0008_strange_lila_cheney.sql`. Deleted: `app/swipe-file/`, `app/competitors/[id]/`, `lib/scoring/`, `docs/scoring.md`. Docs swept: `CLAUDE.md`, `docs/{analysis,dashboard,architecture,ai-pipeline,scraping,meta-ads-mechanics}.md`.

**Gates:** typecheck 0 · lint clean · 52 tests green · Insights verified live (filter toggles active/inactive, no winner/flop language anywhere, `/swipe-file` 404s, `/competitors` 200).

## 2026-06-22 — Messaging section on Insights (phrase bubble + winner phrase-lift) + the "free" correction

Added a **Messaging** block to the Insights page (deterministic, zero-AI — phrases were computed but never rendered before):
- **"Messaging"** — top ~8 repeated phrases per brand (`phrase · #ads`), re-lensed by the existing All/Active/Winners/Dropped segment filter (toggle Winners → the messaging that survives; thin samples grey out).
- **"What your winners say differently"** — self brand only (needs ≥ 20 winners): the phrases the user's 90-day winners repeat MORE than their overall copy, as `% of all ads · % of winners · Lift`. Powered by a new pure, unit-tested **`phraseLift`** in `lib/analysis/phrases.ts` (full document-frequency baseline on BOTH sets — fixes a truncated-top-N bug that would inflate rare-overall phrases). For ClickUp: winners over-index on "chat" (+12), "together" (+9), "app" (+9), "everything" (+8).

**The "free" correction (why this shipped with loud caveats).** A hand insight claimed "ClickUp uniquely leads on *free*" (34% of ads vs Monday 10%). The user pushed back: Monday/Asana say "try for free" *below the creative* far more. Investigation proved them right — ClickUp's "free" is **buried in body captions**; Monday/Asana put it in the **prominent headline** ("Start your free trial today", "Create your free account") AND likely **inside the creative art**, which our text mining **cannot read (no OCR)**. So phrase counts are real but two things make "leads on a word" claims unsafe: **(1) blind to in-image/video text; (2) no placement weighting** (a headline word = a buried-caption word). Both limitations are now stated in the section captions, the `phraseLift`/phrase docs, and **added as a hard rule to the strategic-insights AI prompt** (never claim a brand "owns"/"leads on" a word from phrase counts; never infer prominence).

**Files.** `lib/analysis/phrases.ts` (+`phraseLift`, +`docFrequencies` refactor), `lib/analysis/phrases.test.ts` (+4 tests), `app/insights/page.tsx` (two sections + reads + caveats), `lib/ai/prompts/strategic-insights.ts` (rule 7). Docs: `docs/analysis.md` (E + new E2 + the limitation w/ the free example), `CLAUDE.md`.

**Gates:** typecheck 0 · lint clean · 87 tests green · both sections verified rendering live with real data.

## 2026-06-22 — AI "Strategic insights" narrative on the Insights page (Opus over the deterministic numbers)

User wanted the sophisticated strategic read I'd produced by hand (especially the "winners count is misleading because Monday runs a high-velocity churn strategy" conclusion) baked into the product permanently. They explicitly chose: keep the analysis deterministic, and have **an AI go over the already-computed numbers and write a narrative** — no AI math, no auto-runs.

**What shipped.** A new "Strategic insights" panel pinned at the top of the Insights page. Click **Generate** → a high-quality model reads the full deterministic `CrossAnalysisBundle` and returns a Zod-validated narrative (headline, a "how to read winners" caveat, 3–10 insights each with evidence + a concrete "so what" + confidence, and honest caveats). It leads with the winner-metric caveat by design.

**Architecture (respects every guardrail).**
- **Deterministic stays deterministic.** The AI never recomputes a number or sees a raw ad — it only narrates `lib/analysis` output. Same no-spend/reach/market-share rule, enforced in the prompt.
- **User-triggered + cached.** Generation runs only on the button click (`POST /api/insights/generate`, demo-guarded 403), never on page load or scrape. Result is cached in the new **`ai_insight_reports`** table (migration `0007_known_johnny_blaze.sql`); the page reads the latest row for free and shows a "numbers changed — regenerate?" nudge when the live `fingerprintBundle` ≠ the stored `dataFingerprint`. Never auto-regenerates.
- **Structured output + retry**, via the provider abstraction. Added **Opus** to `ANTHROPIC_MODELS` (the client now supports `haiku|sonnet|opus`); the task defaults to Opus, overridable with `INSIGHTS_MODEL` in `.env`.
- **No `tsx` CLI.** The analysis chain statically imports `eld/large`, which dies under `tsx` (documented gotcha — confirmed live); Next.js/vitest resolve it fine, so generation lives in the app only.

**Files.** `lib/ai/client.ts` (+opus), `lib/ai/schemas.ts` (`StrategicInsightsSchema`), `lib/ai/prompts/strategic-insights.ts` (static persona/rules + `buildInsightsPrompt`), `lib/ai/analyzers/generate-insights.ts` (load → prompt → generate → fingerprint → save), `lib/db/schema.ts` + `queries.ts` (`ai_insight_reports`, `getLatestInsightReport`/`saveInsightReport`), `app/api/insights/generate/route.ts`, `app/insights/_components/strategic-insights.tsx`, `app/insights/page.tsx` (panel wiring + staleness). Docs: `docs/ai-pipeline.md` (3rd AI task), `docs/analysis.md` (narrative-on-top note), `CLAUDE.md`.

**Cost.** ~$0.05–0.15 per Opus run (text-only), then cached; ~5× cheaper on Sonnet. **Not yet run** — left for the user to click (no AI spend incurred during the build, per the cost guardrail).

**Gates:** typecheck 0 · lint clean · 83 tests green · Insights page renders the panel (HTTP 200, empty-state "Generate" button) verified live.

## 2026-06-22 — Scraper: fixed Monday.com under-capture (39→767) + hardened scroll + capture check

User caught a major data bug: the dashboard showed **39 active Monday.com ads** when the Ad Library has **~770** (many in Spanish/Portuguese). Investigation (DB diagnostics) proved it wasn't a display bug — we'd only *captured* 39: all 0–40 days old (just the freshest batch), 87% English, near-zero LATAM. ClickUp/Asana were fine (wide age ranges), so it was Monday-specific.

**Root cause.** `scrollUntilStable`'s no-growth stall (`NO_GROWTH_STREAK_LIMIT = 6`) bailed after the first ~39 ads. Monday's library is ~20× bigger and lazy-loads in bursts with lulls longer than 6 polls, so the scroll gave up early and the run still recorded as a clean `success`.

**Fixes (`lib/scraper/scrape-competitor.ts`).**
1. **Hardened scroll:** `NO_GROWTH_STREAK_LIMIT` 6→**12**, `MAX_SCROLLS` 80→**320**. `scrollUntilStable` now returns `{ reason, finalCount }`.
2. **Post-scrape capture check (user-requested):** `readReportedTotal(page)` reads Meta's own "~N results" count; if we captured < `CAPTURE_MIN_RATIO` (0.8) of it **after a stall**, the run emits a `warning` ScrapeEvent (CLI prints `⚠️`) and is recorded **`partial`** with the reason in `error_message` — never again a silent truncated "success". Best-effort + localized; a null read skips the check.
3. New `warning` ScrapeEvent type, surfaced in the CLI (`scripts/scrape.ts`).

**Re-scraped Monday.com** (ALL view, inactive 150 + active uncapped, active last): **767 live ads** (was 39), age spread now **0–805 days** (was 0–40), capture check passed ("767 of ~770, ok"). LATAM now present (Portuguese 72, Spanish 28). **Real finding on complete data:** Monday runs a very high-velocity strategy — 766 of 767 live ads are < 60 days old, with a single 805-day evergreen, hence only 1 "winner" (90d+). Not a bug — that's their actual playbook.

**Gates:** typecheck 0 · lint clean · 83 tests green · verified in DB + Insights UI.

## 2026-06-22 — Insights: median run length (all ads) added to Longevity

Added a **"Median run length — all ads"** row at the top of the Longevity section, at the user's request for a "median age of ads (active + inactive)."
- New pure helper `medianDaysActive(ads)` in `lib/analysis/metrics.ts` (median of `days_active` across **all** ads, live + paused; median not mean so a few very-long ads can't skew it; null for empty). Surfaced as `CompetitorAnalysis.medianDaysActiveAll` in `analyze-competitor.ts`.
- **Honesty note baked into the label:** `days_active` is *run length*, not calendar age (live = launch→today; paused = launch→stop, frozen). The row label + hint say so, and the section description now flags that the median spans all ads while the tiers below stay live-only.
- Live values: ClickUp 62 days · Asana 45 · Monday.com 56 (across all their ads).
- Gates: typecheck 0 · lint clean · **83 tests** (added 4 `medianDaysActive` cases) · verified in-browser, no console errors.

## 2026-06-22 — Insights: "Active (live)" segment added to the filter

Added a fourth option to the sticky segment filter: **All ads / Active (live) / Winners (90d+) / Dropped (<30d)**. `active` = every currently-live ad (`isLive` — Meta's `is_active` AND present in the latest scrape), the **superset of `winners`** (which also requires 90+ days). Fills the gap between "All ads" (live + paused) and "Winners" — the "what are they running right now, regardless of age" view.
- `lib/analysis/metrics.ts`: added `"active"` to the `Segment` union + `inSegment` (`return isLive(...)`).
- `app/insights/page.tsx`: new toggle button, `?segment=active` parsing, badge label, and updated the "Creative & messaging" intro copy.
- Verified live: Active re-lenses every table to the live counts (ClickUp n=456, Asana n=173, Monday n=39 — matching the head-to-head live numbers).
- Gates: typecheck 0 · lint clean · **79 tests** (added an `inSegment` "active" case).

## 2026-06-22 — Insights: Languages table segment-lensed + region cell wrapping

Two small follow-ups from user review:
- **Languages now responds to the sticky All/Winners/Dropped filter** (it was previously always-all-ads). Switched it to the same `segAds`/`segColumns`/`filterTag` path the creative & messaging tables use, computing per-segment counts with `aggregateLanguages`; the all-ads "Read" line hides in a segment view. Surfaces e.g. that ClickUp's winners are 96% English + 4% Portuguese (n=259) while Monday's winners column greys out (n=0).
- **"Strongest regions" cell now wraps.** The shadcn `TableCell` hard-codes `whitespace-nowrap`, so the long region prose ran off as one ragged right-aligned line. Added a per-row `align` option to `company-scale-table.tsx`; the regions row is now left-aligned with `whitespace-normal` + a 15rem max-width span, so it wraps to a tidy 4–5 lines per brand.
- Gates: typecheck 0 · lint clean · verified in-browser (Languages re-lenses with `n=` + badge; regions wrap; no console errors).

## 2026-06-22 — Insights: "Company scale & regional reach" (external context block)

Added one **external-data** section to the Insights page, directly below Languages, at the user's request ("if you find reliable data include numbers of their global or regional presence").

**What it shows.** A side-by-side table of company-level context for the three brands — Ownership, Revenue/ARR, Paying customers, Valuation/listing, Headquarters, Countries/reach, and **Strongest regions** — to read the ad strategy against. New component `app/insights/_components/company-scale-table.tsx`; data is hand-curated + static, keyed by lowercased competitor name.

**The honesty design (the important part).** Every *other* Insights table is deterministic math over scraped ads and the project rule is "never claim spend/reach/market-share/geography from Meta data." This block is the **one deliberate exception**, so it's fenced off hard: it lives OUTSIDE `lib/analysis/`, carries an amber **"External context — not from Meta ad data"** banner, tags every estimate with an **`est.`** badge, and links a **source per figure**. The rule bars *inferring* those numbers from the ad library — it doesn't bar showing clearly-cited external facts of a different provenance. Documented the exception in `docs/analysis.md` (out-of-scope rules), `docs/dashboard.md` (Insights section), and `CLAUDE.md` so a future session doesn't tear it out as a violation.

**Reliability split (web-researched).** Asana (NYSE: ASAN) and Monday.com (NASDAQ: MNDY) are public → figures from audited SEC filings (Asana FY2025 $723.9M; Monday FY2025 $1.23B, ~245k customers, 200+ countries). ClickUp is private → self-reported/third-party estimates (~$300M ARR, 100k+ customers, $4B valuation, 20M+ users), all tagged `est.`. Per the user's choice, estimates are shown but clearly marked.

**Cross-validation (the bonus finding).** The external regional data independently agrees with our deterministic ad-language metric: ClickUp's Portuguese ads ↔ Brazil is its #2 market; Asana's heavy German/French copy ↔ its EMEA traction; Monday's French copy ↔ its strong EMEA revenue. Surfaced as the section's "Read" line.

**Gates.** typecheck 0 · lint clean · verified in-browser (section renders, `est.` badges on ClickUp only, 8 source links resolve, no console errors). No DB/schema change — purely additive UI + static data.

## 2026-06-21 — Sticky winners/dropped filter + `--active-status` two-pass scrape + fresh data

Three connected pieces of work in one session.

**1. Sticky segment filter (the requested feature).** The Insights segment toggle (All / Winners / **Dropped** — renamed from "Flops" per user wording) was moved out of the "Creative & messaging" sub-header into a **sticky bar pinned under the top nav** (`sticky top-14 z-40`, full-bleed via negative margins + backdrop blur), so it's reachable from anywhere on the page. Still pure server-rendered `<Link>`s (`?segment=`), no client JS. Each lensed section now carries a small **segment badge** ("Winners"/"Dropped") via a new `tag` prop on `Section`, so it's obvious which tables the filter re-lenses. Scope unchanged: only the creative & messaging tables filter; the scoreboard/longevity/gap sections always show all ads (those ARE the winner/dropped split). Verified in-browser (sticky on scroll, both segments populate, badges render).

**2. `--active-status` scrape flag + two-pass strategy.** Added `activeStatus: "all" | "active" | "inactive"` to `ScrapeOptions` → `buildAdLibraryUrl` (Meta's `active_status` param, was hardcoded `all`) and a `--active-status=` CLI flag. **Why:** a single `--max-ads` cap takes whatever Meta returns first, which biased Monday.com to 300 paused / 0 live (its live ads sat past the 300 cutoff). The fix is a two-pass scrape per brand — `inactive --max-ads=150` (bounded dropped sample) + `active --max-ads=100000` (every live ad). Default stays `all`; typecheck/lint/78 tests green.

**3. `isLive` two-pass ordering bug (found + fixed).** First two-pass run showed **0 winners everywhere** despite 259/33/0 raw winners. Root cause: `isLive` requires `lastSeenAt >= latestScrapeAt` (snapshot freshness), but the **inactive pass ran last**, so it became `latestScrapeAt` and every live ad (seen only in the earlier active pass) read as stale → not-live. Fix: **run the active pass LAST** (re-ran active-only to repair the DB). Documented as a gotcha in `CLAUDE.md` + `docs/scraping.md`.

**Data refresh.** Wiped all prior ad data + 834 MB of creative images for a clean start (competitors + Meta page IDs kept), then two-pass scraped the 3 brands (ALL view): **ClickUp 606 (456 live / 259 winners), Asana 323 (173 / 33), Monday.com 189 (39 / 0)** = 1,118 ads, 1.4 GB images. Monday's 0 winners is now genuine (39 live ads, none yet 90+ days), not a cap artifact. Images kept for the swipe file per user choice (scraper still downloads them).

## 2026-06-21 — Insights "Read" lines stripped of causal/confounded claims

User flagged that a "Read" line asserted behaviour from a confounded metric: *"Flop rate ranges from 9% to 67% — ClickUp stops the largest share of its ads early."* Flop rate (like raw volume) is inflated by ad-duplication build style, so that's an inference we can't defend. Rewrote every `*Read` function in `app/insights/page.tsx` to state **facts only** — a leader on a clearly-defined metric or a ranked list — with **no causal/behavioural inference** and **no confounded raw counts**:
- Overview now lists **distinct** live creatives + **distinct** winners (de-confounded), dropped the flop-rate behavioural claim entirely.
- Longevity uses **shares** (% of a brand's live ads in testing / 90+) instead of raw counts.
- Removed loaded verbs: "battle-tested" → "highest share live 90+ days"; "leans on video" → "highest video share"; "writes the shortest copy" → "highest share of short copy".
- Documented as a **hard rule** in `docs/dashboard.md` so it doesn't regress.
- Gates: typecheck 0 · lint clean · 78 tests green.

## 2026-06-21 — Insights: landing-pages table + winner/flop segment toggle

Two requested additions to the Insights hub.

**Landing pages.** New `landingPages(ads, top)` metric (host **+ path**, query/hash stripped) — surfaced as a per-brand "top 5 landing pages" table. Why path, not domain: every brand's ads link to its own domain (verified — 100% of the 781 ads have `landing_url`, all self-domain), so the old domain-only view was useless; the **path** is the signal (which offer/feature they drive to: ClickUp → `/lp/get-started` + feature LPs, Asana → `/campaign/try-now`, Monday → homepage). `landingDomains` kept but documented as low-signal cross-brand.

**Winner / flop segment toggle.** New `isFlop` + `inSegment(ad, scrapeAt, "all"|"winners"|"flops")` predicates. The "Creative & messaging" tables (creative mix, structure, CTA, copy length, placement, landing pages) re-lens to **All / Winners (90d+) / Flops (<30d)** via a URL-param toggle (`?segment=`, server-rendered `Link`s — no client state, stays SSR). Immediately surfaced a real divergence: among **winners**, ClickUp's CTA is 100% "Learn More" while Asana's is 100% "Sign Up" + 100% DCO.
- **Sample-size guard (non-negotiable):** winner counts are lopsided (ClickUp 180, Asana 11, Monday 2). Each segmented column shows its `n`; columns under `MIN_SAMPLE` (8) are greyed (`BrandColumn.muted`) so a 2-ad sample can't masquerade as a confident finding. Monday's winners column correctly greys out.
- **Loader change:** `loadCrossAnalysis` now also returns `brands[]` (raw ads + latest-scrape-at per brand) so the page can filter to a segment without a second DB round-trip.
- Removed the standalone language/advertiser reads from lensed tables in non-all views (the "Read" is all-ads-based, so it's hidden when a segment is active).
- Gates: typecheck 0 · lint clean · **78 tests** (added `isFlop`/`inSegment`/`landingPages` coverage). Verified all three segment views render (200) with the sample-size greying. Docs: `docs/analysis.md` (landing pages + segment lens), `docs/dashboard.md` (Insights section).

## 2026-06-21 — Insights refinements (definitions, per-section "Read", longevity %, copy-length order)

Round of polish on the Insights comparison hub from user review:
- **Removed the standalone "Volume, de-confounded" table** — distinct-live-creatives already lives in the head-to-head overview, so the separate table was redundant.
- **Per-section "Read" line** — each `Section` now renders a 1–2 sentence **deterministic** takeaway beneath its table (templated from the numbers: leader / range / outlier — `overviewRead`, `longevityRead`, `mediaRead`, etc. in `page.tsx`). Still zero AI.
- **Metric definitions** — added `hint` sub-labels defining flop rate ("of stopped ads, the share that ran <30 days"), winners ("live 90+ days"), distinct creatives, etc.
- **Longevity tiers show `count (%)`** — each tier cell is now e.g. `36 (95%)`, the % being that tier's share of the brand's live ads (revealed Monday's live ads are 95% still in their first 30 days).
- **Copy length fixed order** — Short → Medium → Long → No primary copy (was count-ranked). `pivot()` gained an `{ order }` option.
- **Verified the ClickUp "3% Portuguese" reading is correct**, not an eld misdetection — the 10 ads are genuinely Brazilian-Portuguese ClickUp ads ("Conheça a ClickUp…" + Trello/Asana attack ads). No code change; documents that the language detector is behaving.
- Gates: typecheck 0 · lint clean · 75 tests green. `docs/dashboard.md` Insights section updated.

## 2026-06-21 — Insights page wired: cross-competitor comparison hub (deterministic, zero-AI)

Rebuilt the "coming soon" Insights page into the **side-by-side comparison hub** — the first UI on top of the `lib/analysis/` module. Server component, `force-dynamic`, recomputed on every load (no analysis table, no cache, no AI). Verified rendering against the live DB (ClickUp/Asana/Monday, 200 OK, real cells).

- **Data seam:** `lib/analysis/load.ts` (`loadCrossAnalysis()`) — fetches each active competitor's ads + the latest successful scrape time, runs `analyzeCompetitor` then `analyzeAcross`. New query `getLatestSuccessfulScrapeAt(competitorId)` (latest non-failed `scrape_runs.started_at`) supplies the snapshot model's "live = seen in the latest scrape" reference.
- **Layout decision (user):** brands as **columns**, metrics as **rows** (spec-sheet) — best for the few brands tracked; `self` pinned first + highlighted with a "You" tag.
- **Tables:** Head-to-head overview · Volume de-confounded (raw entries → distinct creatives via Meta `collation_id`, with the "floor / DCO under-counts" caveat) · Longevity tiers (live only) · Creative mix · Ad structure · CTA mix · Placement spread · Copy length · Languages · Advertiser & cadence · **Your gaps** (rivals-out-index-you, share-only, only when `self` present).
- **Components:** `app/insights/_components/comparison-table.tsx` (reusable, pre-formatted string cells, `null` → "—") + `self-gap-table.tsx`. Reuses the shadcn `table` primitive — **no new dependencies**.
- **Stale-metric handling (user choice):** page followers + launch velocity show "—" until a re-scrape populates `page_like_count` / `start_date` (those columns post-date the current 781 ads). Everything else populates from existing data.
- **Empty states:** no competitors → add some; competitors but no ads → scrape one. Read-only (works on the Vercel demo).
- **Scope:** Insights hub only this pass (user chose "Insights first"). Per-competitor analysis panels on the competitor detail page (winner-split tables + phrase bubble) are the planned Phase 2.
- **Gates:** `pnpm typecheck` 0 · `pnpm lint` clean · 75 tests green. Docs updated (`CLAUDE.md` analysis note, `docs/dashboard.md` Insights section).

## 2026-06-21 — Docs scrubbed of removed-AI-layer references (forward-looking only)

Swept every active doc to **remove all "what's gone / being rebuilt / dormant / historical-note" memorial framing** about the removed AI analysis layer (creative analyzer, competitor synthesizer / "Find patterns", GTM recommender, the Insights scoreboard, the "Map markets" footprint). The docs now describe **only the current system** — aligning with the project rule that `CLAUDE.md` (and the reference docs) should reflect current state, not be a changelog. No code or DB changes: the removed-layer code files were already deleted (2026-06-20), and the leftover legacy columns (`variant_count`/`variant_pts`/`market_footprint`) + dormant tables (`ad_analyses`/`competitor_syntheses`/`recommendations`) stay as-is (load-bearing `NOT NULL` / kept for append-only migrations).

- **`CLAUDE.md`** — replaced the ⚠️ "AI layer is being rebuilt" preamble with a present-tense "analysis is deterministic-first" note; removed "REMOVED/gone" asides from the folder map, commands (the `pnpm analyze/synthesize/recommend` removal note), conventions, and gotchas (geographic, snapshot model, eld, clean:ads, self-competitor). Now 141 lines.
- **`docs/analysis.md`** — dropped the "What is deliberately NOT here (old parameters that are gone)" section; kept the live guardrail as a forward "Out of scope — hard rules" (never claim spend/reach/market-share; dedup is `collation_id` only).
- **`docs/dashboard.md`, `docs/architecture.md`, `docs/ai-pipeline.md`** — removed documentation of the deleted UI/pipeline and the "Removed — design reference for the rebuild" appendix; rewrote the data-flow/lifecycle to scrape → score → deterministic on-read analysis → dashboard.
- **`docs/scoring.md`, `docs/scraping.md`, `docs/meta-ads-mechanics.md`** — dropped synthesizer/footprint references and "historical note" memorials; kept the live rationale (three-signal scoring, snapshot model, Meta-only sourcing) in present tense.
- **`changelog.md`** — kept intact as the project's history record (this is where "what was removed and why" legitimately lives).

## 2026-06-21 — Deterministic analysis module (`lib/analysis/`) + `docs/analysis.md`

Built the **zero-AI competitive-analysis layer** (Part B of the rebuild) — pure functions over already-scraped columns, **recomputed on every read** (no analysis table, no cache, "fresh analysis each time"). No paid API is touched. UI wiring is deliberately **not** done yet (user asked to land the module + doc first).

**New files (all pure → unit-tested):**
- `lib/analysis/types.ts` — `AnalysisAd` (structural subset of a Drizzle `Ad`) + `Tally`/`SplitTally`/`LongevityTier`.
- `lib/analysis/metrics.ts` — per-competitor math + the tunable thresholds (single source of truth): `isLive`/`isWinner` (snapshot model), longevity tiers (**LIVE ads only** — a winner must still be running: Testing/Established/Strong/Proven 90+/Hall-of-fame 180+), flops (not-live & <30d, rate over *ended* ads), creative mix **with winner-split** (`splitBy` → which formats survive), structure (DCO≠carousel), CTA mix (raw Meta labels), placements, landing domains (+split), `distinctCreatives`, creative scaling (collation, within-competitor display only), advertiser context, launch velocity.
- `lib/analysis/phrases.ts` — the "phrase bubble": **document-frequency** 1–3-gram mining (each phrase counts once per ad), stopword-trimmed, ≥2 ads, top 30.
- `lib/analysis/analyze-competitor.ts` — composes the above + language roll-up (`eld`) into one `CompetitorAnalysis`.
- `lib/analysis/analyze-across.ts` — head-to-head table + **self-gap** (where competitors out-index the user's own `self` brand on a *share* basis — never spend).
- `lib/analysis/index.ts` — public surface. `metrics.test.ts` (14) + `phrases.test.ts` (6).

**De-confounding volume — the key honesty fix.** Raw `ad_archive_id` count is confounded by build style (manual ad-set duplication inflates; DCO bundles deflate). So volume is compared on **distinct creatives** using **Meta's `collation_id` ONLY** — explicitly *no* homemade caption/media/CTA similarity guess (user: *"just check Meta's collation id… don't make your own analysis on creative"*). Real data (live ads): **ClickUp 222 → 105**, Monday 38 → 35, Asana 20 → 19. The "11× Asana" headline collapses to ~3–5×; disclosed as a floor (DCO bundlers under-count). Placements shown as a separate axis since they live *inside* one entry and never inflate the count.

**Docs:** new `docs/analysis.md` (full metric catalogue + the snapshot model + dedup boundary + an explicit "what is NOT here" list so removed signals — spend/reach/market-share, AI angle/synthesis/recs, `variant_count`, homemade dedup — don't creep back). Added it to `CLAUDE.md`'s "When to read what" index, added `lib/analysis/` to the folder map, and corrected the stale `lib/lang/` note (`tinyld` → `eld`; now consumed by `lib/analysis`).

**State:** `pnpm typecheck` 0 · 20 analysis tests green (full suite run in session). **Next:** wire the per-competitor panels (A–G) into the competitor detail page and the head-to-head + self-gap (H) into the Insights page; a free re-scrape to populate `start_date`/`page_like_count` for velocity + advertiser context.

## 2026-06-21 — Snapshot model: stop inferring "paused" from absence (removed `markMissingAdsInactive`)

**Context.** While scoping a fix for the known `--max-ads` cap bug (a shallow re-scrape wrongly flipped still-live ads to `is_active=false`, freezing their longevity), a data audit overturned the assumption the bug rested on. We'd believed "commercial ads vanish when stopped, so absence ⇒ paused." The data says otherwise:

- We scrape with **`active_status=all`** (`scrape-competitor.ts` + `resolve-meta-page.ts`), so Meta returns each page's **active AND inactive** ads with a real `is_active` flag.
- Corrected measurement across the 781 ads: **~93% of "paused" ads were returned by Meta flagged inactive**; only **~7%** are true disappearances (Asana 179/8, ClickUp 144/**0**, Monday 144/26 — returned/absent). (An earlier audit query reported the *inverse* (~96% inferred); it was wrong — it compared `last_seen_at` to a single `MAX()` instant, but a scrape stamps each ad a second apart over ~100s, so all-but-one looked "absent". Comparing to the scrape **start time** fixed it.)

**Decision (user-approved): the snapshot model.** Trust Meta's `is_active` directly; never infer paused from absence. An ad not found in a later scrape is **left as-is** (last-known status + dates frozen); the analysis layer treats **"live" = "present in the latest scrape"** and everything else as "last seen N ago" — non-destructive and self-healing (a reappearing ad just refreshes). This dissolves the cap bug entirely (nothing flips on absence) and matches the "fresh analysis each time" intent for this single-user hobby tool — *less* machinery, not the guard-heavy hysteresis/volume-gate alternative that was considered and rejected as over-engineering.

**What changed (code, 2 files):**
- **`lib/scraper/scrape-competitor.ts`** — removed the `markMissingAdsInactive` call (+ its import); `adsWentInactive` is now always `0` with an explanatory comment.
- **`lib/db/queries.ts`** — deleted the `markMissingAdsInactive` function (+ the now-unused `notInArray` import); left a tombstone comment.
- Kept the `scrape_runs.ads_went_inactive` column + UI plumbing (the UI only renders it when `>0`, so it just hides — avoids a needless migration).

**Trade-off (accepted):** we lose the hard "flopped/retired by disappearance" label for the ~7% of ads that genuinely vanish without Meta ever flagging them — they now read "last seen N ago" instead of a confident "paused". Given Meta hands us the real flag for the other ~93% (plus real `end_date` for run-length since the 2026-06-20 capture), this is a more honest signal for less code.

**State:** `pnpm typecheck` 0 errors. (Lint/tests run in the session.)

## 2026-06-21 — `docs/meta-ads-mechanics.md` re-sourced to official Meta domains only

The mechanics doc had third-party marketing blogs (admapix, mida.so, primores, adlibrary.com, sprout, adnabu, marpipe, adamigo) cited as fact — and one of them ("commercial ads vanish when stopped") was an over-claim our own data contradicts. Rebuilt the doc on a strict rule: **cite only Meta-owned domains** (`transparency.meta.com`, `developers.facebook.com`, `www.facebook.com`, `about.fb.com`), and tag every statement ✅ **VERIFIED** (verbatim Meta quote + URL) or 🟡 **OUR INFERENCE** (Meta is silent — derived from our data). A research agent gathered the verified facts (8 questions, official sources only) and explicitly listed what Meta does *not* document.

**Key corrections:** the "vanish" claim is gone — §5 now states what Meta actually documents (retention contrast: political 7yr / EU 1yr / commercial = only "active ads searchable") and our verified data (we get inactive ads directly via `active_status=all`, ~93%/7%). The one load-bearing verified fact for our whole architecture is quoted exactly: *"Ads that did not reach any location in the EU will only return if they are about social issues, elections or politics"* — which is why commercial spend/impressions/reach are always null and we scrape the UI, not the API. Added the doc to `CLAUDE.md`'s "When to read what" index. Docs only — no code.

## 2026-06-20 — Language detection: `tinyld` → `eld`

Swapped the creative-language detector in `lib/lang/detect-languages.ts` from `tinyld` to **`eld`** ("Efficient Language Detector") after a 781-caption real-data bake-off. `tinyld` confidently misread plainly-English business copy as Italian (e.g. `it:0.96` on a Monday caption reused across ~18 ads, inflating Monday's "Italian" footprint from a true ~3 to 23), and the old margin-based "English prior" workaround could not catch high-confidence errors — it also over-corrected genuine French back to English. `eld` fixed **both** directions: 20 → 0 English false-positives, recovered the mislabeled French, and did **not** regress on the short Spanish/Portuguese sister pair. So `eld` replaced `tinyld` **and** let us delete the English-prior hack (more accurate, less code).

**Corrected footprint (shipped module):** Monday's phantom Italian 23 → 3 (flagged minor); Asana French 36 → 50; ClickUp unchanged (was already right). **tsx caveat:** `eld`'s npm package only declares the ESM `"import"` condition, so a static `import { eld } from "eld/large"` fails under `tsx` (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — Next.js/vitest/tsc resolve it fine. No current code hits it; a future `tsx` CLI needing detection must use `await import("eld/large")`. Removed `tinyld`, added `eld` as a prod dependency. `typecheck` 0 · `lint` clean · 14 language tests + full suite green.

## 2026-06-20 — Documentation sweep: purge stale references to the removed AI layer

Follow-up to the AI-layer removal. The removal commit deliberately deferred the doc sweep ("to avoid rewriting twice"), but `CLAUDE.md` auto-loads into every session as instructions, so its stale commands (`pnpm analyze`/`synthesize`/`recommend`), folder map, conventions, and gotchas were actively misleading every future session. Full sweep done now (user approved "full sweep").

**What changed (5 files, docs only — zero code):**
- **`CLAUDE.md`** — added a top status banner; removed the three dead CLI commands; fixed the `lib/ai/` + `scripts/` folder map to the surviving files; rewrote the AI conventions (dropped the analyzer-version banner, selling-motion/`dominant_ctas`, `ai-powered` angle, replace-on-run recs, prompt-caching-for-analyzer, synthesis/recs-user-triggered bullets) into "conversion goal is CTA-derived" + "AI is user-triggered + structured-output only"; collapsed the removed-analyzer gotchas (analyze/synthesize API routes, synthesizer roll-ups, image sniffing, `.env`, failed-stub-rows) into one "lessons banked for the rebuild" gotcha.
- **`docs/ai-pipeline.md`** — restructured down to the surviving onboarding AI only (provider abstraction, structured-outputs rule, company-profile generator, competitor suggester, CTA→goal taxonomy). The removed analyzer/synthesizer/recommender design is **not** reproduced in the doc — a one-paragraph pointer says "recover it from git before `63812c2`" (it was briefly kept as an appendix, then trimmed at the user's request to keep docs lean).
- **`docs/architecture.md`** — redrew the system diagram (AI stages dashed/removed), rewrote the data-flow lifecycle to scrape→score→dashboard, folded the analyzer-versioning / synthesis / recommendation-dedup notes into a single "removed/dormant" note, fixed the "what lives where" table + failure boundaries.
- **`docs/dashboard.md`** — status banner; rewrote the competitor-detail section to what renders now (the deterministic "Ads by format" breakdown matrix + the scored ad grid + a deterministic-only ad-detail dialog); replaced the Insights spec with the live "coming soon" placeholder; corrected the swipe-file note (angle filter removed, gated on *scored* not *analyzed* ads); flagged the removed synthesis panel / recommender / scoreboard / button state-machine as rebuild targets.
- **`data/field-analysis.md`** — added a "historical snapshot (pre-removal)" banner; left the dated audit tables intact (rewriting a dated snapshot would falsify it).

**Verification.** Re-grepped all `.md` for removed-layer identifiers (`synthesis-panel`, `pnpm analyze/synthesize/recommend`, `the synthesizer`, `the recommender`, `ANALYZER_VERSION`, `dominant_ctas`, etc.); every remaining hit is inside an explicitly-flagged "removed / rebuild reference" block. No code touched, so typecheck/lint/tests are unaffected.

## 2026-06-20 — Removed the old AI analysis layer (rebuild, step 1)

The AI ad-analysis was judged low-value ("all crap" for bulk analysis) and is being rebuilt from scratch. Step 1 = tear out the old layer to reach a clean, compiling, running foundation before building the new one. The 13 AI columns on `ad_analyses` had already been dropped (schema + DB), which broke ~29 typecheck errors across ~21 files; this change removes the dependent code.

**Removed (20 files):** the creative analyzer + prompt, the AI synthesizer + prompt, the recommender + prompt (`lib/ai/analyzers/{analyze-creative,synthesize-competitor,generate-recommendations}.ts`, `lib/ai/prompts/{creative-analyzer,synthesizer,recommender}.ts`, `lib/ai/angle-info.ts`), their CLI scripts (`scripts/{analyze-ads,synthesize-competitor,generate-recommendations}.ts`), their API routes (`/api/competitors/[id]/analyze`, `/synthesize`, `/api/recommendations/generate`), and the UI that rendered AI output (`synthesis-panel.tsx`, `recommendations-panel.tsx`, `competitor-scoreboard.tsx`, `analyze-ads-dialog.tsx`). Also deleted three throwaway Python export scripts.

**Surgically edited (15 files):** `lib/ai/schemas.ts` (dropped analysis/synthesis/recommendation schemas + Angle/BrandVoice enums; kept company-profile + competitor-suggester schemas and `ConversionGoalEnum`), `lib/db/queries.ts` (dropped analysis/synthesis/recommendation queries; kept competitor/ad/score/scrape-run queries incl. `upsertScrapedAd`), `lib/scoring/buckets.ts` (removed AI-dependent `isLikelyCampaign` + "Likely campaign" tag; kept deterministic buckets) + its test, the competitor detail page + `ad-detail-dialog`/`ad-card`/`ad-grid` (removed AI sections, kept score + raw fields), the swipe file (removed angle filter, kept buckets/sort), the Insights page (now a minimal "coming soon" placeholder), `scripts/clean-ads.ts` (now decides "analyzed" by row-exists-and-not-failed), `scripts/backfill-conversion-goals.ts` (kept CTA re-derive, dropped the synthesis refresh), and `package.json` (removed `analyze`/`synthesize`/`recommend` scripts).

**Kept untouched:** scraping (`lib/scraper/**`), performance scoring (`lib/scoring/performance-score.ts` + `score-ads.ts`), CTA→goal (`lib/ads/cta-to-goal.ts`), language detection, onboarding (company-profile + competitor-suggester analyzers/prompts/routes), the AI provider abstraction (`lib/ai/client.ts`), and the 781 ads with all their scraped data. The now-unused `competitor_syntheses` + `recommendations` tables stay defined (no destructive migration).

**State:** `pnpm typecheck` 0 errors · `pnpm lint` clean · `pnpm test` 53/53 · app boots and the dashboard renders with no console errors. Next: build the deterministic (zero-AI) analysis layer.

NOTE: `docs/ai-pipeline.md` and parts of `CLAUDE.md` (commands, AI conventions) now describe a removed system — a full doc sweep is deferred until the new deterministic + AI analysis lands, to avoid rewriting them twice.

## 2026-06-20 — Extended Meta data capture (17 new `ads` columns)

Audited a real Meta ad object (30 top-level + 32 snapshot fields) against `normalizeAd()` + the `ads` schema and found we were dropping a lot of usable data. Widened capture to "everything except the very irrelevant." **Data layer only** — nothing surfaced in the UI yet, and the AI analyzer still reads only image + caption (feeding the new copy fields to it is a follow-up).

**What's now captured** (migration `0005_short_forge.sql`, 17 append-only `ADD COLUMN`s):
- `start_date` / `end_date` — **real ISO timestamps** (from Meta's unix seconds). Previously only the derived `daysActive` integer was kept, so launch dates / timelines / "what's new" were impossible.
- `video_urls` — **the actual video file URL** (`video_hd_url` ?? `video_sd_url`) per video card. Before, only the still `video_preview_image_url` thumbnail was stored, so all 273 video ads (35%) were effectively "analyzed" as a frozen frame. **Store URL only, no download (user decision)** — Meta signs these and they EXPIRE within days, so they're a short-lived reference, not a permanent asset.
- `link_description` — the ad's description line (real copy, never captured before).
- `display_link` — the display domain shown on the ad (`snapshot.caption`; note our `caption` column holds `body.text`, a naming quirk).
- `page_like_count`, `page_categories`, `page_profile_uri`, `page_profile_picture_url` — advertiser context (follower count, business category, page link, logo).
- `ad_categories` — top-level `categories[]` ("UNKNOWN" for commercial vs political/housing/etc.).
- `extra_texts` / `extra_image_urls` / `extra_video_urls` — DCO variant copy + creatives.
- `contains_sensitive_content`, `is_reshared`, `branded_content`, `page_is_deleted` — cheap Meta flags.

**Deliberately skipped as "very irrelevant"** (always null/empty for commercial SaaS ads — only political/EU ads populate them): `spend`, `reach_estimate`, `impressions_with_index`, `targeted_or_reached_countries`, `currency`, `country_iso_code`, `total_active_time`, plus regulatory/empty noise (`ad_id`, `fev_info`, `menu_items`, `regional_regulation_data`, etc.).

**Where the change lives:** `lib/db/schema.ts` (columns), `lib/scraper/scrape-competitor.ts` (`MetaAdRecord` + snapshot types + `NormalizedAd` + `normalizeAd()`; `extractFromInitialHtml` and `normalizeAd` are now **exported** for testing), `lib/db/queries.ts` (`upsertScrapedAd` input + insert + re-scrape refresh). All Meta-derived, so a re-scrape backfills pre-existing rows — no data migration needed.

**Verified** on a real saved Meta response (`extractFromInitialHtml` → `normalizeAd` over a `page.html` dump): image ad → dates / linkDescription / displayLink / pageLikeCount (1842) / categories all populated; video ad → real `video_hd_url` captured in `videoUrls`. Typecheck + lint clean.

**Backfill status:** existing 781 rows show NULL in the new columns until re-scraped (free, Playwright-only). User asked to verify-only for now; a full re-scrape of the three tracked competitors is the next step to populate them.

## 2026-06-04 — Synthesis revamp (angle-grouped creatives, raw-CTA selling motion, `ai-powered` angle) + market-sweep removal + `clean:ads`

A multi-part change driven by user feedback on the competitor "Ad strategy" panel and the scraping model.

**1. Winners & Tried-&-dropped now group creatives BY ANGLE.** In `synthesis-panel.tsx`, both sections render each angle as its own block — angle label + plain-English blurb, then 2–3 example ad creatives beneath it (`AngleGroups` component), ordered by ad count, with "+N more … in the full list below" pointers. Previously Winners showed a text angle-list + a flat thumbnail grid, and Tried-&-dropped was a text-only list off the AI's `abandoned_patterns`. **Tried-&-dropped is now derived client-side** from the ad data (paused, non-winner, analyzed ads = the flopped + retired buckets, grouped by angle), so it renders even before "Find patterns" runs and no longer depends on the synthesis. *Why:* the user wanted "2–3 creative examples right under each winner angle, then the next angle" — far more scannable than a wall of thumbnails, and visual for dropped angles too.

**2. "Hooks they lead with" removed** from the Profile section. *Why:* it was the one freehand AI list (verbatim hook snippets pulled out of context, mixed across products/angles) and read as a jumble. The real creatives — now shown grouped by angle with their headlines visible — do that job better. `top_hooks` is still produced by the synthesizer (the recommender still uses it); it's just no longer displayed.

**3. `ai-powered` added to the angle taxonomy (13 → 14 angles).** For ads where AI/automation IS the headline pitch ("let AI do it for you"). Synced across `lib/ai/schemas.ts` (`AngleEnum`), `lib/ai/angle-info.ts`, the creative-analyzer prompt, and the synthesizer prompt. Adding it auto-bumped `ANALYZER_VERSION` → re-analyze banner (re-analyze deferred by the user; see Status). *Why:* the user asked for AI as its own angle. Noted that it's a product-claim, not a persuasion mechanic — but it lives in the same enum.

**4. "Selling motion" now shows the RAW Meta CTA, not our goal jargon.** New `dominant_ctas` JSON column on `competitor_syntheses` (migration `0004_soft_maximus.sql`) tallies the raw `ad.ctaLabel` ("Sign Up", "Learn More"). The synthesis Takeaway, the Profile "Selling motion" fact, and the Insights scoreboard column ("Top goal" → **"Top CTA"**) all read it; the recommender reasons in CTA terms (dimension #2 reworded, reads `dominant_ctas`). `primary_conversion_goal` + `dominant_conversion_goal` (via `lib/ads/cta-to-goal.ts`) are STILL computed/stored but no longer surfaced; `goalLabel`/`GOAL_LABEL` are now unused-but-kept. *Why:* the user found the derived goal taxonomy (lead-capture / demo / awareness…) confusing — "just use Learn More and Sign Up." Display populates on the next `Find patterns`.

**5. Per-country "market sweep" / footprint feature REMOVED.** Deleted: the "Map markets" button, `market-footprint-card.tsx`, the Insights `market-gaps-panel.tsx`, the "Ads by market" breakdown table, per-ad "Runs in" country badges, the scraper's `footprintOnly` + multi-country sweep + ALL-append logic, the `--footprint`/`--countries` CLI flags, the scrape-route `countries`/`footprintOnly` params, `getMarketFootprint*` queries + `MarketFootprint`/`CompetitorFootprint` types, the synthesizer `marketFootprint` rollup, the recommender's geographic dimension (now **4** dimensions), and `DEFAULT_MARKETS`/`countryLabel`/`countryFlag` from `lib/markets.ts`. **Kept:** the primary scrape's two modes (All countries / Specific country, still using `COUNTRY_OPTIONS`), the `ALL_COUNTRIES` sentinel, creative-language detection (unchanged — reads caption/title, never countries), and the `ads.countries` column + `competitor_syntheses.market_footprint` column (both retired-but-kept to avoid destructive migrations). *Why:* the user asked to "delete everything related to the per-country market sweep (keep languages)." Meta exposes no reliable per-ad geography, so the footprint was always a thin, confusing signal. Scraping is one job again.

**6. New `pnpm clean:ads` CLI (`scripts/clean-ads.ts`, `--dry-run`).** Deletes ads that are BOTH paused AND not successfully analyzed; keeps all active ads + all analyzed ads (incl. paused ones feeding Tried-&-dropped). Cascades orphaned `performance_scores` + `ad_analyses` rows and the creative files on disk. Demo-guarded, pure, zero AI. **Run live 2026-06-04: deleted 976 ads + 3,474 creative files** (1,757 → 781 ads). *Why:* the user asked to keep the library clean by removing non-active, non-analyzed ads.

**Verification.** `pnpm typecheck` + `pnpm lint` clean. Migration generated + applied. Cleanup run for real. UI verified in the browser preview: angle-grouped Winners/Tried-&-dropped render with creatives, "Hooks they lead with" gone, "Selling motion" degrades to "—" until re-synthesis, Insights shows "Top CTA" with no Markets column / Market-gaps panel, no Map-markets button, no runtime errors. Docs swept: `CLAUDE.md`, `docs/scraping.md`, `docs/dashboard.md`, `docs/ai-pipeline.md`. **Pending (user-deferred):** the paid re-analyze of the 781 remaining ads (needed for `ai-powered` to populate and for `dominant_ctas` to fill in on re-synthesis).

## 2026-06-03 — Language detection: franc-min → tinyld (Spanish/Portuguese were being erased)

**What changed.** Replaced the creative-language detector's engine in `lib/lang/detect-languages.ts`. Was `franc-min` + a `MIN_MARGIN` (0.10) confidence gate; now `tinyld` (a detector purpose-built for SHORT text) + a re-tuned **English-prior tie-break** (`ENGLISH_PRIOR_MARGIN` = 0.02). tinyld returns ISO 639-1, mapped back to the module's ISO 639-3 contract via a new `ISO1_TO_3` table, so no consumer (synthesizer, schema, UI) changed. Dependencies: removed `franc-min` and `eld`, added `tinyld` (net flat). Added real-caption regression tests (the exact Monday.com strings that broke) — suite 10 → 11 tests, all green; `pnpm typecheck`/`lint` clean.

**Why.** Investigating "why doesn't Monday.com's What's-new / language read show its Spanish & Portuguese push," the synthesis contradicted itself: the AI `recent_pivots` narrative correctly described "a significant expansion into Spanish- and Portuguese-language markets," but the deterministic `creative_languages` counter reported **Spanish = 1, Portuguese = 2** out of 180. Root cause: **franc-min cannot separate short Spanish from short Portuguese** — they are sister languages that score within ~0.1 of each other on ad-length copy, so the margin gate rejected nearly every genuine ES/PT caption as a "near-tie" → "undetected." (It also confidently mislabeled "Empieza tu prueba gratis hoy" as Bosnian.) The gate that was designed to *avoid phantom languages* was instead *suppressing real ones* whenever the real language had a close linguistic sibling. So the product's own roll-up erased the single most visible trend in the account.

**How chosen — a real-data bake-off (not a guess).** Hand-labeled 28 real captions across en/fr/de/it/es/pt and ran franc-min vs tinyld vs eld. Results: franc **3/7** on Spanish+Portuguese (79% overall); **tinyld 7/7** (93% overall); eld inconclusive (needs an async `eld.load()` the harness skipped — dropped, not chosen). tinyld's only misses were 2 terse, brand/list-heavy English fragments ("Tasks, docs, whiteboards…" → Romanian; "ClickUp Brain makes image generation 10x faster" → Estonian) where English was the close runner-up — recovered by porting the English-prior tie-break onto tinyld's scores, giving **28/28** on the combined detector.

**Caught in real-data validation (not the bake-off): a Unicode-glyph trap.** Running the new detector over Monday's actual 206 analyzed ads (free, no AI) before declaring victory surfaced a SECOND bug the clean labeled bake-off missed: tinyld labels *everything* (no "undetected" floor), and **55 plainly-English ads came back as Armenian (`hy`) at 100% confidence**. Cause: Monday writes "monday․com" using **U+2024 ONE DOT LEADER**, a period lookalike — that single glyph flips tinyld's script guess. Fix: **NFKC-normalize** copy before detection (`stripTemplates` now appends `.normalize("NFKC")`), which folds U+2024→"." and ClickUp's 𝗺𝗮𝘁𝗵-𝗯𝗼𝗹𝗱 captions→ASCII while preserving real accents. After the fix Monday reads a trustworthy English 60% / French 13% / Italian 11% / **Spanish 8% / Portuguese 5%** / German 2% — vs the old broken English 79% / Spanish 0.6% / Portuguese 1%. Lesson logged: validate detectors on messy production strings, not just hand-picked clean captions.

**Propagation / not yet visible.** Like all deterministic roll-ups, `creative_languages` only refreshes on a **re-synthesis** (free — reads existing columns, no re-scrape/re-analyze). Monday's on-screen language read won't show Spanish/Portuguese until `Find patterns` is re-run. Separately, the roll-up still only sees the **206 of 872** Monday ads that are analyzed — fixing detection makes the *sample* honest, not *complete* (analysis coverage is the open data-hygiene item in Status). Files: `lib/lang/detect-languages.ts` (+ `.test.ts`), `package.json`; docs swept in `CLAUDE.md` (folder map + synthesizer-rollup gotcha) and `docs/ai-pipeline.md` (`creative_languages` bullet).

## 2026-06-03 — "What's new" panel: 30-day window + dominant-angle summary line

**What changed.** In the competitor "Ad strategy" panel (`app/competitors/[id]/_components/synthesis-panel.tsx`), the **🆕 What's new — recent launches** section now (1) always uses a **30-day** window instead of the previous "14 days, fall back to 30 if empty" logic — `recent = live ads with daysActive <= 30`, newest first; and (2) opens with a **one-line plain-English summary** naming the dominant angle(s) among the recent set (new `RecentAngleSummary` component + a small `listJoiner` grammar helper), e.g. *"Mostly Product demo, Social proof, and UGC-style angles."* The `recentWindow` (14|30) state was removed; `deriveHeroSections` now also returns `recentAngles` (top 3 angles among recent ads, same derivation as `winnerAngles`).

**Why.** User asked to always show the last 30 days (the 14-day-first behavior under-reported recent activity for brands that don't launch weekly) and to add a summary line so the section leads with *what kind* of ads are new, not just a wall of cards. Dominant-angle framing was chosen (over conversion-goal or velocity framing) to stay consistent with the Winners section's "Mostly these plays" read.

**Also answered (no code change).** Investigated "why does Monday.com show only 1 winner angle": it's correct, not a bug — of Monday's 872 scraped ads only 38 are live and 206 analyzed, and exactly **2** clear the strict winner bar (live + score ≥70 + 60+ days), both "Product demo" → one angle. The thin winner pool is partly because ~666 of Monday's newer ads aren't analyzed yet (see the data-hygiene note in Status).

**Files.** `app/competitors/[id]/_components/synthesis-panel.tsx` only. No query, schema, or dependency changes. `pnpm typecheck`/`lint` clean; verified live in the browser (Monday.com What's-new now reads "36 ads launched in the last 30 days" + the angle summary). Docs: `docs/dashboard.md` "What's new" bullet.

## 2026-06-03 — Insights: deterministic "Competitor scoreboard" comparison table

**What changed.** Added a third panel to the Insights page (`app/insights/_components/competitor-scoreboard.tsx`), positioned between the recommendations and the market-gaps panel: a **non-AI, zero-cost side-by-side table** of every active competitor, with the user (`self`) pinned + highlighted at top ("You" badge, tinted row). Each row is read straight from that competitor's saved `competitor_syntheses` row via the new `getSynthesesForActiveCompetitors()` query (LEFT join, so un-synthesized competitors are still returned). Columns: ads analyzed · media mix % · launch velocity (14d/30d) · market count · language count · top conversion goal · top brand voice · top angle · top 2 pain points · top 2 benefits. Every row also shows a "synthesized {age}" staleness stamp. All enum codes are humanized through `lib/ai/angle-info.ts` (`angleLabel`/`goalLabel`; voice is title-cased inline).

**Why.** The Insights page already compared *you vs the field* narratively (recommendations) and geographically (market gaps), but there was no scannable *everyone-vs-everyone* scoreboard. All the comparison data was already sitting in `competitor_syntheses` (the deterministic roll-ups), so surfacing it as a table is pure re-arrangement — no new AI call, no cost, no schema migration, always current as of each competitor's last `Find patterns` run.

**Honest-data rules baked in.** (1) A competitor without a synthesis renders a muted "Not analyzed yet — run Find patterns" row rather than being dropped (you see who's missing, not mistake them for having no ads). (2) If nobody has been synthesized, a nudge replaces the table. (3) The pain-point/benefit **shared-highlight** (amber `◆`, "two or more companies share this") fires only on an **exact, normalized match across the displayed top-2** of 2+ distinct companies — computed over the same slice shown so every `◆` has a visible twin (an earlier draft computed it over each company's full list, producing `◆`s whose match was hidden off-screen — caught and fixed during browser verification). Exact-only by design (no fuzzy matching, per the plan), so on free-text AI strings it's deliberately rare-but-trustworthy.

**Files.** New `app/insights/_components/competitor-scoreboard.tsx`; new `getSynthesesForActiveCompetitors()` + `CompetitorWithSynthesis` type in `lib/db/queries.ts`; `app/insights/page.tsx` (fetch in the existing `Promise.all`, render between Recommendations and Market gaps). No new dependencies, no migration. `pnpm typecheck`/`lint` clean; verified live in the browser preview (self pinned, all metrics populated, shared-highlight correctly silent on the current 3-competitor data which shares no exact top-2 pain point).

## 2026-06-03 — "Always-on" now requires the ad to be live (fixes "Always-on + Paused" combo)

**What changed.** In `lib/scoring/buckets.ts`, the `always-on` tag now requires `is_active = true` (was `winner && score >= 70 && days_active >= 60`, with no live check). It is now mutually exclusive with the `paused` tag: a proven 60+ day winner that's been switched off is **Winner + Paused**, never **Always-on + Paused**.

**Why.** A user spotted a Monday.com ad in the Winners section tagged BOTH "Always-on" AND "Paused" (and "Inactive"), running 325d. "Always-on" reads as present-tense "still running constantly", so pairing it with "Paused" was contradictory. The old tag only measured *how long the ad ran* (a quality of the creative), ignoring whether it's live now. (The 325d itself was correct — `computeDaysActive` freezes a paused ad's run length at its `end_date`; it's run length, not age.) Consequence: the redesigned Winners hero (which filters on the `always-on` tag) is now genuinely **live-only**, matching its "still running after 60+ days" copy — the user chose "Live winners only". Paused proven winners still appear in the full ad grid below as Winner + Paused.

**Ripple.** The synthesizer's stored `always_on_winners` list (and the recommender's `alwaysOnWinnerCount`) now mean "live always-on winners" — they shrink to live-only on the next re-synthesis (the redesigned panel derives winners live via `classify()`, so the UI updates immediately without re-synthesis). Updated: `lib/scoring/buckets.ts` (+ a regression test that a paused 60+ winner never gets `always-on`), `lib/db/schema.ts` comment, `docs/scoring.md` predicate table, `lib/ai/prompts/recommender.ts` wording, `synthesis-panel.tsx` empty-state copy. `pnpm typecheck`/`lint` clean, bucket tests pass; verified live (Monday.com + Asana Winners now show only Active always-on ads).

## 2026-06-03 — "Ad strategy" summary panel redesign (Winners / Tried & dropped / What's new + Profile)

**What changed.** Rewrote the competitor synthesis panel (`app/competitors/[id]/_components/synthesis-panel.tsx`) from a flat stack of ~11 equal-weight enum-badge rows into three reader-first hero sections plus a cleaned-up secondary profile:
- **🏆 Winners — what's working**: the strict always-on set (score ≥70, 60+ days), derived live from the ad data via `classify()` (renders even before "Find patterns" is run). Leads with the top angles *among winners*, each explained in plain English, then real ad cards.
- **⚰️ Tried & dropped**: from `abandoned_patterns`, each row now naming the angle + a one-line explanation.
- **🆕 What's new — recent launches**: live ads from the last 14 days (fallback to 30 if empty), newest first, as real ad cards.
- **Profile**: secondary dimensions reorganized into a fact sheet — Voice · Selling motion (goal split) · Media mix as a 3-up row; pain/benefit chip lists; "Hooks they lead with"; languages shown ONCE (the old duplicate localization block removed); collapsed "All angles" distribution.

**Why.** User feedback: the old panel was "a mish mash, hard to read, jargon-heavy" — raw enum names (`product-demo`, `ugc-style`) shown bare, "Winners" reduced to a one-sentence count instead of the actual ads, localization shown twice. The redesign gives clear hierarchy, shows real ad creatives under Winners/What's-new, and replaces every enum string with a human label + blurb.

**Supporting changes.** New shared `lib/ai/angle-info.ts` (pure map: angle/goal code → label + one-line explanation; the single source so no enum jargon leaks to the UI). Extracted the reusable `AdCard` (+ `BUCKET_EMOJI`, `mediaPathToUrl`, `hostnameOf`) out of `ad-grid.tsx` into `app/competitors/[id]/_components/ad-card.tsx` so the summary and the full grid share one card. `page.tsx` now passes `ads`/`scores`/`analyses` into the panel. `pnpm typecheck`/`lint` clean; verified live in the browser. Docs: `docs/dashboard.md` "Ad strategy summary card".

## 2026-06-03 — Conversion goal: derived from the Meta CTA, not the AI (+ new `awareness` goal)

**What changed.** `primary_conversion_goal` is no longer a vision-model output. It's now mapped deterministically from the ad's Meta CTA in the new pure, unit-tested `lib/ads/cta-to-goal.ts`, written into the `ad_analyses` row at analyze time. The field was removed from the analyzer prompt + the `CreativeAnalysisSchema` (`lib/ai/schemas.ts`). Added an **`awareness`** goal (for generic brand/site-visit CTAs like "Learn More", "View Instagram Profile") to both the Zod enum and the `ad_analyses` column enum (text column — no migration). New `pnpm backfill:goals` (`scripts/backfill-conversion-goals.ts`) re-derives goals for all existing rows and refreshes the stored `dominant_conversion_goal` counts on synthesis rows — pure, zero AI.

**Why.** Investigating "why are most ClickUp ads lead-capture?" exposed the bug: ClickUp uses the generic "Learn More" button on ~every ad, so the model was scattering identical ads across lead-capture / demo-request / free-trial / other based on caption vibes alone (112 "lead-capture" ads all had the "Learn More" CTA and landed on product/feature pages — they were brand-awareness, not lead-capture). Across the dataset Meta really only exposes two meaningful CTAs ("Sign Up" 965, "Learn More" 737), and "Learn More" scattered 6 ways under the model while "Sign Up" was ~95% free-trial. The button the advertiser chose is the ground truth for intent, so we map it directly — deterministic, reproducible, zero AI cost, and no hallucinated distinctions. Honest caveat accepted: this loses the ability to flag a genuine demo/content-download ad behind a generic button, but that signal was unreliable anyway.

**Impact (after `backfill:goals`, 639 analyzed ads, 338 changed).** ClickUp: 112 lead-capture → **185 awareness** (real story: ClickUp runs almost entirely brand/awareness ads, NOT lead-capture). Monday.com: **187 free-trial** / 19 awareness. Asana: **119 free-trial** / 88 awareness. The earlier "ClickUp relies on lead-capture" recommendation was an artifact of the missing `awareness` slot; re-running `pnpm recommend` regenerates against the corrected mix.

**Files.** `lib/ads/cta-to-goal.ts` (+ `.test.ts`), `lib/ai/schemas.ts` (enum + field removal), `lib/db/schema.ts` (enum), `lib/ai/prompts/creative-analyzer.ts` (taxonomy + example removed), `lib/ai/analyzers/analyze-creative.ts` (writes the derived value; note: removing the schema field bumps `ANALYZER_VERSION` → a cosmetic "Re-analyze all" banner you can ignore, since goal no longer comes from the model), `scripts/backfill-conversion-goals.ts`, `package.json`. Docs: `docs/ai-pipeline.md` "Conversion goal taxonomy".

## 2026-06-03 — Synthesizer: four new deterministic roll-ups (languages, media mix, pain/benefits, velocity)

**What changed.** Extended the competitor synthesizer with four more deterministic aggregates, written to new (append-only, migration `0003_past_omega_red.sql`) `competitor_syntheses` columns and surfaced in the "Ad strategy patterns" panel:
- **`creative_languages`** — how many languages the brand writes copy in (localization *depth*). New pure, unit-tested module `lib/lang/detect-languages.ts` (franc-min) detects per-ad language from **`caption`/`title` only — never the CTA** (`cta_text` is localized to the viewer; the documented Kannada-CTA trap).
- **`media_mix`** — image/video/carousel counts (`ads.media_type`). Strong recommender format-gap driver.
- **`top_pain_points`/`top_benefits`** — most-repeated pains/benefits, flattened from per-ad analyzer arrays we already extract but were ignoring at synthesis.
- **`launch_velocity`** — new *live* creatives that started running in the last 14/30 days.

**Why these four.** They're all "machines count, the model reasons" aggregates — **zero added Sonnet tokens** (the one reasoning call is unchanged). The analyzer already paid the vision cost to extract pain/benefits/media; we were just discarding it at roll-up time. Media mix especially earns its place by feeding the recommender ("they're 60% video, you're 100% static").

**Two bugs caught by validating on real data before shipping (Monday/Asana):**
1. **franc hallucinated languages on short English copy** — "No matter what kind of work you do, Asana helps you manage it." ranked Tagalog 1.00 vs English 0.975 (a 2.5% margin); "…No cape required." ranked German over English. A confident-but-wrong language is worse than none, so `detectLanguage` now reads the full ranked list (`francAll`) and applies a **confidence gate**: trust the winner only if it clears the runner-up by `MIN_MARGIN` (0.10); on a near-tie, fall back to English if it's a close contender, else "undetected". It deliberately **under-claims** localization (errs toward false negatives, like `pageNameMatches`). After the fix: Monday → English-only (the phantom Quechua became "undetected"), Asana → English-only (no phantom Tagalog/German).
2. **Launch velocity measured the wrong thing** — first cut used `firstSeenAt`, which is when *our tool* first scraped the ad, so every competitor read "30 new in 14d" on first scrape. Rebased on `isActive && daysActive <= N`: for a live ad, `daysActive` = days since Meta's `start_date` = real launch recency. After the fix: Monday 0/3, Asana 4/4 — believable (both run long-lived evergreen creative).

**Files:** `lib/lang/detect-languages.ts` (+ `.test.ts`, 10 cases incl. the two real false-positive regressions), `lib/db/schema.ts` (5 new JSON columns), `drizzle/0003_past_omega_red.sql`, `lib/db/queries.ts` (`getAnalyzedAdsForCompetitor` now returns caption/title/mediaType/painPoints/benefits; `upsertCompetitorSynthesis` persists the new fields), `lib/ai/analyzers/synthesize-competitor.ts` (the four aggregate helpers), `app/competitors/[id]/_components/synthesis-panel.tsx` (StatStrip + LanguagesSection + ValueCountRow). One new dependency: `franc-min` (MIT, ~tens of KB). `pnpm typecheck`/`lint` clean, 50/50 tests.

**Note:** the new fields populate only on a **re-synthesis** (no backfill of old rows) — but need no re-scrape/re-analyze; they read columns we already have. They reflect the *analyzed subset*, same as the existing angle/voice tallies.

---

## 2026-06-03 — Split scraping into two jobs: ALL-default scrape + footprint-only "Map markets"

**The bug that started it.** Monday.com showed **0 active ads out of 827** in the DB, while ClickUp (174 active) and Asana (18 active) looked normal. Investigation (read-only, against the live DB) traced it to *capture time*, not `markMissingAdsInactive`: Monday's most-recently-scraped ads were written with `is_active=0` directly.

**Root cause — `is_active` is per-VIEW, and the old sweep picked the wrong view.** Meta reports the same ad's active status differently depending on which library you query. A global/Advantage+ ad (Monday's whole account) reads **paused in a single country's library** but **active in the global `ALL` view**. The old combined geo-sweep looped the countries first and appended `ALL` last, and the union (`if (!byLibraryId.has(id)) set(id, ad)`) was **first-occurrence-wins** — so the paused per-country version locked in and the active `ALL` version was thrown away. Result: every global advertiser flipped to ~100% paused. Confirmed in data: ClickUp's 33 "ALL-only" ads were all active, proving the ALL view carries the live status the sweep discarded. (The user recalled this exact per-country-vs-ALL discrepancy from a prior session — that recollection cracked the case.)

**The fix — separate "is it live?" from "where does it run?".** Rather than patch the union merge, we removed the scenario:
- **`ALL` is now the PRIMARY/default scrape** (the "Scrape ads" button). Widest volume + authoritative `is_active`. A single-market scrape stays available under "Specific country."
- **The geo sweep became a separate, footprint-only "Map markets" action** (`scrapeCompetitor({ footprintOnly: true })`). It records ONLY each ad's `countries[]` and: skips the `ALL` completeness pass, skips `markMissingAdsInactive`, and via `upsertScrapedAd({ footprintOnly: true })` updates only `countries`/`last_seen_at` on existing ads. It never writes `is_active` or scoring.

Because a footprint sweep no longer writes the live/paused flag, the per-country/ALL conflict **can't occur** — no union-merge change was needed. This is the elegant part: the bug is dissolved by design, not patched.

**What shipped (no schema migration):**
- `lib/scraper/scrape-competitor.ts` — new `footprintOnly` option; skip ALL-append + `markMissingAdsInactive` when set; guard against footprint mode without a market list; mode-aware progress log.
- `lib/db/queries.ts` — `upsertScrapedAd` gains `footprintOnly`: existing rows get a `countries`-only update.
- `app/api/competitors/[id]/scrape/route.ts` — parses + forwards `footprintOnly`.
- `scripts/scrape.ts` — `--footprint` flag (sweeps `DEFAULT_MARKETS` by default; `--country=ALL` documented as the primary scrape).
- `components/scrape-ads-dialog.tsx` — scrape picker is now **All countries (recommended, default)** / **Specific country** (geo sweep removed from it); new `purpose="map-markets"` variant renders the footprint-only sweep UI. Default mode flipped `single`→`all`.
- `app/competitors/[id]/page.tsx` — added the **"Map markets"** button beside "Scrape ads".
- Docs: `CLAUDE.md` (commands + gotchas), `docs/scraping.md` (rewrote "Country selection" into "two separate jobs"), this changelog.

**Verified:** typecheck + lint clean. In-browser (Asana): the "Map markets" button renders; the Scrape dialog defaults to "All countries (recommended)" with the geo sweep gone; the Map markets dialog shows the footprint-only explanation, a per-market cap, and no country picker; no console errors. **Validated on live data:** re-scraped all three on `ALL` — **Monday went 0 → 38 active** (fix confirmed), Asana 20, ClickUp 222. (ClickUp needed a cap=600 re-scrape: an initial cap=200 run wrongly flipped 66 previously-active ads inactive because its library is ~557 > cap — the known `markMissingAdsInactive`+cap interaction, not a regression. cap=600 restored it with `went_inactive: 0`.)

**Also fixed a stale test (unrelated):** `lib/scoring/buckets.test.ts` had one failing case asserting a paused 50-day ad is `other` — left over from before the Retired bucket (`is_active=false && days_active>=14` → `retired`) shipped 2026-05-31. Updated the assertion + name to expect `retired`. Suite is back to green (40/40).

## 2026-05-31 — Scraper under-capture fix: paginated batches arrive as `text/html`

**Symptom:** every market capped at ~30 ads regardless of how many the brand actually runs (ClickUp's US library shows ~1,400). Geo sweeps therefore under-represented every competitor.

**Diagnosis (instrumented, not guessed):** a throwaway diagnostic logged scroll position, page height, and every network response while scrolling ClickUp's US page. Findings:
- The page scrolled fine (`scrollY` 0 → 41k, `scrollHeight` 5.7k → 44k) — the wheel events worked.
- With the content-type filter removed, **350+ unique `ad_archive_id`s streamed in under a minute**, all from `/api/graphql` responses with `content-type: text/html`.
- So the bug was never the scroll. The first ~30 ads come from the initial SSR HTML (`extractFromInitialHtml`); every *paginated* batch was being dropped by the response listener because its content-type allowlist only accepted `json`/`ndjson`/`text/javascript`.

**Fix:** in `collectMarketAds` (`lib/scraper/scrape-competitor.ts`), reorder the listener to gate on the **URL** (`/api/graphql|/ads/library`) first, then accept `text/html` alongside json. The URL gate keeps us from reading unrelated HTML bodies.

**Validated:** single-market `--country=US --max-ads=200` on ClickUp climbed 25 → 45 → … → 200 (capped), 137 new ads saved. Then a full geo re-sweep (ClickUp/Monday/Asana, 10 `DEFAULT_MARKETS`, **200/market**, `active_status=all` to preserve the paused/"what they dropped" signal).

**Why 200/market & all-status:** user wants the "what competitors tried and abandoned" signal, which needs paused ads (`active_status=all`). Meta serves newest-first, so a 200 cap yields the ~200 most-recent active+paused ads per market; our own scoring (longevity/recency/placement) then ranks relevance. 200 also stays safely above existing DB counts (Monday 190) so `markMissingAdsInactive` can't wrongly flip leftovers to paused.

**Doc:** added a CLAUDE.md gotcha ("Paginated ad batches arrive as `text/html`, NOT json") so this can't regress.

---

## 2026-05-31 — New "Retired" bucket (splits the oversized Other)

The Other bucket was suspiciously large (119 ads across all brands; 20 of ClickUp's 113). A query showed **100% of Other was paused ads that had run 14–64 days (avg 37) before being switched off, avg score 63** — i.e. proven creatives the advertiser cycled out, not junk. The old taxonomy only had a home for paused-*fast* ads (Flopped, `< 14` days); anything that ran longer then stopped fell through to Other. The code comment in `buckets.ts` had already flagged this as a planned "retired" treatment.

**Fix (free, pure-math — no re-scrape, no AI, recomputed on render):** added a **Retired** bucket = `is_active = false AND days_active >= 14`. Every paused ad now resolves cleanly: pulled fast → Flopped, ran-then-stopped → Retired, genuine high-scorer → still a Winner (`paused` tag, Winner keeps priority). Priority is now **Winner > New > Maturing > Flopped > Retired > Other**, leaving Other a true residue (only a *live* ad past 30 days scoring `< 70` — currently empty in the DB).

**Touched (all free, presentation + predicate):**
- `lib/scoring/buckets.ts` — `Bucket` union + `BUCKET_LABEL` + new `isRetired()` + `bucketOf` priority; refreshed the Flopped/Other doc comments.
- `lib/ai/analyzers/synthesize-competitor.ts` — comment only; Retired folds into the synthesizer's internal `other` exactly as those ads did before, so synthesis output is unchanged (no re-run needed).
- UI bucket switches: `ad-grid.tsx` (📦 emoji, slate colour, order, counts), `breakdown-tables.tsx` (order/emoji/header colour), `ad-detail-dialog.tsx` + `swipe-file/swipe-grid.tsx` (colour + bucket Record). Swipe file has no Retired *section* yet (consistent with Maturing/Other — possible follow-up; Retired ads are strong swipe material).
- `docs/scoring.md` — predicate table + Flopped-vs-Retired prose + Other-is-now-residue note.

Verified in-browser on ClickUp: bucket bar reads 🏆 65 · 🌱 1 Maturing · ⚰️ 27 Flopped · 📦 20 Retired, and both breakdown tables now show a Retired column with Other all-zero (market "All" row: Retired 60 / Other 0). Typecheck + lint clean.

**Not touched (deliberately):** the separate conversion-goal `other` (13 awareness ads) — confirmed deferred to the re-sweep. See Next-up.

---

## 2026-05-31 — Competitor page: by-market & by-format breakdown tables

Two new tables on each competitor detail page, answering "where (geographically) and in which creative format are this brand's Winners / Maturing / Flopped ads concentrated?" — a question the flat ad grid couldn't show at a glance.

**Changes (one new client component, ~5 lines wiring):**
- **`app/competitors/[id]/_components/breakdown-tables.tsx`** (new) — pure presentation. Takes the `ads` + `scores` already loaded by the page (no new DB query, no AI, zero cost). Computes each ad's bucket once via the canonical `bucketOf` from `lib/scoring/buckets.ts`, then renders two `components/ui/table.tsx` matrices side-by-side:
  - **Ads by market** — rows = countries (flag + name via `lib/markets.ts` helpers), columns = the 5 buckets (🏆/🧪/🌱/⚰️/○) + Total, sorted by row total. The `ALL` sentinel is excluded (carries no real geo).
  - **Ads by format** — rows = Image / Video / Carousel (empty format rows hidden) + an "All" totals footer.
- **`app/competitors/[id]/page.tsx`** — import + `<BreakdownTables ads={ads} scores={scores} />` rendered right below the Markets card (only when `ads.length > 0`).

**One deliberate honesty caveat (baked into the UI as a footnote):** a bucket is a property of the *whole ad* — Meta exposes no per-country age or active-status — so in the market table a multi-market ad is counted once in **each** market it runs in. That means the market table's column totals can exceed the ad count (ClickUp: 247 across markets vs. 113 ads); the format table's totals equal the ad count (each ad is one format). A second footnote reports how many ads have no market data yet (need a geo-sweep re-scrape to populate).

Verified in-browser on ClickUp: market table renders with flags + the "All" totals row; format table sums to 113 and its Winner/Flopped/Maturing/Other column totals match the existing filter-chip counts exactly. Typecheck + lint clean. Presentation-only — no change to the canonical predicates, so no `docs/scoring.md` edit. (Note: these tables reflect *current* data, which is still pre-completeness-fix; they'll get richer after the pending re-sweep.)

---

## 2026-05-31 — Scraper completeness: real wheel-event scrolling + ALL pass (awaiting live validation)

Two fixes to capture the ads we were silently missing. **Not yet validated end-to-end** — see the In-progress note in the Status block (Meta rate-limited the test IP).

- **Real mouse-wheel scrolling** — `scrollUntilStable` was paginating with `window.scrollBy`, which sets scroll position but doesn't fire Meta's lazy-load listener, so pulls capped out early (~25 ads on a market that has hundreds). Switched to `page.mouse.wheel(0, 6000)` after positioning the cursor; raised the no-growth streak limit 4→6 and the loop cap 60→80 to give slow markets room. In isolated testing this took one market from ~25 to ~520 ads.
- **ALL completeness pass for geo sweeps** — some live ads (Advantage+/global campaigns) aren't attributed to any single-country library and only surface in Meta's global `ALL` view. Monday.com is the tell: it had 0 ads per-country but live ads in `ALL`. So a multi-market sweep now appends `ALL` as a final pass. The existing `if (market === ALL_COUNTRIES) continue;` guard means this pass adds ads but records NO country footprint (recording "ALL" as a country would poison footprints), and because re-scrapes UNION countries, it never erases real markets a prior pass found.

Both in `lib/scraper/scrape-competitor.ts`. Pending: live re-sweep of ClickUp/Monday/Asana at 100/market once the throttle lifts, then analyze→synthesize→recommend.

---

## 2026-05-31 — Swipe File page (cross-brand ad gallery)

The Swipe File nav item was a placeholder. It's now the cross-brand "steal-worthy" gallery the spec in `docs/dashboard.md` describes: every scored ad from **all** tracked brands in one view, so you can scan "what to copy / what to test" without clicking into each competitor.

**Scope decision:** includes the user's own `self` ads alongside competitors' (each card is brand-labeled, with "(You)" on self ads) — confirmed with the user. This differs from the recommender, which excludes self ads from its evidence catalog; the swipe file is a browse surface, not a citation source, so showing your own ads for comparison is useful.

**Changes:**
- **3 new read-only queries** in `lib/db/queries.ts`: `getSwipeFileAds()` (all ads across non-deleted competitors incl. self, joined to brand name + status, newest first), `getAllScores()`, `getAllAnalyses()`. The latter two are unscoped bulk reads keyed by `adId` in the page; extra rows for ads outside the set are harmless.
- **`app/swipe-file/page.tsx`** — server component (`force-dynamic`), loads the three queries in parallel, keys scores/analyses by `adId`. Empty state (no *scored* ads) links to `/competitors`. Gate is "has a scored ad," not "has an analyzed ad," because scoring is pure math and doesn't need an AI analysis.
- **`app/swipe-file/_components/swipe-grid.tsx`** — client component. Buckets every scored ad via the canonical `bucketOf`/`classify` from `lib/scoring/buckets.ts` (no new grouping logic). Three sections (Winners / New & testing / Flopped, the last only when "Show dropped ads" is on). Angle filter pills are derived from the angles actually present in the data. Sort by Score / Longest-running / Recently-added (firstSeenAt). Cards reuse the `AdDetailDialog` from the competitor page as the drawer.

**Reuse, not reinvent:** the card markup mirrors `ad-grid.tsx`'s `AdCard` but adds a brand letter-avatar + name (letter avatar chosen over external favicon fetches — confirmed with the user) and a 2-line hook (analysis hook → caption fallback). The detail drawer is the *exact* same component, so there's one source of truth for ad detail.

**Deviations from the `docs/dashboard.md` spec (noted, low-risk):** filter/sort/toggle state is local React state, not URL state (URL state is a future nice-to-have); brand icon is a letter avatar, not a favicon. Both were explicit user choices.

Verified in the browser: Winners (29) / New & testing (4) / Flopped (48) render, filter pills + sort + dropped-ads toggle all work, no console errors.

---

## 2026-05-31 — Competitor page: bucket labels on cards + count/filter bar

Follow-up to the bucket-taxonomy work. The buckets existed but were nearly invisible on the competitor detail grid — the only on-card signal was the *color* of the score chip (meaningless unless you know the code), the grid was a flat interleaved list, and "Active only" defaulted ON, hiding the entire Flopped/paused story. Asana, for example: you couldn't tell at a glance that 13 of 30 ads are Winners vs. 4 experiments.

**Changes (all in `app/competitors/[id]/_components/ad-grid.tsx`, pure UI — no new data, no backend):**
- **(A) Bucket label pill on every card** — a text+emoji pill (🏆 Winner / 🧪 Active experiment / 🌱 Maturing / ⚰️ Flopped / ○ Other) in the card body, plus any tags (Always-on / Paused / Likely campaign) via the existing `BUCKET_LABEL`/`TAG_LABEL`. Uses `classify(ad, score, analysis)` so the campaign tag renders on flopped ads.
- **(B) Bucket count/filter bar above the grid** — `All 30 · 🏆 13 Winner · 🧪 4 Active experiment · ○ 13 Other` (zero-count buckets hidden). Clicking a chip filters the grid to that bucket. **Key UX decision: picking a bucket bypasses "Active only"** — otherwise clicking Flopped (always inactive) would show nothing; the checkbox is disabled+greyed while a bucket is selected.

Counts/buckets are computed client-side from the already-loaded `scores` via `bucketOf` (unscored ads → Other). Verified in-browser on Asana: count bar correct, card pills render, clicking Other surfaces all 13 incl. inactive.

**Touched:** `app/competitors/[id]/_components/ad-grid.tsx`, `changelog.md`. Typecheck clean, lint clean apart from the 1 pre-existing `queries.ts` warning. No docs/CLAUDE.md change needed — this is presentation only; the canonical predicates in `docs/scoring.md` are unchanged.

## 2026-05-31 — Bucket taxonomy: add Maturing + Flopped (renamed) + Likely-campaign tag

Refined the per-ad bucket scheme after a data-grounded review of the old four-bucket set (Winner / Active experiment / Abandoned / Other). Two gaps surfaced when bucketing the live DB:
- **Live ads aged 14–29 days vanished into "Other"** — too old to be a fresh "experiment," not yet eligible to be a "Winner." That's the "proving out, watch this" signal, and it was invisible.
- **"Abandoned" couldn't separate a true flop from a planned one-time campaign** (a Black Friday / launch burst legitimately runs a few days and stops).

**Changes (`lib/scoring/buckets.ts`, pure):**
- **New `maturing` bucket** — `is_active = true AND 14 <= days_active < 30`. Surfaces the previously-hidden middle state. Priority is now **Winner > New > Maturing > Flopped > Other**.
- **Renamed `abandoned` → `flopped`** AND **tightened the predicate to run-length only** — `is_active = false AND days_active < 14`. The old second arm (`last_seen > 30 days ago`, *regardless of run length*) was dropped: an ad that ran a long time then went quiet *ran* — it's not a flop. Those now fall to **Other**. (0 ads reclassified in the current DB — the dropped arm caught nothing here — but it removes a latent mislabel and matches the "Flopped = short-lived" intent.) A future "Retired / refreshed" bucket could capture proven-then-paused ads; out of scope now.
- **New `campaign` tag ("Likely campaign")** layered on Flopped — fires when the ad's analysis angle is `offer-led`/`fomo-scarcity` or its themes read promotional (sale / `% off` / seasonal / limited-time). Run length can't tell a flop from a planned promo; the creative *announcing* a deal can. It's an **inferred, analysis-dependent** tag: un-analyzed flops carry no tag. `tagsFor`/`classify` gained an optional `analysis` param; the core bucket math stays AI-free and zero-cost.

**Why a tag, not a separate bucket:** campaigns are still short-lived paused ads, so they belong in Flopped; the tag distinguishes them without fragmenting the bucket or stranding the 37% of short-run ads that aren't analyzed yet.

**Call sites updated:** `synthesize-competitor.ts` (`bucket === "flopped"` feeds the unchanged `abandoned_patterns` output column — no DB migration; documented as a deliberate seam), `ad-grid.tsx` + `ad-detail-dialog.tsx` badge classes (added `maturing` amber, renamed `flopped`; the dialog now passes the analysis row into `classify` so the campaign tag renders).

**Touched:** `lib/scoring/buckets.ts`, `lib/scoring/buckets.test.ts` (34→40 tests), `lib/ai/analyzers/synthesize-competitor.ts`, `app/competitors/[id]/_components/ad-grid.tsx` + `ad-detail-dialog.tsx`, `docs/scoring.md` (canonical predicate table), `docs/dashboard.md`, `CLAUDE.md`. Typecheck clean, 40/40 tests pass, lint clean apart from the 1 pre-existing `queries.ts` warning. Note: the synthesis output concept `abandoned_patterns` keeps its name on purpose — it's fed by the Flopped bucket.

## 2026-05-31 — Three market modes + geographic insights (Pass 2 of 2)

Completes the market-modes work deferred in Pass 1. Most of the engine already existed (the multi-market scan loop + `ads.countries` union); this pass added the third mode, the missing UI, and the data-integrity guard for "All".

**Three scrape modes (replacing the old single "Scan across markets" checkbox):**
- **Specific country** — one country library, records that 1 market. Reveals a country dropdown (~18 curated codes, defaults to home country).
- **All countries** (`country=ALL`) — Meta's global view: fast, widest volume, but Meta hides which country each ad runs in, so it records **no** footprint.
- **Geo sweep** — loops the 10 `DEFAULT_MARKETS`, recording each ad's `countries[]`. `--max-ads` is per-market. The only mode that powers the geographic insights.

**The integrity guard (the one subtle bit):** `ALL` is not a real country code. Naively, `ALL` mode would write `countries: ["ALL"]` onto every ad, making a brand read as "advertises in 1 market: ALL" and poisoning the cross-competitor gaps view. So `scrape-competitor.ts` skips the sentinel (`if (market === ALL_COUNTRIES) continue;`). Because re-scrapes UNION rather than overwrite, an `ALL` run never erases real markets a prior sweep recorded.

**New geographic UI (the actual new user value):**
- **Markets card** (`market-footprint-card.tsx`) on each competitor page — computed live from `ads.countries` via `getMarketFootprint`, no AI/synthesis. Flag-prefixed badge per market with ad counts. Empty state nudges toward Geo sweep, never asserts "single-market".
- **Per-ad country badges** in the ad detail dialog footer.
- **Market gaps panel** (`market-gaps-panel.tsx`) on Insights — deterministic (non-AI) comparison of the `self` footprint vs. each competitor's, surfacing markets where competitors advertise but the user doesn't. Always-correct complement to the AI recommender's conditional geo dimension.

**Other:** extracted shared market constants into pure, browser-safe `lib/markets.ts` (`DEFAULT_MARKETS`, the ~18-code `COUNTRY_OPTIONS` picker list trimmed per product call, `countryLabel`/`countryFlag` helpers) — imported by both the Node scraper and the `"use client"` dialog. Fixed a readonly-array typecheck error in `scripts/scrape.ts` (`[...DEFAULT_MARKETS]`).

**Touched:** `lib/markets.ts` (new), `lib/scraper/scrape-competitor.ts`, `scripts/scrape.ts`, `components/scrape-ads-dialog.tsx`, `app/competitors/[id]/_components/market-footprint-card.tsx` (new), `app/competitors/[id]/_components/ad-detail-dialog.tsx`, `app/competitors/[id]/page.tsx`, `app/insights/_components/market-gaps-panel.tsx` (new), `app/insights/page.tsx`, `lib/db/queries.ts`, `docs/scraping.md`, `docs/dashboard.md`, `CLAUDE.md`. Typecheck clean, 34/34 tests pass, lint clean apart from the 1 pre-existing `queries.ts` warning.

## 2026-05-31 — Capture richer Meta fields + fix carousel/DCO misclassification (Pass 1 of 2)

Driven by two Ad Library screenshots ("23 ads use this creative and text" and "This ad has multiple versions") that prompted an investigation into what Meta exposes that we weren't capturing. Findings (all evidence-based, via live ClickUp/Asana/Monday scrapes + raw-JSON inspection):

1. **`display_format` distinguishes DCO from carousel — and we were ignoring it.** Meta labels every ad `IMAGE`/`VIDEO`/`CAROUSEL`/`DCO`. `DCO` = "This ad has multiple versions" (within-ad A/B-tested `cards[]`), NOT a carousel. Our classifier inferred type from card count, so every multi-card DCO ad became "carousel" — **Asana showed 100% carousel** (the tell). This also corrects the old `docs/scoring.md` claim that we "can't tell a carousel from DCO variants" — we can, via `display_format`.
2. **`collation_count`** ("N ads use this creative") **is well-populated in healthy scrapes** — the original "null/1" reading came from a *failed* scrape dump. It's market-scoped (ClickUp US maxed at 8; `country=ALL` reached 28, matching the screenshot's 23). But it stays OUT of the score: cross-competitor it reflects campaign-build style (ClickUp duplicates ad sets, Asana/Monday use Advantage+/DCO consolidation) not ad quality.
3. **`title`** (headline) was never stored — the analyzer only saw the body caption.

**What shipped (Pass 1 — capture + data quality; market modes are Pass 2):**
- **Migration `0002_huge_raza` (append-only):** new `ads` columns `title`, `display_format`, `collation_count`, `collation_id`, `contains_ai_media`.
- **Classifier fix** (`normalizeAd`): `media_type: "carousel"` now ONLY for `display_format=CAROUSEL`; DCO ads take their underlying image/video kind. Verified on re-scrape — Asana 30 carousel → 30 image; Monday's 13 true `CAROUSEL` ads stay carousel.
- **Capture + persist** all five fields through `normalizeAd` → `upsertScrapedAd` (insert + re-scrape update). Stopped overloading the legacy `variant_count` column (collation now has its own column).
- **Analyzer** now receives the headline (`buildCreativeAnalyzerPrompt` + static prompt updated) — bumps `ANALYZER_VERSION`, so the Re-analyze banner fires (intended; re-analysis is user-triggered/paid).
- **UI:** ad detail dialog shows the headline, a "Multiple versions (DCO)" badge, "N ads use this creative", and an AI-generated-media badge. Verified live (ClickUp ad: headline + "4 ads use this creative" render correctly).
- **Re-scraped** ClickUp/Asana/Monday (US, cap 100) to propagate. Note: stale inactive ads Meta no longer returns keep pre-fix `media_type`/null `display_format` — expected propagation.

**Touched:** `lib/db/schema.ts`, `drizzle/0002_huge_raza.sql`, `lib/scraper/scrape-competitor.ts`, `lib/db/queries.ts`, `lib/ai/prompts/creative-analyzer.ts`, `lib/ai/analyzers/analyze-creative.ts`, `app/competitors/[id]/_components/ad-detail-dialog.tsx`, `docs/scraping.md`, `docs/scoring.md`, `CLAUDE.md`. Typecheck clean, 34/34 tests pass, lint clean apart from the 2 pre-existing `queries.ts` warnings. **Pass 2 (deferred):** the three market modes — All / Single / Geographic scan.

## 2026-05-31 — Fixed paused-ad longevity inflation (`daysActive` = run length)

**The bug.** `daysActive` (the input to longevity, which is 60% of the score) was computed as `now − start_date` for *every* ad. That's correct for a live ad, but a **paused** ad's clock kept ticking after it stopped: a 30-day ad paused a year ago read ~395 days and maxed out longevity at 60, masquerading as an evergreen winner. Confirmed in the live DB — **35 of 36 inactive ads showed 130+ days** (all capped), almost all fictional. The inflation grows every day the ad sits dead in the table.

**The data that pinned it down.** I parsed a raw Meta dump: `end_date` is populated and behaves exactly right — for a live ad it tracks ~today, for a paused ad it's **frozen at the day Meta stopped it** (one paused ad: start 05-13, end 05-21 = ran 8 days, but our code read 9 then and would read 18 today).

**The fix.** `daysActive` now = true run length: count `start_date → now` while live, `start_date → end_date` once paused. Extracted into a pure, unit-tested helper `lib/scraper/days-active.ts` (`computeDaysActive`) — same isolation approach as the brand-match fix, since the scraper itself can't be imported into vitest. 5 test cases (live ignores stale end_date, paused counts to end_date, missing-end_date fallback, end-before-start clamp, missing-start guard).

**Propagation:** `end_date` is not stored, and `daysActive` is computed at scrape time, so **pre-existing paused ads keep their inflated values until re-scraped** (same model as the placements/countries fixes). No migration. A re-scrape of each competitor will correct the stored scores.

**Also looked at (no code change):**
- **Placement signal is sound — kept as-is.** Worried it might be saturated (Meta Advantage+ auto-spread), but the DB shows real spread (platform counts 1→2, 2→32, 3→8, 4→3, 5→10), so it discriminates. The 30 ads showing 0 platforms are just stale pre-placement-fix rows awaiting re-scrape, not a design flaw. (Minor: we count `publisher_platform` = platform spread, max 5; code/docs loosely call it "placement," and the 4-platform cap collapses 13 ads. Naming cleanup deferred.)
- **Longevity cap (#3) — deferred deliberately.** 64% of ads sit at the 130+ cap, which *looks* like the cap kills discrimination — but 35 of those 54 are the inflated inactive ads from this bug. The pileup is mostly an artifact. Correct sequence: ship this fix → re-scrape → re-examine whether genuinely-active ads still pile at 60 before touching the cap.

**Touched:** new `lib/scraper/days-active.ts` + its test, `lib/scraper/scrape-competitor.ts` (use helper; fixed a stale "capped at 15" comment → 20), `docs/scoring.md`, `CLAUDE.md`. Typecheck clean, 34/34 tests pass (+5), lint clean apart from the 2 pre-existing unused-import warnings in `queries.ts`.

## 2026-05-31 — Tightened the brand-name match filter (no more wrong-brand ads)

**The bug.** `pageNameMatches` (the filter that decides whether a keyword-search ad actually belongs to the competitor being scraped) compared names with a both-ways raw substring test after stripping all punctuation *and spaces*: `a.includes(b) || b.includes(a)`. Because spaces were gone, "Asana" (`asana`) matched the unrelated yoga app "Asana Rebel" (`asanarebel`) — and likewise "Meta"→"Meta Quest", "Monday"→"Cyber Monday Deals Co". Any short or generic brand name silently pulled in another brand's ads, poisoning every downstream layer (analysis, scoring, synthesis, recommendations).

**The fix.** Match on **whole word-tokens**, not character substrings. Lowercase → punctuation becomes spaces (boundaries preserved) → split into tokens → drop corporate-suffix *noise* tokens (`com`, `inc`, `llc`, `ltd`, `co`, `corp`, `official`, `app`, `hq`, `the`, `io`, `ai`) → require the remaining token **sets to be equal**. So:
- "Monday" vs "Monday.com" → extra token `com` is noise → both reduce to `{monday}` → **match** ✓
- "Asana" vs "Asana Rebel" → extra token `rebel` is meaningful → `{asana}` ≠ `{asana, rebel}` → **rejected** ✓
- Pure-noise names (e.g. "The Co") fall back to exact normalized equality so they can't false-match on an empty set.

**Deliberate bias toward false negatives:** a missed brand is recoverable via the manual "Set Meta page" button, but a wrong-brand ad silently corrupts the data. The primary `view_all_page_id` scrape path is already scoped to one page, so this filter mainly guards the keyword fallback.

**Structure:** extracted the matcher (and its `brandTokens` helper + noise list) out of `scrape-competitor.ts` into a new pure, dependency-free module `lib/scraper/page-name-matches.ts`, so it can be unit-tested without dragging in Playwright + the DB layer (importing the scraper into vitest failed on the `@/lib/db/queries` resolution). Added `lib/scraper/page-name-matches.test.ts` (6 cases covering the exact bug + the Monday.com keep-case + ordering + empty/noise fallbacks).

**Touched:** new `lib/scraper/page-name-matches.ts` + its test, `lib/scraper/scrape-competitor.ts` (import instead of inline), `docs/scraping.md`, `CLAUDE.md`. Typecheck clean, 29/29 tests pass (+6), lint clean apart from the 2 pre-existing unused-import warnings in `queries.ts`.

## 2026-05-31 — Scoring re-weight to 3 signals + AI determinism (temperature)

Two consistency fixes from a full-pipeline audit.

**1. Re-weighted the performance score from 4 signals to 3.** The old model reserved 20 of 100 points for a "variant count" signal (how many near-identical creatives a brand split-tests — a genuinely strong intent signal). Problem: **Meta doesn't expose variant count reliably.** I confirmed this against a real scrape dump (`data/scrape-errors/…/page.html`, 30 ads): `collation_count` is `1` on 10 ads and `null` on 20, every `collation_id` is distinct, and `cards[]` conflates carousel slides with DCO format variants. So `variant_count` was always `1`, `variantPoints()` always returned 0, the real score ceiling was 80/100, and the `hidden-gem` tag (`score>=60 && variant_count==1`) fired on *every* qualifying ad — useless.

Rather than fake the signal, I removed it and redistributed its weight:
- **Longevity 50 → 60** (curve scaled ×1.2: `37.8·log10(d) − 19.8`, cap 60; anchors 30d≈36, 90d≈54, ~130d+→60).
- **Placement 15 → 20** (5/placement, now capped at 4 placements).
- **Recency 15 → 20** (active 20, recently-paused 10, else 0).
- Dropped the `hidden-gem` tag entirely (its only input is gone).
- `ads.variant_count` / `performance_scores.variant_pts` kept as unused legacy columns (append-only migration rule), written `1`/`0`.

**Behavioral note:** scores now span a true 0-100. Because the old ceiling was 80, the winner threshold (still `score>=70 && days_active>=30`) is now reached more easily — e.g. a 30-day active ad on 3 placements is now a Winner (36+15+20=71) where before it couldn't clear 70. This is the *correction*, not a regression: the scale now reflects the design intent.

**2. Set `temperature: 0.2` on all AI calls** (`lib/ai/client.ts`, both the main and schema-retry `messages.create`). They previously ran at the SDK default of **1.0**, so re-analyzing the same ad could return different angles/themes/persona each run — directly undermining the product's whole premise of consistent classification. 0.2 (not 0) keeps a little headroom on the vision pass while making results reproducible.

**Touched:** `lib/scoring/performance-score.ts`, `buckets.ts`, `score-ads.ts`, both test files, `lib/ai/client.ts`, `lib/db/queries.ts` (synthesizer no longer reads `variantCount`; corrected a stale `upsertScrapedAd` JSDoc), `lib/db/schema.ts` (legacy-column comments), the ad-detail dialog UI (removed the Variants bar + dead `muted` prop), `docs/scoring.md`, `CLAUDE.md`. Typecheck clean, 23/23 tests pass.

## 2026-05-31 — Multi-market scan + geographic recommendations

Added the ability to scan a competitor across multiple country libraries, record each ad's geographic footprint, and feed that into the recommender as a conditional 5th gap dimension. Configurable per the user's call: **single-market stays the fast default; the multi-market scan is opt-in.**

**The honest constraint that shaped this.** I checked Meta's raw responses: for commercial ads `reach_estimate`, `spend`, `targeted_or_reached_countries`, and `country_iso_code` are all null/empty (Meta only fills them for political/EU ads). So the ONLY real geo signal is *which country library an ad appears in* — the library is country-scoped, so presence = the ad targets that market. A `country=ALL` pull gives volume but zero per-ad attribution; per-ad geo requires looping each country. We do NOT and cannot report spend/reach/demographics by region.

**What changed:**
- **Schema (migration `0001_chubby_thunderball`, append-only):** `ads.countries` (JSON `string[]`, default `[]`) — the set of market libraries an ad appeared in. `competitor_syntheses.market_footprint` (JSON `{ marketCount, countries, countryCounts }`).
- **Scraper (`lib/scraper/scrape-competitor.ts`):** new `countries?: string[]` option + exported `DEFAULT_MARKETS` (US, GB, CA, AU, DE, FR, ES, IT, BR, IN — note `GB`, not `UK`). Per-market collection extracted into `collectMarketAds()`; the main fn loops markets, unions ads via `byLibraryId` + `countriesByLibraryId`, and persists each ad once with its footprint. `maxAds` is now **per market**. A failed market keeps the run `partial` and skips `markMissingAdsInactive`. Single-market path unchanged (just a one-element loop) and still records `countries: [country]`.
- **`upsertScrapedAd`:** takes `countries[]` and **unions** with the existing row (a US-only re-scrape never erases a market a prior scan found). New `getMarketFootprint(competitorId)` aggregates `ads.countries`.
- **Synthesizer:** computes the footprint deterministically (over ALL scraped ads, not just analyzed) and stores it on the synthesis row.
- **Recommender:** `RecSynthSummary` gained `marketFootprint`; the static prompt gained a strict, conditional geographic dimension — only fires when both sides have real footprint data and the competitor's is clearly broader; suggests 1-3 markets as a test; otherwise skips. Empty footprint = "not scanned," never "single-market."
- **Surfaces:** CLI `--countries=US,GB,DE` / `--countries=default`; scrape API parses `countries[]`; the Scrape dialog has a "Scan across 10 major markets" toggle (default max-ads bumped to 100).

**Important propagation note:** existing ads have empty `countries` until re-scraped (same model as the placements fix). So footprints read 0 for all current competitors — the recommender correctly produces no geo recs until a market scan is run. Verified the migration + `getMarketFootprint` against the live DB. Typecheck clean, 25/25 tests pass, lint clean apart from the 2 pre-existing unused-import warnings in `queries.ts`.

## 2026-05-31 — GTM recommender UI (Insights page + generate route)

Built the second pass of task #4: the Insights page is no longer a placeholder. It now renders the saved recommendations and lets the user (re)generate them. The engine was already done (CLI-first); this wires it to the UI.

**Why now:** we deliberately shipped the recommender as a CLI first so we could eyeball recommendation quality on real data before investing in the page. Quality looked good (real ClickUp-vs-Asana/Monday gaps with grounded evidence), so the page was the remaining gap between "engine works" and "a non-technical user can use it."

**What changed:**
- `app/api/recommendations/generate/route.ts` (new): `POST` route, `DEMO_MODE`-guarded (403 in demo — this both writes the table and makes a paid call). Calls `generateRecommendations({ targetCount: "5-10" })` and returns the result as plain JSON. Deliberately NOT SSE — it's a single Sonnet call, so it mirrors the synthesize route, not the streaming scrape/analyze routes.
- `app/insights/page.tsx`: now an async server component (`dynamic = "force-dynamic"`). Reads `getRecommendations()`, renders priority-sorted cards (priority badge high→red/medium/low, title, rationale, evidence). Shows "Last generated Xm ago" and an empty state that points first-timers to the Synthesize step. Each cited `library_id` links to `facebook.com/ads/library/?id=<id>` (swipe-file-linkable, opens in a new tab).
- `app/insights/_components/recommendations-panel.tsx` (new, `'use client'`): the Generate/Regenerate button. Mirrors `synthesis-panel.tsx` — running/error states, `status:"skipped"` surfaces the friendly reason (e.g. "synthesize a competitor first"), success calls `router.refresh()`. Button shows the cost + replace-on-run note inline; disabled in demo.

**Decisions:** fixed target count (5–10), no per-run count selector — keep v1 simple. No "done"/archive UI (recs are replace-on-run by design). Typecheck clean; lint clean apart from the 2 pre-existing unused-import warnings in `queries.ts`. Verified the display path in the browser preview against existing data; did not trigger a live generation (paid call + would replace the current set).

## 2026-05-31 — Recommendations are replace-on-run (dropped the "done" state)

Removed the recommendation dedup/archive machinery in favor of **replace-on-run**, at the user's call ("I don't want any 'done' in my recommendations as such").

**Why:** the previous design hashed each rec and matched hashes across runs solely to preserve a per-rec "done"/`actioned_at` toggle (and soft-archived recs that didn't reappear so a done-marked one wouldn't be lost). That hash-matching was brittle: because the model rewords titles between runs, hashes didn't match, so a re-run archived all the old recs and created new ones (observed: 7 archived / 7 new on an identical-input re-run). Once we decided recommendations carry no user-owned state, the entire mechanism was dead weight. Recommendations are now honestly what they are — a fresh snapshot of "what to do given the competitor data right now."

**What changed (no schema migration):**
- `lib/db/queries.ts`: `upsertRecommendations()` → `replaceRecommendations()`. Deletes the existing set and inserts the new one in a single batch. `stable_hash` is still computed, but only to collapse exact duplicates *within* one run (and to satisfy the column's NOT NULL/UNIQUE). Returns `{ total }`. Removed `getArchivedRecommendations()` (dead — nothing archives) and renamed `getActiveRecommendations()` → `getRecommendations()` (no archived filter).
- `lib/ai/analyzers/generate-recommendations.ts`: `RecommendResult` dropped `newCount`/`keptCount`/`archivedCount`; now just `recommendationsCount`. Calls `replaceRecommendations`.
- `scripts/generate-recommendations.ts`: dropped the "new / kept / archived" line from the CLI summary.
- The `actioned_at` and `archived_at` columns stay in the schema but are now unused (always null) — left in place to avoid a SQLite table-rebuild migration for zero functional gain.

**Knock-on for the Insights UI (still next up):** no "done" toggle and no Archive tab. The page renders the current set and offers a Generate button. Typecheck clean; lint clean apart from the 2 pre-existing unused-import warnings in `queries.ts`.

## 2026-05-30 — GTM recommender engine (task #4, CLI-first)

Built task #4 from `docs/ai-pipeline.md` as a CLI-first engine (Insights UI deliberately deferred to a second pass so we could eyeball recommendation quality on real data before investing in the page). This is the product's highest-leverage output: it reads every competitor synthesis + the user's own (`self`) synthesis and proposes prioritized GTM moves.

**Prep this session (data, not code):** analyzed all 30 Asana ads (`pnpm analyze`; 3 transient connection/rate-limit failures retried clean) and synthesized Asana (`pnpm synthesize`). That gave the recommender real input: ClickUp (`self`, 25 analyzed) vs. Asana + Monday.com (30 each), all three with syntheses.

**Design decision — evidence-catalog grounding (extends the spec):** the spec requires every rec to "cite specific ad IDs," but a competitor synthesis row doesn't carry per-ad IDs (only aggregate counts + always-on UUIDs). So the recommender additionally hands the model an **evidence catalog** — each competitor's top `EVIDENCE_PER_COMPETITOR` (12) ads by score, listed by Meta `library_id` with angle/hook/score/longevity. The model may cite only those; after the call we filter `evidence_ad_ids` against the catalog and drop anything invented (logged, non-fatal). Result: citations are real, swipe-file-linkable `library_id`s, never hallucinated and never internal UUIDs. Only competitor ads are catalogued — the user's own ads are never cited as "evidence."

**What shipped (no schema change — `recommendations` table already had every column; no new deps):**
- `lib/ai/schemas.ts`: `RecommendationsSchema` (5–10 items: `title`, `priority` high/medium/low, `rationale`, `evidence_ad_ids`).
- `lib/ai/prompts/recommender.ts`: `RECOMMENDER_PROMPT_STATIC` (cached system block: the four gap dimensions + longevity-weighting rules) + `buildRecommenderPrompt()` rendering the self block (synthesis or positioning-only), each competitor's synthesis summary, and the evidence catalogs.
- `lib/ai/analyzers/generate-recommendations.ts`: `generateRecommendations()` — gathers active competitors' syntheses + catalogs + `company.md`, picks the comparison basis (real ads if `self` has a synthesis with analyzed ads, else positioning), one Sonnet call, validates evidence, dedup-writes. Skips cleanly with a reason if no competitor syntheses exist.
- `lib/db/queries.ts`: `upsertRecommendations()` — computes `stable_hash` = SHA-1(trimmed title + sorted evidence IDs), preserves `created_at`/`actioned_at` on hash match, resurrects archived matches, inserts new, soft-archives missing. Returns `{newCount, keptCount, archivedCount, total}`.
- CLI: `scripts/generate-recommendations.ts` + `pnpm recommend [--count=<phrase>]`.

**Verified against real data (ClickUp vs Asana + Monday, 24 ads citable):** one Sonnet call, ~$0.06. Produced 7 grounded recs — e.g. "Shift primary CTA from lead-capture to free-trial" (ClickUp leans lead-capture; Asana runs free-trial across all 11 of its 137-day always-on winners), "Build a quantified social-proof series" (ClickUp has zero social-proof ads; Asana has two 137-day stat-led winners), "Counter Monday.com's coordinated AI 'sidekick' push." **All 15 cited IDs verified real** (11 Asana, 4 Monday); zero hallucinations slipped the filter; zero `self` ads cited. **Dedup verified without a second paid call**: re-feeding the identical recs through `upsertRecommendations` after marking one `actioned` returned 0 new / 7 kept / 0 archived with `actioned_at` + `created_at` preserved and `last_generated_at` bumped. Typecheck + lint clean (the 2 lint warnings are pre-existing unused imports in `queries.ts`).

## 2026-05-30 — Competitor synthesizer (the reasoning layer)

Built task #3 from `docs/ai-pipeline.md` end-to-end: the layer that rolls up all of one competitor's analyzed ads into a strategic pattern summary. This is the input the GTM recommender (task #4, next) will compare across competitors.

**Hybrid design decision (improves on a literal reading of the spec):** the spec had the model output everything including frequency counts. Counting enum values across dozens of ads is exactly what an LLM gets subtly wrong, and we already have the data in clean columns — so the counts (`dominant_angles`, `dominant_conversion_goal`, `dominant_brand_voice`) and `always_on_winners` are now computed **deterministically in code**, and the single Sonnet call does only the judgment work: `top_hooks`, `recent_pivots`, and clustering the active-experiment + abandoned buckets into named patterns. Cheaper, and the numbers are exact instead of hallucinated. The DB row is identical either way. (Confirmed with the user before building.)

**What shipped (no schema change — `competitor_syntheses` already had every column; no new deps):**
- `lib/ai/schemas.ts`: `CompetitorSynthesisSchema` — reasoning fields only (`top_hooks`, `recent_pivots`, `active_experiments[]`, `abandoned_patterns[]`). Angle fields constrained to the shared `AngleEnum`.
- `lib/ai/prompts/synthesizer.ts`: `SYNTHESIZER_PROMPT_STATIC` (cached system block) + `buildSynthesizerPrompt()` that lays the ads out in four labeled buckets (PROVEN WINNERS / ACTIVE EXPERIMENTS / ABANDONED / OTHER), one compact line per ad to control tokens.
- `lib/ai/analyzers/synthesize-competitor.ts`: `synthesizeCompetitor()` — loads analyzed ads, buckets each via `classify()`, computes the deterministic tallies, makes the one Sonnet call, merges, upserts. Returns `status:"skipped"` cleanly when a competitor has no analyzed ads.
- `lib/db/queries.ts`: `getAnalyzedAdsForCompetitor()` (joins ads + analyses + scores, excludes failed stubs) and `upsertCompetitorSynthesis()`.
- CLI: `scripts/synthesize-competitor.ts` + `pnpm synthesize --competitor-id=<uuid>`.
- API: `app/api/competitors/[id]/synthesize/route.ts` — POST → **JSON** (not SSE; it's a single call, unlike scrape/analyze), `DEMO_MODE`-guarded (403).
- UI: `app/competitors/[id]/_components/synthesis-panel.tsx` — an "Ad strategy patterns" card with a Find patterns / Regenerate button (disabled in demo and when there are 0 analyzed ads). Renders dominant angles/goals/voice as counted chips, top hooks, always-on count, "🧪 Testing right now" (active experiments) and "⚰️ Tried and dropped" (abandoned) clusters, and the recent-pivots prose. Wired into the competitor detail page above the ad grid.

**Verified against real data (Monday.com, 30 analyzed ads — the one competitor with analyses):** one Sonnet call, ~$0.03, ran clean. Counts exact (social-proof 9, product-demo 9, free-trial 17, playful 14…). Buckets: 0 winners / 19 experiments / 0 abandoned / 11 other (Monday's ads are mostly fresh + still show `placements:[]` since they haven't been re-scraped, so none clear the Winner bar yet — consistent, not a bug). The model's reasoning was genuinely sharp: it spotted that all 19 active ads launched on the same day (2026-05-22), flagged it as a coordinated "monday sidekick" AI-product campaign push, and clustered the experiments correctly (7+5+3+2+1+1 = 19). Panel renders correctly in the browser. Typecheck + lint clean.

## 2026-05-30 — Ad detail UI (scores + AI analysis finally surfaced)

Closed the loop on data we were already computing but never showing. Until now the competitor detail page rendered a grid of plain thumbnails; the `performance_scores` and `ad_analyses` rows sat in the DB invisible. Now they're on screen.

**What changed (4 files, no schema/migration, no new deps):**
- `lib/db/queries.ts`: added `getAnalysesForCompetitor(competitorId)` — a bulk fetch of all analysis rows for a competitor's ads (joined via `ads.competitorId`), mirroring the existing `getScoresForCompetitor`. One read instead of N per-card reads. Includes failed stub rows; the UI decides how to show them.
- `app/competitors/[id]/page.tsx`: fetches scores + analyses alongside ads in the same `Promise.all`, keys each into a plain object by `adId`, passes both to `AdGrid`.
- `app/competitors/[id]/_components/ad-grid.tsx`: each card now shows a bucket-colored score chip (green Winner / blue Active-experiment / red Abandoned / grey Other) and is itself the dialog trigger. Added a Score ↔ Longest-running sort toggle (default Score, winners on top). The card is now a `<button>`, so the landing-URL `<a>` moved into the dialog (can't nest a link in a button).
- New `app/competitors/[id]/_components/ad-detail-dialog.tsx`: the modal. Left column = larger media (first image + "+N more"), caption, CTA, link-out. Right column = score header (N/100), four signal bars using `SIGNAL_MAX` from `performance-score.ts` and `classify()` from `buckets.ts` for the bucket/tags, then the AI analysis fields. Uses the project's Base UI dialog — note the trigger uses `render={children}`, **not** Radix's `asChild` (this codebase is `@base-ui/react`, a recurring gotcha).

**Honest UI decision — the Variants bar:** `variant_count` is always 1 (still the open scoring gap), so this signal always scores 0/20. Rather than show a plain empty "Variants 0" bar — which would wrongly read as "this ad failed split-testing" — it's rendered greyed-out with the label "Not tracked yet". Transparency over a misleading zero.

**Verified live** (Asana, dev server + headless browser): page renders 200 with 17 active-ad cards showing 11 green / 4 blue / 2 grey chips (matches the 11 Winners from the placements fix). Opened the top card: dialog shows "Winner · Always-on · Hidden gem", score 75/100, Longevity 50/50, Variants 0/20 "Not tracked yet" (greyed), Placement 10/15 "2 placements", Recency 15/15. Typecheck + lint clean (the 2 lint warnings are pre-existing unused imports in `queries.ts`).

## 2026-05-30 — Fixed the placements scoring gap (Winner bucket now reachable)

Acted on the 2026-05-29 diagnosis. Wired Meta's `publisher_platform` through to the `placements` column so the placement-spread scoring signal stops scoring 0. This was the clean, high-value half of the two-part scoring gap.

**What changed (two files, no migration):**
- `lib/scraper/scrape-competitor.ts`: added `publisher_platform?: string[]` to the `MetaAdRecord` type (top-level, sibling of `end_date`); added a `placements: string[]` field to `NormalizedAd`; `normalizeAd` now reads `rec.publisher_platform`, lowercases each entry for clean display, defaults to `[]`; and the `upsertScrapedAd` call passes `placements: ad.placements` instead of the old hardcoded `[]`.
- `lib/db/queries.ts`: the `upsertScrapedAd` re-scrape (UPDATE) branch now refreshes `placements`. Previously a stale comment claimed placements was "maintained by other logic" — there was no such logic, so existing rows never got it. Now a plain re-scrape backfills every pre-existing ad. (`variant_count` is still deliberately not touched — it's the remaining dead signal with no clean Meta source.)

**Verified against real data (Asana):** re-scraped at `--max-ads=50` (safe: 50 > the 15 existing ads, no inactivation risk). All 30 Asana ads now store `["facebook","instagram"]`. Score max rose **65 → 75**, avg **59.5 → 65.7**, and **11 ads crossed the Winner threshold (≥70)** — previously the bucket was mathematically unreachable. Typecheck + lint clean.

**Honest note:** the theoretical ceiling is 80 (needs 3+ placements), but Asana only runs on Facebook + Instagram in practice (2 placements = 10/15 pts), so 75 is its real ceiling. That's correct behavior, not a bug — the score reflects what the advertiser actually does. Monday.com's 30 ads still read `[]` until someone re-scrapes them; the fix propagates on re-scrape with no migration.

## 2026-05-29 — Investigated why placements + variant_count are empty (no code change)

Investigation only — no files changed. Traced the "Winner bucket unreachable" known issue to its root cause by reading `lib/scraper/scrape-competitor.ts` against a real saved Meta JSON dump (`data/scrape-errors/3d26d40d-…-fail/page.html`, an Asana scrape). Conclusion: the two dead signals have *different* causes and should be fixed separately.

**Placements — clean recoverable bug, the data is right there.**
- Meta returns `"publisher_platform":["FACEBOOK","INSTAGRAM","MESSENGER","THREADS"]` on every ad in the dump (confirmed by grep — present on all records).
- But `scrape-competitor.ts:230` passes a hardcoded `placements: []` to `upsertScrapedAd`, the `MetaAdRecord` type (`:352`) never declares `publisher_platform`, and `normalizeAd` (`:496`) never reads it. The data is fetched over the wire and dropped on the floor.
- Fix is contained: add the field to the type, read it in `normalizeAd`, pass it through instead of `[]`. `upsertScrapedAd` already refreshes Meta-derived fields on re-scrape, so a plain re-scrape repopulates every existing ad — no migration. This lifts the score ceiling from 65 → up to 80 and makes the Winner threshold (≥70) reachable.

**Variants — genuinely harder, no clean Meta field.**
- Checked the two candidate sources in the real JSON. `collation_count` (Meta's own "this ad has N versions" counter) is `null` for 20 of 30 ads and `1` for the other 10 — effectively unusable. `cards[]` length is the only real proxy (DCO bundles multiple creative variants under one `ad_archive_id`), and the code already parses `cards` for media but never counts them as `variant_count`.
- So this is not a "forgot to read a field" fix like placements. It means *deriving* a count from `cards.length` measured on the live GraphQL responses, with `collation_count` as a weak secondary hint. Medium effort, lower payoff than placements.

**Recommendation captured for next session**: do placements first (clean, high-value, verify against an Asana/Monday re-scrape), variants second. No threshold loosening — the ≥70 Winner cutoff is correct; the data was incomplete.

## 2026-05-29 — Performance scoring layer (buckets + persistence + auto-trigger)

Wired up the scoring layer end-to-end. The pure scoring math (`performance-score.ts`) and its tests already existed from a prior session; this session added everything around it to make scores actually computed, saved, and groupable.

**What shipped**:
- New: `lib/scoring/buckets.ts` — the canonical bucket predicates `docs/scoring.md` references. `bucketOf(ad, score)` returns exactly one of Winner / New (active experiment) / Abandoned / Other with priority Winners > New > Abandoned > Other. `tagsFor()` layers `always-on` / `hidden-gem` / `paused` tags on top. `classify()` returns both. Pure module, 12 unit tests covering the priority edge cases (e.g. a paused long-running high-scorer stays a Winner with a `paused` tag, not Abandoned).
- New: `lib/scoring/score-ads.ts` — `scoreCompetitorAds(competitorId)`. The only impure file in `lib/scoring/`: reads a competitor's ads, runs the pure scorer over each, and upserts `performance_scores` rows with a compact human `explanation` string. `performance-score.ts` and `buckets.ts` stay pure.
- New queries: `upsertScore(...)` (insert-or-update by ad via `onConflictDoUpdate`) and `getScoresForCompetitor(...)` (bulk read, joined on `ads.competitorId`).
- Trigger: `scrapeCompetitor()` now calls `scoreCompetitorAds()` at the end of every successful run, emits a `scored-ads` event, and surfaces a "Scored N ads" line in the live scrape dialog. Wrapped in try/catch so a scoring error can never fail a scrape whose ads are already saved. Chose auto-on-scrape (vs. manual button) because scoring is free deterministic math — the user-triggered guardrail only exists to gate paid AI work.

**Verified against real data** (Asana 15 ads, Monday.com 30 ads): scoring saved cleanly, distributions look sane within each competitor (Asana avg 59.5, Monday avg 39.6), and the bucket/tag logic fired correctly (Asana's long-running single-creative live ads → `hidden-gem`; Monday's fresh live ads → Active experiment).

**Honest finding surfaced during verification** (logged as a Known issue above): two of the four signals — `variant_count` and `placements` — are never populated by the scraper, so they always score 0. That caps every ad at 65 and makes the Winner bucket (≥70) currently unreachable. The scoring is correct; the gap is upstream in extraction. Flagged rather than silently "fixed" by loosening the threshold — the threshold is right, the data is incomplete.

## 2026-05-22 — Fixed mediaType misclassification (DCO ads were all "carousel")

User flagged that most ads on the dashboard were tagged `carousel` while the Meta Ad Library showed them as videos. Investigated and confirmed.

**Root cause**: Meta's modern delivery is almost entirely `display_format: "DCO"` — Dynamic Creative Optimization bundles where multiple variant creatives share one `ad_archive_id`. Each variant lives in `cards[]`, and each card is either an image card (`original_image_url` set, video fields null) or a video card (`video_hd_url` set, image fields null). The old classifier looked only at `display_format` and `snap.videos[]` (which is empty for modern ads) → every DCO bundle got labeled `carousel` regardless of whether the cards were actually videos.

Diagnostic: added an env-gated `DUMP_FIRST_SNAPSHOT=1` block to the scraper that dumps the raw `snapshot` of the first matching ads. Used it to confirm the field shape on 5 real Monday.com ads before writing the fix. Removed the block once the classifier was verified.

**Fix #1 — classifier**: rewrote `normalizeAd` in `lib/scraper/scrape-competitor.ts` to trust card contents. New helper `isVideoCard(c)` returns true when a card has a playable video URL (`video_hd_url || video_sd_url`), with `video_preview_image_url` as a fallback only when both image fields are null. Decision rule:
- `display_format === "VIDEO"` OR top-level `videos[]` non-empty → `video`
- All cards are video cards → `video`
- Single image card → `image`
- Multiple image cards → `carousel` (a real multi-image carousel)
- Mixed video + image cards → `carousel` (DCO bundle, closest enum match)
- Otherwise → `image`

**Fix #2 — `upsertScrapedAd` was silently swallowing classifier improvements**: the existing-row branch only updated `isActive` and `daysActive`. Every other Meta-derived field — `caption`, `ctaLabel`, `landingUrl`, `mediaUrls`, `mediaType` — was set on insert and never touched again. Meaning the classifier rewrite never reached the 25 pre-existing Monday rows on re-scrape. Fixed to refresh all extraction fields except `mediaPaths` (local files we've downloaded) and provenance fields (`firstSeenAt`, `createdAt`, `variantCount`, `placements`). This is the more dangerous bug long-term — it would have silently neutered any future scraper improvement.

**Cleanup pass on Monday.com data**:
- Pre-fix state across 25 ads: `carousel × 19, image × 1, video × 5`. Most were misclassified.
- Re-scraped at max=50, hit 30 ads. New state: `video × 20, carousel × 9, image × 1`. 11 of the original 25 flipped `carousel → video`. 5 brand-new ads pulled in (4 video + 1 carousel).
- Deleted the 11 stale `ad_analyses` rows whose underlying `mediaType` flipped — the analyzer prompt's media-type context note was wrong for those. Brand-new 5 ads had no analysis yet.
- Ran analyzer on the 16-ad backlog (11 flipped + 5 new). 16/16 success. Total cost ~$0.032.
- Final distribution honestly reflects what's on the Ad Library: Monday is predominantly a video advertiser.

**Trade-offs / gotchas worth knowing**:
- "Which 25 ads do we get?" Meta's per-page default order, which is approximately newest-by-start-date. Not contractually documented. A small `--max-ads` against a prolific advertiser (Monday has 30+ visible) systematically misses older / inactive winners. No URL flag to control this — we'd need to add `sort_data` params to influence it, and even then Meta's per-page order isn't fully sortable.
- Mixed-card DCO bundles (video + image variants in the same ad) still fall into `carousel`. That's our enum's closest match. Realistically rare on Monday's set; can revisit if a more granular type ("dco-mixed") becomes useful for the synthesizer.
- The `markMissingAdsInactive` known issue bit during the diagnostic scrape (`--max-ads=5` flipped 13 ads to inactive). The follow-up `max=50` re-scrape restored correct active flags. Avoid small caps when there's existing data; the UI's 25/50/100 are safe.

## 2026-05-22 — Creative analyzer (vision pass on scraped ads)

First end-to-end ad analyzer. For every scraped ad, an Anthropic vision call (Claude Haiku 4.5) reads the image + caption + CTA and writes a structured row into `ad_analyses` — hook (verbatim from the ad), primary angle + optional secondary (from a fixed 13-item enum), visual summary, dominant hex colors, text density, subject, themes / pain points / benefits, target persona, emotional tone, conversion goal (fixed enum), brand voice (fixed enum). Same dual-surface shape as the scraper: one core function called by both a CLI and a dashboard button.

**Pipeline**:
- New: `lib/ai/schemas.ts` — `CreativeAnalysisSchema` (Zod) + fixed enums for `Angle`, `ConversionGoal`, `BrandVoice`, `TextDensity`, `Subject`. Enums are intentionally constrained so the future synthesizer can detect cross-ad patterns ("3 of 5 competitors run comparison ads").
- New: `lib/ai/prompts/creative-analyzer.ts` — exports `CREATIVE_ANALYZER_PROMPT_STATIC` (the heavy block: rules + three taxonomies with definitions + one-shot example, ~2.5K tokens) and `buildCreativeAnalyzerPrompt(ad)` (the small per-ad block: caption + CTA + media-type note). Split so the static portion can be prompt-cached.
- New: `lib/ai/analyzers/analyze-creative.ts` — exports `analyzeAdsForCompetitor(opts)` and `ANALYZER_VERSION`. The version is a SHA-1(prompt + schema) hash computed once at module load; editing the prompt or schema auto-bumps it, which surfaces an outdated count in the dashboard. Worker pool with bounded concurrency (default 5) for batched runs. Per-ad failures log to `data/analysis-errors/<ad_id>.json` and write a stub row with `analysis_failed_at` set; the next run picks them up for retry.
- New: `lib/ai/analyzers/analyze-creative.ts → sniffImageMediaType` — detects actual image format from magic bytes (JPEG/PNG/GIF/WebP). Required because Meta serves a small fraction of `.jpg` URLs that are actually PNG/WebP bytes, which Anthropic's vision API rejects when the declared media type lies.
- New: `scripts/analyze-ads.ts` + `pnpm analyze` — thin CLI wrapper. Uses `tsx --env-file=.env` so `ANTHROPIC_API_KEY` loads from `.env` not the parent shell (matters because Claude Code injects its own ANTHROPIC_API_KEY).
- New: `POST /api/competitors/[id]/analyze` — SSE stream, demo-mode guarded, `maxDuration = 300`. Each event mirrors the analyzer's discriminated union (`log | progress | analyzed-ad | failed-ad | done | error`).
- New: `components/analyze-ads-dialog.tsx` — two-phase dialog matching `scrape-ads-dialog.tsx`'s shape. Pre-flight picker (10/25/50) with cost estimate (~$0.002/ad cached); live phase shows progress bar, per-ad `✓ <library_id> — [angle] hook…` lines, and a final summary grid.
- Card placement: the button appears as a secondary action next to "Scrape ads" only when `getAdsNeedingAnalysisCount(id, ANALYZER_VERSION) > 0`. Same logic on the competitor detail header. Labels itself dynamically ("Analyze 12 ads").
- New query: `getAdsNeedingAnalysisCount(competitorId, currentVersion)` — counts ads with no row, stale-version row, or failed-stub row. This is what the badge reads. The simpler `getUnanalyzedAdCount` is kept for backwards compat.

**Smoke-tested end-to-end against Monday.com** (25 ads):
- 5-ad batch first: 5/5 success in ~25s, diverse angles (social-proof × 3, product-demo × 1, before-after × 1).
- Caught a real bug: my initial filter only skipped current-version rows, ignoring `analysis_failed_at`. Fixed to also retry failed stubs. Re-ran with the fix → all 25 ads landed clean.
- Caught a real bug: trusting `.jpg` extension caused 1/3 of one batch to fail (Anthropic rejected the upload because the file was actually a PNG). Added magic-byte sniffing → 0 failures on retry.
- Final distributions on Monday.com:
  - Angles: social-proof (6), product-demo (3), curiosity-hook (3), problem-agitation (1), comparison (1), aspirational (1), before-after (1), ugc-style (1).
  - Brand voice: playful (6), professional (4), bold (3), warm (1).
  - Conversion goal: free-trial (8), lead-capture (3), other (2), content-download (1). 9 rows have no goal (model emitted null where unclear).
- Spot-checked one row by hand: hook captured verbatim ("Finally, a work platform your team will actually love to use…"), visual_summary is genuinely descriptive (notes the person, the home-office setup, AND the Monday Kanban overlay), 5 dominant colors with hex codes, target persona is concrete ("Team leads and project managers at small-to-mid-sized companies").

**Why it matters**: this is the first AI output that becomes raw material for everything downstream. Scoring needs hooks to display. Synthesis needs angles to count. Recommendations need themes + persona to compare across competitors. Without this layer, the rest of the pipeline can't ship.

**Trade-offs noted**:
- The vision model sees ONE image per ad — first frame for videos, first slide for carousels. Documented limitation #5 in `docs/ai-pipeline.md`. Video hooks that depend on the first 3 seconds of motion are systematically under-analyzed for now.
- 1 retry on schema failure (handled inside `lib/ai/client.ts`), then we log + skip — no infinite retry loops on a single bad ad. This is intentional cost guardrail #6 in the pipeline doc.
- The cost-estimate UI shows $0.002/ad (cached); first call in a fresh batch pays the uncached $0.004 because the cache hasn't warmed yet. Within a 50-ad concurrent batch the cache is warm for ads 2-50. Average converges on ~$0.002.
- The analyzer's local in-memory filter (now fixed) duplicated logic that already lives in `getAdsNeedingAnalysisCount`. Keep these two in sync — a divergence between "what the badge says is pending" and "what the analyzer will actually pick up" is the worst kind of bug.

## 2026-05-22 — Dashboard "Scrape ads" button + scraper refactor

Brought the scraper out of the terminal. Any competitor card with a verified Meta page now has a `Scrape ads` button that opens a live-streaming dialog. The user picks 25 / 50 / 100, clicks Start, and watches each saved ad scroll into a log panel in real time.

**Refactor**: extracted the entire scraping core out of `scripts/scrape.ts` into `lib/scraper/scrape-competitor.ts` (~600 lines moved). `scripts/scrape.ts` is now a 100-line wrapper that parses argv and pipes progress events to stdout. Both the CLI and the new API route call `scrapeCompetitor()` — same code, same behavior, single source of truth.

**Pipeline**:
- New: `lib/scraper/scrape-competitor.ts` exports `scrapeCompetitor(opts)` taking `{ competitorId, country?, maxAds?, headed?, onEvent? }` and returning `ScrapeResult`. The `onEvent` callback receives `ScrapeEvent` discriminated union: `log | navigate | progress | saved-ad | done | error`.
- New: `POST /api/competitors/[id]/scrape` — opens a Server-Sent Events stream. Each event is JSON-serialized and pushed as `data: …\n\n`. Closes when scrape finishes (or errors). Demo-mode guarded (returns 403). `maxDuration = 300` since scraping can take a few minutes.
- New: `components/scrape-ads-dialog.tsx` — two-phase shadcn dialog. Phase 1 (idle): pick max ads, click Start. Phase 2 (running/done): live progress bar showing "matching ads N / total observed M", a scrolling log of `+ <library_id> (<media_type>) — <caption_preview>` lines, and a final summary grid (status / saved / new / unchanged / went inactive). Cancel button aborts the client-side stream (note: server-side Playwright keeps running until natural completion — its scrape_runs row will still be written).
- UI placement: secondary action on every tracked card with a verified page. On `self` (your own company), it's surfaced alongside Open. On cards missing a page, it's hidden (you'd have nothing to scrape against).

**Smoke-tested end-to-end against Monday.com**:
- CLI v2 (post-refactor): re-scraped at `--max-ads=10`. 30 observed, 10 saved, 7 unchanged (matches the 7 we'd reasonably expect to overlap with the prior cap-25 run), 0 new, status=success in ~30 seconds.
- The refactored code produces identical scrape behavior to the v1 CLI it replaces.

**Why it matters**: scraping is now a one-click action for a non-technical user. No `pnpm db:studio` to find a UUID, no terminal command, no waiting blind. The dialog's live log is the difference between "did anything happen?" and "I can literally see ads landing in my database." This is the unblock-step before the AI analyzer becomes the natural next click on each card.

**Trade-offs**:
- The SSE stream is a thin wire format — if the user closes the browser tab mid-scrape, the server-side scrape keeps running (writes its scrape_runs row, ads land in DB). Acceptable: the user can refresh and see what happened.
- Cancel aborts the *client* stream but not the *server* Playwright session. Decided not to wire a kill switch — would add complexity for a near-zero benefit (scrape is ≤5 min worst case).
- Marked a known issue in the Status block: `markMissingAdsInactive` over-aggressively inactivates ads beyond the maxAds cap. Defers to a future fix that knows whether we reached the actual end of Meta's library.

## 2026-05-22 — Live end-to-end test against Monday.com

After resolving Monday.com's page_id via the manual paste dialog (`view_all_page_id=314197722000030`), ran `pnpm scrape --competitor-id=…  --max-ads=25`. Result:

- status=success in 22 seconds
- 30 ads observed, 30 matched (page-ID filter held cleanly)
- 25 saved (cap), 25 new, 0 unchanged
- 17 currently active, 8 inactive (carried over from Meta's "all-time" view)
- 100 media files downloaded to `data/ad-creatives/`
- Captions clean and varied — "Finally, a work platform your team will actually love…", "There's a reason why 180K+ customers…", "🎬 Ever wondered what it's like to be a monday.com ambassador…"
- CTAs canonical English: Sign Up, Learn More (localization fallback working)
- days_active values realistic: 101, 8, 10, 10, 10

This validates the full pipeline: manual page-set dialog → DB → CLI scrape → real ads on disk and in DB. The exact data the AI analyzer will consume next session.

## 2026-05-22 — "Set Meta page" UI for brands the resolver can't find

Closed the manual-paste gap left by the auto-resolver. Brands that don't say their own name in ad body copy (like Monday.com) can now be linked via the UI without dropping to `pnpm db:studio`.

**Pipeline**:
- `lib/scraper/parse-meta-page-input.ts` — pure parser. Accepts an Ad Library URL (`?view_all_page_id=…`), a Facebook `/pages/<name>/<id>` URL, or a naked numeric page ID. Vanity URLs (`facebook.com/acmehq`) are detected and returned as a `kind: 'vanity'` so the API can ask the user to re-paste an Ad Library URL instead.
- `lib/scraper/verify-meta-page.ts` — Playwright verifier. Given a page_id, hits `view_all_page_id=<id>`, intercepts GraphQL responses, walks the SSR HTML, and finds either an ad record OR a header block whose `page_id` matches. Returns the discovered `page_name`, ad count, verified badge, and profile picture URL. If nothing matches → returns `{ ok: false }`, blocking the save. This is the safety net — we never save a page_id we haven't seen with our own eyes.
- API: `POST /api/competitors/[id]/meta-page/verify` (parse → Playwright verify, 10-30s) and `POST /api/competitors/[id]/meta-page` (save). Both demo-mode-guarded.
- UI: `components/set-meta-page-dialog.tsx`. Two-step shadcn dialog — paste → "Verify" (shows discovered name + ad count + page profile pic + "open in Ad Library" link) → "Confirm and save". Surfaces a yellow warning when the discovered page_name doesn't exactly match the competitor name (probable mis-paste, but user can still confirm).
- Card placement: on `app/competitors/page.tsx`, any competitor with `meta_page_id IS NULL` now shows a `Set Meta page` primary action (replacing the "Open" link) and a yellow sub-line. The top of the page shows a yellow "Needs your help" banner counting how many competitors are in this state.
- New query: `countCompetitorsNeedingPageSetup()` and `setCompetitorMetaPage()` in `lib/db/queries.ts`.

**Why it matters**: the auto-resolver fails silently when a brand's own ads don't mention the brand name — that's a meaningful chunk of B2B SaaS. Without the UI escape hatch, users would hit "Scrape ads" on Monday.com, get zero results, and have no idea what to do. The Playwright round-trip on verify is slow (~15s) but it's a one-time cost per competitor and it prevents silently-broken state.

**Trade-offs noted**:
- Verify takes 10-30s. The dialog shows a friendly "we're opening a real browser" message so the wait doesn't feel like a hang.
- Vanity URLs (`facebook.com/acmehq`) aren't auto-resolved — would require an extra fetch + redirect-follow. For now we tell the user to re-paste an Ad Library URL.
- The page-name mismatch warning is soft (yellow text, not blocking) — users sometimes name competitors differently than Meta does ("Adobe Inc." vs "Adobe") and we shouldn't force them to rename.

## 2026-05-22 — Meta Ad Library scraper + page-ID resolver

Built the linchpin: `pnpm scrape --competitor-id=<uuid>` now reliably pulls ads from Meta's Ad Library and writes them to the `ads` table.

**Pipeline**:
- `scripts/scrape.ts` launches Chromium via Playwright, navigates to the per-competitor Ad Library URL, and intercepts every GraphQL response Meta streams back. Each response is parsed for `ad_archive_id` records and walked recursively to extract page_name, body.text, cta_type, link_url, display_format, images, videos, start_date, is_active.
- Initial server-rendered HTML is also walked (a regex finds each `ad_archive_id` occurrence, then a balanced-brace walk slices out the enclosing JSON object). This catches the first ~12 ads that ship in the SSR payload before any XHR fires.
- Scroll-and-wait loop triggers more lazy-load batches until either the brand-matching count reaches `--max-ads` (default 50) or growth stalls for 4 polls.
- For keyword-search URLs, ads are filtered by loose page_name match against the competitor name — otherwise the scrape collects every brand that happens to advertise with a keyword overlap.
- Media is downloaded sequentially to `data/ad-creatives/{adId}.{ext}` (carousels get `-0`, `-1`, `-2` suffixes). Videos use the `video_preview_image_url` (first frame); we don't store the video itself.
- `ads` rows are upserted by `library_id`; existing rows get `last_seen_at`/`is_active`/`days_active` refreshed but caption/creative are immutable per Meta's library ID model.
- After a successful scrape, ads from this competitor that weren't seen this run flip `is_active=false`. Empty-result runs do NOT flip ads inactive (safer — an empty result is usually scraper failure, not the brand having stopped advertising).
- Every invocation writes a `scrape_runs` row (`success` | `partial` | `failed`) with counts and an error_message on failure. Failed runs save a screenshot + HTML to `data/scrape-errors/<id>-<ts>-fail/`.

**Pivots during build**:
1. **DOM scraping was a dead end**. The `docs/scraping.md` v1 strategy (`text=/Library ID:/`) failed — Meta no longer renders "Library ID:" as visible text. Pivoted to parsing the JSON state Meta embeds in the page and streams via GraphQL.
2. **Keyword-search URLs are noisy**. The competitor suggester (`lib/ai/analyzers/suggest-competitors.ts`) emits `?q=<name>&search_type=keyword_unordered` URLs — but Meta's keyword search matches ad *body text*, not page names. A search for "Monday.com" returned ads from Burn Boot Camp, Coldplay, Alibaba, etc — any brand whose copy contained "Monday". Built a page-ID resolver to convert brand-name guesses into verified `view_all_page_id=<ID>` URLs.
3. **Caption was a template placeholder**. Asana runs Dynamic Creative ads where `body.text` = `{{product.brand}}`. Added `isTemplatePlaceholder` check so caption falls through to title → carousel card body → carousel card title.
4. **CTA was in Kannada**. `cta_text` is localized to the viewer; `cta_type` is the canonical English enum ("SIGN_UP" → "Sign Up"). Prefer `cta_type` always.

**Page-ID resolver** (`lib/scraper/resolve-meta-page.ts`):
- Visits Meta with `?q=<brandname>&search_type=keyword_unordered` (Meta ignores `search_type=page` on the public Ad Library — confirmed empirically).
- Mines `page_id` + `page_name` from every ad in the response. Each ad carries its own page info, so a keyword search becomes a poor man's page directory.
- Scores candidates by name similarity (Dice coefficient on lowercased alphanumeric tokens, with bonus for `page_is_verified` and non-zero ad count). Threshold 0.4 for a confident match.
- Returns `{ best, candidates }` — the `candidates` list is for a future picker UI when several candidates score close.

**Backfill** (`scripts/backfill-meta-pages.ts`): one-shot CLI that runs the resolver against existing competitors and updates `meta_page_id` + canonical `meta_page_url`. Supports `--only-status=<status>`, `--force`, `--dry-run`.

**Verified against Asana**: 15 ads scraped, 7 active, captions like "Coordinate work without the chaos. Asana keeps every team updated…", canonical "Sign Up" CTAs, real days_active values (32, 129, 371), 45 carousel images downloaded.

**Known limitation**: brands that don't say their own name in ad body copy (e.g. Monday.com) won't be auto-resolved. Need manual URL paste UI (deferred).

Why this matters: the scraper is the data foundation everything downstream depends on (ad analyzer, performance scoring, synthesizer, recommender). Getting it reliable is more important than getting it fast.

## 2026-05-22 — Accept moves cards to Tracked; counts stay in sync

- After a successful Accept or Reject on `/competitors`, the suggestion list now calls `router.refresh()`. The server component re-fetches `getActiveCompetitors()` and `getSuggestedCompetitors()`, so:
  - Accepted cards visibly move from the `Suggested (N)` section to the `Tracked competitors (N)` grid below.
  - The `Tracked competitors (N)` header count and the page subtitle ("N tracked.") update immediately.
  - The yellow "Next up: scraper not built yet" banner appears once `tracked > 0`.
  - Rejected cards disappear from the Suggested list (they're soft-deleted in the DB).
- Simplified `app/competitors/_components/suggestions-list.tsx`: removed the local `Decision` state map, the in-batch counter (`✓ N accepted · ○ N pending · ✗ N rejected`), the post-accept `Open →` button, and the conditional accepted/rejected card styling. Server data is now the single source of truth — no more divergence between what the user sees and what the DB knows.
- Swapped the suggester model from Haiku to Sonnet in `lib/ai/analyzers/suggest-competitors.ts:46` while Anthropic's Haiku pool recovers from sustained 529s. Flagged in the Status block above so it gets reverted.

Why: user reported (1) the `Open →` button on freshly-accepted cards led to an empty placeholder detail page — no value, confusing CTA. (2) After accepting 2 competitors, the page subtitle still said "Track and analyze competitor ad strategies." and the Tracked section header still showed `(0)` because those counts come from server-rendered queries and the optimistic client state didn't refresh them. Both symptoms had the same root cause: client-side decision tracking diverging from the DB. Fix was to ditch the local state and let `router.refresh()` reconcile after each action — the accepted card "moving" to the Tracked section IS the confirmation, and all counts derive from one source.

## 2026-05-22 — Merge `/suggest` into `/competitors` + harden AI client errors

- **AI client retry**: bumped `callWithRetry` in `lib/ai/client.ts` from 3 to 4 attempts (1s/2s/4s/8s backoff, ~15s total). When all retries fail on a 529 / 429 / 5xx, the final error is rewrapped as a human-readable string ("Claude is temporarily overloaded. Please try again in a moment.") instead of letting the raw Anthropic SDK error (`"529 {json}"`) propagate to the UI.
- **Merged `/suggest` into `/competitors`**: deleted the entire `app/suggest/` directory. Suggestions now appear inline on `/competitors` as a `Suggested (N)` section between the user's `self` card and the `Tracked competitors` grid. The `✨ Suggest 10 competitors` button moved into the page header next to `+ Add competitor`.
- Moved `SuggestButton` and `SuggestionsList` into `app/competitors/_components/`. Dropped the sticky bottom "View in dashboard →" pill (no longer needed — user is already on the destination page). Accepted cards' `Open →` link now points to `/competitors/[id]` instead of `/competitors`.
- Updated `docs/dashboard.md`: the "Suggest competitors" section now documents the inline pattern, not the standalone page. Step 4 of the onboarding flow now lands users on `/competitors` directly.

Why: user feedback — "the page /suggest is extraneous - doesn't provide any value." They were right. Two surfaces (one to suggest on, one for the accepted cards to live on) meant unnecessary navigation, two refreshes, and a worse "where did the card go?" experience. One page = one place where competitors live. The retry-and-friendly-error fix was triggered by the same session: a real 529 from Anthropic surfaced raw JSON in the suggestions UI, which looked broken even though the actual cause was a transient API overload.

## 2026-05-22 — UX fixes for the suggest + competitors flow

- `/suggest`: accepted/rejected suggestions now stay visible on the page in a transformed state (✓ Accepted with Open link, or struck-through Rejected). Decisions are tracked in client state so the page doesn't refresh-and-vanish.
- `/suggest`: new in-batch counter ("✓ N accepted · ○ N pending · ✗ N rejected") above the list.
- `/suggest`: sticky bottom CTA appears after first accept — "N competitors added → View in dashboard".
- `/suggest`: added the manual `+ Add competitor` button to the header so users don't have to navigate away.
- Added competitor detail placeholder at `/competitors/[id]` (honest "scraping not built yet" copy + disabled button) so the Open links don't 404.
- Added an honest "next up: scraping isn't built yet" note on `/competitors` once at least one competitor is tracked.
- Fixed pre-existing lint errors in `app/layout.tsx` (replaced `<a>` with `<Link>` for internal nav).

Why: user tested phase 2 and reported the accept action felt invisible (card vanished with no confirmation), there was no obvious next step after accepting, and the manual-add flow wasn't discoverable from `/suggest`. All three were design mistakes. Also being honest about scraping not being built — better to set expectation than have users click a broken button later.

## 2026-05-22 — Competitors grid + Suggest competitors flow

- Added `CompetitorSuggestionsSchema` to `lib/ai/schemas.ts` (10 suggestions, each with name/why/likely_meta_page_url).
- Added `lib/ai/prompts/competitor-suggester.ts` with one-shot example + exclude-list support.
- Added `lib/ai/analyzers/suggest-competitors.ts` that reads `context/company.md`, excludes already-tracked names, calls Claude Haiku, and inserts `status='suggested'` rows.
- Added queries: `getActiveCompetitors`, `getSuggestedCompetitors`.
- Added API routes: `POST /api/competitors/suggest`, `POST /api/competitors/[id]/accept`, `POST /api/competitors/[id]/reject`, `POST /api/competitors` (manual add). All write routes guarded by `DEMO_MODE`.
- Added `components/competitor-card.tsx` (reusable card with status badge + action slots) and `components/add-competitor-dialog.tsx` (manual add modal).
- Rebuilt `app/competitors/page.tsx`: server-rendered grid with pinned self card, active competitors below, empty state when only self exists.
- Added `app/suggest/page.tsx`: profile preview + Suggest button + suggestion list with Accept/Reject per row.

Why: now that onboarding produces a profile, the natural next step is letting the user populate their competitor list. AI-driven discovery (10 suggestions per click) saves them having to hand-pick names; manual add covers the cases the AI misses. Accept/Reject is DB-persisted so re-running suggestions never re-surfaces something the user already rejected.

Deferred: filter pills (All / Accepted / Suggested) on the grid, competitor detail page (`/competitors/[id]`), suggestion-count tooltips on cards, and a "Suggest again with new context" affordance.

## 2026-05-22 — Onboarding flow, phase 1

- Added `lib/ai/client.ts` provider abstraction (Anthropic implementation; Gemini stub). Empty `ANTHROPIC_API_KEY` is treated as missing with a helpful error message.
- Added `lib/ai/schemas.ts` with `CompanyProfileSchema`.
- Added `scripts/scrape-website.ts` — cheerio-based homepage + /pricing + /about scraper.
- Added `lib/ai/prompts/company-profile.ts` and `lib/ai/analyzers/generate-company-profile.ts`.
- Added `app/onboarding/page.tsx` with 4-state flow (input / fallback / progress / confirmation).
- Added `app/api/onboarding/start/route.ts` SSE endpoint that streams progress for website scrape + profile generation.
- Added `app/api/onboarding/confirm/route.ts` to persist edited profile + country preference.
- Updated `app/page.tsx` and `app/competitors/page.tsx` to redirect to `/onboarding` when no `self` competitor exists.
- Removed dead `PROJECT_SPEC.md` reference from `CLAUDE.md`; pointed the section to `docs/` instead.

Verified end-to-end against `clickup.com`: website scrape → Haiku profile generation → confirmation edit → `context/company.md` written → `self` row inserted in DB.

Known gotcha: when launching `pnpm dev` from inside Claude Code, the host blanks `ANTHROPIC_API_KEY` in the inherited environment, which shadows the .env value. Workaround: launch with `env -u ANTHROPIC_API_KEY pnpm dev`. Not an issue when running from a regular terminal.

Why: the foundation (DB schema, scaffolding, docs) was complete from a prior session, but no feature code existed. Onboarding is the minimum slice that exercises every layer (DB write, web scrape, AI call, Zod validation, SSE, server+client React) — building it first answers all the plumbing questions once and unblocks every subsequent feature.

Deferred from this phase:
- Meta Ad Library auto-search (needs Playwright; user pastes URL manually for now).
- Suggest-competitors screen (step 4 of onboarding) — separate task.
- "Thin website" UX (still generates a profile, but no special-case warning yet).
