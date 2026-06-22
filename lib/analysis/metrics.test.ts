import { describe, it, expect } from "vitest";
import type { AnalysisAd } from "./types";
import {
  ctaMix,
  distinctCreatives,
  domainOf,
  inSegment,
  isLive,
  landingPages,
  longevityBreakdown,
  medianDaysActive,
  structureLabel,
} from "./metrics";

const SCRAPE_AT = "2026-06-21 10:00:00";

function ad(over: Partial<AnalysisAd> = {}): AnalysisAd {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    libraryId: over.libraryId ?? over.id ?? Math.random().toString(36).slice(2),
    caption: null,
    title: null,
    linkDescription: null,
    extraTexts: null,
    ctaLabel: null,
    landingUrl: null,
    displayLink: null,
    mediaType: null,
    displayFormat: null,
    isActive: true,
    daysActive: 10,
    placements: null,
    collationCount: null,
    collationId: null,
    pageLikeCount: null,
    pageCategories: null,
    startDate: null,
    lastSeenAt: SCRAPE_AT, // seen in the latest scrape by default
    ...over,
  };
}

describe("isLive — snapshot model", () => {
  it("is live only if active AND seen in the latest scrape", () => {
    expect(isLive(ad({ isActive: true, lastSeenAt: SCRAPE_AT }), SCRAPE_AT)).toBe(true);
    expect(isLive(ad({ isActive: false, lastSeenAt: SCRAPE_AT }), SCRAPE_AT)).toBe(false);
    // active flag but NOT in the latest scrape (a stale ghost) → not live
    expect(isLive(ad({ isActive: true, lastSeenAt: "2026-06-03 09:00:00" }), SCRAPE_AT)).toBe(false);
  });

  it("falls back to Meta's flag when there's no scrape time", () => {
    expect(isLive(ad({ isActive: true }), null)).toBe(true);
    expect(isLive(ad({ isActive: false }), null)).toBe(false);
  });
});

describe("longevityBreakdown — LIVE ads only", () => {
  it("excludes paused ads even if they ran a long time", () => {
    const ads = [
      ad({ isActive: true, daysActive: 200 }), // hall of fame
      ad({ isActive: true, daysActive: 95 }), // proven
      ad({ isActive: false, daysActive: 365 }), // long but PAUSED → excluded
      ad({ isActive: true, daysActive: 5 }), // testing
    ];
    const { tiers, liveCount } = longevityBreakdown(ads, SCRAPE_AT);
    expect(liveCount).toBe(3);
    expect(tiers.find((t) => t.key === "hallOfFame")?.count).toBe(1);
    expect(tiers.find((t) => t.key === "proven")?.count).toBe(1);
    expect(tiers.find((t) => t.key === "testing")?.count).toBe(1);
    expect(tiers.find((t) => t.key === "established")?.count).toBe(0);
  });

  it("uses [min, max) boundaries (30 is Established, not Testing)", () => {
    const { tiers } = longevityBreakdown([ad({ daysActive: 30 })], SCRAPE_AT);
    expect(tiers.find((t) => t.key === "established")?.count).toBe(1);
    expect(tiers.find((t) => t.key === "testing")?.count).toBe(0);
  });
});

describe("medianDaysActive — all ads, live + paused", () => {
  it("returns the middle value for odd counts", () => {
    const ads = [ad({ daysActive: 10 }), ad({ daysActive: 200 }), ad({ daysActive: 40 })];
    expect(medianDaysActive(ads)).toBe(40);
  });

  it("averages the two middle values for even counts (rounded)", () => {
    const ads = [ad({ daysActive: 10 }), ad({ daysActive: 30 }), ad({ daysActive: 50 }), ad({ daysActive: 90 })];
    expect(medianDaysActive(ads)).toBe(40); // (30 + 50) / 2
  });

  it("counts paused ads too (not skewed like a mean by one long ad)", () => {
    const ads = [
      ad({ isActive: true, daysActive: 20 }),
      ad({ isActive: false, daysActive: 25 }),
      ad({ isActive: true, daysActive: 365 }),
    ];
    expect(medianDaysActive(ads)).toBe(25);
  });

  it("returns null for an empty set", () => {
    expect(medianDaysActive([])).toBe(null);
  });
});

