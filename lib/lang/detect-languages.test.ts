import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  aggregateLanguages,
  MIN_CHARS,
} from "./detect-languages";

// Realistic ad-caption-length samples.
const EN = "Manage all your team's projects in one place and ship work faster.";
const ES = "Gestiona todos los proyectos de tu equipo en un solo lugar y trabaja mejor.";
const DE = "Verwalte alle Projekte deines Teams an einem Ort und arbeite schneller zusammen.";

describe("detectLanguage", () => {
  it("detects common languages from caption-length text", () => {
    expect(detectLanguage(EN)).toBe("eng");
    expect(detectLanguage(ES)).toBe("spa");
    expect(detectLanguage(DE)).toBe("deu");
  });

  it("separates SHORT Spanish from Portuguese — the sister-language failure case", () => {
    // REGRESSION (2026-06-03): these real Monday.com captions all went to "undetected"
    // under franc-min (Spanish/Portuguese scored within its margin gate), erasing the
    // entire LATAM expansion. eld (like tinyld before it) must call each correctly —
    // verified on the 781-caption bake-off: eld did NOT regress on this pair.
    expect(detectLanguage("Todo tu trabajo en un solo lugar")).toBe("spa");
    expect(detectLanguage("Empieza tu prueba gratis hoy")).toBe("spa"); // franc said Bosnian
    expect(detectLanguage("Crie processos para o seu trabalho fluir com eficiência:")).toBe("por");
    expect(detectLanguage("Chega de ter medo de IA. O monday sidekick torna o trabalho simples.")).toBe("por");
  });

  it("survives lookalike Unicode glyphs via NFKC normalization", () => {
    // REGRESSION (2026-06-03): Monday writes "monday․com" with U+2024 ONE DOT LEADER,
    // which made the detector return Armenian at 100% for 55 plainly-English ads. NFKC
    // folds the glyph to "." (and 𝗯𝗼𝗹𝗱 math letters to ASCII) so real words are detected.
    expect(detectLanguage("There's a reason why 180K+ customers use monday․com to manage their teams")).toBe("eng");
    expect(detectLanguage("𝗘𝗻𝘁𝗿𝗼𝗱𝘂𝗰𝗶𝗻𝗴 ClickUp AI Notetaker for all your meetings")).toBe("eng");
  });

  it("calls terse, brand/list-heavy English copy English (no prior hack needed)", () => {
    // tinyld used to mis-rank these as ro/et with English a hair behind, needing a
    // margin-based "English prior" workaround. eld gets them right natively.
    expect(detectLanguage("No matter what kind of work you do, Asana helps you manage it.")).toBe("eng");
    expect(detectLanguage("Tasks, docs, whiteboards, screen recording, comms all in one place.")).toBe("eng");
    expect(detectLanguage("ClickUp Brain makes image generation 10x faster")).toBe("eng");
  });

  it("does not misread English business copy as Italian (the eld swap, 2026-06-20)", () => {
    // REGRESSION: tinyld returned it:0.96 with HIGH confidence on this real Monday
    // caption (reused across ~18 ad entries), inflating Monday's "Italian" footprint
    // from a true ~3 to 23. The margin-based English-prior could not catch a confident
    // error. eld calls it English.
    expect(
      detectLanguage(
        "monday.com's work management platform gives managers full visibility into where their team's time and effort goes.",
      ),
    ).toBe("eng");
  });

  it("does not over-correct genuine French to English (the prior-hack's own bug)", () => {
    // REGRESSION: tinyld's English-prior wrongly forced these real Asana French ads to
    // English (false negatives). eld keeps them French — fixing the opposite-direction
    // error the workaround introduced.
    expect(
      detectLanguage("Automatisez vos workflows, identifiez les obstacles et gardez le cap sur vos objectifs avec Asana."),
    ).toBe("fra");
    expect(detectLanguage("Repartez du bon pied. Gagnez en efficacité en 2026 avec Asana.")).toBe("fra");
  });

  it("returns null for Dynamic-Creative template placeholders (never guesses)", () => {
    expect(detectLanguage("{{product.brand}}")).toBeNull();
    // a placeholder that strips down to too-little real text also fails closed
    expect(detectLanguage("{{product.name}} — {{cta}}")).toBeNull();
  });

  it("returns null for text under the length floor", () => {
    expect(detectLanguage("Try now")).toBeNull();
    expect(detectLanguage("a".repeat(MIN_CHARS - 1))).toBeNull();
  });

  it("returns null for empty / missing input", () => {
    expect(detectLanguage(null)).toBeNull();
    expect(detectLanguage(undefined)).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });
});

describe("aggregateLanguages", () => {
  it("counts languages and reports the undetected bucket", () => {
    const result = aggregateLanguages([EN, EN, ES, "{{x}}", "short"]);
    expect(result.detectedFrom).toBe(3); // 2 EN + 1 ES
    expect(result.undetected).toBe(2); // placeholder + too-short
    expect(result.languageCount).toBe(2);
    // most-used first
    expect(result.languages[0].code).toBe("eng");
    expect(result.languages[0].count).toBe(2);
  });

  it("flags a single-ad language as minor, keeps a well-represented one major", () => {
    // 10 English + 1 Spanish → Spanish is incidental (count < 2)
    const texts = [...Array(10).fill(EN), ES];
    const result = aggregateLanguages(texts);
    const en = result.languages.find((l) => l.code === "eng")!;
    const es = result.languages.find((l) => l.code === "spa")!;
    expect(en.minor).toBe(false);
    expect(es.minor).toBe(true); // only 1 ad
  });

  it("keeps a language with >=2 ads and >=5% share as major", () => {
    // 10 English + 2 German → German is 2/12 = 16.7% → major
    const texts = [...Array(10).fill(EN), DE, DE];
    const result = aggregateLanguages(texts);
    const de = result.languages.find((l) => l.code === "deu")!;
    expect(de.count).toBe(2);
    expect(de.minor).toBe(false);
  });

  it("attaches a human label + flag, falling back gracefully", () => {
    const result = aggregateLanguages([EN]);
    expect(result.languages[0].label).toBe("English");
    expect(result.languages[0].flag).toBeTruthy();
  });

  it("handles an all-undetected set without dividing by zero", () => {
    const result = aggregateLanguages(["{{x}}", "short", null]);
    expect(result.detectedFrom).toBe(0);
    expect(result.undetected).toBe(3);
    expect(result.languageCount).toBe(0);
    expect(result.languages).toEqual([]);
  });
});
