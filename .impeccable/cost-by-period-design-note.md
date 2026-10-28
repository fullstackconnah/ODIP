# Design note: Cost by period (Check step)

Written before the first UI edit. SHAPE.md (scratchpad/cost-by-period) is the binding spec; this is the summary the build follows.

- **What:** a new h3 section "Cost by period" on step 3 (Check). Pick a period kind, step through periods, read the price of exactly those dates. Frontend only, one new quote per chosen period.
- **Where:** in `CheckStep`, after "What it costs" (its by-category list, caption and left-out line) and before the public-holiday line. The footer RunningTotal is unchanged.
- **House components:** `ToggleGroup` (ariaLabel "Period", `flex-wrap`), `Button` secondary md square with chevrons (WeekToolbar pattern), `FormField` + native date input with `formGrid`/`span.date` for Custom, `formatDateRange`, the CheckStep `LABEL`/`HEADLINE` tokens. Text tokens only, no chart, no colour carrying meaning.
- **Layout:** toggle row, stepper row (buttons left of the period line so they never move), figure slot, date-notes row, quote-notes row. Figure slot has a fixed min height (taller of the headline and a 36px sm button), so every state renders in the same box.
- **States:** first load "pricing…", updating "updating…", busy (429 retry), ready, nothing priced, failed (Try again, aria-disabled + aria-busy while retrying), part period, custom clamped, custom To before From, custom empty/unreadable, saved agreement, agreement a fortnight or shorter (one line, no control), not rendered while idle.
- **Never stale:** the amount shows only when the answer's blocks and dates are the current settled blocks and the chosen period; any other moment shows the updating state. Quote notes row keeps its box (`invisible`) while updating.
- **apple-design rules applied:** response on the click (period line and date notes change before any request), no latency added to the input path (only the quote is debounced, 300 ms), interruptible (the query signal cancels an overtaken request), no motion beyond the house colour transitions, tracking and tabular figures as the sibling figures, 44px touch targets on coarse pointers, restraint (no display step, no fade or count-up), reduced-motion needs nothing because nothing moves.
- **Accessibility:** section `aria-labelledby`, `aria-busy` while pricing; one `role="status"` live region that speaks once when a user action settles and never for updating or block-driven re-prices; stepper ends use `aria-disabled` (focus kept), never `disabled`.

## Fix round 1 (written before the edits)

- **What / where:** `CostByPeriod.tsx` only: the stepper row, the Try again button and the failure detail line. No new element, no new copy except the budget-failed state, which reuses "Couldn't price this period." and the existing Try again.
- **House components:** `Button` (secondary, sm) with `TAP_AREA`; the existing stepper `Button`s; no native widget added.
- **Row (apple-design: spatial consistency, nothing jumps):** the row stops wrapping. The period line is a `min-w-0 flex-1` item beside the two 44 px steppers and wraps inside itself at the " · " joins (its spans are nowrap). `min-h-12` below `sm` gives every state (ready, updating, busy) one row height, so the figure slot below never moves.
- **Try again (apple-design: hit target, response):** `TAP_AREA` pads the 36 px button to a 44x44 hit box on touch without growing it; the gap beside it is 12 px, above it 8 px, so the 4 px pads collide with nothing.
- **Retry (apple-design: feedback without layout shift):** while retrying, the failure detail keeps its box and is `invisible`, so the section height is the same before and during the press.
- **States:** idle, pricing, updating, busy, ready, nothing, failed (quote failed), failed (budget failed, new), failed + retrying. Reduced motion: nothing animates here.
