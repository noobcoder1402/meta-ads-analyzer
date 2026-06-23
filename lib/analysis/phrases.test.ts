import { describe, it, expect } from "vitest";
import { topPhrases, countAdsMentioningAi } from "./phrases";

describe("topPhrases", () => {
  it("counts DOCUMENT frequency, not raw occurrences", () => {
    // "manage all your projects" appears 3x in ONE ad here, but in only 1 ad → count 1,
    // below the default minAds=2, so it should NOT surface.
    const res = topPhrases([
      "manage all your projects manage all your projects manage all your projects",
      "ship faster with great work",
    ]);
    expect(res.find((p) => p.phrase === "manage all your projects")).toBeUndefined();
  });

  it("surfaces a phrase repeated across multiple ads", () => {
    const res = topPhrases([
      "all your work in one place",
      "bring all your work in one place",
    ]);
    const phrase = res.find((p) => p.phrase === "work in one place");
    expect(phrase?.count).toBe(2);
  });

  it("excludes 1–2 word fragments — only 3–5 word phrases surface", () => {
    const res = topPhrases([
      "all your work in one place",
      "bring all your work in one place",
    ]);
    expect(res.find((p) => p.phrase === "place")).toBeUndefined(); // single word
    expect(res.find((p) => p.phrase === "one place")).toBeUndefined(); // two words
    expect(res.find((p) => p.phrase === "work in one place")).toBeDefined();
  });

  it("drops phrases that start or end on a stopword", () => {
    const res = topPhrases([
      "the best way to manage tasks",
      "the best way to manage work",
    ]);
    // "the best way" starts on stopword "the" → dropped; "best way to manage" survives
    expect(res.find((p) => p.phrase === "the best way")).toBeUndefined();
    expect(res.find((p) => p.phrase === "best way to manage")).toBeDefined();
  });

  it("ignores bare numbers and one-char tokens", () => {
    const res = topPhrases(
      ["get 2 free months of access", "claim 2 free months of access"],
      { minAds: 2 },
    );
    expect(res.some((p) => p.phrase.includes("2"))).toBe(false);
    expect(res.find((p) => p.phrase === "free months of access")).toBeDefined();
  });

  it("respects the top cap and minAds floor", () => {
    const texts = Array.from({ length: 5 }, () => "automate your workflow with ease");
    const res = topPhrases(texts, { top: 1, minAds: 2 });
    expect(res.length).toBe(1);
  });

  it("returns nothing for empty / null input", () => {
    expect(topPhrases([null, undefined, "", "  "])).toEqual([]);
  });
});

describe("countAdsMentioningAi", () => {
  it("counts ads that mention AI, once per ad", () => {
    const n = countAdsMentioningAi([
      "Build faster with AI today",
      "Our AI agent does the work",
      "no mention here",
    ]);
    expect(n).toBe(2);
  });

  it("matches A.I. and the spelled-out phrase", () => {
    expect(countAdsMentioningAi(["Powered by A.I.", "uses artificial intelligence"])).toBe(2);
  });

  it("counts an ad once even when AI appears many times", () => {
    expect(countAdsMentioningAi(["AI AI AI, all artificial intelligence"])).toBe(1);
  });

  it("does not fire inside unrelated words", () => {
    expect(countAdsMentioningAi(["send me an email", "visit Thailand", "that's fair"])).toBe(0);
  });

  it("ignores null / empty input", () => {
    expect(countAdsMentioningAi([null, undefined, "", "   "])).toBe(0);
  });
});
