# Design note: themed checkboxes and table pager (Operate mode)

What: one base rule `input[type=checkbox], input[type=radio] { accent-color: var(--color-primary) }` in src/index.css (base layer). The tick/fill follows the Bunya Support green in light (#396200) and dark (#a6d66b, set by the dark token block). House component: CheckboxField and every bare input inherit it; no per-site classes needed.
Pager (DataTable): already split into a summary span and a controls group (#460). Kept: nowrap summary and page label; the row wraps between the two groups at max-md (summary line, then Page/Previous/Next right-aligned). Desktop unchanged.

States
- Checkbox unchecked: native box, border untouched. Checked: green fill with the browser's contrast tick (light and dark). Focus: existing focus ring unchanged. Disabled: browser dims. Forced-colors: accent-color is ignored by the UA there, system colours apply, so the forced-colors block needs nothing.
- Pager page 1 (Previous disabled) and last page (Next disabled), at 390 (summary on its own line, controls below, 44px buttons on coarse) and 1440 (one row, summary left, controls right).
- Long count "Showing 1,001-1,020 of 12,345": the summary stays one line (nowrap), the controls drop to the next line on a phone.
