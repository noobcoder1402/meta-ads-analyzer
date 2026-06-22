# Field Analysis — Meta Ads (deterministic, no AI)

> **⚠️ Historical snapshot (generated before the 2026-06-20 AI-layer removal).** The deterministic Meta-field tables below are still representative, but any **"AI-analysis coverage"**, **Brand voice**, and AI-derived sections describe data that no longer exists — the per-ad analyzer, its `ad_analyses` AI columns, brand voice, and angles were removed (see `changelog.md`). Treat this file as a one-time audit, not current state.

**781 ads** across 3 competitors with data.

## 1. Coverage

| Competitor | Ads |
|---|---|
| ClickUp | 366 |
| Monday.com | 208 |
| Asana | 207 |

### AI-analysis coverage

- analyzed OK: **618** (79.1%)
- analysis failed (stub row): **2**
- never analyzed: **161**

## 2. Raw Meta fields

### 2.1 Live vs Paused

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| Paused | 501 | 64.1% | 187 | 144 | 170 |
| Live | 280 | 35.9% | 20 | 222 | 38 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.2 Media type

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| image | 496 | 63.5% | 193 | 213 | 90 |
| video | 273 | 35.0% | 8 | 153 | 112 |
| carousel | 12 | 1.5% | 6 | 0 | 6 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.3 Display format (ad structure)

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| DCO | 393 | 50.3% | 189 | 35 | 169 |
| IMAGE | 185 | 23.7% | 4 | 179 | 2 |
| VIDEO | 179 | 22.9% | 8 | 152 | 19 |
| (blank) | 16 | 2.0% | 0 | 0 | 16 |
| CAROUSEL | 8 | 1.0% | 6 | 0 | 2 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.4 CTA button label

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| Learn More | 443 | 56.7% | 88 | 346 | 9 |
| Sign Up | 320 | 41.0% | 119 | 12 | 189 |
| View Instagram Profile | 10 | 1.3% | 0 | 0 | 10 |
| Book Travel | 7 | 0.9% | 0 | 7 | 0 |
| Get Offer View | 1 | 0.1% | 0 | 1 | 0 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.5 Contains AI-generated media (Meta flag)

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| No AI media | 781 | 100.0% | 207 | 366 | 208 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.6 Caption present

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| has caption | 781 | 100.0% | 207 | 366 | 208 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.7 Title present

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| no title | 503 | 64.4% | 189 | 119 | 195 |
| has title | 278 | 35.6% | 18 | 247 | 13 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.8 Landing URL present

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| has landing URL | 781 | 100.0% | 207 | 366 | 208 |
| **TOTAL** | **781** | 100% | 207 | 366 | 208 |

### 2.9 Placements (top 10)

_765 ads contributed; 5 distinct values._

| Rank | Value | Count | % of contributing ads |
|---|---|---|---|
| 1 | facebook | 755 | 98.7% |
| 2 | instagram | 746 | 97.5% |
| 3 | messenger | 645 | 84.3% |
| 4 | audience_network | 384 | 50.2% |
| 5 | threads | 372 | 48.6% |

### 2.10 Countries recorded (top 20)

_479 ads contributed; 10 distinct values._

| Rank | Value | Count | % of contributing ads |
|---|---|---|---|
| 1 | us | 132 | 27.6% |
| 2 | es | 108 | 22.5% |
| 3 | br | 106 | 22.1% |
| 4 | au | 95 | 19.8% |
| 5 | ca | 91 | 19.0% |
| 6 | gb | 83 | 17.3% |
| 7 | fr | 80 | 16.7% |
| 8 | de | 59 | 12.3% |
| 9 | it | 49 | 10.2% |
| 10 | in | 20 | 4.2% |

### 2.11 Days active (run length)

- count (non-null): **781**  |  null/blank: **0**
- min **1**  |  median **56**  |  mean **88.5**  |  max **786**

| Bucket | Count | % |
|---|---|---|
| 0–7 days | 47 | 6.0% |
| 8–30 days | 179 | 22.9% |
| 31–90 days | 223 | 28.6% |
| 91–180 days | 216 | 27.7% |
| 181–365 days | 114 | 14.6% |
| 365+ days | 2 | 0.3% |

