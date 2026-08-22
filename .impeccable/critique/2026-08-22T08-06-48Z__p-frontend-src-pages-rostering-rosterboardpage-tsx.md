---
target: the roster board
total_score: 31
p0_count: 0
p1_count: 4
timestamp: 2026-08-22T08-06-48Z
slug: p-frontend-src-pages-rostering-rosterboardpage-tsx
---
Method: dual-agent (A: critique-a-design · B: critique-b-detector)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Drag-assign has no explicit success confirmation; compliance notes truncated at rest |
| 2 | Match System / Real World | 4 | Domain vocabulary matches a trained NDIS coordinator exactly |
| 3 | User Control and Freedom | 3 | No "clear all filters" once participant + region + unfilled-only combine |
| 4 | Consistency and Standards | 4 | One ShiftChip, one FindingsList, reused verbatim across four contexts |
| 5 | Error Prevention | 4 | Blocking hard-disables Save; Warnings force a stored reason; live dry-run precedes commit |
| 6 | Recognition Rather Than Recall | 2 | Blocking and Warning render an identical dot; safety text truncates to `title`-only |
| 7 | Flexibility and Efficiency | 3 | Drag + keyboard menu both work; no bulk acknowledge, no week-nav shortcuts |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely restrained, but chips truncate near-universally at ~150px |
| 9 | Error Recovery | 4 | Messages name person, rule and date; blocking dialog is calm, not alarmist |
| 10 | Help and Documentation | 1 | One inline hint; no explanation of Ratio / Night-type codes |
| **Total** | | **31/40** | **Good — address weak dimensions** |

## Anti-Patterns Verdict

**Not AI slop.** Both assessments agree independently.

**LLM assessment (A):** every product-register DON'T checked and clear — no side-stripe borders, no gradient text, no glassmorphism, no hero-metric template, no decorative card grids, no uppercase tracked eyebrows, no reinvented affordances, no modal-as-first-thought. One component vocabulary throughout.

**Deterministic scan (B):** `detect.mjs` exit 0, `[]` — zero findings across 19 source files. No rules fired, so there are no false positives to discount. `bg-[var(--color-warning)]` (3 sites) was not flagged, consistent with the earlier verification that Tailwind v4 emits no `.bg-warning` utility.

**Visual overlays:** none. Injection failed at the mandatory preflight — the app's own CSP (`index.html:8`, `script-src 'self' 'wasm-unsafe-eval'`, no nonce) blocks inline script injection product-wide. Fallback signal reported; no live server was started; no overlay is claimed.

## Overall Impression

The safety machinery is the best part of this build and the board is the weakest link in it. The rule engine, the findings copy, and the override gate are genuinely good — a blocked shift cannot be saved, a warning cannot be waved through without a written reason, and the messages name the person, the rule and the date. Then the board throws that precision away at the last step: every flagged chip renders the same amber dot whether it is an overridable warning or a regulatory prohibition.

The single biggest opportunity is to make severity — not merely the presence of a finding — the thing the board encodes.

## What's Working

1. **Error prevention implemented faithfully.** Blocking hard-disables Save, Warnings force a stored reason, and a 400ms debounced dry-run surfaces both before the user attempts to commit. Scored 4/4 and verified live.
2. **One component vocabulary, honestly reused.** `ShiftChip` and `FindingsList` have exactly one implementation each, reused across board, slide-over, drag-confirm and exceptions drawer. No divergent save buttons anywhere.
3. **Restraint that is real, not claimed.** "Colour means something is wrong; ordinary shifts are neutral surfaces" is true in the shipped code. Contrast independently measured by both assessments: 6.1–15.4:1 across all sampled text. Comfortably AA, ruled out as a concern.

## Priority Issues

**[P1] Blocking and Warning are visually identical on the board.**
`ShiftChip` branches on `findings.length > 0`, not on severity, so a regulatory prohibition and an overridable warning render the same amber dot. This is the one distinction the module exists to make. A coordinator scanning fifteen rows must open every flagged chip to learn which is which. The correct pattern already exists in `FindingsList` and the exceptions drawer (AlertOctagon/destructive vs AlertTriangle/warning) — this is propagating an existing pattern, not inventing one.
*Fix: encode severity in the chip marker. Suggested command: /impeccable clarify.*

