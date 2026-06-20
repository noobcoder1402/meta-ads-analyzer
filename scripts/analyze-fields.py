"""
Pure-Python, deterministic field analysis of all scraped ads.
ZERO AI calls, zero cost — just counting and math over the SQLite tables.

Outputs a human-readable report to stdout and writes it to
data/field-analysis.md.

Run:  python3 scripts/analyze-fields.py
"""
import sqlite3, json, os, statistics
from collections import Counter

DB = os.path.join(os.path.dirname(__file__), "..", "data", "app.db")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "field-analysis.md")

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

lines = []
def w(s=""):
    print(s)
    lines.append(s)

# ---------- helpers ----------
def parse_list(val):
    if not val:
        return []
    try:
        v = json.loads(val)
        return v if isinstance(v, list) else [v]
    except Exception:
        return [val]

def pct(n, total):
    return f"{(100*n/total):.1f}%" if total else "0.0%"

def cat_table(rows, key, title, blank_label="(blank)"):
    """Count distribution of a categorical column, overall + per competitor."""
    w(f"\n### {title}")
    overall = Counter()
    by_comp = {}
    for r in rows:
        v = r[key]
        v = v.strip() if isinstance(v, str) else v
        if v is None or v == "":
            v = blank_label
        overall[v] += 1
        by_comp.setdefault(r["comp"], Counter())[v] += 1
    total = sum(overall.values())
    # header
    comps = sorted(by_comp.keys())
    w(f"\n| Value | Total | % | " + " | ".join(comps) + " |")
    w("|---|---|---|" + "|".join(["---"] * len(comps)) + "|")
    for val, n in overall.most_common():
        cells = [str(by_comp[c].get(val, 0)) for c in comps]
        w(f"| {val} | {n} | {pct(n,total)} | " + " | ".join(cells) + " |")
    w(f"| **TOTAL** | **{total}** | 100% | " + " | ".join(str(sum(by_comp[c].values())) for c in comps) + " |")

def list_freq(rows, key, title, top=15):
    """Frequency of items inside a JSON-array column (one ad can contribute many)."""
    w(f"\n### {title} (top {top})")
    overall = Counter()
    n_with = 0
    for r in rows:
        items = [str(x).strip().lower() for x in parse_list(r[key]) if str(x).strip()]
        if items:
            n_with += 1
        overall.update(items)
    w(f"\n_{n_with} ads contributed; {len(overall)} distinct values._\n")
    w("| Rank | Value | Count | % of contributing ads |")
    w("|---|---|---|---|")
    for i, (val, n) in enumerate(overall.most_common(top), 1):
        w(f"| {i} | {val} | {n} | {pct(n, n_with)} |")

def num_stats(rows, key, title, buckets):
    w(f"\n### {title}")
    vals = [r[key] for r in rows if r[key] is not None]
    nulls = sum(1 for r in rows if r[key] is None)
    if not vals:
        w("\n_No values._")
        return
    w(f"\n- count (non-null): **{len(vals)}**  |  null/blank: **{nulls}**")
    w(f"- min **{min(vals)}**  |  median **{statistics.median(vals):.0f}**  |  "
      f"mean **{statistics.mean(vals):.1f}**  |  max **{max(vals)}**")
    w("\n| Bucket | Count | % |")
    w("|---|---|---|")
    for label, lo, hi in buckets:
        n = sum(1 for v in vals if lo <= v <= hi)
        w(f"| {label} | {n} | {pct(n, len(vals))} |")

# ---------- pull data ----------
# Only competitors that actually have ads.
ad_rows = con.execute("""
    SELECT a.*, c.name AS comp,
           an.angle, an.angle_secondary, an.emotional_tone, an.brand_voice,
           an.text_density, an.primary_conversion_goal, an.themes,
           an.pain_points, an.benefits, an.target_persona,
           an.analysis_failed_at, an.id AS analysis_id
    FROM ads a
    JOIN competitors c ON c.id = a.competitor_id
    LEFT JOIN ad_analyses an ON an.ad_id = a.id
""").fetchall()

w("# Field Analysis — Meta Ads (deterministic, no AI)")
w(f"\n**{len(ad_rows)} ads** across "
  f"{len(set(r['comp'] for r in ad_rows))} competitors with data.\n")