### 2.12 Collation count (creative reuse)

- count (non-null): **713**  |  null/blank: **68**
- min **1**  |  median **5**  |  mean **8.8**  |  max **36**

| Bucket | Count | % |
|---|---|---|
| 1 (none) | 172 | 24.1% |
| 2–5 | 202 | 28.3% |
| 6–10 | 114 | 16.0% |
| 11–25 | 161 | 22.6% |
| 26+ | 64 | 9.0% |

## 3. AI-analysis fields (categorical) — over 618 analyzed ads

### 3.1 Primary angle

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| product-demo | 313 | 50.6% | 137 | 72 | 104 |
| problem-agitation | 74 | 12.0% | 8 | 54 | 12 |
| social-proof | 54 | 8.7% | 21 | 5 | 28 |
| comparison | 41 | 6.6% | 14 | 23 | 4 |
| curiosity-hook | 41 | 6.6% | 1 | 19 | 21 |
| authority | 28 | 4.5% | 20 | 8 | 0 |
| aspirational | 21 | 3.4% | 3 | 1 | 17 |
| ugc-style | 19 | 3.1% | 0 | 7 | 12 |
| before-after | 13 | 2.1% | 3 | 3 | 7 |
| offer-led | 12 | 1.9% | 0 | 11 | 1 |
| fomo-scarcity | 2 | 0.3% | 0 | 2 | 0 |
| **TOTAL** | **618** | 100% | 207 | 205 | 206 |

### 3.2 Secondary angle

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| (blank) | 399 | 64.6% | 167 | 80 | 152 |
| product-demo | 66 | 10.7% | 6 | 53 | 7 |
| problem-agitation | 57 | 9.2% | 17 | 24 | 16 |
| social-proof | 21 | 3.4% | 2 | 1 | 18 |
| comparison | 19 | 3.1% | 2 | 16 | 1 |
| aspirational | 12 | 1.9% | 2 | 4 | 6 |
| offer-led | 12 | 1.9% | 0 | 12 | 0 |
| ugc-style | 10 | 1.6% | 0 | 8 | 2 |
| authority | 9 | 1.5% | 9 | 0 | 0 |
| curiosity-hook | 6 | 1.0% | 0 | 3 | 3 |
| fomo-scarcity | 4 | 0.6% | 0 | 3 | 1 |
| before-after | 3 | 0.5% | 2 | 1 | 0 |
| **TOTAL** | **618** | 100% | 207 | 205 | 206 |

