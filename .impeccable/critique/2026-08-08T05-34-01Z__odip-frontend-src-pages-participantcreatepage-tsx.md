---
target: the participant add/edit form
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-08T05-34-01Z
slug: odip-frontend-src-pages-participantcreatepage-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Save shows pending state, but success is a silent redirect with no confirmation |
| 2 | Match System / Real World | 3 | Correct NDIS terminology, but no explanation of what values mean operationally |
| 3 | User Control and Freedom | 2 | No unsaved-changes guard on a 16-field form; back/Cancel silently discards edits |
| 4 | Consistency and Standards | 2 | Confirmed live: blue-tinted shadow (`shadow-blue-500/20`) under a green primary button, in two places |
| 5 | Error Prevention | 1 | NDIS Number is free text with no validation; checkboxes have 556-636px click targets due to a `w-full` class leak |
| 6 | Recognition Rather Than Recall | 3 | Searchable staff dropdown, descriptive labels |
| 7 | Flexibility and Efficiency | 2 | No save-and-add-another, no duplicate-from-existing, no autosave |
| 8 | Aesthetic and Minimalist Design | 2 | All 6 section cards carry identical visual weight; washed-out low-contrast inputs |
| 9 | Error Recovery | 1 | Confirmed live: clearing a required field and submitting shows ZERO visible error text, even for fields that ARE wired to display one |
| 10 | Help and Documentation | 1 | `hint` prop exists on the shared field component but is unused everywhere in this form |
| **Total** | | **20/40** | **Acceptable (borderline Poor)** |

#### Design Specificity Verdict

**LLM assessment**: The form's *content* is unmistakably NDIS-specific — Plan Management type, NDIS support ratios (1:1/1:2/2:1), an "Intensive Support (NDIS billing)" flag, and a Restrictive Practice flag tied to a real regulatory register. This could not be mistaken for a generic CRM contact form. But the *presentation* is generic form scaffolding: a flat stack of identically-styled Cards and checkboxes gives zero visual weight to which fields are routine vs. compliance-critical. Content passes design-specificity; presentation doesn't yet reflect the stakes the content carries.

**Deterministic scan**: `detect.mjs --json` against `ParticipantCreatePage.tsx` returned `[]` (exit 0) — zero automated rule hits. This detector targets generic anti-pattern signatures; it did not (and structurally could not) catch the domain-specific findings below, which came from design review and live verification instead.

**Visual overlays**: the standard browser-injected detector overlay could not be completed this run — the dev stack was down when the assigned browser-evidence agent ran. Instead, a follow-up pass brought the stack up and manually verified 5 specific claims directly in the live, authenticated app (computed styles, DOM hit-area measurements, and a live submit-with-missing-field test), which is stronger ground truth than the overlay would have provided. All 5 claims were confirmed against the real rendered page; a 6th, unlisted bug (oversized checkbox click targets) was found the same way.

#### Overall Impression

The form's domain modeling is solid and its defaults are sensible, but it treats every field — from "Repeat Client" to a legally-regulated Restrictive Practice flag — with the exact same visual weight and the exact same (broken) error feedback. The single biggest opportunity: make the form's visual hierarchy tell the coordinator which fields carry real compliance/safety stakes, and fix validation feedback so failures are never silent.

#### What's Working

1. **Sensible defaults** (`planType: 'SelfManaged'`, `supportRatio: 'SharedSupport'`, all risk flags `false`) reduce decisions for the common case, which fits a coordinator filling this out many times a day.
2. **Clean create/edit unification** — one component, `isEdit` branching, identical field order in both modes, so coordinators don't relearn the layout between adding and editing a participant.
3. **Searchable Preferred Staff dropdown** instead of a giant flat `<select>` — scales as the staff list grows.

#### Priority Issues

- **[P0] Restrictive Practice Flag carries zero visual weight for a field that feeds a real regulatory register.**
  Why it matters: PRODUCT.md confirms this flag feeds an actual restrictive-practices register, and the read-only detail page already renders it with an amber warning icon (confirmed live, viewing the same participant on both screens) — but the edit form shows it as one of five identically-styled plain checkboxes with no confirmation or context. A coordinator can flip a regulated flag with zero friction.
  Fix: reuse the amber-warning treatment from the detail page on the edit form; add explicit confirmation copy before it takes effect.
  Suggested command: `/impeccable harden`

- **[P0] Validation error feedback is effectively broken, not just missing on two fields.**
  Why it matters: source review found `planType`/`supportRatio` never receive an `error` prop despite being required — but live testing went further: clearing First/Last Name (fields that ARE wired with `error={errors.firstName?.message}`) and submitting produced ZERO visible error text anywhere on the page. The request was silently blocked with no feedback at all. This means the error-display path itself is unreliable, not just absent on two fields — a coordinator can be stuck with no way to tell why Save isn't working.
  Fix: audit `FormField`'s error-rendering path end-to-end (why does a wired `error` prop not render visibly?), then wire the two unwired fields once the underlying display is confirmed working.
  Suggested command: `/impeccable harden`

