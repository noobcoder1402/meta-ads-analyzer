# Deterministic analysis layer (`lib/analysis/`)

> Read this before touching `lib/analysis/`, before adding/removing a metric, or before
> changing the Insights page.

> **Neutral by design (2026-06-22).** This layer has **no "winner / flop" value framing**.
> Meta exposes no spend, reach, or conversions for commercial ads, so we can never prove an
> ad is "good" — we only report *facts*: how long an ad has run, whether it's active or
> inactive, and what mix of formats/CTAs/copy/placements/domains it uses. The Insights
> segment lens is **All ads / Active ads / Inactive ads** (live vs not-live), nothing more.
> The longevity tiers are kept as a *descriptive* run-length split, explicitly NOT a quality
> score. (The old per-ad scoring engine, the Swipe File, and the competitor-detail page were
> removed in the same change — see `changelog.md`.)

**What this is.** A 100% **deterministic** competitive-analysis layer. Zero AI, zero cost.
Every number is pure math over columns Meta already gave us (longevity, CTA, media,
placements, copy, domains, collation). The whole thing is **recomputed on every read** —
there's no `analysis` table, no caching, no background job. That's deliberate: it's a
small hobby project and "fresh analysis each time" is simpler and never goes stale.

**Why deterministic-first.** Everything that can be computed exactly is computed exactly —
no AI, no cost, fully reproducible run-to-run. An optional, **user-triggered** fixed-enum
AI pass may later sit *on top* of these numbers, but it will never replace them, and
nothing in this layer calls a paid API.

**The AI narrative sits strictly on top.** The Insights page has a "Strategic insights"
panel where a high-quality model (Opus) reads the deterministic output of this layer and
writes a narrative (`lib/ai/analyzers/generate-insights.ts`, cached in `ai_insight_reports`
— see `docs/ai-pipeline.md`). That AI **never enters this layer**: it doesn't recompute a
number, doesn't see raw ads, and is bound by the same golden rule below (no
spend/reach/market-share). It's interpretation *of* these numbers, clearly labelled as
such, and user-triggered + cached so it never costs anything on a page load.

**The golden rule: never over-claim.** Meta returns `spend`, `impressions`, `reach`,
demographics and geography as **null** for commercial ads (only political/EU ads populate
them — see `docs/meta-ads-mechanics.md`). So this layer **never** says "spend", "budget",
"market share", "outspends", or "reach". It only ever says things we can defend from the
data: how long an ad has run, what format it is, which CTA/surface it uses, what words it
repeats. Shares are "% of *ads*", never "% of *spend*".

---

## File map

```
lib/analysis/
  types.ts                 # AnalysisAd (structural subset of a Drizzle Ad) + Tally / LongevityTier
  metrics.ts               # ALL the pure per-competitor metric functions + tunable thresholds
  phrases.ts               # copy mining → the "phrase bubble" (document-frequency n-grams)
  analyze-competitor.ts    # composes metrics + phrases + language into ONE CompetitorAnalysis object
  analyze-across.ts        # folds many CompetitorAnalysis into head-to-head + self-gap
  index.ts                 # public surface (import from "@/lib/analysis")
  metrics.test.ts          # snapshot model, longevity, active/inactive segments, dedup, CTA, structure, domains
  phrases.test.ts          # phrase-mining (document-frequency) tests
```

Everything in `metrics.ts` and `phrases.ts` is a **pure function** — no DB, no AI, no
clock except an injected `now`. That's why they're unit-tested with hand-built fixtures.
`analyze-competitor.ts` / `analyze-across.ts` are also pure (they just fold the above).
The DB read that feeds them lives in the page/route, not here.

---

## The snapshot model (how "live" is decided)

This underpins **every** metric, so understand it first.

We scrape with `active_status=all`, so Meta hands back each ad's **real** `is_active`
flag — both active and inactive ads. We **trust that flag directly**; we do **not** infer
"paused" from an ad being absent in a later scrape. On our data, ~93% of "paused" ads are
Meta's own flag; only ~7% are true disappearances, which we leave frozen at their
last-known status.

So an ad is **live** when **both** are true:

