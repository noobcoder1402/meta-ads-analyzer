# Scoring

Read this before changing anything in `lib/scoring/` or before changing how scores are explained in the UI.

## The fundamental constraint

Meta does not expose spend, impressions, reach, CTR, or conversion data for commercial ads in the public Ad Library. Performance therefore cannot be **measured**; it can only be **inferred** from public signals. This is the entire reason the scoring layer exists.

Every signal we use answers the same underlying question: *would the advertiser keep this ad running if it wasn't working?*

## Why three signals, not four

Earlier versions reserved 20 points for a **variant count** signal (how many near-identical creatives an advertiser split-tests — seemingly strong evidence of budget being scaled). It was removed, and after a deeper investigation (2026-05-31) it stays removed — but for a more precise reason than the original docs claimed.

**What we originally got wrong:** the first removal said we *couldn't* tell a "5-image carousel" from "5 A/B-tested versions" because both fill `cards[]`. That's actually false — Meta's `display_format` field cleanly separates `CAROUSEL` from `DCO`, and `collation_count` ("N ads use this creative") is well-populated in *healthy* scrapes (the dump we first judged on was a failed scrape, which is why it looked null/1). We now capture both fields (see `docs/scraping.md`).

**Why it's still not a scoring signal:** both "variant-flavored" fields measure **how an advertiser builds campaigns, not ad quality**. Measured across competitors: ClickUp ran high `collation_count`s (manual ad-set duplication) while Asana/Monday sat near 1 (Advantage+/DCO consolidation) — *for the same spend*. Folding that into a cross-competitor 0–100 score would reward campaign-build style and make ClickUp look like it's "scaling winners" purely from how it constructs campaigns. So `collation_count` / DCO version count are used as **within-competitor context + display only** (e.g. "N ads use this creative" on the ad card), never as score input.

The 20 points were **redistributed** into the three signals that *do* track ad quality, and the 0-100 scale now means what it says. The `ads.variant_count` and `performance_scores.variant_pts` columns remain as unused legacy (append-only migrations), always written `1`/`0`. (The real collation number lives in its own `ads.collation_count` column — captured, displayed, not scored.)

## The three signals

### Longevity (60 points — biggest weight)

Why it's the strongest signal: Meta advertisers kill bad ads fast. A losing ad burns measurable money every day, so the typical kill-cycle is 2-3 days. If an ad has been running for 90+ days, the advertiser almost certainly has data showing it's profitable. They wouldn't keep paying otherwise.

**Log-scaled, not linear.** A jump from 7 to 14 days matters much more than 90 to 180 — the first month is when winners separate from losers; after that you're just confirming what you already knew.

```ts
function longevityPoints(daysActive: number): number {
  if (daysActive <= 0) return 0;
  const pts = 37.8 * Math.log10(daysActive) - 19.8;
  return Math.max(0, Math.min(60, pts));
}
```

