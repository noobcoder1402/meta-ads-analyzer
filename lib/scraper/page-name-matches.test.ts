import { describe, it, expect } from "vitest";
import { pageNameMatches } from "./page-name-matches";

describe("pageNameMatches", () => {
  it("matches identical names regardless of case/punctuation", () => {
    expect(pageNameMatches("ClickUp", "ClickUp")).toBe(true);
    expect(pageNameMatches("ClickUp", "clickup")).toBe(true);
    expect(pageNameMatches("Notion", "Notion!")).toBe(true);
  });

  it("ignores corporate-suffix noise tokens", () => {
    expect(pageNameMatches("Monday", "Monday.com")).toBe(true);
    expect(pageNameMatches("Monday.com", "Monday")).toBe(true);
    expect(pageNameMatches("Asana", "Asana Inc")).toBe(true);
    expect(pageNameMatches("Figma", "Figma (Official)")).toBe(true);
  });

  it("rejects a different brand that merely contains the name as a substring", () => {
    // The bug this fix targets: substring-both-ways matched these.
    expect(pageNameMatches("Asana", "Asana Rebel")).toBe(false);
    expect(pageNameMatches("Meta", "Meta Quest")).toBe(false);
    expect(pageNameMatches("Monday", "Cyber Monday Deals Co")).toBe(false);
    expect(pageNameMatches("Notion", "Notion Labs")).toBe(false);
  });

  it("is order-independent across tokens", () => {
    expect(pageNameMatches("Red Bull", "Bull Red")).toBe(true);
  });

  it("returns false on empty input", () => {
    expect(pageNameMatches("", "Asana")).toBe(false);
    expect(pageNameMatches("Asana", "")).toBe(false);
  });

  it("falls back to exact equality when a name is pure noise", () => {
    // "The Co" reduces to no significant tokens → require exact normalized match.
    expect(pageNameMatches("The Co", "The Co")).toBe(true);
    expect(pageNameMatches("The Co", "The Company")).toBe(false);
  });
});
