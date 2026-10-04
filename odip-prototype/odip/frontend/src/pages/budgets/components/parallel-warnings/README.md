# Budget warnings — presentation surfaces (parallel-warnings)

Three presentation-only surfaces for the budget-warnings feature, plus the private contract they share.
Everything here is **display**: no endpoint, no DTO, no financial rule, no fetch, no navigation.
Budget phase 2b owns the API adapter and maps its answer onto these types.

## The files

| File | What it is |
|---|---|
| `viewModel.ts` | The private presentation contract. Not a server DTO, deliberately duplicates nothing from `@/api/types`. |
| `wording.ts` | Shared wording, JSX-free: risk labels, unavailable/hidden sentences, sentence builders. |
| `BudgetFigure.tsx` | The ONE amount renderer. Centralises the privacy contract and the zero-vs-missing rule. |
| `BudgetAttentionBand.tsx` | The dashboard attention band: loading, failed, ready-at-zero, ready-with-counts. |
| `BudgetRiskTable.tsx` | The `/budgets` list body: one row per participant and pool, on the shared `DataTable`. |
| `AgreementBudgetBreakdown.tsx` | Per-pool, per-period agreement figures against what each period has available. |
| `fixtures.ts` | Explicit fixtures for the three surfaces. |

## The four rules this code exists to hold

1. **A zero is a figure; a missing figure is a dash.** `BudgetAmount` is `number | null`. `0` is a real
   server answer and prints `$0.00`; `null` is "the server could not give a number" and prints `–` with
   the reason beside it. `undefined` is never accepted — a prop that can be absent is `T | null`, so
   forgetting it is a compile error rather than a silent dash.
2. **No figure ever leaks to a viewer who may not see it.** `BudgetFigureVisibility` is explicit and
   required on every row and on the whole breakdown. When it is not visible, the amount is withheld from
   the cell, from `title`, from `aria` and from every attribute. There is one renderer, so there is one
   place for that to be true and one place for it to be tested.
3. **No surface implies an all-clear without data.** Loading and failed states print a dash, are not
   tinted, and carry no count. They are never the band's "all clear" field.
4. **Warning only, never blocking.** None of these components can block anything. None holds a callback
   that could refuse an action; the breakdown holds no `disabled` and no gate. That is structural, not a
   convention.

## What these components deliberately do not do

- They do not sort by risk by default — the order of `rows` is the server's, it holds the buckets and
  the "no budget recorded" tail. (A user-placed sort of the Status column does use the declared
  `BUDGET_RISK_ORDER`; see F-15 below.)
- They do not add any two figures, and they do not derive a status from them. `status` is the server's word.
- They do not decide a status, re-rank a participant, or re-derive a forecast.
- They do not route. Navigation is the caller's, via `action.to`.
- They do not read a clock. `wording.ts` builds every sentence from fixed words, so it cannot change
  with an ICU build.

## Money and formatting

All money goes through the existing `formatCurrency` via `BudgetFigure`. No surface formats money
itself, and no display string is ever accepted from the server — the adapter passes whole dollars, so
one figure cannot end up spelled two ways.

## Design-lane findings applied here

From the source-only design review (`OPERATIVE-FINDINGS.md`, task `t_1fbc9426` run 2483, base
`c5353359`), reconciled against this candidate:

- **F-15 (M) — fixed.** The Status column had no `sortFn`, so `DataTable.defaultComparator` fell through
  to `String(a).localeCompare(b)` and sorted the risk words **alphabetically** — Approaching, Forecast
  over, On track, Over — the exact reverse of the required order. It also had no `sortable`, so the
  `sortFn` would have been dead code. Both are now set, with the rank declared once in
  `BUDGET_RISK_ORDER` and a name tiebreak so a re-sort is stable. Covered by five tests that drive the
  real header.
- **F-18 (R) — applied.** The band takes no icon and no chip, so its words are the only cue. It now
  names the denominator (`of N participants with a recorded budget`) alongside both halves of the
  count. The denominator counts participants with a *recorded* budget, so a missing budget is never
  presented as a risk. When the server has not sent one the base is left off rather than invented.
- **F-10 (M) — held.** `$0.00` for a known zero, `–` for unknown, never an en dash as a status, never
  "On track" without a successful read. `configuredZero` gives a `$0.00` pool its own sentence.
- **F-24 (R) — held.** Every link names its destination: the band's action is the caller's label; a row
  link carries the participant's name. Money is never link text.
- **F-25 / F-27 (P) — applied.** Money columns carry `max-md:text-left`; the Status column reserves
  `minWidth` so chips of different length do not make the column jump; no `priority` is passed.

Out of this lane and **not** done here (other workers own them): F-11/F-14 (the dashboard's own
`AttentionBand` and `BudgetBar`, which are shared files this lane must not edit), F-03/F-04/F-05
(`FindingsList`/`RosterGateFields`, shared-primitive owner), F-01/F-02/F-06/F-07/F-08 (shift panel),
F-09 (`statusToneCoverage.test.ts` — note the C# walk `skipIf(!HAS_BACKEND)` silently skips in the
Docker image, so a green local run is not a green build there), F-12/F-13 (server DTO shape and
`ParticipantsController` redaction), F-17 (`BudgetSettingsTab`).

## Verification

Run in the isolated worktree `F:/Projects/personal/ODIP/.claude/worktrees/hermes-budget-warnings-ui`
on `feat/hermes-budget-warnings-ui`, base `c5353359`, timezone `Australia/Sydney`.

- `npx tsc -b --force` — clean, exit 0.
- `npx vitest run src/pages/budgets/components/parallel-warnings` — 3 files, 76 tests, all pass.
- `npx eslint src/pages/budgets/components/parallel-warnings` — clean, exit 0.

**Not verified here:** no rendered/browser pass, no 200% zoom, no measured contrast, no accessibility
conformance. The design lane's K1–K10 scenes (K6 `/budgets`, K7 band, K8 agreement, K9 screen-reader,
K10 contrast) remain a prerequisite for any visual or a11y sign-off; jsdom does no layout, so
`DataTable`'s pinned-cell behaviour and the pinned widths can only be checked in a real browser.