- **[P1] Checkbox click targets are 556-636px wide instead of 16px, confirmed by direct DOM measurement.**
  Why it matters: `FormField.tsx` clones its child and injects a shared `w-full` class onto checkbox inputs too, overriding the intended `w-4 h-4` sizing. Live measurement showed hit-areas 35-40x larger than intended, likely overlapping across the 5-checkbox "Support Needs" stack and risking misclicks on adjacent flags — including the Restrictive Practice flag from the issue above.
  Fix: exclude checkbox/radio inputs from the shared `w-full` injection in `FormField.tsx`.
  Suggested command: `/impeccable audit`

- **[P1] Primary-action button has a color-token mismatch: green button, blue shadow.**
  Why it matters: confirmed live via computed styles — the Save button uses `bg-[var(--color-primary)]` (`#396200`, green) but a literal `shadow-blue-500/20`, producing a visible blue-tinted halo under a green button. The same mismatch repeats on `ParticipantDetailPage.tsx`'s Edit button, suggesting a leftover from the pre-fork "TripCore" blue theme.
  Fix: replace the literal Tailwind blue shadow with one derived from the primary color token.
  Suggested command: `/impeccable colorize`

- **[P2] No inline guidance on ambiguous or compliance-sensitive fields.**
  Why it matters: `FormField`'s `hint` prop exists specifically for this purpose but is used nowhere in this form — Plan Type semantics, "Intensive Support (NDIS billing)," and the Restrictive Practice Flag all get zero inline explanation, forcing a first-time user to guess or ask a colleague.
  Fix: add one-line hints via the existing `hint` prop on the fields that need them.
  Suggested command: `/impeccable clarify`

#### Persona Red Flags

**Jordan (Confused First-Timer)**
- No explanation anywhere of what "Self/Plan/Agency Managed," "1:1/1:2/2:1," or "Intensive Support (NDIS billing)" mean.
- Confirmed live: submitting with a required field missing shows no visible error at all — Jordan has no idea why Save isn't working.
- No progress or field-count indicator, so Jordan doesn't know how long the form is until scrolling through all 6 cards.

**Sam (Accessibility-Dependent User)**
- Required fields render as plain text `' *'` with no `aria-required`/native `required` attribute — screen readers get no programmatic required signal.
- The 5 support-need checkboxes have no `<fieldset>`/`<legend>` grouping them as a related set.
- Confirmed live: all inputs use a flat grey-beige background with low contrast against white cards, adding a visual (and likely WCAG contrast) problem on top of the missing ARIA wiring.
- Error text has no `aria-describedby`/`aria-invalid` link to its input, and — per the live test — often doesn't render at all.

**Office Coordinator (project-specific, primary persona per PRODUCT.md)**
- No "save and add another" or duplicate-from-similar-participant path — every participant is a full 16-field form from scratch, many times a day.
- The generic failure banner ("Failed to create/update participant. Please check your input and try again.") gives zero specificity, and per the live test, even the per-field error path frequently shows nothing — a coordinator can be stuck with no diagnostic signal at all.
- No duplicate-participant detection (same name/NDIS number) before create, a real risk in a high-volume daily workflow.

#### Minor Observations

- `dateOfBirth` uses a native `<input type="date">`, which renders in per-browser/OS locale format — inconsistent with the app's own en-AU DD/MM/YYYY convention used everywhere data is displayed.
- NDIS Number is entered as plain free text with no format validation, despite being masked to last-digit-only everywhere it's displayed — an inconsistency in how sensitively the app treats this field between entry and display.
- Direct URL navigation to `/participants/new` isn't gated by `canWrite` — only the list page's link is disabled/hidden for a ReadOnly user, who can fill the whole form and only discover the 403 on submit.
- At mobile widths the 2-column grid (`grid md:grid-cols-2`) collapses to one column with a long single scroll and a non-sticky Cancel/Save row at the very bottom (inferred from source; the live session's resize tool could not shrink the viewport to confirm visually — worth a follow-up check).
- `ParticipantDetailPage.tsx` has a separate "Support Profile" tab with fields that sound adjacent to this form's Notes & Requirements fields (e.g. `behaviourSupportNotes` vs. `behaviourRiskSummary`) but lives on a disconnected editing surface this form gives no indication of.

#### Questions to Consider

- Restrictive Practice Flag already gets an amber-warning treatment on the read-only detail page — should the edit form borrow that signal, or does a field with this much compliance weight belong outside a plain checkbox list entirely?
- The error-display path appears to fail even where it's wired correctly — is this form's validation UX a known gap, or a regression nobody's hit yet because the seeded defaults rarely get cleared?
- Two adjacent, unlinked places (this form's Notes & Requirements, the detail page's Support Profile tab) capture similar clinical/behavioural information — is that an intentional data-model split, or worth unifying into one editing surface?