### 3.3 Emotional tone

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| confident-aspirational | 81 | 13.1% | 37 | 22 | 22 |
| frustrated-then-empowered | 44 | 7.1% | 7 | 34 | 3 |
| confident-capable | 32 | 5.2% | 27 | 1 | 4 |
| confident-empowering | 32 | 5.2% | 24 | 3 | 5 |
| confident-reassuring | 23 | 3.7% | 16 | 1 | 6 |
| confident-efficient | 21 | 3.4% | 9 | 3 | 9 |
| aspirational-confident | 17 | 2.8% | 7 | 1 | 9 |
| playful-confident | 16 | 2.6% | 0 | 3 | 13 |
| confident-organized | 15 | 2.4% | 9 | 0 | 6 |
| frustrated-then-relieved | 12 | 1.9% | 0 | 6 | 6 |
| intrigued-then-empowered | 11 | 1.8% | 1 | 9 | 1 |
| frustrated-then-liberated | 11 | 1.8% | 10 | 1 | 0 |
| confident-collaborative | 9 | 1.5% | 8 | 1 | 0 |
| frustrated-then-confident | 9 | 1.5% | 0 | 9 | 0 |
| relatable-then-empowered | 9 | 1.5% | 0 | 9 | 0 |
| skeptical-then-confident | 8 | 1.3% | 0 | 0 | 8 |
| frustrated-then-reassured | 6 | 1.0% | 0 | 6 | 0 |
| efficient-empowered | 6 | 1.0% | 2 | 3 | 1 |
| relieved-confident | 6 | 1.0% | 0 | 1 | 5 |
| calm-confident | 6 | 1.0% | 6 | 0 | 0 |
| confident-empowered | 6 | 1.0% | 4 | 0 | 2 |
| empowered-efficient | 5 | 0.8% | 4 | 1 | 0 |
| confident-authoritative | 5 | 0.8% | 2 | 3 | 0 |
| frustrated-then-hopeful | 5 | 0.8% | 0 | 2 | 3 |
| aspirational-warm | 5 | 0.8% | 0 | 0 | 5 |
| empowered-confident | 4 | 0.6% | 2 | 0 | 2 |
| confident-approachable | 4 | 0.6% | 0 | 0 | 4 |
| confident-assured | 4 | 0.6% | 0 | 2 | 2 |
| urgent-excited | 4 | 0.6% | 0 | 4 | 0 |
| efficient-confident | 4 | 0.6% | 1 | 1 | 2 |
| aspirational-playful | 4 | 0.6% | 0 | 0 | 4 |
| confident-delighted | 4 | 0.6% | 0 | 0 | 4 |
| playful-aspirational | 3 | 0.5% | 0 | 0 | 3 |
| playful-delighted | 3 | 0.5% | 0 | 0 | 3 |
| confident-enthusiastic | 3 | 0.5% | 0 | 0 | 3 |
| confident-enabling | 3 | 0.5% | 1 | 1 | 1 |
| chaos-to-clarity | 3 | 0.5% | 1 | 0 | 2 |
| confident-playful | 3 | 0.5% | 0 | 2 | 1 |
| aspirational-forward-looking | 3 | 0.5% | 3 | 0 | 0 |
| forward-looking-confident | 3 | 0.5% | 3 | 0 | 0 |
| relatable-then-relieved | 3 | 0.5% | 0 | 3 | 0 |
| impressed-then-empowered | 3 | 0.5% | 0 | 3 | 0 |
| surprised-intrigued | 3 | 0.5% | 0 | 3 | 0 |
| delighted-empowered | 3 | 0.5% | 0 | 3 | 0 |
| overwhelmed-then-relieved | 3 | 0.5% | 0 | 0 | 3 |
| reassuring-empowering | 3 | 0.5% | 0 | 0 | 3 |
| cautionary-then-empowered | 2 | 0.3% | 1 | 1 | 0 |
| relatable-aspirational | 2 | 0.3% | 0 | 0 | 2 |
| relatable-encouraging | 2 | 0.3% | 0 | 0 | 2 |
| confident-forward-looking | 2 | 0.3% | 0 | 0 | 2 |
| urgent-celebratory | 2 | 0.3% | 0 | 2 | 0 |
| enthusiastic-energetic | 2 | 0.3% | 0 | 0 | 2 |
| confident-professional | 2 | 0.3% | 0 | 0 | 2 |
| confident-clarity | 2 | 0.3% | 0 | 0 | 2 |
| confident-accomplished | 2 | 0.3% | 1 | 0 | 1 |
| aspirational-efficient | 2 | 0.3% | 1 | 0 | 1 |
| relieved-empowered | 2 | 0.3% | 0 | 1 | 1 |
| skeptical-then-reassured | 2 | 0.3% | 0 | 0 | 2 |
| focused-confident | 2 | 0.3% | 0 | 0 | 2 |
| confident-persuasive | 2 | 0.3% | 0 | 0 | 2 |
| confident-clear | 2 | 0.3% | 2 | 0 | 0 |
| celebratory-optimistic | 2 | 0.3% | 2 | 0 | 0 |
| confident-optimistic | 2 | 0.3% | 2 | 0 | 0 |
| persuasive-confident | 2 | 0.3% | 0 | 0 | 2 |
| overwhelmed-then-empowered | 2 | 0.3% | 0 | 2 | 0 |
| delighted-surprised | 2 | 0.3% | 0 | 2 | 0 |
| urgent-opportunistic | 2 | 0.3% | 0 | 2 | 0 |
| surprised-impressed | 2 | 0.3% | 0 | 2 | 0 |
| curious-then-confident | 2 | 0.3% | 0 | 0 | 2 |
| organized-confident | 2 | 0.3% | 0 | 0 | 2 |
| clear-empowered | 2 | 0.3% | 0 | 0 | 2 |
| aspirational-sophisticated | 2 | 0.3% | 0 | 2 | 0 |
| relatable-humorous-then-empowered | 2 | 0.3% | 0 | 2 | 0 |
| surprised-then-intrigued | 2 | 0.3% | 0 | 2 | 0 |
| enthusiastic-instructional | 2 | 0.3% | 0 | 2 | 0 |
| surprised-delighted | 2 | 0.3% | 0 | 2 | 0 |
| constrained-then-liberated | 1 | 0.2% | 1 | 0 | 0 |
| clever-then-confident | 1 | 0.2% | 1 | 0 | 0 |
| playful-anticipatory | 1 | 0.2% | 0 | 0 | 1 |
| positive-encouraging | 1 | 0.2% | 0 | 0 | 1 |
| playful-intrigued-urgent | 1 | 0.2% | 0 | 0 | 1 |
| empowering-confident | 1 | 0.2% | 0 | 0 | 1 |
| intrigued-amused | 1 | 0.2% | 0 | 0 | 1 |
| intrigued-then-validated | 1 | 0.2% | 0 | 0 | 1 |
| curious-engaged | 1 | 0.2% | 0 | 0 | 1 |
| intriguing-urgent | 1 | 0.2% | 0 | 0 | 1 |
| enthusiastic-aspirational | 1 | 0.2% | 0 | 0 | 1 |
| enthusiastic-encouraging | 1 | 0.2% | 0 | 0 | 1 |
| celebratory-energetic | 1 | 0.2% | 0 | 0 | 1 |
| playful-intrigued | 1 | 0.2% | 0 | 0 | 1 |
| urgent-concerned | 1 | 0.2% | 0 | 0 | 1 |
| efficient-empowering | 1 | 0.2% | 1 | 0 | 0 |
| confident-urgent | 1 | 0.2% | 1 | 0 | 0 |
| solution-focused, confident | 1 | 0.2% | 1 | 0 | 0 |
| empowering-optimistic | 1 | 0.2% | 1 | 0 | 0 |
| overwhelmed-then-confident | 1 | 0.2% | 0 | 1 | 0 |
| relief-then-empowered | 1 | 0.2% | 0 | 1 | 0 |
| amused-then-empowered | 1 | 0.2% | 0 | 1 | 0 |
| problem-focused-to-confident | 1 | 0.2% | 0 | 1 | 0 |
| surprised-hopeful | 1 | 0.2% | 0 | 1 | 0 |
| aspirational-excited | 1 | 0.2% | 0 | 1 | 0 |
| impressed-curious | 1 | 0.2% | 0 | 1 | 0 |
| playful-then-empowering | 1 | 0.2% | 0 | 1 | 0 |
| pragmatic-relieved | 1 | 0.2% | 0 | 1 | 0 |
| confident-modern | 1 | 0.2% | 0 | 1 | 0 |
| confident-explanatory | 1 | 0.2% | 0 | 1 | 0 |
| focused-then-empowered | 1 | 0.2% | 0 | 0 | 1 |
| engaged-curious | 1 | 0.2% | 0 | 0 | 1 |
| playful-relieved | 1 | 0.2% | 0 | 0 | 1 |
| playful-confident-satisfying | 1 | 0.2% | 0 | 0 | 1 |
| surprised-then-reassured | 1 | 0.2% | 0 | 0 | 1 |
| optimistic-empowered | 1 | 0.2% | 0 | 0 | 1 |
| playful-empowering | 1 | 0.2% | 0 | 0 | 1 |
| clear-confident | 1 | 0.2% | 1 | 0 | 0 |
| liberation-empowering | 1 | 0.2% | 1 | 0 | 0 |
| liberated-empowered | 1 | 0.2% | 1 | 0 | 0 |
| problem-aware-to-empowered | 1 | 0.2% | 1 | 0 | 0 |
| confident-compelling | 1 | 0.2% | 1 | 0 | 0 |
| urgent-then-empowered | 1 | 0.2% | 0 | 1 | 0 |
| curious-engaging | 1 | 0.2% | 0 | 1 | 0 |
| playful-confident-aspirational | 1 | 0.2% | 0 | 1 | 0 |
| urgent-relieved | 1 | 0.2% | 0 | 1 | 0 |
| excited-empowered | 1 | 0.2% | 0 | 1 | 0 |
| confident-helpful | 1 | 0.2% | 0 | 1 | 0 |
| helpful-efficient | 1 | 0.2% | 0 | 1 | 0 |
| enthusiastic-confident | 1 | 0.2% | 0 | 1 | 0 |
| urgent-promotional | 1 | 0.2% | 0 | 1 | 0 |
| empowered-ambitious | 1 | 0.2% | 0 | 1 | 0 |
| calm-focused | 1 | 0.2% | 0 | 1 | 0 |
| reflective-then-hopeful | 1 | 0.2% | 0 | 1 | 0 |
| surprised-then-relieved | 1 | 0.2% | 0 | 0 | 1 |
| enthusiastic-conversational | 1 | 0.2% | 0 | 0 | 1 |
| frustrated-then-enthusiastic | 1 | 0.2% | 0 | 0 | 1 |
| empowered-simplified | 1 | 0.2% | 0 | 0 | 1 |
| anxious-then-relieved | 1 | 0.2% | 0 | 0 | 1 |
| skeptical-then-empowered | 1 | 0.2% | 0 | 0 | 1 |
| confident-inviting | 1 | 0.2% | 0 | 0 | 1 |
| empowered-aspirational | 1 | 0.2% | 0 | 0 | 1 |
| excited-enthusiastic | 1 | 0.2% | 0 | 0 | 1 |
| aspirational-triumphant | 1 | 0.2% | 0 | 0 | 1 |
| confident-innovative | 1 | 0.2% | 0 | 0 | 1 |
| inviting-confident | 1 | 0.2% | 0 | 0 | 1 |
| overwhelmed-to-confident | 1 | 0.2% | 1 | 0 | 0 |
| confident-productive | 1 | 0.2% | 1 | 0 | 0 |
| confident-impressive | 1 | 0.2% | 1 | 0 | 0 |
| focused-then-relieved | 1 | 0.2% | 0 | 1 | 0 |
| aspirational-relieved | 1 | 0.2% | 0 | 1 | 0 |
| casual-impressed | 1 | 0.2% | 0 | 1 | 0 |
| confident-impressed | 1 | 0.2% | 0 | 1 | 0 |
| intrigued-forward-looking | 1 | 0.2% | 0 | 1 | 0 |
| casual-helpful | 1 | 0.2% | 0 | 1 | 0 |
| urgent-then-confident | 1 | 0.2% | 0 | 1 | 0 |
| intrigued-confident | 1 | 0.2% | 0 | 1 | 0 |
| confident-relieved | 1 | 0.2% | 0 | 1 | 0 |
| excited-energized | 1 | 0.2% | 0 | 1 | 0 |
| empowered-then-liberated | 1 | 0.2% | 0 | 1 | 0 |
| frustrated-then-delighted | 1 | 0.2% | 0 | 1 | 0 |
| instructional-confident | 1 | 0.2% | 0 | 1 | 0 |
| energetic-confident | 1 | 0.2% | 0 | 1 | 0 |
| chaotic-then-empowered | 1 | 0.2% | 0 | 1 | 0 |
| relatable-frustrated-then-hopeful | 1 | 0.2% | 0 | 1 | 0 |
| empowered-futuristic | 1 | 0.2% | 0 | 1 | 0 |
| helpful-confident | 1 | 0.2% | 0 | 1 | 0 |
| enthusiastic-helpful | 1 | 0.2% | 0 | 1 | 0 |
| **TOTAL** | **618** | 100% | 207 | 205 | 206 |

