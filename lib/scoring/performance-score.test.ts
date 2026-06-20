import { describe, it, expect } from "vitest";
import {
  longevityPoints,
  placementPoints,
  recencyPoints,
  performanceScore,
  type ScorableAd,
} from "./performance-score";

describe("longevityPoints", () => {
  it("is 0 for unknown / zero / negative ages", () => {
    expect(longevityPoints(0)).toBe(0);
    expect(longevityPoints(-5)).toBe(0);
    expect(longevityPoints(1)).toBe(0); // below the curve's x-intercept → clamped
  });

  // Anchored on docs/scoring.md reference points (rounded). The 30- and 90-day
  // points are the bucket-defining anchors and must stay tight.
  it("hits the calibrated reference points", () => {
    expect(Math.round(longevityPoints(7))).toBe(12);
    expect(Math.round(longevityPoints(14))).toBe(24);
    expect(Math.round(longevityPoints(30))).toBe(36);
    expect(Math.round(longevityPoints(90))).toBe(54);
  });

  it("caps at 60 for very long-running ads", () => {
    expect(longevityPoints(180)).toBe(60);
    expect(longevityPoints(2000)).toBe(60);
  });

  it("is monotonically increasing", () => {
    expect(longevityPoints(60)).toBeGreaterThan(longevityPoints(30));
    expect(longevityPoints(90)).toBeGreaterThan(longevityPoints(60));
  });
});

describe("placementPoints", () => {
  it("awards 5 per placement, capped at 20 (4 placements)", () => {
    expect(placementPoints([])).toBe(0);
    expect(placementPoints(["Feed"])).toBe(5);
    expect(placementPoints(["Feed", "Reels", "Stories"])).toBe(15);
    expect(placementPoints(["Feed", "Reels", "Stories", "Marketplace"])).toBe(20);
    expect(
      placementPoints(["Feed", "Reels", "Stories", "Marketplace", "Search"])
    ).toBe(20);
  });
});

describe("recencyPoints", () => {
  it("gives full points to currently-active ads", () => {
    expect(recencyPoints(true, 0)).toBe(20);
    expect(recencyPoints(true, 999)).toBe(20);
  });

  it("gives partial points to recently-paused ads", () => {
    expect(recencyPoints(false, 0)).toBe(10);
    expect(recencyPoints(false, 29)).toBe(10);
  });

  it("gives no points to long-paused ads", () => {
    expect(recencyPoints(false, 30)).toBe(0);
    expect(recencyPoints(false, 200)).toBe(0);
  });
});

describe("performanceScore", () => {
  const base: ScorableAd = {
    daysActive: 0,
    placements: [],
    isActive: false,
    lastSeenAt: new Date().toISOString(),
  };

  it("a 90-day active ad on 2 placements is a winner (score >= 70)", () => {
    const result = performanceScore({
      ...base,
      daysActive: 90,
      isActive: true,
      placements: ["Feed", "Reels"],
    });
    // longevity 54 + placement 10 + recency 20 = 84
    expect(result.score).toBe(84);
    expect(result.longevityPts).toBe(54);
    expect(result.placementPts).toBe(10);
    expect(result.recencyPts).toBe(20);
  });

  it("score equals the sum of the three signal points", () => {
    const result = performanceScore({
      ...base,
      daysActive: 45,
      placements: ["Feed", "Reels", "Stories"],
      isActive: true,
    });
    const sum =
      result.longevityPts + result.placementPts + result.recencyPts;
    expect(result.score).toBe(sum);
    expect(result.signals).toHaveLength(3);
  });

  it("caps at 100 for a long-running, broadly-placed, active ad", () => {
    const result = performanceScore({
      ...base,
      daysActive: 200,
      placements: ["Feed", "Reels", "Stories", "Marketplace"],
      isActive: true,
    });
    expect(result.score).toBe(100);
  });

  it("a brand-new abandoned ad scores near zero", () => {
    const result = performanceScore({
      ...base,
      daysActive: 0,
      isActive: false,
      lastSeenAt: "2020-01-01 00:00:00",
    });
    expect(result.score).toBe(0);
  });
});