# Per-competitor ad counts
w("## 1. Coverage")
comp_counts = Counter(r["comp"] for r in ad_rows)
w("\n| Competitor | Ads |")
w("|---|---|")
for comp, n in comp_counts.most_common():
    w(f"| {comp} | {n} |")

# Analysis coverage (analyzed = has analysis row with no failure)
w("\n### AI-analysis coverage")
analyzed = sum(1 for r in ad_rows if r["analysis_id"] and not r["analysis_failed_at"])
failed = sum(1 for r in ad_rows if r["analysis_failed_at"])
none = sum(1 for r in ad_rows if not r["analysis_id"])
w(f"\n- analyzed OK: **{analyzed}** ({pct(analyzed,len(ad_rows))})")
w(f"- analysis failed (stub row): **{failed}**")
w(f"- never analyzed: **{none}**")

# ---------- RAW META FIELDS ----------
w("\n## 2. Raw Meta fields")
# is_active -> Live/Paused
for r in ad_rows:
    pass
# build a derived status column on the fly via a wrapper
class Row:
    def __init__(self, r): self.r = r
    def __getitem__(self, k):
        if k == "status":
            return "Live" if self.r["is_active"] else "Paused"
        if k == "ai_media":
            return "AI media" if self.r["contains_ai_media"] else "No AI media"
        if k == "has_caption":
            return "has caption" if (self.r["caption"] or "").strip() else "no caption"
        if k == "has_title":
            return "has title" if (self.r["title"] or "").strip() else "no title"
        if k == "has_landing":
            return "has landing URL" if (self.r["landing_url"] or "").strip() else "no landing URL"
        return self.r[k]
wrapped = [Row(r) for r in ad_rows]

cat_table(wrapped, "status", "2.1 Live vs Paused")
cat_table(wrapped, "media_type", "2.2 Media type")
cat_table(wrapped, "display_format", "2.3 Display format (ad structure)")
cat_table(wrapped, "cta_label", "2.4 CTA button label")
cat_table(wrapped, "ai_media", "2.5 Contains AI-generated media (Meta flag)")
cat_table(wrapped, "has_caption", "2.6 Caption present")
cat_table(wrapped, "has_title", "2.7 Title present")
cat_table(wrapped, "has_landing", "2.8 Landing URL present")

list_freq(ad_rows, "placements", "2.9 Placements", top=10)
list_freq(ad_rows, "countries", "2.10 Countries recorded", top=20)

num_stats(ad_rows, "days_active", "2.11 Days active (run length)",
          buckets=[("0–7 days", 0, 7), ("8–30 days", 8, 30),
                   ("31–90 days", 31, 90), ("91–180 days", 91, 180),
                   ("181–365 days", 181, 365), ("365+ days", 366, 10**9)])
num_stats(ad_rows, "collation_count", "2.12 Collation count (creative reuse)",
          buckets=[("1 (none)", 1, 1), ("2–5", 2, 5), ("6–10", 6, 10),
                   ("11–25", 11, 25), ("26+", 26, 10**9)])

# ---------- AI ANALYSIS FIELDS (categorical, codified) ----------
analyzed_rows = [r for r in ad_rows if r["analysis_id"] and not r["analysis_failed_at"]]
w(f"\n## 3. AI-analysis fields (categorical) — over {len(analyzed_rows)} analyzed ads")
cat_table(analyzed_rows, "angle", "3.1 Primary angle")
cat_table(analyzed_rows, "angle_secondary", "3.2 Secondary angle")
cat_table(analyzed_rows, "emotional_tone", "3.3 Emotional tone")
cat_table(analyzed_rows, "brand_voice", "3.4 Brand voice")
cat_table(analyzed_rows, "text_density", "3.5 Text density")
cat_table(analyzed_rows, "primary_conversion_goal", "3.6 Conversion goal (CTA-derived, internal)")

w("\n## 4. AI-analysis list fields (frequency)")
list_freq(analyzed_rows, "pain_points", "4.1 Pain points")
list_freq(analyzed_rows, "benefits", "4.2 Benefits")
list_freq(analyzed_rows, "themes", "4.3 Themes")

with open(OUT, "w") as f:
    f.write("\n".join(lines) + "\n")
w(f"\n\n---\nReport written to {OUT}")
con.close()