### 3.4 Brand voice

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| professional | 369 | 59.7% | 190 | 78 | 101 |
| playful | 143 | 23.1% | 5 | 59 | 79 |
| bold | 80 | 12.9% | 11 | 62 | 7 |
| warm | 26 | 4.2% | 1 | 6 | 19 |
| **TOTAL** | **618** | 100% | 207 | 205 | 206 |

### 3.5 Text density

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| med | 354 | 57.3% | 145 | 100 | 109 |
| high | 215 | 34.8% | 54 | 86 | 75 |
| low | 49 | 7.9% | 8 | 19 | 22 |
| **TOTAL** | **618** | 100% | 207 | 205 | 206 |

### 3.6 Conversion goal (CTA-derived, internal)

| Value | Total | % | Asana | ClickUp | Monday.com |
|---|---|---|---|---|---|
| free-trial | 318 | 51.5% | 119 | 12 | 187 |
| awareness | 292 | 47.2% | 88 | 185 | 19 |
| other | 7 | 1.1% | 0 | 7 | 0 |
| direct-purchase | 1 | 0.2% | 0 | 1 | 0 |
| **TOTAL** | **618** | 100% | 207 | 205 | 206 |

## 4. AI-analysis list fields (frequency)

### 4.1 Pain points (top 15)

