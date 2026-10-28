# Design note: primitives B1, list pills, pager and row actions (written before the first UI edit)

Mode: Operate (lists). Display only: no endpoint, DTO, table or migration. Spec: TRIAGE.md section 1, items 1-8.

## What, where, which house component
| # | Site | Change | House component |
|---|---|---|---|
| 1 | StaffPage Status pill | delete ACTIVE_STATUS_COLORS; Dropdown `colorClass` = `statusClass(current)` + existing `h-[var(--control-h-sm)]` | Dropdown pill (editable status), lib/tone statusClass |
| 2 | ParticipantsPage Status | hand pill to `StatusBadge status={current}` inside the labelled span ("Status: Active") | StatusBadge (12px) |
| 3 | TripsPage waitlist (table + card) | `StatusBadge tone="warning" label="N wait" / "N waitlist"` | StatusBadge |
| 4 | SchedulePage preferred pill, TripStatusBadge | StatusBadge tone warning; TripStatusBadge = StatusBadge status + TRIP_STATUS_LABELS | StatusBadge |
| 5 | IncidentsPage flag, BudgetEmergencyReviewMarker | StatusBadge tone + label. The marker keeps its siren/tick/key glyph via a small optional `icon` on StatusBadge | StatusBadge |
| 6 | AuditHistoryTab | StatusBadge status=action, colorMap Created=success Updated=info Deleted=danger; lib/format formatRelative compact + formatDateTimeAu | StatusBadge, lib/format |
| 7 | CompletionReviewPage | DataTable `pagination` replaces the hand pager; Dismiss becomes Button ghost sm | DataTable, Button |
| 8 | PatternsPage row actions | three raw buttons to Button ghost sm iconOnly, long aria-labels and Generate's disabled kept | Button |

## States kept
Loading, empty ("No completions found"), the Dismiss-error Button, selected rows across a page change, disabled Generate, Trips hover-reveal wrapper, read-only Staff badge.

## Wording (lead decision)
Audit relative date: "Yesterday" becomes "1d ago"; the tooltip is the absolute `dd/mm/yyyy, hh:mm` (formatDateTimeAu). Inactive reads danger, Active success, everywhere.

## apple-design rules applied
- Touch targets: Button iconOnly carries the 44px coarse hit area (TAP_AREA); pager buttons use the DataTable's coarse height.
- Restraint and consistency: one pill size (12px) and one tone vocabulary per meaning; no new colours.
- Feedback: Button gives the instant pressed state; disabled Generate stays visibly disabled.
- Reduced motion: no motion added.