```ts
isLive(ad) = ad.isActive AND ad.lastSeenAt >= latestScrapeAt
```

`latestScrapeAt` = the **start time of the latest successful scrape** (`scrape_runs`).
The `>=` filters out "ghost" rows that Meta still flags active but that didn't appear in
the most recent scrape. Both timestamps are `"YYYY-MM-DD HH:MM:SS"`, so a plain string
compare is chronological. If we've never scraped (`latestScrapeAt = null`), we fall back
to Meta's flag alone.

> **Pitfall that bit us once:** compare `lastSeenAt` to the scrape **start**, not to
> `MAX(last_seen_at)`. A scrape stamps each ad a second or two apart over ~100s, so
> comparing to the max instant makes all-but-one ad look "absent." (This is the bug behind
> the bogus "96% of ads disappear" reading.)

---

## A–G: the per-competitor metrics (`analyzeCompetitor`)

One call → one `CompetitorAnalysis` object that the Insights page renders.
Tunable thresholds all live at the top of `metrics.ts` (single source of truth; surface
them in the UI explainer so the methodology is transparent).

### A. Longevity tiers — **LIVE ads only**

A *descriptive* run-length split: how long has each **still-running** ad been live? Paused
ads are **excluded** from the tiers (the tiers measure how long an ad has been *running*, so
a stopped ad has no place here — and counting a long-paused ad would distort it). The labels
are **neutral run-length bands, NOT a quality judgment** — a long run could mean a profitable
evergreen ad OR just a brand that doesn't refresh creative; Meta gives us no way to tell.

Tiers, by `days_active` (`[min, max)`, max exclusive):

| Tier | Days live | Read (neutral) |
|---|---|---|
| Testing | 0–30 | Brand-new, still early |
| Established | 30–60 | Past the first month |
| Strong | 60–90 | Running a while |
| Long-running | 90–180 | Live for months |
| Veteran | 180+ | Live 6+ months |

**Median run length** (`medianDaysActive`, surfaced as `CompetitorAnalysis.medianDaysActiveAll`):
the median `days_active` across **ALL** ads — live **and** paused — a single robust "typical
run length" figure. Median (not mean) so a handful of very-long-running ads can't skew it.
This is the **one run-length number computed over all ads**, not live-only (the tiers stay
live-only); the Insights longevity section labels it as such so the basis is unambiguous.

> **Why `days_active` is run-length, not age:** for a live ad it's `start_date → now`;
> for a paused ad it's `start_date → end_date` (frozen). See `lib/scraper/days-active.ts`
> and the CLAUDE.md gotcha. The tiers only ever read live ads, so the freeze only matters
> for the median run length (which includes paused ads).

### Segments — the active/inactive lens (`inSegment`)

The single live predicate `isLive` (active by Meta **and** seen in the latest scrape) drives
the segment filter: `inSegment(ad, latestScrapeAt, "all" | "active" | "inactive")`, where
`active` = live now and `inactive` = the complement (paused/ended). **`active` + `inactive`
partition `all`** — no overlap, no gap, no value judgment. The Insights "Creative & messaging"
tables re-run the mix metrics over the chosen segment so you can compare *what a brand is
currently running* (active) against *what it has stopped* (inactive). **Sample-size guard is
mandatory:** segment counts can be lopsided, and a share computed over a handful of ads is
noise. The UI shows each segment's `n` per brand and greys out columns under a floor
(`MIN_SAMPLE`), so a thin sample can't masquerade as a confident finding.

### C. Creative mix

For media kind, ad structure, and copy length we show the **plain share · count** across the
brand's ads (`mediaMix` / `structureMix` / `copyLengthMix` → `Tally[]`). On the Insights page
each table is re-lensed by the active/inactive segment, so the same metric can show "what
they run now" vs "what they've stopped."

- **Media kind** (`mediaType`): Image / Video / Carousel.
- **Structure** (`display_format`): Single image / Single video / Carousel /
  **Dynamic creative (DCO)**. **DCO ≠ carousel** — DCO is "this ad has multiple internal
  versions" (within-ad A/B test), not a swipeable carousel. Mislabeling DCO as carousel is
  the classic bug (Asana once read 100% carousel — the tell). Old rows with null
  `display_format` fall back to media kind.