_579 ads contributed; 542 distinct values._

| Rank | Value | Count | % of contributing ads |
|---|---|---|---|
| 1 | context switching | 67 | 11.6% |
| 2 | lack of visibility | 38 | 6.6% |
| 3 | missed deadlines | 37 | 6.4% |
| 4 | tool fragmentation | 35 | 6.0% |
| 5 | scattered tools | 32 | 5.5% |
| 6 | scattered workflows | 30 | 5.2% |
| 7 | wasted time | 26 | 4.5% |
| 8 | tool sprawl | 25 | 4.3% |
| 9 | collaboration friction | 20 | 3.5% |
| 10 | team coordination | 18 | 3.1% |
| 11 | fragmented tools | 17 | 2.9% |
| 12 | spreadsheet constraints | 15 | 2.6% |
| 13 | workflow inefficiency | 15 | 2.6% |
| 14 | inefficiency | 15 | 2.6% |
| 15 | inefficient processes | 15 | 2.6% |

### 4.2 Benefits (top 15)

_618 ads contributed; 736 distinct values._

| Rank | Value | Count | % of contributing ads |
|---|---|---|---|
| 1 | unified workspace | 45 | 7.3% |
| 2 | unified platform | 40 | 6.5% |
| 3 | streamlined workflow | 39 | 6.3% |
| 4 | focus on priorities | 37 | 6.0% |
| 5 | team alignment | 34 | 5.5% |
| 6 | automation | 33 | 5.3% |
| 7 | single platform | 24 | 3.9% |
| 8 | team visibility | 23 | 3.7% |
| 9 | team adoption | 22 | 3.6% |
| 10 | centralized workspace | 22 | 3.6% |
| 11 | increased efficiency | 20 | 3.2% |
| 12 | saves time | 20 | 3.2% |
| 13 | team collaboration | 18 | 2.9% |
| 14 | full visibility | 18 | 2.9% |
| 15 | on-time delivery | 14 | 2.3% |

### 4.3 Themes (top 15)

_618 ads contributed; 486 distinct values._

| Rank | Value | Count | % of contributing ads |
|---|---|---|---|
| 1 | team collaboration | 174 | 28.2% |
| 2 | productivity | 123 | 19.9% |
| 3 | task management | 74 | 12.0% |
| 4 | ai automation | 73 | 11.8% |
| 5 | project management | 64 | 10.4% |
| 6 | workflow automation | 62 | 10.0% |
| 7 | all-in-one platform | 57 | 9.2% |
| 8 | consolidation | 54 | 8.7% |
| 9 | automation | 42 | 6.8% |
| 10 | efficiency | 32 | 5.2% |
| 11 | tool consolidation | 27 | 4.4% |
| 12 | workflow efficiency | 26 | 4.2% |
| 13 | team coordination | 25 | 4.0% |
| 14 | work platform | 25 | 4.0% |
| 15 | team management | 25 | 4.0% |
