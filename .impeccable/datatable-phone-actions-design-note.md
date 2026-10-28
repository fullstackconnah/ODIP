# DataTable phone cards: row actions on their own line (design note, written before any edit)

Skills called first: ponytail:ponytail, impeccable:impeccable, apple-design. Mode: Operate (app UI).

## What changes
Below md, the `actions` column cell of a DataTable card always takes the card's last line: full width (`basis-full`), content right-aligned (`text-right`; `RowActions` already `justify-end`). Today it is an ordinary flex item, so it flows after the last field: inline when it fits, on its own line when it does not. The cluster's position varies by row content, which reads as inconsistent.
Where: `DataTable.tsx`, one `ACTIONS_CARD` class string next to `CARD_CLASS`, applied to the td when `col.key === 'actions'`. All `max-md:` classes, so the md+ table is byte-identical. No new CSS and no `data-card` value: `data-card` switches the whole row into the title/meta layout (`tr:has(> td[data-card])`), which would re-order every card that has an actions column and never opted in.
House component: `RowActions` (unchanged), `ROW_ACTIONS_CARD` keeps the 44px targets.

## States
- Card with actions: last line, right edge on the card's inner right edge, 12px touch row gap (index.css) above it unchanged.
- Card without actions (RowActions/overlay returns null, or render gives null): the td is empty, so `max-md:empty:hidden` removes it; no blank strip and no extra row gap.
- `RowActions overlay`: absolute only at `md:pointer-fine`; below md it stays in flow, now on its own line. Untouched.
- `rowDetail`: the detail tr is a separate row; the actions line is the end of the main row, the detail follows. Untouched.
- Pinned end column on md+: pin classes are md-only; nothing here applies at md+.
- Long title wrapping: title is `primary` (own order/line); actions line stays last whatever the title does.
- Plain text "Edit" Button directly in the cell (no RowActions): `text-right` right-aligns the inline button.
- Header 'Actions' label (2 columns): the existing caps `::before` label stays, right-aligned above the buttons.

## apple-design rules applied
Familiarity and consistency (same control, same place on every card); mapping (actions at the card's end, where the thumb lands); targets stay 44px (restraint: no new chrome). No motion added.

## Cost
About 44px more height on cards where the cluster fitted inline before (lead decision).
