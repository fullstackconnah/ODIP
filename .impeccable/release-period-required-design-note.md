# Release period required (funding plan editor) - design note (written before any edit)

Skills loaded first: ponytail:ponytail (full), impeccable:impeccable, apple-design. Mode: Operate (form task).

## What and where
`PlanFields` in `pages/funding/FundingPlanEditor.tsx`: the "Funding periods" select. House component `SelectField` (FormField wiring: label, `error`, aria-invalid, aria-describedby) - no new component.

## Select
- Label stays "Funding periods"; marked `required` (house convention, same as Plan start / Plan end).
- Options: placeholder "Choose…" (SelectField `placeholder`: a disabled, hidden empty option, so it shows while unchosen and cannot be picked afterwards), then "Whole plan" (value `whole`, maps to null), Monthly, 3-monthly, 6-monthly, 12-monthly.
- "No funding periods" becomes "Whole plan" in `periodLengthLabel`, which also prints PlanRecord and PlanBudgetCard (one source).

## Error
- Inline via `SelectField error`, copy "Choose how the funding is released." Shown only after a Save was tried (same `attempted` gate as the other required fields). It clears the moment a choice is made (validate is live).
- Refused Save: existing `focusFirstProblem` finds `[aria-invalid="true"]` and focuses the select; no new focus code.

## State model
`EditorState.periodLengthMonths: number | null | undefined` - undefined = not chosen, null = whole plan (unchanged meaning), number = months. New plan starts undefined. `nextPlanState` with a previous plan carries `previous ?? null` forward (chosen). Stored plan loads `plan.periodLengthMonths ?? null` (chosen; null reads Whole plan). No previous plan: unchosen.
Unchosen proposes no periods (`proposePeriods` already returns [] for an unknown length), so no table rows until a choice; picking 1/3/6/12 proposes as before.

## States
| State | Select shows | Error | Save |
|---|---|---|---|
| New, unchosen | "Choose…" | none until a Save is tried | refused |
| Save refused | "Choose…", aria-invalid | "Choose how the funding is released." under the field, field focused | refused |
| Whole plan chosen | "Whole plan" | none | saves, no periodLengthMonths in payload |
| 3 months chosen | "3-monthly" | none | saves with 3 and proposed periods |
| Edit stored null | "Whole plan" | none | unchanged |
| Edit stored 3 | "3-monthly" | none | periods never rewritten |
| Next plan, previous chosen | previous choice | none | saves without a new choice |

## apple-design rules applied
Feedback inline beside the field, validated at the point of refusal, not a dialog (section 16 feedback/agency); direct specific labels ("Whole plan" names the thing); familiarity: reuse the house select and error slot; nothing animated; error text is not colour-only (text + aria-invalid). Touch: the house select height unchanged (44px target kept).

## Not done
No backend change; import unchanged; no new component or option.

## Added while building
Unchosen pools show the line "Choose how the funding is released to see its periods." where a chosen plan shows its periods table (or "The whole plan is one period"), and `proposedPeriods` returns no periods until a choice is made.
