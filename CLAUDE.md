# Meta Ads Analyzer

Open-source, self-hosted competitor intelligence tool. Scrapes Meta Ad Library, runs AI analysis on ad creative (hooks, angles, visuals), generates GTM recommendations. Two distribution modes: deployed Vercel demo (read-only, cached data) and local clone (full functionality). Single-user by design — no auth, one SQLite file per install. Not a multi-tenant SaaS.

**Detailed specs live in `docs/`** (one file per concern). Read the relevant file once at the start of a new feature; don't re-read every turn. See "When to read what" below.

## Tech stack

Next.js 15 App Router · TypeScript · shadcn/ui + Tailwind · Drizzle ORM + SQLite (better-sqlite3) · Playwright (scraping) · Anthropic SDK + Gemini SDK (provider-abstracted) · Zod for all structured outputs · pnpm.

## Commands

```bash
pnpm dev              # Next.js dev server
pnpm seed:demo        # load data/demo-snapshot.json into SQLite (idempotent)
pnpm db:migrate       # apply Drizzle migrations
pnpm db:studio        # open Drizzle Studio
pnpm test             # vitest
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm scrape --competitor-id=<uuid> [--max-ads=N] [--country=US|ALL] [--headed]
                       # CLI: one competitor's ads from Meta Ad Library → ads + scrape_runs tables.
                       # Owns volume + live/paused status + scoring. --country=ALL is the PRIMARY/default
                       # (Meta global view: widest volume + the authoritative is_active signal). --country=US
                       # scopes to one market (investigation; records that one country into ads.countries).
                       # WHY ALL is authoritative: a global/Advantage+ ad reads "paused" in a single country's
                       # library but "active" in ALL, so only the ALL view can own live/paused. (The old
                       # per-country "Map markets" / footprint sweep was removed 2026-06-04 — Meta exposes no
                       # reliable per-ad geography, so the signal wasn't worth the complexity.)
                       # (UI equivalent: the "Scrape ads" button — All countries (default) / Specific country.)
pnpm analyze --competitor-id=<uuid> [--max-ads=N] [--concurrency=N] [--force]
                       # CLI: vision-analyze ads (image + caption → ad_analyses rows).
                       # Default batch 50, concurrency 5. --force re-analyzes even current rows.
                       # (UI equivalent: the "Analyze N ads" button on each competitor card; same code path)
pnpm synthesize --competitor-id=<uuid>
                       # CLI: roll up ALL of one competitor's analyzed ads → one competitor_syntheses row.
                       # One Sonnet call (~$0.03). Counts computed in code; model does only the reasoning.
                       # Deterministic roll-ups also include: creative languages (localization depth, from
                       # caption/title — NOT the CTA), media mix (image/video/carousel), top pain points +
                       # benefits, and launch velocity (new LIVE ads by start_date, last 14/30d).
                       # (UI equivalent: the "Find patterns" button on the competitor detail page; same code path)
pnpm recommend [--count=<phrase>]
                       # CLI: cross-competitor GTM gap analysis. Compares the self synthesis (or company.md
                       # positioning if no ads) against ALL competitor syntheses → recommendations table.
                       # One Sonnet call (~$0.06). Replace-on-run: each run fully replaces the previous set. Default --count=5-10.
                       # (UI equivalent: the Insights page "Generate recommendations" button; same code path)
pnpm backfill:pages [--only-status=<status>] [--force] [--dry-run]
                       # convert AI-guessed keyword URLs into verified view_all_page_id URLs
pnpm backfill:goals [--dry-run]
                       # re-derive primary_conversion_goal for ALL ad_analyses from each ad's
                       # Meta CTA (lib/ads/cta-to-goal.ts). Pure, ZERO AI cost. Also refreshes the
                       # stored dominant_conversion_goal counts on synthesis rows. Run after editing
                       # the CTA→goal map. --dry-run prints the old→new diff without writing.
                       # NOTE: the conversion goal is now INTERNAL-ONLY (not shown in the UI — the
                       # dashboard displays the raw Meta CTA labels instead). See gotchas.
pnpm clean:ads [--dry-run]
                       # CLI: delete ads that are BOTH paused AND not successfully analyzed (library
                       # hygiene). Keeps every ACTIVE ad + every analyzed ad (incl. paused ones used by
                       # Tried & dropped). Cascades: removes orphaned performance_scores + ad_analyses
                       # rows and the creative files on disk. Pure, ZERO AI. Demo-guarded. --dry-run previews.
pnpm refresh:all      # bulk re-scrape every tracked competitor (CLI-only) (not yet implemented)
```