- **Copy length** of primary copy: Short < 80 chars, Medium < 200, Long ≥ 200,
  plus "No primary copy".

### D. CTA mix — **raw Meta labels**

`ctaMix` counts the **exact** CTA label Meta shows ("Learn More", "Sign Up", …); a null CTA
is "No CTA". We use the raw label directly — there is no derived "conversion goal" bucket
(that CTA→goal taxonomy was removed 2026-06-22 because nothing read it).

> Use `cta_type` (canonical English enum), **never** `cta_text` — the text is localized to
> the viewer (we've seen Kannada CTAs on US scrapes). The scraper already stores the
> resolved label.

### E. Phrase bubble — **copy mining** (`phrases.ts`)

The "top phrases" cloud: the words/phrases a competitor **repeats across ads**, sized by
how many ads use them.

- **Document-frequency, not term-frequency.** A phrase counts **at most once per ad**. One
  ad saying "work management" 5× shouldn't outweigh 5 ads each saying it once — the second
  is the real positioning signal.
- **3–5 word phrases (no 1–2 word fragments).** Short fragments ("work", "teams", "project
  management") are too generic to show positioning; 6+ word phrases too rare to repeat.
  Phrases are dropped if they **start or end on a stopword** (so "of your" / "the best way"
  don't pollute it) or contain a bare number.
- **The "AI" exception (`countAdsMentioningAi`).** "AI" is deliberately too short to be a
  phrase but is a meaningful positioning signal, so it's surfaced **separately** as an
  explicit per-brand count: how many ads whose copy says "AI" / "A.I." / "artificial
  intelligence" (word-boundaried, case-insensitive, **once per ad**). Shown as its own
  "Mentions AI" row in the Insights Messaging section, not mixed into the phrase ranks.
- Mines `caption + title + linkDescription + extraTexts` (all author-written copy) — never
  the CTA (localized). Stopword list is deliberately small so brand names + product nouns
  survive; it includes `com/www/http/https` so `monday.com` → `monday`, not `com`.
- Defaults: phrases in **≥ 2 ads**, top **30**, most-used first.
- **Hard limitation — WRITTEN copy only.** This reads Meta's text fields; it is **blind to
  words rendered INSIDE the image/video** (no OCR) and **does not weight placement** — a word
  in the prominent below-creative headline counts the same as one buried deep in the body
  caption. So **never claim a brand "owns" or "leads on" a word from these counts**, and never
  infer prominence. (Real example, 2026-06-22: phrase counts said ClickUp "led" on *free* at
  34% vs Monday 10% — but ClickUp's "free" is buried in body captions while Monday/Asana put
  *"Start your free trial"* in the headline AND likely in the creative art, which we can't read
  at all. The count was right; the "leads on free" conclusion was wrong.)

### F. Placement spread — **does NOT inflate volume**

Which surfaces each competitor runs on: **Facebook / Instagram / Messenger / Audience
Network / Threads**. Document-frequency again — "% of ads that run on X", denominator =
ads that have any placement data.

> **Critical for the volume question:** placements live **inside one ad entry** — an ad on
> all 5 surfaces is still **one** `ad_archive_id`, not five. So placements never inflate
> the ad count. They're a separate axis: *reach breadth per ad*, not *how many ads*. This
> is exactly how you tell "blankets every surface" (ClickUp) from "concentrates on FB+IG"
> (Asana) — two different strategies that the raw count can't distinguish.

### G. Landing pages / domains

- **`landingDomains`** — the host only (`display_link` preferred, else `landing_url` host,
  `www.`/scheme stripped). **But domain alone is near-useless cross-brand**: every brand's
  ads link to its own domain, so a domains comparison just says "everyone links to themselves."
- **`landingPages`** — host **+ path** (query/hash stripped, trailing slash removed),
  ranked by ad count. This is the real signal: the *page/offer* each brand drives traffic
  to (`/lp/get-started`, `/campaign/try-now`, `/pricing`). Within-competitor (a top-N list
  per brand), because brands share no common landing pages. This is what the Insights
  "Landing pages" table surfaces; re-lens to active vs inactive to compare where current ads
  point vs where stopped ones did.

### Plus: scaling, advertiser context, launch velocity

- **Creative scaling** (`creativeScaling`): Meta's `collation_count` ("N ads use this exact
  creative & text"). **Within-competitor display only** — it's confounded across
  competitors (build style, market scope) so it is **never** a cross-competitor or scoring
  signal. We show each competitor's own top-scaled creatives.
- **Advertiser context** (`advertiserContext`): `page_like_count` + `page_categories` from
  the freshest row that has them. Populated for all tracked brands (the 2026-06-22 re-scrape
  filled `page_like_count`/`page_categories` — they were added 2026-06-20). The UI still
  guards gracefully if a future brand is scraped before these exist.
- **Launch velocity** (`launchVelocity`): new ads in the last 14 / 30 days from
  `start_date`. `hasDates` is now true across the dataset (the 2026-06-22 re-scrape populated
  `start_date`); the UI hides velocity only if a brand has no dated rows yet.

---

## De-confounding volume → **distinct creatives** (Meta's signal only)

The single most important honesty fix in this layer.

**The problem.** Raw `ad_archive_id` count is **confounded by build style**:
- A brand that **manually duplicates** one creative across many ad-sets shows **many**
  entries for **one** idea.
- A **DCO / Advantage+** brand bundles many creatives into **few** entries.

So "ClickUp runs 222 ads vs Asana 20" is **not** an apples-to-apples volume comparison.

**The fix — and its hard boundary.** We collapse entries to **distinct creatives using
ONLY Meta's own `collation_id`** ("these entries share one creative & text"):

```ts
creativeKey(ad) = ad.collationId ? `coll:${collationId}` : `id:${libraryId}`
distinctCreatives(ads) = unique creativeKeys
```

We do **NOT** guess similarity from caption / media / CTA. An entry Meta didn't collate is
counted as its own creative. This was a deliberate user call: *"just check Meta's collation
id and see what it gives — don't make your own analysis on creative."* The number is Meta's
grouping surfaced honestly, not our inference.

**Known, disclosed limitations** (state these in the UI, don't hide them):
- It can **over-state** distinct creatives — true duplicates Meta didn't collate stay
  separate.
- It can **under-state** for **DCO bundlers** — one entry hides many internal variants we
  can't split. So `distinctCreatives` is a **floor**.
- `collation_count` is **market-scoped**: a single-country scrape sees only that market's
  count; `country=ALL` gives the global total. Compare like with like.

**What it gave on real data (live ads):**

| Competitor | Raw live entries | Distinct creatives (collation_id) |
|---|---|---|
| ClickUp | 222 | **105** (96 collation groups + 9 uncollated) |
| Monday | 38 | **35** |
| Asana | 20 | **19** |

→ ClickUp's raw count is ~2× inflated by manual duplication; the "11× Asana" headline
collapses to roughly **3–5×** on distinct creatives. And because Asana/Monday lean on DCO,
their 19/35 *under*-counts their true variety. Honest takeaway: **ClickUp is a higher-
volume advertiser, but not by the raw margin — and there's no clean "who advertises more"
winner** because the two build styles aren't directly comparable. Always show both the raw
count and the distinct count, with the confound labeled.

---

## H: cross-competitor + self-gap (`analyzeAcross`)

Folds many `CompetitorAnalysis` objects into the Insights page view.

- **Head-to-head table** (`HeadToHeadRow[]`): one row per competitor (incl. `self`) —
  total ads, active (live) count, inactive count, **distinct live creatives**, top CTA,
  top media, top language.
- **Self-gap** (`gaps`): where competitors **out-index the user's own `self` brand** on a
  **share** basis — CTA, media, language, placement. `competitorShare` = mean share across
  non-self competitors; a dimension is a "gap" only if competitors lead the user by
  ≥ `GAP_MIN_DELTA` (10 share-points), sorted by biggest gap first.

> **Always a SHARE comparison, never volume/spend.** "Competitors run more video than you
> (60% vs 20% of their ads)" is defensible. "Competitors outspend you on video" is **not** —
> we have no spend. The self-gap needs a `self` competitor present (`selfPresent`); with no
> `self` row, gaps are empty.

---

## Out of scope — hard rules (never claim these)

The analysis **must not** assert anything Meta doesn't give us for commercial ads:

- ❌ **Spend / budget / impressions / reach / CPM / CPC** — always null for commercial ads.
- ❌ **Market share / "outspends" / demographics / geography-by-region** — Meta exposes none
  of it. The only geo signal is *which country library an ad appears in*; never infer
  spend/reach/audience by region.
- ❌ **"Winner / flop" or any quality verdict on an ad** — we have no spend/results, so a long
  run is never "proof it works" and a short run is never "proof it failed." Report run length
  and active/inactive as facts; never editorialize them into good/bad.
- ❌ **Homemade content-similarity dedup** — distinct creatives are grouped by Meta's
  `collation_id` only, never by guessing from caption/media/CTA.
- ❌ **Conversion-goal taxonomy in the UI** — the analysis shows the **raw** Meta CTA label;
  the internal goal mapping is not surfaced here.

> **The one allowed exception — clearly-fenced EXTERNAL data.** These rules forbid *inferring*
> spend/reach/market-share/geography **from the Meta ad library** (it isn't in the data). They do
> NOT forbid showing *clearly-cited external facts* of a different provenance. The Insights page has
> exactly one such block — "Company scale & regional reach" (`app/insights/_components/company-scale-table.tsx`):
> hand-curated revenue/customers/valuation/HQ/regions from public filings (audited) + self-reported
> numbers for private brands (tagged `est.`). It lives OUTSIDE this `lib/analysis/` layer, is static
> (not recomputed), carries an "External context — not from Meta ad data" banner + per-figure sources,
> and must never be mixed into the ad-derived metrics. Don't let it leak into `lib/analysis/`.

---

## Data dependencies / re-scrape notes

A **current scrape populates every column**, so a fresh clone gets all metrics. The
"added 2026-06-20" note below only mattered for rows scraped *before* that date — and the
three tracked brands were fully re-scraped on 2026-06-22, so **all columns are now populated
across the whole dataset** (verified: `start_date`, `page_like_count`, `page_categories` set
on all ~1,846 ads).

| Metric | Column(s) | Status |
|---|---|---|
| Longevity tiers, active/inactive, median run length | `days_active`, `is_active`, `last_seen_at` | ✅ |
| Media / structure mix | `media_type`, `display_format` | ✅ (structure falls back to media on null `display_format`) |
| CTA mix | `cta_label` | ✅ |
| Phrases | `caption`, `title`, `link_description`, `extra_texts` | ✅ (`link_description`/`extra_texts` added 2026-06-20) |
| Placements | `placements` | ✅ |
| Domains | `display_link` / `landing_url` | ✅ (`display_link` added 2026-06-20; URL fallback always works) |
| Distinct creatives | `collation_id` | ✅ |
| Advertiser context | `page_like_count`, `page_categories` | ✅ (added 2026-06-20; populated after the 2026-06-22 re-scrape) |
| Launch velocity | `start_date` | ✅ (added 2026-06-20; populated after the 2026-06-22 re-scrape) |

Re-scraping is non-destructive and self-healing (`upsertScrapedAd` refreshes Meta-derived
fields), so a fresh scrape backfills any newer columns with no migration.

---

## Conventions for this layer

- **Pure functions stay pure.** Anything in `metrics.ts` / `phrases.ts` takes data in and
  returns data out — no DB, no `Date.now()` except an injected `now`, no AI. Keep it
  testable.
- **Thresholds are surfaced.** `LONGEVITY_TIERS` and `COPY_*_MAX` are the single source of
  truth and must be shown in the UI explainer. Changing one is a methodology change — note
  it in `changelog.md`.
- **Recomputed on read.** No analysis table, no cache. If that ever gets slow, memoize at
  the page layer — don't add a persistence step that can go stale.
- **Honesty over completeness.** Every metric either is defensible from Meta's data or is
  labeled a floor/estimate with its confound stated. When in doubt, show the raw number
  next to the adjusted one.
