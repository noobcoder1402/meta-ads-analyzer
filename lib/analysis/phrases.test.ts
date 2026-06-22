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
      "All your work in one place",
      "Bring all your work together",
      "work management for teams",
    ]);
    const work = res.find((p) => p.phrase === "work");
    expect(work?.count).toBe(3);
  });

  it("drops phrases that start or end on a stopword", () => {
    const res = topPhrases([
      "the best way to manage work",
      "the best teams manage work",
    ]);
    // "the best" ends fine but starts on stopword "the" → dropped; "best" survives
    expect(res.find((p) => p.phrase === "the best")).toBeUndefined();
    expect(res.find((p) => p.phrase === "best")).toBeDefined();
  });

  it("ignores bare numbers and one-char tokens", () => {
    const res = topPhrases(["save 2 hours a day", "save 2 hours every day"], { minAds: 2 });
    expect(res.find((p) => p.phrase === "2")).toBeUndefined();
    expect(res.find((p) => p.phrase === "save")).toBeDefined();
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
