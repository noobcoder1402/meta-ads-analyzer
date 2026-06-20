import { describe, it, expect } from "vitest";
import { ctaToConversionGoal } from "./cta-to-goal";

describe("ctaToConversionGoal", () => {
  it("maps the CTAs present in the dataset", () => {
    expect(ctaToConversionGoal("Sign Up")).toBe("free-trial");
    expect(ctaToConversionGoal("Learn More")).toBe("awareness");
    expect(ctaToConversionGoal("View Instagram Profile")).toBe("awareness");
    expect(ctaToConversionGoal("Get Offer View")).toBe("direct-purchase");
    expect(ctaToConversionGoal("Book Travel")).toBe("other");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(ctaToConversionGoal("learn more")).toBe("awareness");
    expect(ctaToConversionGoal("  SIGN UP  ")).toBe("free-trial");
  });

  it("falls back to 'other' for unknown or missing CTAs", () => {
    expect(ctaToConversionGoal(null)).toBe("other");
    expect(ctaToConversionGoal(undefined)).toBe("other");
    expect(ctaToConversionGoal("")).toBe("other");
    expect(ctaToConversionGoal("Some Brand New CTA")).toBe("other");
  });

  it("never silently treats an unknown CTA as awareness", () => {
    // Regression guard: 'awareness' must come ONLY from an explicit mapping,
    // never as the default — otherwise unmapped CTAs would inflate awareness.
    expect(ctaToConversionGoal("Mystery Button")).not.toBe("awareness");
  });
});