Reference points:
- 7 days → ~12 pts
- 14 days → ~24 pts
- 30 days → ~36 pts (the "this is probably working" threshold)
- 90 days → ~54 pts
- ~130+ days → 60 pts (capped — beyond this it's all the same signal)

**`daysActive` is run length, not age.** Computed in `lib/scraper/days-active.ts` (`computeDaysActive`, pure + unit-tested) from Meta's `start_date`/`end_date`: a **live** ad counts to *now*; a **paused** ad counts to its `end_date` (the day Meta stopped it). This matters because counting a paused ad to *now* would inflate its longevity forever — a 30-day ad paused a year ago would read ~395 days and falsely max out at 60. Because the value is computed at scrape time and stored, **pre-existing paused ads keep their old inflated `days_active` until re-scraped** (same propagation model as the placements/countries fixes).

### Placement spread (20 points)

Meta's Ad Library shows which placements each ad runs on: Feed, Reels, Stories, Marketplace, etc. An advertiser running an ad across multiple placements is committing more budget and trusts it across formats. A single-placement ad might just be a test.

```ts
function placementPoints(placements: string[]): number {
  return Math.min(20, placements.length * 5);
}
```

5 points per placement, capped at 4 placements (so 20 max).

### Currently active (20 points)

A paused-but-recently-active ad still tells you something — it was probably a winner that the advertiser cycled out for creative refresh. But a *currently running* ad is a stronger signal than a paused one.

```ts
function recencyPoints(isActive: boolean, daysSinceLastSeen: number): number {
  if (isActive) return 20;
  if (daysSinceLastSeen < 30) return 10;   // recently paused
  return 0;                                 // long-paused, ignore
}
```

## The composite

```ts
function performanceScore(ad: AdRow): ScoreBreakdown {
  const longevity = longevityPoints(ad.days_active);
  const placement = placementPoints(ad.placements);
  const recency   = recencyPoints(ad.is_active, daysSince(ad.last_seen_at));

  return {
    score: longevity + placement + recency,    // 0-100
    longevity_pts: longevity,
    placement_pts: placement,
    recency_pts: recency,
    explanation: buildExplanation(...),
  };
}
```

The function is pure — no I/O, no async — and unit-tested in `lib/scoring/performance-score.test.ts`. Re-runnable any time without re-scraping or re-analyzing.

## Bucket predicates (canonical definitions)

Pure predicates in `lib/scoring/buckets.ts` — the single source of truth used by the synthesizer prompt builder, the competitor detail page sections, and the swipe file. Other docs reference this section by name; they do not redefine the predicates.

| Bucket / tag        | Predicate                                                                          | Where surfaced                                          |
|---------------------|------------------------------------------------------------------------------------|---------------------------------------------------------|
| **Winner**          | `score >= 70 AND days_active >= 30`                                                | Competitor detail Winners section, swipe file, mini-summary count |
| **Always-on winner** (Winner tag) | `is_active = true AND score >= 70 AND days_active >= 60` — mutually exclusive with `Paused` | `competitor_syntheses.always_on_winners`; `Always-on` tag on Winner rows; competitor detail Winners section |
| **Paused** (Winner tag) | Winner AND `is_active = false`. A proven 60+ day winner that's been switched off is Winner + Paused, never Always-on. | `Paused` tag on a Winner that's been cycled out |
| **Active experiment** | `is_active = true AND days_active < 14`                                          | Competitor detail New section, swipe file, mini-summary count |
| **Maturing**        | `is_active = true AND 14 <= days_active < 30`                                       | Competitor detail (the "watch this one" middle state); was previously hidden in Other |
| **Flopped**         | `is_active = false AND days_active < 14`                                            | Competitor detail Dropped section, swipe file (toggle), mini-summary count |
| **Retired**         | `is_active = false AND days_active >= 14`                                           | Competitor detail bucket bar + by-market/by-format breakdown tables; previously hidden in Other |
| **Likely campaign** (Flopped tag) | Flopped AND analysis angle ∈ {`offer-led`, `fomo-scarcity`} OR a promo theme (sale / `% off` / seasonal / limited-time / "ends soon") | `Likely campaign` tag on a Flopped ad, to separate a planned one-time promo from a true flop |

**Membership is exclusive** — `bucketOf(ad, score)` returns exactly one bucket using priority **Winner > New > Maturing > Flopped > Retired > Other**. A long-running high-scorer that just went paused stays a Winner with a `Paused` tag rather than dropping into Retired.

**Flopped vs Retired — both are paused, split by run length.** Every paused ad is either **Flopped** (`days_active < 14` — pulled fast, the clearest "didn't earn its budget" signal) or **Retired** (`days_active >= 14` — ran a real multi-week stint then cycled out; typically a proven creative refreshed, NOT a failure, and strong swipe material). The only exception is a paused high-scorer, which Winner's priority keeps as a `Paused` Winner. Adding Retired emptied the old catch-all: in the live DB the entire Other bucket (119 ads, avg 37-day run, avg score 63) was proven-then-paused ads — exactly this group. Both buckets are AI-free, zero-cost run-length math; the `Likely campaign` tag still distinguishes a short planned promo from a true Flopped failure (below).

**Likely campaign is an inferred, analysis-dependent tag, not a hard split.** Run length alone can't tell a flop from a planned burst (a Black Friday ad legitimately runs a few days and stops); the only honest signal is the creative *announcing* a promo. So the tag reads the ad's analyzed angle/themes — meaning an **un-analyzed** Flopped ad carries no tag and reads as a plain flop until analyzed. The tag softens to "Likely" because the signal is indicative, not definitive. Computed purely from analysis fields in `isLikelyCampaign()`; the core bucket math stays AI-free and zero-cost.

**Other** is now a true residue, not a dumping ground. With Retired absorbing all paused-but-ran ads, the only thing that still lands in Other is a *live* ad past 30 days that scores under 70 (a long-running mid-performer) — currently empty in the live DB. It remains the implicit catch-all (no dedicated section), flows through the synthesizer prompt as background context, and renders behind a `Show all N other ads` toggle on the competitor detail page.

> **Synthesizer seam:** the synthesis output column `competitor_syntheses.abandoned_patterns` (and the model's `abandoned_patterns` field) keep their name — they're fed by the per-ad **Flopped** bucket. Renaming the bucket to "Flopped" did not migrate that column. So "abandoned patterns" in synthesis output == clusters of Flopped ads.

Any predicate change must update `lib/scoring/buckets.ts` and the UI explainer in the same PR.

## UI requirements (non-negotiable)

The score MUST be clearly labeled as **inferred**, not measured. The methodology breakdown must be accessible on hover or click, showing each signal's contribution. If you change weights or formulas, update the in-UI explainer in the same PR — otherwise the dashboard lies to users.

Sample tooltip text:

> *Score: 84 (inferred)*
> *This is an inferred score based on public Ad Library signals — not measured performance.*
> *• Running 124 days (60/60)*
> *• 3 placements (15/20)*
> *• Recently paused (10/20)*

## Why not include more signals?

Things considered and rejected:

- **Number of ads the page runs total** — measures advertiser scale, not ad quality. Distorts cross-competitor comparison.
- **Image/text "quality" score from a model** — circular: we're trying to measure what works, not what looks polished.
- **Caption length, emoji count, CTA strength** — too noisy individually, and they're already captured implicitly via longevity (a great caption keeps an ad alive).
- **Landing page load speed** — interesting but adds scraping complexity and depends on user's geo/network. Future enhancement.

If you propose adding a new signal, it must:
1. Be observable in public Ad Library data (no Meta API access)
2. Answer the "would the advertiser keep running this" question
3. Not strongly correlate with an existing signal (otherwise it's just double-counting)

## Calibration

We have no ground truth (no actual performance data). The weights are based on practitioner heuristics, not empirical validation. This is honest and stated in the README. If you ever get access to a brand's actual ad performance data (via someone running the tool on their own ads), use it to recalibrate — but don't claim calibration we haven't done.