Always run `pnpm typecheck` after non-trivial changes. Always run `pnpm lint` before declaring a task done.

## Folder structure (brief)

```
app/                  # Next.js routes + API routes
components/           # shadcn UI + project components
lib/db/               # Drizzle schema, client, queries
lib/ai/               # prompts, Zod schemas, provider abstraction, analyzers (creative-analyzer, suggest-competitors, generate-company-profile, synthesize-competitor, generate-recommendations). Also angle-info.ts: pure shared map of angle/goal code → plain-English label + blurb (UI imports this so no enum jargon leaks to users).
lib/ads/              # cta-to-goal (pure, unit-tested): deterministic map from Meta CTA → conversion goal. The conversion goal is NOT AI-inferred — see gotchas.
lib/scraper/          # Meta Ad Library: scrape-competitor (core, used by CLI + API), resolve-meta-page (name → page_id), verify-meta-page (page_id → name), parse-meta-page-input (paste → page_id), page-name-matches (pure brand-match filter, unit-tested), days-active (pure run-length calc, unit-tested)
lib/scoring/          # performance-score (pure math) + buckets (pure predicates) + score-ads (DB orchestrator, only impure file)
lib/markets.ts        # pure, browser-safe: ALL_COUNTRIES sentinel (global view) + COUNTRY_OPTIONS (~18 picker codes for the "Specific country" scrape mode). Imported by the scraper and the scrape dialog.
lib/lang/             # detect-languages (pure, unit-tested): deterministic creative-language detection from caption/title via tinyld (short-text detector), with an English-prior tie-break. Feeds the synthesizer's creativeLanguages roll-up.
scripts/              # CLI: scrape, analyze-ads, synthesize-competitor, generate-recommendations, scrape-website, backfill-meta-pages, backfill-conversion-goals, clean-ads, seed-demo
context/              # single auto-generated company.md (user-editable; created during onboarding)
data/                 # SQLite db, cached creatives (data/ad-creatives/), debug dumps (data/scrape-errors/), AI failure dumps (data/analysis-errors/), demo snapshot
docs/                 # detailed reference docs (read on demand, see below)
```

## When to read what

These docs are NOT auto-loaded. Read them before working in their area:

- **`docs/architecture.md`** — read before any cross-layer refactor or before changing how data flows between scraper → analyzer → dashboard.
- **`docs/ai-pipeline.md`** — read before writing/editing any AI prompt, Zod schema, or provider integration. Contains the angle taxonomy, schema patterns, concrete output examples, the Anthropic-vs-Gemini abstraction rules, and the honest limitations to communicate.
- **`docs/scoring.md`** — read before touching `lib/scoring/` (scoring or buckets), before changing how scores are explained in the UI, or before adjusting any threshold that affects which ads are surfaced as winners / experiments / maturing / flopped / retired. Now the canonical source for bucket predicates referenced by both the synthesizer and the dashboard.
- **`docs/scraping.md`** — read before touching `scripts/scrape.ts`, `lib/scraper/`, or anything Playwright. **Important update (2026-05-22)**: extraction is now via JSON-intercept of Meta's GraphQL responses, NOT DOM scraping. The doc covers the JSON shape, the `ad_archive_id` key, page-ID resolution, and known limitations.
- **`docs/dashboard.md`** — read before adding a page, route, or shadcn component. Covers the onboarding flow, the `self` competitor pattern, the company profile editor, state patterns, SSR rules, and demo-mode read-only enforcement.

