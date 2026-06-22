# Meta Ad Library Mechanics — Reference

**Why this file exists:** every deterministic metric we build sits on top of what Meta's public Ad Library actually exposes. This doc is the canonical "what's real, what's confounded, what's always null" reference so we never build a metric that over-claims (e.g. "spend", "market share", "reach by region").

**Sourcing rule:** this doc cites **only official Meta-owned domains** (`transparency.meta.com`, `developers.facebook.com`, `www.facebook.com`, `about.fb.com`) — never third-party blogs/agencies (which over-claim; e.g. "commercial ads vanish when stopped" is contradicted by our own data). Every statement is tagged:

- ✅ **VERIFIED** — backed by a verbatim quote from an official Meta page (URL inline).
- 🟡 **OUR INFERENCE** — Meta does **not** document this; we derived it from our own scrape data or from the *contrast* between what Meta does document. Treat as a working assumption, not fact.

> **Scope:** what is true / countable / confounded / always-null for **commercial** ads (normal product / SaaS / ecommerce — the category every competitor we track runs), as distinct from political/issue/electoral and other regulated ads.

---

## 0. What "commercial ad" means (and why it matters)

✅ **VERIFIED.** Transparency depends entirely on the ad's category. Meta states the Ad Library lets "people search for **all active ads** running across products from Meta," and that **only** for "ads about social issues, elections or politics" does Meta "provide additional information, including **spend, reach and funding entities**." — https://transparency.meta.com/researchtools/ad-library-tools

So two tiers:
- **Regulated** — political / issue / electoral (and, per the API, housing/employment/financial). Disclose spend, impressions, reach, demographics, funder.
- **Commercial** — everything else: SaaS, ecommerce, app installs, lead-gen, brand. Meta discloses the **creative** and **timing** but **no spend, impressions, reach, or demographics**.

Every brand we track (ClickUp, Monday, Asana, …) runs **commercial** ads → we permanently work in the lowest-transparency tier, which is why our analysis only ever reports observable facts (longevity, creative mix, active/inactive) and never measures or infers ad performance.

---

## 1. Field availability — commercial vs regulated

✅ **VERIFIED** against the Graph API `ArchivedAd` node and `ads_archive` endpoint:
- https://developers.facebook.com/docs/graph-api/reference/archived-ad/
- https://developers.facebook.com/docs/graph-api/reference/ads_archive/

| Field | Commercial ad? | Meta's documented condition |
|---|---|---|
| `impressions` | ❌ | "only for POLITICAL_AND_ISSUE_ADS" |
| `spend` | ❌ | "only for POLITICAL_AND_ISSUE_ADS" |
| `demographic_distribution` | ❌ | "only for POLITICAL_AND_ISSUE_ADS" |
| `currency` | ❌ | "only for POLITICAL_AND_ISSUE_ADS" |
| `eu_total_reach` | ⚠️ EU-delivered only | "Available only for ads delivered to the EU" |
| `age_country_gender_reach_breakdown` | ⚠️ EU/UK only | "only for ads delivered to the UK & EU and POLITICAL_AND_ISSUE_ADS delivered to Brazil" |
| `target_ages` / `target_gender` / `target_locations` | ⚠️ EU/UK only | same condition as above (advertiser's chosen targeting) |
| `ad_creative_bodies` (body) | ✅ | "A list of the text which displays in each unique ad card of the ad" |
| `ad_creative_link_titles` (headline) | ✅ | "A list of titles which appear in the call to action section for each unique ad card" |
| `ad_delivery_start_time` / `ad_delivery_stop_time` | ✅ | run length must be **derived** (see §6) |
| `publisher_platforms` (placements) | ✅ | "Meta technologies where the archived ad appeared, such as Facebook or Instagram" |
| `page_id` / `page_name`, `ad_snapshot_url`, `languages` | ✅ | standard returnable fields |

**Bottom line (✅ VERIFIED):** for a normal SaaS ad, **spend / impressions / reach / demographics are genuinely unavailable** — this is the official node, not a blog. Never surface commercial spend or impressions as fact.

---

## 2. Page / advertiser metadata (web JSON, not the official API)

🟡 **OUR INFERENCE.** We capture page like/follower count, page categories, profile pic/URI from the **web GraphQL JSON** the Ad Library UI loads. These are **not** in the official Graph API node and Meta does not document them as Ad Library outputs. Useful as advertiser-level audience *context* — but it's the Page's overall following, **not** any specific ad's reach. Treat as observed payload, undocumented.

---

## 3. EU / DSA — the only door to reach + targeting for commercial ads

✅ **VERIFIED.** Under the EU Digital Services Act, Meta commits to "display and archive **all** ads that target people in the EU, along with the dates the ad ran, the parameters used for targeting (e.g., age, gender, location), who was served the ad, and more," stored "in our public Ad Library for **a year**." — https://about.fb.com/news/2023/08/new-features-and-additional-transparency-measures-as-the-digital-services-act-comes-into-effect/

✅ **VERIFIED** retention/visibility: EU ads "are displayed in the Ad Library **while active and archived for one year** upon the delivery of their last impression." — https://transparency.meta.com/researchtools/ad-library-tools

So for an ad that delivered ≥1 impression in the EU, the API additionally exposes `eu_total_reach`, the age/country/gender **reach** breakdown, and the advertiser's chosen targeting (§1).

Key nuances:
- ✅ This is **reach** (people who saw it) + **targeting** — **NOT spend or impressions**. Spend/impressions stay political-only even in the EU (§1).
- 🟡 **OUR INFERENCE:** it's the **EU slice only** — a US-only ad gets none of this; a global ad gets the breakdown for its EU delivery only. (Follows from "ads that target people in the EU," but Meta doesn't spell out the partial-delivery case.)
- We do **not** capture these fields today.