**[P1] Fixed chrome overlaps and hides roster data below desktop.**
At 820px and 390px the bottom tab bar renders on top of grid rows, hiding real shift data (observed overlapping the James O'Brien and Sarah Mitchell rows). The sidebar also stays fully expanded, consuming 185–240px. This is not graceful density degradation; it is data concealment.
*Fix: stop fixed chrome overlapping grid content below tablet. Suggested command: /impeccable layout.*

**[P1] Safety-critical text is truncated with `title`-only disclosure.**
`StaffRow` caps `complianceNotes[0]` at `max-w-[7rem]` with `truncate`; the only full-text path is a `title` on a non-focusable `<span>`. Keyboard, touch and screen-reader users get nothing — on precisely the text that determines whether someone may be rostered. Fragments like "Sarah Mitchell has n…" are unreadable even as fragments.
*Fix: widen the column, wrap instead of truncating, or route through a real focusable disclosure. Suggested command: /impeccable clarify.*

**[P1] The page scrolls horizontally at every width.**
Measured `scrollWidth - clientWidth`: 184px at 1440, 500px at 820, 914px at 390. The layout is identical at all three widths — one fixed-width grid, no reflow. The brief specified collapsing to a day-at-a-time list below `lg`; that was never built.
*Fix in progress (container containment). The mobile collapse remains an open decision. Suggested command: /impeccable adapt.*

**[P2] Chip density overflows into truncation.**
Time + name + ratio badge + override icon + kebab in ~150px truncates on nearly every chip. Measured chip button box: 96×16px. This is the cognitive-load chunking failure and it undercuts the genuine minimalism elsewhere.
*Fix: defer lower-priority chip content so time and person never truncate. Suggested command: /impeccable distill.*

**[P2] Every interactive element in the board is under 44×44px.**
41 of 41 interactive elements inside `<main>`, at all three widths. Chip open-buttons 96×16, kebab 26×26, week-nav chevrons 28×28. Density is legitimate for a desktop product-register tool; at 390px it is a genuine failure.
*Fix: gated on the mobile-layout decision. Suggested command: /impeccable adapt.*

**[P2] `prefers-reduced-motion` is honoured nowhere in the product.**
Zero matches across the entire frontend `src/`. ~25 unguarded transitions plus `animate-fade-in` on every page mount and `animate-pulse` skeletons. The brief required reduced-motion alternatives for rostering.
*Fix: one global guard block in `index.css` covers the product. Suggested command: /impeccable polish.*

## Persona Red Flags

**Sarah (office coordinator — the primary lens, rebuilding a week after a 7am call-out):** the one fact she needs at a glance — which of nine exceptions is the regulatory blocker versus the eight overridable warnings — is surfaced nowhere on the board. She opens flagged chips one by one. When she drags a replacement onto that shift, she still cannot see whether *that* person has a compliance problem, because the note truncates. Her first glance shows 7 of 15 rows carrying red or amber fragments, reading as "everything is on fire" rather than "here are your two real problems."

**Sam (accessibility-dependent):** `title`-only disclosure on truncated compliance notes is a hard failure — nothing reachable by keyboard or screen reader on the text that matters most. The flattened severity dot compounds it: no way to triage without opening every chip to read text.

**Alex (power user):** four of the week's nine exceptions restate one fact (Isabella Ferraro's expired first-aid certificate, against four different shifts) with no batch acknowledge. No keyboard shortcut for week navigation.

## Minor Observations

- The severity-distinguishing icon pattern already exists in two components; the P1 chip fix is propagation, not invention.
- Toolbar carries six simultaneous top-level controls with no reset-filters affordance — over the ≤4 cognitive-load guidance, though each control is individually well-labelled.
- `RosterGridSkeleton` places chip placeholders on `rowIdx % 3 === 0` — arbitrary rather than data-shaped.
- Delete copy ("This permanently removes the shift from the roster. This can't be undone.") is honest without being alarmist.
- `font-display` on staff names is a judgment call against the display-fonts-in-data ban; it is the committed heading face at modest weight, not an ornate face. Not counted as a finding.
- The "everything is on fire" first paint has a specific root cause: base-seeded staff carry no `WorkerScreeningExpiryDate`, and null WSC is treated as Blocking. On a fresh deployment every existing staff member is unrosterable until screening data is backfilled.

## Questions to Consider

- If severity is the one thing this board must communicate, should the chip encode severity rather than mere presence of a finding?
- Would "2 need you, 7 are warnings" serve the Monday-morning triage better than a flat "9 exceptions"?
- Should the exceptions drawer group four instances of one expired certificate into a single item with four affected dates?
- Should "no screening on file" and "screening expired on a date" really carry the same severity? One is a data gap; the other is a verified prohibition.
- What would first paint look like if healthy rows collapsed by default, so the opening view is already the triage list?