For implementation history and rationale of past changes, see `changelog.md`.

## Critical conventions

- **One context file, auto-generated**: there is exactly one user-editable context file — `context/company.md` — created during onboarding by scraping the user's website and (if available) reading their own Meta ads. There are no `current-angles.md` or `goals.md` files. "Current angles" are derived from the user's own scraped ads via the synthesizer; "goals" live in an optional `## Goals` section inside `company.md`.
- **The user is a `self` competitor**: the user's own company is stored in the `competitors` table with `status='self'`. It's pinned at the top of the dashboard grid, cannot be deleted, and is processed by the same scrape/analyze/synthesize pipeline as any competitor. The recommender compares the user's synthesis (or website-derived profile if they have no ads) against competitor syntheses.
- **Never auto-scrape during onboarding**: onboarding generates the profile and detects the user's Meta page, but ad scraping always requires an explicit user click on the `self` card's `Scrape ads` button.
- **Re-scrape website is non-destructive**: editing `context/company.md` via the dashboard's `Re-scrape website` button must show a diff and preserve manual edits by default — never silently overwrite.
- **Every scrape writes a `scrape_runs` row**: success, partial, or failure. The row is what the UI reads to display "Last scrape: 2h ago — 3 new, 2 inactive." No row = invisible to the dashboard.
- **`ad_analyses` rows carry `analyzer_version`**: auto-hashed from the static prompt + schema. Drift surfaces a `Re-analyze all` banner; never auto-runs. Full logic in `docs/ai-pipeline.md` task #2.
- **Conversion goal is DERIVED FROM THE CTA, not the AI** (changed 2026-06-03): `primary_conversion_goal` is mapped deterministically from the ad's Meta CTA via `lib/ads/cta-to-goal.ts` and written at analyze time — it is NOT a model output (the field was removed from the analyzer prompt + Zod schema). Why: an advertiser using a generic "Learn More" button on every ad (e.g. ClickUp) had identical ads scattered across lead-capture/demo/free-trial by the model's caption-reading; the chosen button is the ground truth for intent. The `awareness` goal exists for generic brand/site-visit CTAs ("Learn More", "View Instagram Profile"). Unknown/absent CTAs → `other`, never `awareness`. To re-derive existing rows after editing the map: `pnpm backfill:goals` (pure, zero AI). Keep the enum in sync across `lib/ai/schemas.ts`, `lib/db/schema.ts`, and the map. Full rationale in `docs/ai-pipeline.md` "Conversion goal taxonomy".
- **The displayed "selling motion" is the RAW Meta CTA, not the derived goal** (changed 2026-06-04): the goal taxonomy above read as confusing jargon to users, so the UI now shows the actual CTA buttons ("Sign Up", "Learn More"). The synthesizer tallies `ad.ctaLabel` into `competitor_syntheses.dominant_ctas`; the synthesis "Selling motion" fact, the Takeaway, and the Insights scoreboard "Top CTA" column all read `dominant_ctas`. The recommender reasons in CTA terms too. `primary_conversion_goal` + `dominant_conversion_goal` are STILL computed and stored (cheap, deterministic) but no longer surfaced anywhere. `GOAL_LABEL`/`goalLabel` in `angle-info.ts` are now unused (kept, harmless).
- **AI is its own angle** (added 2026-06-04): the angle taxonomy has 14 values — `ai-powered` was added for ads where AI/automation IS the headline pitch ("let AI do it for you"). Pick it only when AI is the central claim. Adding it bumped `ANALYZER_VERSION` (so a re-analyze surfaces it). Keep the enum in sync across `lib/ai/schemas.ts`, `lib/ai/angle-info.ts`, the analyzer + synthesizer prompts.
- **Synthesis and recommendations are user-triggered only**: never auto-run on scrape, never on schedule. The dashboard may surface staleness hints; the click is always the user's. This is the single biggest cost guardrail.
- **Scoring auto-runs after each scrape** — and that's fine: performance scoring is pure deterministic math over already-scraped columns (no AI calls, zero cost), so `scrapeCompetitor()` recomputes it inline at the end of every successful run. This is the deliberate exception to the "user-triggered only" rule above, which exists purely to gate *paid* AI work. Scoring is wrapped in try/catch so a scoring error can never fail a scrape that already saved its ads.
- **Recommendations are replace-on-run**: re-running the recommender fully replaces the previous set — `replaceRecommendations()` deletes the old rows and inserts the new ones. There is deliberately NO "done"/actioned state and no archive: recs are a fresh snapshot of "what to do given the competitor data right now," so nothing user-owned needs preserving across runs. The only dedup is *within* a single run (two recs that hash identically collapse to one). `stable_hash` = SHA-1(trimmed title + sorted evidence ad IDs) still populates the per-row id and enforces that within-run uniqueness; evidence is validated *before* hashing (see next point). The `actioned_at`/`archived_at` columns remain in the schema but are unused (always null) — left in place to avoid a SQLite table-rebuild migration. Full rules in `docs/ai-pipeline.md` task #4.
- **Recommendations cite only catalog ad IDs**: the recommender hands the model an "evidence catalog" — the top `EVIDENCE_PER_COMPETITOR` (12) scored ads per competitor, by `library_id`. The model may only cite those. After the call, `generate-recommendations.ts` filters every `evidence_ad_ids` against the catalog and drops invented IDs (logged, not fatal). So `evidence_ad_ids` are Meta `library_id`s (swipe-file-linkable), never internal UUIDs, and are guaranteed to resolve. Only competitor ads are catalogued — the user's own (`self`) ads are never cited as evidence.
- **Prompt caching required for the analyzer**: not an optimization. The static-vs-variable token split makes this a 40-60% cost saving for free on batched runs.
- **Structured outputs only**: every AI call returns a Zod-validated object. Never parse model text with regex or string ops. If the schema fails validation, retry once, then log and skip.
- **Provider abstraction**: never import `@anthropic-ai/sdk` directly outside `lib/ai/client.ts`. Use the abstraction so `MODEL_PROVIDER=gemini` works as a drop-in.
- **Demo mode is sacred**: all `POST`/`PUT`/`DELETE` API routes must check `process.env.DEMO_MODE === 'true'` and return `403` if so. The deployed Vercel demo must never write or call paid APIs.
- **Scoring is transparent**: any change to `lib/scoring/performance-score.ts` must update the methodology explainer shown in the UI. Don't silently change weights.
- **SQLite migrations are append-only**: never edit a past migration. Generate a new one with `pnpm drizzle-kit generate`.
- **Server components by default**: use client components only when you need state, effects, or browser APIs. Mark with `'use client'` explicitly.
- **No `any`**: TypeScript strict mode is on. If you genuinely need to escape the type system, use `unknown` and narrow.
- **shadcn components only from `components/ui/`**: don't reinvent buttons, dialogs, etc. If a needed primitive isn't installed, run `pnpm dlx shadcn@latest add <component>`.

