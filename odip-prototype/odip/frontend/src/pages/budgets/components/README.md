# Budget warnings: the presentation components

Presentation-only components for the budget warnings (budget phase 2b). They draw what the server worked out and decide nothing: no endpoint, no fetch, no financial rule, no navigation.
The pages and the adapters beside them own the wiring: `pages/BudgetsPage.tsx` and `../budgetRows.ts` map the Budgets list's DTO onto these types, and
`pages/plan-builder/agreementBudgetView.ts` maps the agreement check's DTO onto the bar's.

## The files

| File | What it is |
|---|---|
| `viewModel.ts` | The private presentation contract. Not a server DTO, deliberately duplicates nothing from `@/api/types`. |
| `wording.ts` | Shared wording, JSX-free: the dash, the "no budget recorded" sentences, the bar's fixed words. |
| `BudgetFigure.tsx` | The ONE amount renderer. Centralises the privacy contract and the zero-vs-missing rule. |
| `BudgetRiskTable.tsx` | The `/budgets` list body: one row per participant and pool, on the shared `DataTable`, and the no-budget tail behind its count. |
| `AgreementBudgetBreakdown.tsx` | The agreement budget bar's comparison: per pool and funding period, "Agreement {cost} against {remaining} left in {period}", then within or over. |
| `fixtures.ts` | Explicit view-model fixtures for these components' own tests. |

## The four rules this code exists to hold

1. **A zero is a figure; a missing figure is a dash.** `BudgetAmount` is `number | null`. `0` is a real server answer and prints `$0.00`; `null` is "the server could not give a number" and
   prints `–` with the reason beside it. `undefined` is never accepted: a prop that can be absent is `T | null`, so forgetting it is a compile error rather than a silent dash.
2. **No figure ever leaks to a viewer who may not see it.** `BudgetFigureVisibility` is explicit and required on every row and on the whole breakdown. When it is not visible, the amount is
   withheld from the cell, from `title`, from `aria` and from every attribute. There is one renderer, so there is one place for that to be true and one place for it to be tested.
3. **No surface implies an all-clear without data.** Loading and failed states print a dash or say so, are not tinted, and carry no count.
4. **Warning only, never blocking.** None of these components can block anything. The breakdown holds no gate and no `disabled`, and the only callbacks it takes are the retry after a failed check
   and, for "no budget recorded", a link to the Funding tab. That is structural, not a convention.

## What they deliberately do not do

- They do not sort by risk by default: the order of `rows` is the server's (risk, then name). A person who sorts the Status column gets `BUDGET_RISK_ORDER`.
- They do not add any two figures, and they do not derive a status from them. `status` is the server's word, and so is "within" or "over by".
- They do not route. Navigation is the caller's, via `action.to`.
- They do not read a clock. `wording.ts` builds every sentence from fixed words, so it cannot change with an ICU build.

## Changes made when these were wired (against SPEC-P2B, which wins)

These started as a parallel agent system's presentation surfaces (cherry-picked as `5acf6946` and `97ea7559`, authorship kept). Where they disagreed with the spec they were changed:

- **The separate attention band is gone.** `BudgetAttentionBand` drew a second band of its own, counted "approaching" too and printed its own all-clear. The spec asks for ONE `BandItem` in the
  dashboard's existing `AttentionBand`, counting only participants over or forecast to go over, so that is what `pages/budgets/budgetBand.ts` builds; its states, its wording and its
  denominator are removed with it.
- **The agreement breakdown's figures are the server's.** It showed "signed or committed", a forecast and an "allowance" (set-aside versus plan amount). The agreement check answers
  {agreement cost, available minus used, over by} per pool and period and nothing else, so the breakdown draws exactly those, and gained the part of the agreement that fits no pool or falls outside
  the plan, a retry, and the "no budget recorded" link to the Funding tab.
- **The no-budget tail is a real disclosure.** It was a button that called back and opened nothing. It now holds the participants (with why, and a way to record a budget) and says whether it is open.
- **The row's action is the participant's name.** It is a link named "{action} for {participant}" (the visible name is inside the accessible name), where it was a column of buttons named by a pattern that
  only worked for labels containing "open", "view" or "go". The DataTable's column rule pins an actions column to the edge, and at 1440px that column covered Forecast, the figure the list is for. The
  columns' narrowest widths were also trimmed so the table fits at 1366px and 1440px (measured in a browser). The coarse "estimate" and "committed" members, which the server never sends, are removed.
- **A row that is over or forecast over is tinted from md up, so its status pill sits on the card fill there** (a pill in the row's own colour vanished into it); below md the rows are untinted cards and
  the pill keeps its own tone.
- **A pool with more than three funding periods draws the first three and puts the rest behind a native disclosure** that says how many there are and how many are over (`MAX_LINES_SHOWN`). The bar is
  docked, and a plan funded monthly would otherwise fill the screen with a year of lines.
