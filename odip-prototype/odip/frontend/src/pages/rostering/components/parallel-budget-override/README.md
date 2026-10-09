# Budget override / emergency: the shift panel's budget components

Budget phase 3 (`SPEC-P3.md`): the three components that show a person **why** a one-off shift is going past the recorded budget, **what they must write** to go ahead anyway, and **what was recorded**
afterwards. They began as a presentation-only slice built at the phase 1 base (branch `feat/hermes-budget-override-ui`, commits `f940650b` and `8ec25ff0`, kept in this branch's history) and are now
wired into `ShiftSlideOver` and `ShiftChip`. Where that slice disagreed with the spec, the spec won; the changes are listed at the end.

## What is here

| File | What it is |
|---|---|
| `BudgetOverrideReasonFields.tsx` | "Emergency or safety": the one way through a shift a hard limit refused. A secondary action, then a required description. |
| `BudgetFindingDetails.tsx` | The authoritative pool / period / left / cost / over-by readout, from the server's figures. |
| `BudgetEmergencyReviewMarker.tsx` | The marker a shift saved over budget carries, with the audit facts. |
| `budgetOverrideTypes.ts` | The view model and the pure rules over it (no JSX, no hook, no money arithmetic). |
| `budgetFigures.ts` | How a server-sent figure reads on screen, and the sentence that names an overrun. |
| `fixtures.ts` | Literal server answers for the tests. |
| `index.ts` | The public surface. Import from here. |

## Who decides what

The **server** decides everything about money and permission; these components render its answer.

- **No role is read in the browser.** The server answers a Coordinator under a hard limit with `BUDGET_FORECAST_OVER` as `Blocking`, and an Admin with the same code as a `Warning` that has `requiresReason`.
  `emergencyOffered(findings)` is therefore "a blocking `BUDGET_FORECAST_OVER` came back". An Admin never sees the emergency action: the panel's existing "Reason for override" field answers the warning.
- **The finding carries its figures.** `RosterFindingDto.budget` holds the pool, the period, and available / used / booked ahead / shift cost / forecast / over-by, the Budgets list's words in its order, plus the count of shifts the period could not price. `figuresOf(finding)` maps them to what the readout prints.
  Nothing here sums or compares money, so the rows are the server's own and a period it could not fully price says so instead of looking complete.
- **The marker is read from codes the server stored** (`ShiftDto.acknowledgedFindingCodes`), never from the reason's words: `markerForAcknowledgedCodes`. The server stores `BUDGET_EMERGENCY` only for an
  emergency it accepted, and `BUDGET_FORECAST_OVER` only for an Admin override that carried a reason, and it drops both from anything the client sends. A warning leaves no marker.

## The flow in the shift panel

1. The dry run (`POST rostering/shifts/check`) returns the findings, and, for a shift the budget could not check, an informational line in the envelope message (`budgetNote`). The line is not a finding.
2. **Warn mode or a pattern shift**: the budget finding is a warning with the shift's cost in its sentence ("This shift: about $292.32"). Save is "Save with override" as for any warning; no reason.
3. **Admin, hard limit**: the finding says "Reason required"; the existing reason field is required; the reason is stored with `BUDGET_FORECAST_OVER`.
4. **Coordinator, hard limit**: Save is disabled and the refusal names the figures. `BudgetOverrideReasonFields` offers **Emergency or safety** as a secondary action. Choosing it opens the description
   and **moves focus to it**; Save ("Save as emergency") stays disabled until the description is at least `MIN_REASON_LENGTH` trimmed characters. The request carries `emergency: true` and the description in
   `overrideReason`; the server stores `Emergency or safety: {description}` with `BUDGET_EMERGENCY` and raises one Admin review task.
5. A shift saved either way shows the marker on the board chip and, in the panel, `BudgetEmergencyReviewMarker`: an emergency says "Admin review pending" until the Admin completes the task; an Admin
   override has no review to wait for.

## Copy, and what it must never say

- Warnings are the default. Hard limits are a Settings switch. **Only a one-off shift's overrun can be refused.** Nothing here blocks an agreement, a claim, a cancel, a cheaper edit, or delivered support.
- The emergency or safety path **cannot be switched off**: there is no prop, setting or control for it, and the copy says so.
- An emergency saves at once and an Admin reviews it afterwards. Nothing says "approved".
- A restricted viewer (`restricted`) gets no amount in the DOM. The roster itself is Admin, Coordinator and SuperAdmin only, so the shift panel never sets it; it is kept for any future surface.

## What changed from the presentation-only slice

- `BudgetOverrideReasonFields` lost its Admin path (the "Override as an Admin" radio, the `capabilities` prop, `availableChoices`, `storedReason` and the client-side `Emergency or safety: ` prefix). SPEC-P3
  gives the Admin the existing reason field, and the server owns the prefix. The Emergency path is a secondary button, not a lone radio, and moves focus to the description.
- `BudgetEmergencyReviewMarker` gained the Admin override without a review (no badge, no "not approved" sentence), an emergency with no review task found reads as pending, and the review day arrives as a
  date (`reviewedOn`).
- `BudgetFindingDetails` can leave its sentence out (`sentence={false}`) where the findings list already prints the server's own; its warning icon uses `TONE.warning.ink`, as `toneContrast.test.ts` requires.
- New helpers: `isBudgetFinding`, `emergencyOffered`, `figuresOf`.
- Dropped with the Admin path: the README's "wiring recipe" (the client no longer sends the budget codes), and its note about de-duplicating them: `ShiftSlideOver` sends each code once, and the server drops
  the two that carry meaning.

## Still not claimed

jsdom does no layout: the phone-width tests assert wrapping and preserved text, not pixels. The rendered pass (1440 and 390) is in the phase 3 report's screenshots.