## Important rules

- **Never commit secrets**. `.env` is gitignored; `.env.example` is the template.
- **Never commit `data/app.db`**. The bundled `data/demo-snapshot.json` is the only data file that ships.
- **Never bypass the provider abstraction** to use a "better" Anthropic-specific feature without first adding it to the abstraction with a Gemini fallback.
- **Never store user-uploaded files or PII**. The tool is for analyzing public Meta ads only.
- **Don't add dependencies casually**. Justify each one. The bundle size and supply chain are part of the product.

## Common gotchas

- **Playwright on Vercel**: doesn't work. Scraping is local-only. Routes that trigger scraping must guard with `DEMO_MODE`.
- **better-sqlite3 native bindings**: rebuild after Node version changes (`pnpm rebuild better-sqlite3`).
- **Vision token counting**: ad images are ~1000-1500 tokens each in vision calls. Batch carefully.
- **Meta Ad Library pagination**: it lazy-loads on scroll. Playwright must scroll-and-wait, not click "load more" (the button doesn't exist). Use REAL wheel events (`page.mouse.wheel`), NOT programmatic `window.scrollBy` — the latter sets scroll position without firing Meta's lazy-load listener, which silently under-captures (a market with hundreds of ads caps out at ~25). See `scrollUntilStable` in `scrape-competitor.ts`.
- **Meta Ad Library extraction**: do NOT scrape DOM. Class names are hashed and change. Intercept GraphQL responses (or parse the SSR HTML's JSON blocks for the first batch). Look for `ad_archive_id` — that's Meta's key for ads. See `docs/scraping.md`.
- **Paginated ad batches arrive as `content-type: text/html`, NOT json**: Meta's `/api/graphql` pagination responses (everything past the first ~30 SSR ads) are labeled `text/html`. The response listener in `collectMarketAds` must gate on the **URL** (`/api/graphql|/ads/library`), then accept `text/html` alongside json — a content-type allowlist of only json/ndjson/javascript silently caps EVERY scrape at the ~30 ads in the initial HTML (the scroll works fine; the responses get dropped). This was the 2026-05-31 under-capture bug. Don't re-narrow the content-type filter.
- **`display_format` is the ad STRUCTURE; `mediaType` is the MEDIA KIND — different axes**: Meta's `display_format` (`IMAGE`/`VIDEO`/`CAROUSEL`/`DCO`) is stored verbatim in the `display_format` column. `DCO` = "This ad has multiple versions" (within-ad A/B-tested `cards[]`), which is NOT a carousel. Our `mediaType` (`image`/`video`/`carousel`) reserves `carousel` ONLY for `display_format=CAROUSEL`; a DCO ad takes its underlying image/video kind. Classified in `normalizeAd` (`scrape-competitor.ts`) via `isVideoCard()` + the `isTrueCarousel` flag: all-video→`video`, all-image→(`carousel` if CAROUSEL else `image`), mixed→(`carousel` if CAROUSEL else `video`). Earlier code mislabeled every multi-card DCO ad as "carousel" (Asana was 100% carousel — the tell). Don't revert to "trust cards, ignore display_format".
- **`upsertScrapedAd` refreshes Meta-derived fields on re-scrape**: when a `library_id` already exists, the update touches `caption`, `title`, `ctaLabel`, `landingUrl`, `mediaUrls`, `mediaType`, `displayFormat`, `isActive`, `daysActive`, `placements`, `countries`, `collationCount`, `collationId`, `containsAiMedia`, plus the **extended-capture fields (added 2026-06-20)**: `startDate`, `endDate`, `videoUrls`, `linkDescription`, `displayLink`, `pageLikeCount`, `pageCategories`, `pageProfileUri`, `pageProfilePictureUrl`, `adCategories`, `extraTexts`, `extraImageUrls`, `extraVideoUrls`, `containsSensitiveContent`, `isReshared`, `brandedContent`, `pageIsDeleted`. It deliberately does NOT touch `mediaPaths` (local files we've already downloaded), `variantCount` (unused legacy), or `firstSeenAt`. So when you improve the classifier or add an extraction field, re-scraping is enough to propagate the fix/backfill — no data migration needed (only a schema migration when adding a column). If a re-scrape changes `mediaType` on an ad that already has an `ad_analyses` row, the analysis prompt context is now stale; drop those analysis rows and they'll be picked up on the next analyze run.
- **Extended Meta capture (added 2026-06-20)**: the `ads` table keeps 17 more fields straight from Meta's ad object (migration `0005_short_forge.sql`). Highlights: **`startDate`/`endDate` are stored as real ISO timestamps** (no longer collapsed into just `daysActive`); **`videoUrls` holds the actual video file URL** (`video_hd_url` ?? `video_sd_url`) — but Meta SIGNS these and they EXPIRE within days, and we store the URL only (no download), so don't treat `videoUrls` as a stable asset; the still thumbnail used for display/analysis still lives in `mediaUrls`. Also captured: `linkDescription`, `displayLink` (= `snapshot.caption`, the display domain — NOT the body, which our `caption` column confusingly holds), advertiser context (`pageLikeCount`/`pageCategories`/`pageProfileUri`/`pageProfilePictureUrl`), `adCategories`, DCO variants (`extraTexts`/`extraImageUrls`/`extraVideoUrls`), and flags. Deliberately NOT captured (always null for commercial ads): `spend`, `reach_estimate`, `impressions`, `targeted_or_reached_countries`, currency/geo. The analyzer does NOT yet read the new copy fields — feeding `linkDescription` etc. into the vision prompt is a follow-up. `extractFromInitialHtml` + `normalizeAd` are exported from `scrape-competitor.ts` for testing.
- **`collation_count` is captured but NOT scored**: it's Meta's "N ads use this creative and text" (cross-ad scaling count), stored in the `collation_count` column with `collation_id`. It is MARKET-SCOPED (single-country scrape sees only that market; `country=ALL` gives the global total — ClickUp US maxed at 8, ALL hit 28) and often `null`. Deliberately NOT a scoring signal: it reflects campaign-build style (manual ad-set duplication vs Advantage+/DCO), not ad quality, so it's confounded across competitors. Use within-competitor + display only. See `docs/scoring.md`.
- **`variant_count` / `variant_pts` are unused legacy columns**: scoring is THREE signals (longevity 60 / placement 20 / recency 20), not four. The real collation number lives in the `collation_count` column (above), not here. These columns stay in the schema (append-only migrations) defaulting to `1`/`0`. See `docs/scoring.md` "Why three signals, not four".
- **AI calls run at `temperature: 0.2`** (set in both `messages.create` calls in `lib/ai/client.ts`): the product depends on the same ad analyzing to the same angle/themes run-to-run. Don't remove it or analyses/scores become non-reproducible across runs.
- **`search_type=page` is a lie**: the public Ad Library URL ignores it. Use `view_all_page_id=<ID>` for per-brand browsing. The `resolveMetaPage` helper finds the page_id from a brand name (with caveats — see "Known limitation" in changelog Status block).
- **Keyword search returns unrelated brands**: `?q=<name>&search_type=keyword_unordered` matches ads by *body text*, not page name. Filter results by `page_name` match if using a keyword URL — `pageNameMatches` in `lib/scraper/page-name-matches.ts` does this. It compares brand-significant **token sets** (dropping corporate-suffix noise like `com`/`inc`/`official`), NOT raw substrings, so "Monday" matches "Monday.com" but "Asana" does NOT match "Asana Rebel". Deliberately errs toward false negatives (a missed brand is recoverable via "Set Meta page"; a wrong-brand ad poisons analysis). Don't loosen it back to substring matching.
- **Auto-resolver fails on brands that don't say their own name**: e.g. Monday.com — none of their ads contain "Monday" in body copy, so the page-ID resolver finds nothing. The `Set Meta page` inline button on each competitor card (uses `verify-meta-page.ts` under the hood) is the manual escape hatch: user pastes the Ad Library URL, we verify with Playwright, save the page_id.
- **Geographic data is library-presence only — Meta exposes nothing else, which is why the footprint feature was REMOVED (2026-06-04)**: for commercial ads Meta returns `reach_estimate`, `spend`, `targeted_or_reached_countries`, `country_iso_code` as **null/empty** (only political/EU ads populate them). The only geo signal is *which country library an ad appears in*. The old per-country "Map markets" sweep built a footprint from this, but it was thin and confusing (a global ad shows up in no single country), so the whole feature was dropped: no Map-markets button, no footprint card, no Insights market-gaps panel, no `marketFootprint` rollup, no geographic recommender dimension. Never claim spend/reach/demographics by region — the data doesn't exist. `competitor_syntheses.market_footprint` is now a retired legacy column (always null).
- **`ads.countries` still exists but no feature reads it**: a **Specific country** scrape records that one country into `ads.countries` (unioned across runs); the default `ALL` scrape records none (`if (market === ALL_COUNTRIES) continue;` in `scrape-competitor.ts` — recording `"ALL"` as a country would be meaningless). The column is kept for provenance but nothing surfaces it anymore. `ALL_COUNTRIES` + the picker's `COUNTRY_OPTIONS` live in the pure `lib/markets.ts` (browser-safe, no Playwright). **Meta uses `GB`, not `UK`**, for the United Kingdom.
- **Live/paused status is per-VIEW, and only the `ALL` view is authoritative**: Meta reports the SAME ad's `is_active` differently depending on which library you query. A global/Advantage+ ad (e.g. Monday.com) reads **paused in a single country's library** even while it's **active in the global ALL view**, because it isn't a *country-targeted* buy. So the default scrape is `ALL` — the only trustworthy "is this ad live?" signal. (This per-view conflict is also why the old per-country footprint sweep was a problem and was removed.) For a scrape, a market that fails leaves the run `partial` and skips `markMissingAdsInactive` (a failed market must not be read as "ads stopped").
- **Pruning paused, un-analyzed ads — `pnpm clean:ads`**: deletes ads that are BOTH paused AND have no successful analysis (keeps all active ads + all analyzed ads, including paused ones that feed "Tried & dropped"). Cascades the orphaned `performance_scores` + `ad_analyses` rows and deletes the creative files on disk. Demo-guarded, pure, `--dry-run` previews. The Tried & dropped section + winner/dropped angle grouping in `synthesis-panel.tsx` are derived client-side from the analyzed ad data (paused non-winner = flopped+retired buckets), so they stay accurate after a prune.
- **`markMissingAdsInactive` doesn't know about the `maxAds` cap**: if you re-scrape with `--max-ads=10` against a competitor that has 25 ads in the DB, the 15 ads past the cap get incorrectly flipped to `is_active=false`. Use the UI's 25/50/100 presets which are safe in practice; avoid low caps when ads already exist. Real fix is a future "did we hit end-of-library?" signal.
- **`daysActive` is run length, not age** (`computeDaysActive` in `lib/scraper/days-active.ts`): a live ad counts `start_date → now`; a **paused** ad counts `start_date → end_date` (the day Meta stopped it). Counting paused ads to `now` would inflate longevity (60% of the score) forever — a 30-day ad paused a year ago would read ~395 days and falsely max out. `end_date` is frozen for paused ads and tracks ~today for live ones. Computed at scrape time, so pre-existing paused ads keep their old inflated `days_active` until re-scraped (same propagation model as placements/countries). **Update 2026-06-20: `startDate`/`endDate` ARE now stored as ISO timestamp columns** (they used to be read for the `daysActive` math and thrown away). `daysActive` is still the scoring signal; the stored dates are for display/timelines. Pre-existing rows have NULL `startDate`/`endDate` until re-scraped.
- **Scrape API route is SSE**: `POST /api/competitors/[id]/scrape` returns `text/event-stream`, not JSON. Each event is `data: {...}\n\n`. Closing the client connection does NOT kill the server-side Playwright run — the scrape_runs row still gets written. This is intentional (fast UX, no zombie kill logic), but means "Cancel" is really "stop watching."
- **Analyze API route is SSE too**: `POST /api/competitors/[id]/analyze` follows the same shape as scrape. Same cancel semantics: aborting the client only stops the client stream; the worker pool finishes its in-flight batch and writes rows.
- **Synthesize API route is plain JSON, NOT SSE**: `POST /api/competitors/[id]/synthesize` is a single Sonnet call, so it returns one JSON object (`{status, adsAnalyzedCount, reason?}` or `{error}`), unlike scrape/analyze. The client (`synthesis-panel.tsx`) awaits it, then calls `router.refresh()` to re-render the server component with the new synthesis. `status:"skipped"` (HTTP 200) means there were no analyzed ads to synthesize — surface the `reason`, don't treat it as an error.
- **Synthesizer deterministic roll-ups (`creativeLanguages`/`mediaMix`/`topPainPoints`/`topBenefits`/`launchVelocity`/`dominantCtas`) are computed in code over the ANALYZED subset, not all scraped ads** — same as the angle/voice tallies. (`dominantCtas` = the raw `ctaLabel` tally that drives the user-facing "selling motion" display.) They only populate after a **re-synthesis** (no backfill of old rows), but need no re-scrape/re-analyze — they read columns we already have. Two non-obvious rules: (1) **Language detection runs on `caption`/`title` ONLY, never the CTA** (Meta localizes `cta_text` to the viewer — the documented Kannada-CTA trap). Detection uses **`tinyld`** (a SHORT-text detector), NOT franc-min. **Why the switch (2026-06-03):** franc-min could not separate short Spanish from short Portuguese — sister languages score within its margin gate — so it dumped nearly every genuine Spanish/Portuguese caption to "undetected" and erased Monday.com's whole LATAM expansion from the synthesis (real bake-off: franc 3/7 on ES+PT, tinyld 7/7). The English-prior tie-break is retained but re-tuned: when a non-English winner beats English by less than `ENGLISH_PRIOR_MARGIN` (0.02) and English is top-3, trust English (recovers terse English fragments tinyld over-calls as Romanian/Estonian). tinyld emits ISO 639-1; `detectLanguage` maps to ISO 639-3 (`ISO1_TO_3`) so the module contract is unchanged. **NFKC-normalize before detecting** (`stripTemplates`): advertisers use lookalike glyphs — Monday's "monday․com" uses U+2024 ONE DOT LEADER, which made tinyld call 55 English ads Armenian; ClickUp uses 𝗺𝗮𝘁𝗵-𝗯𝗼𝗹𝗱 letters. NFKC folds both to ASCII. Language ≠ country; it's localization DEPTH, footprint owns "where." (2) **`launchVelocity` uses `isActive && daysActive <= N`, NOT `firstSeenAt`** — `firstSeenAt` is when WE first scraped the ad, so it reads "all new" on a brand's first scrape; `daysActive` on a LIVE ad = days since Meta's `start_date` = real launch recency.
- **Image media-type sniffing**: Meta sometimes serves a `.jpg` URL that's actually PNG/WebP bytes. The analyzer sniffs magic bytes (`lib/ai/analyzers/analyze-creative.ts → sniffImageMediaType`) before sending to Anthropic — trusting the extension caused ~3% of analyses to fail on real data. Don't add new image consumers without sniffing.
- **`pnpm analyze` needs `.env` loaded**: the CLI runs `tsx --env-file=.env` so it picks up `ANTHROPIC_API_KEY`. If Claude Code is in the parent shell, it also injects an `ANTHROPIC_API_KEY` of its own — prefix with `env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL` to ensure the .env value wins.
- **Failed analyses are stub rows, not missing rows**: when an ad's analysis errors out (validation failure after retry, image bytes corrupted, etc.), the analyzer writes a row with `analysis_failed_at` set and most columns null. The dashboard's "Analyze N ads" count includes these — they get retried on the next run. Don't delete failed rows; let them get overwritten.
- **Dynamic Creative captions**: `snapshot.body.text` is sometimes a template placeholder like `{{product.brand}}`. Treat that as no caption and fall through to title / carousel cards.
- **CTA localization**: `snapshot.cta_text` is rendered in the viewer's language (we've seen Kannada CTAs for US-targeted scrapes). Use `snapshot.cta_type` (the canonical English enum) instead.
- **shadcn dark mode**: this project is dark-mode-first. Light mode is a future enhancement; don't optimize for it now.
- **UI primitives are Base UI, not Radix**: `components/ui/*` wrap `@base-ui/react`, not `@radix-ui`. The API differs — to render a custom element as a trigger/child, pass `render={<el/>}` (Base UI), NOT `asChild` (Radix). `asChild` will fail typecheck with "Property 'asChild' does not exist". See `components/ui/dialog.tsx` for the pattern.

## How to update this file

If you (Claude) discover a recurring mistake or a non-obvious convention while working, add it to the relevant section here or to the appropriate `docs/*.md` file. This is a living file — improving it improves every future session.