describe("distinctCreatives — de-confounding ad count", () => {
  it("collapses entries sharing a Meta collation_id to one creative", () => {
    const ads = [
      ad({ libraryId: "1", collationId: "g1" }),
      ad({ libraryId: "2", collationId: "g1" }), // same creative, duplicated
      ad({ libraryId: "3", collationId: "g1" }),
      ad({ libraryId: "4", collationId: "g2" }),
    ];
    expect(ads.length).toBe(4);
    expect(distinctCreatives(ads)).toBe(2); // g1 + g2
  });

  it("does NOT guess: uncollated entries each count as distinct, even with identical copy", () => {
    // Meta didn't group these, so we don't either — no content-similarity inference.
    const same = "Manage all your team's projects in one shared workspace";
    const ads = [
      ad({ libraryId: "1", collationId: null, caption: same }),
      ad({ libraryId: "2", collationId: null, caption: same }),
    ];
    expect(distinctCreatives(ads)).toBe(2);
  });

  it("counts a mix of collated + uncollated correctly", () => {
    const ads = [
      ad({ libraryId: "1", collationId: "g1" }),
      ad({ libraryId: "2", collationId: "g1" }), // → 1
      ad({ libraryId: "3", collationId: null }), // → 1
      ad({ libraryId: "4", collationId: null }), // → 1
    ];
    expect(distinctCreatives(ads)).toBe(3);
  });
});

describe("inSegment — all / active / inactive", () => {
  it("routes ads by live status", () => {
    const live = ad({ isActive: true, daysActive: 120 });
    const paused = ad({ isActive: false, daysActive: 5 });

    // all → everything
    expect(inSegment(live, SCRAPE_AT, "all")).toBe(true);
    expect(inSegment(paused, SCRAPE_AT, "all")).toBe(true);

    // active → only live ads
    expect(inSegment(live, SCRAPE_AT, "active")).toBe(true);
    expect(inSegment(paused, SCRAPE_AT, "active")).toBe(false);

    // inactive → only not-live ads (the complement of active)
    expect(inSegment(paused, SCRAPE_AT, "inactive")).toBe(true);
    expect(inSegment(live, SCRAPE_AT, "inactive")).toBe(false);
  });

  it("active + inactive partition all ads (no overlap, no gap)", () => {
    const ads = [
      ad({ isActive: true, daysActive: 120 }),
      ad({ isActive: true, daysActive: 5 }),
      ad({ isActive: false, daysActive: 200 }),
      ad({ isActive: false, daysActive: 5 }),
    ];
    const active = ads.filter((a) => inSegment(a, SCRAPE_AT, "active"));
    const inactive = ads.filter((a) => inSegment(a, SCRAPE_AT, "inactive"));
    expect(active.length + inactive.length).toBe(ads.length);
    expect(active.some((a) => inactive.includes(a))).toBe(false);
  });
});

describe("landingPages — host + path, by ad count", () => {
  it("keeps the path (the offer page), ranks by frequency, strips query/trailing slash", () => {
    const ads = [
      ad({ landingUrl: "https://clickup.com/lp/get-started?utm=x" }),
      ad({ landingUrl: "https://www.clickup.com/lp/get-started/" }),
      ad({ landingUrl: "https://clickup.com/lp/features/whiteboards" }),
      ad({ landingUrl: null }), // no path → excluded from denominator
    ];
    const pages = landingPages(ads);
    expect(pages[0]).toMatchObject({ label: "clickup.com/lp/get-started", count: 2 });
    // share is over the 3 ads that HAD a path, not all 4
    expect(pages[0].share).toBeCloseTo(2 / 3);
    expect(pages.find((p) => p.label === "clickup.com/lp/features/whiteboards")?.count).toBe(1);
  });
});

describe("ctaMix — raw Meta labels", () => {
  it("uses the exact label and counts a null CTA as 'No CTA'", () => {
    const res = ctaMix([
      ad({ ctaLabel: "Learn More" }),
      ad({ ctaLabel: "Learn More" }),
      ad({ ctaLabel: "Sign Up" }),
      ad({ ctaLabel: null }),
    ]);
    expect(res[0]).toMatchObject({ label: "Learn More", count: 2 });
    expect(res.find((t) => t.label === "No CTA")?.count).toBe(1);
  });
});

describe("structureLabel — DCO is not a carousel", () => {
  it("maps display_format, falling back to media kind on old null rows", () => {
    expect(structureLabel(ad({ displayFormat: "DCO", mediaType: "image" }))).toBe("Dynamic creative");
    expect(structureLabel(ad({ displayFormat: "CAROUSEL", mediaType: "video" }))).toBe("Carousel");
    expect(structureLabel(ad({ displayFormat: null, mediaType: "video" }))).toBe("Single video");
  });
});

describe("domainOf", () => {
  it("prefers display_link, else parses the landing URL host (www stripped)", () => {
    expect(domainOf(ad({ displayLink: "monday.com" }))).toBe("monday.com");
    expect(domainOf(ad({ landingUrl: "https://www.asana.com/product?x=1" }))).toBe("asana.com");
    expect(domainOf(ad({ landingUrl: "clickup.com/teams" }))).toBe("clickup.com");
    expect(domainOf(ad({}))).toBeNull();
  });
});
