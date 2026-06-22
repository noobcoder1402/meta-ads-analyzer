import { describe, it, expect } from "vitest";
import { topPhrases } from "./phrases";

describe("topPhrases", () => {
  it("counts DOCUMENT frequency, not raw occurrences", () => {
    // "project management" appears 3x in ONE ad here, but in only 1 ad → count 1,
    // below the default minAds=2, so it should NOT surface.
    const res = topPhrases([
      "project management project management project management",
      "ship faster with great work",
    ]);
    expect(res.find((p) => p.phrase === "project management")).toBeUndefined();
  });

  it("surfaces a phrase repeated across multiple ads", () => {
    const res = topPhrases([
      "work management for teams",
      "work management for everyone",
    ]);
    const phrase = res.find((p) => p.phrase === "work management");
    expect(phrase?.count).toBe(2);
  });

  it("excludes single words — only 2–4 word phrases surface", () => {
    const res = topPhrases([
      "work management for teams",
      "work management for everyone",
    ]);
    // "work" / "management" alone are too generic; only the multi-word phrase surfaces
    expect(res.find((p) => p.phrase === "work")).toBeUndefined();
    expect(res.find((p) => p.phrase === "management")).toBeUndefined();
  });

  it("drops phrases that start or end on a stopword", () => {
    const res = topPhrases([
      "the best way to manage work",
      "the best teams manage work",
    ]);
    // "the best" starts on stopword "the" → dropped; "manage work" survives in both
    expect(res.find((p) => p.phrase === "the best")).toBeUndefined();
    expect(res.find((p) => p.phrase === "manage work")).toBeDefined();
  });

  it("ignores bare numbers and one-char tokens", () => {
    const res = topPhrases(["save big 2 days", "save big 4 days"], { minAds: 2 });
    expect(res.find((p) => p.phrase === "2")).toBeUndefined();
    expect(res.find((p) => p.phrase === "save big")).toBeDefined();
  });

  it("respects the top cap and minAds floor", () => {
    const texts = Array.from({ length: 5 }, () => "automation workflow automation workflow");
    const res = topPhrases(texts, { top: 1, minAds: 2 });
    expect(res.length).toBe(1);
  });

  it("returns nothing for empty / null input", () => {
    expect(topPhrases([null, undefined, "", "  "])).toEqual([]);
  });
});
