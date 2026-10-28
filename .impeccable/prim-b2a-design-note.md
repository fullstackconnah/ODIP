# Design note: participant tab actions and DisclosureToggle (B2a)

What: raw underlined text buttons on participant tabs and the MAR tab become house `Button` (ghost / ghost-danger, sm); five-plus disclosure toggles share one new `components/DisclosureToggle.tsx`.
Where: participant-detail Notes, Routines, Medications, RestrictivePractices, RiskEntries, three Section files; medications MarTab; incident RestrictivePracticeStep.
No colour or wording change.

## DisclosureToggle
- Props: `label`, `open`, `onToggle`, `controls?`. Renders a `<button type="button">` with `aria-expanded`, `aria-controls` (when given), the label text unchanged, a ChevronDown rotating 180deg when open (transition 200ms, as before).
- Tap floor: `min-h-[var(--tap-min)]` (0 on a mouse, 44 coarse), so desktop height does not grow.
- States: closed, open, hover (muted to foreground text), keyboard focus (house ring, focus-visible only), active (no scale: it is a text row, not a button), reduced motion (chevron transition is non-vestibular, kept short).
- Collapsed by default stays the callers' decision (`useState(false)`).

## Row actions
- `Button variant="ghost" size="sm"`, `ghost-danger` for Archive/Delete. sm carries the TAP_AREA 44px pad on coarse and is 24px on a mouse, so row height does not grow.
- Keep aria-labels, onClick, canWrite gating, disabled states. Drift banner Dismiss/Regenerate: ghost sm, disabled while pending.
- MAR day nav: previous/next secondary iconOnly with existing aria-labels; Today secondary sm.

## apple-design rules applied
Response (press feedback comes from Button's active state, instant), familiarity/consistency (same control looks and behaves the same everywhere), agency (disabled/busy preserved), reduced restraint (no new motion), 44pt targets without visual growth.