**Roadmap implication:** scraping an EU-country view + capturing these fields is the *only* legitimate way to surface audience reach/demographics for our (commercial) competitors. High-value future work; not in v1.

---

## 4. How ads are counted — `ad_archive_id` and collation

- ✅ **`ad_archive_id`** is the ad's identifier in the archive (the key our scraper uses). One archive row = one ad.
- 🟡 **OUR INFERENCE — collation is UNDOCUMENTED.** The "N uses of this creative and text" grouping (`collation_count` / `collation_id`) appears in the web/internal GraphQL payload but **has no official Meta documentation** — searches restricted to Meta domains found nothing describing it. From our own observation it is **country-scoped** (single-country scrape sees only that market's count; `ALL` aggregates globally — ClickUp: US capped at 8, `ALL` hit 28) and **often null**. Because it's undocumented + scope-confounded, use **display-only / within-competitor**, never as a cross-brand metric.

---

## 5. Active vs inactive — what Meta documents vs what we infer

**This is the section that was previously over-claimed. Corrected 2026-06-20.**

✅ **VERIFIED — the retention contrast (this is all Meta actually states):**
- The Ad Library shows "**all active ads** running across products from Meta." — https://transparency.meta.com/researchtools/ad-library-tools
- Political/issue ads "are visible **whether they're active or inactive** and are stored in the Ad Library for **7 years**." — same page.
- EU-delivered ads "are displayed in the Ad Library **while active and archived for one year** upon the delivery of their last impression." — same page.

🟡 **OUR INFERENCE — everything below. Meta does NOT publish a rule for inactive *commercial, non-EU* ads.** Meta only affirms (a) active ads are searchable and (b) the two special categories above stay visible when inactive. It is **silent** on how long a stopped commercial non-EU ad stays viewable.

**But our own data shows Meta returns inactive commercial ads in BULK — because we scrape with `active_status=all`** (set in `scrape-competitor.ts` + `resolve-meta-page.ts`). Browsing a page's full library that way, Meta hands back the advertiser's **active AND inactive** ads, each with a real `is_active` flag. Measured on our DB (corrected count 2026-06-21 — an earlier count was wrong, see below):

| | Inactive **returned by Meta** (real flag) | Inactive **truly absent** (we never saw it again) | Active |
|---|---|---|---|
| Asana | 179 | 8 | 20 |
| ClickUp | 144 | **0** | 222 |
| Monday.com | 144 | 26 | 38 |

So **~93% of our "paused" ads are Meta's own signal**; only **~7%** are genuine disappearances. "Commercial ads vanish when stopped" is therefore **wrong for our scraping method** — most stay visible, flagged inactive. *(Measurement pitfall: to compute this split, compare each ad's `last_seen_at` to the scrape's **start time**, NOT to a single `MAX()` instant — a scrape stamps each ad a second apart over ~100s, so a `MAX()` comparison makes all-but-one ad look "absent" and inverts the result.)*

Consequences for us (🟡):
- **"Paused" is overwhelmingly Meta's signal, so we trust `is_active` directly** and do not infer paused from absence (the snapshot model).
- **An ad not found in a later scrape is left as-is** (last-known status + dates frozen); the analysis layer treats **"live" as "present in the latest scrape"** and shows everything else as "last seen N ago". This is non-destructive and self-heals if the ad reappears.
- A shallow `--max-ads` scrape is harmless: it can't wrongly flip still-live ads to "paused", because we don't flip on absence at all.
- Longevity still comes from Meta's own `ad_delivery_start_time → stop_time/now` (§6), not scrape timing — which is why the run-length tiers read `days_active` directly.

🟡 **Status is also per-country (OUR INFERENCE).** A global / Advantage+ ad that isn't country-targeted can read absent/inactive in a single country's view while being active in the global `ALL` view. So we treat **`ALL` as the authoritative "is this live?" signal**. (From library country-filtering + our Monday.com observation; Meta doesn't document per-ad per-view status.)

---

## 6. Dates & run length

✅ **VERIFIED** (`ArchivedAd` node — https://developers.facebook.com/docs/graph-api/reference/archived-ad/):
- `ad_delivery_start_time`: "Date and time when an advertiser wants to **start** delivering an ad. Provided in UTC."
- `ad_delivery_stop_time`: "The time when an advertiser wants to stop delivery of their ad. **If this is blank, the ad will run until the advertiser stops it.**"

🟡 **OUR INFERENCE:** a blank/absent stop time = still-running ad; a populated stop time = the advertiser-set end of delivery. **"Total active time" is NOT a Meta field** — we derive it (`computeDaysActive`: live → start→now; paused → start→end). Meta documents the two timestamps; the run-length math is ours.

---

## 7. Advantage+ / Dynamic Creative (DCO) — why ad count ≠ activity

✅ **VERIFIED** that one ad can present as many machine-generated variations:
- "Advantage+ creative uses AI to **generate and enhance ad variations** across single image, video and carousel formats." — https://www.facebook.com/business/ads/meta-advantage-plus/creative
- Advantage+ standard enhancements "automatically transforms your images, text, and videos and shows **more personalized versions of your ads to each member of your audience**." — https://developers.facebook.com/blog/post/2023/04/14/advantage-plus-creative-standard-enhancement-API-launch/
- The node itself confirms one ad holds **multiple cards**: `ad_creative_bodies` = "a list of the text which displays in **each unique ad card** of the ad." — `ArchivedAd` node (§1).

🟡 **OUR INFERENCE** (Meta does not document this as an Ad-Library-counting caveat): campaign build style changes the library count for the *same* spend three ways —
1. **Dynamic Creative / DCO** → one library entry, internal variants (UI: "This ad has multiple versions"). We store `display_format='DCO'`, keep variant copy/creatives in `extra_texts` / `extra_image_urls` / `extra_video_urls`. *(The dedicated "About Dynamic Creative" Help page is JS-gated and couldn't be quoted; the multiple-cards behaviour is verified via `ad_creative_bodies` above.)*
2. **Advantage+ Creative** → one ad, machine-generated variations. Big spend, small footprint.
3. **Manual ad-set duplication** → many entries for the same creative (one creative across audiences = many `ad_archive_id`s, inflated collation).

**Net (🟡): ad count is confounded by architecture.** Identical budget → *low* count under DCO/Advantage+, *high* count under manual duplication. With no spend/impression field to normalize against, **you cannot infer spend, reach, or even relative activity from ad volume across competitors.** Within one competitor over time a rising count *may* hint at more testing — still build-style-dependent.

How we handle DCO in metrics: count it as **one** entry for volume/longevity; classify its **format by underlying media** (not auto-"carousel"); include its `extra_texts` in **copy mining**; surface **"% using Dynamic Creative"** as a *testing-sophistication* signal (within-competitor / labeled).

---

## 8. Other reliably-available creative metadata

✅ **VERIFIED returnable fields** (§1 node): creative (image/video), body / headline / link-description copy, CTA button **type** (use canonical English `cta_type` — `cta_text` is localized, don't use it), landing/display URL, placements (`publisher_platforms`), `languages`.

✅ **AI-media flag — VERIFIED.** Meta applies an **"AI info" label**, surfaced inside **"About this ad"**: "When an image or video is created or significantly edited with our generative AI creative features … a label will appear," and Meta will "begin automatically detecting ads created or edited using **third-party AI tools** through industry-standard signals … we'll apply an 'AI info' label." — https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/

🟡 **OUR INFERENCE / caveat:** coverage is partly self-disclosed + detection-based and the third-party auto-detection rollout has no stated completion date. Label it **"disclosed AI media"**; treat **absence as inconclusive**, not "no AI."

---

## 9. Access methods & limits

✅ **VERIFIED — Official Graph API (`/ads_archive`):**
- `ad_type` enum: `{ALL, EMPLOYMENT_ADS, FINANCIAL_PRODUCTS_AND_SERVICES_ADS, HOUSING_ADS, POLITICAL_AND_ISSUE_ADS}`.
- **The load-bearing rule:** "**Ads that did not reach any location in the EU will only return if they are about social issues, elections or politics.**" So **`ad_type=ALL` ≠ literally all ads** — a normal US-only SaaS ad is **not queryable via the official API**. EU-delivered commercial ads *do* return (DSA).
- `ad_reached_countries`: "Search ALL or by ISO country code to return ads that reached specific countries or locations."
- Auth: requires an `access_token`. Rate limiting surfaces as error code **613** ("Calls to this api have exceeded the rate limit").
- Source: https://developers.facebook.com/docs/graph-api/reference/ads_archive/

🟡 **NOT DOCUMENTED BY META:** specific numeric rate-limit thresholds and the full token-eligibility / identity-confirmation steps (referenced as required but not enumerated).

**Web UI scraping (what we do):** the only reliable path to **non-EU commercial ads at scale** — directly validated by the API rule above. Gotchas (see `docs/scraping.md`): hashed CSS (intercept GraphQL JSON, key on `ad_archive_id`), lazy-load on real wheel events, paginated batches arrive as `text/html`, **GB not UK**, local-only (no Playwright on Vercel).

---

## 10. Do / Don't for competitive analysis

**✅ DO (defensible):**
- Surface **creative content**: copy, headlines, CTAs, images/videos, landing/display URLs, placements, languages.
- Use **run-length as a longevity / "this is working" proxy** (derived from start→stop/now), clearly labeled a proxy.
- Track **creative-testing volume *within* a competitor over time** (trend), labeled creative-count, not spend.
- Use **collation & ad count as display-only, within-competitor** texture (undocumented — §4).
- Use the **`ALL` view as the live/paused signal** (our inference — §5); single-country status = market-presence only.
- Surface the **"disclosed AI media"** flag when present (absence ≠ "no AI").
- (Future) For **EU-delivered** ads, surface EU reach / demographic-reach / targeting — explicitly labeled "EU only (DSA)."

**❌ DON'T (over-claiming — unsupported by the data):**
- **Spend / budget** for commercial ads — null. Never estimate "$X/month" from ad count.
- **Impressions / reach / CTR / engagement** for non-EU commercial ads — null.
- **Market share** — no denominator exists (no spend, no reach); any "% of market" is fabricated.
- **Spend or reach by region** for commercial ads — only EU *reach* exists, EU-delivered only.
- **Audience demographics / targeting** for non-EU commercial ads — null.
- **"X spends more than Y because they have more ads"** — confounded by DCO/Advantage+ vs manual duplication.
- **Geographic footprint** — the only geo signal is which country library an ad appears in (thin, per-view confounded).
- **Don't infer "paused" from an ad's absence** — with `active_status=all`, Meta reports `is_active` directly (~93% of our paused ads); an ad simply missing from a later scrape is "last seen N ago", not a confirmed stop (§5).

---

## Sources (official Meta only)
- Ad Library tools / retention (active-only, political 7-yr, EU 1-yr): https://transparency.meta.com/researchtools/ad-library-tools
- Graph API `ads_archive` endpoint (ad_type, EU-only return rule, rate-limit code): https://developers.facebook.com/docs/graph-api/reference/ads_archive/
- Graph API `ArchivedAd` node (field availability, political/EU-only flags, date fields): https://developers.facebook.com/docs/graph-api/reference/archived-ad/
- DSA transparency announcement (EU: all ads, targeting params, 1-yr archive): https://about.fb.com/news/2023/08/new-features-and-additional-transparency-measures-as-the-digital-services-act-comes-into-effect/
- GenAI ad transparency — the "AI info" label: https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/
- Advantage+ creative (AI generates ad variations): https://www.facebook.com/business/ads/meta-advantage-plus/creative
- Advantage+ standard enhancements (per-audience personalized versions): https://developers.facebook.com/blog/post/2023/04/14/advantage-plus-creative-standard-enhancement-API-launch/

**Not documented anywhere on official Meta pages (so never asserted as fact above):** the viewability window for inactive *commercial non-EU* ads (§5), collation/grouping of ads sharing one creative (§4), numeric API rate-limit thresholds (§9), and the third-party-AI label rollout completion date (§8).
