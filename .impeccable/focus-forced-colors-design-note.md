# Focus indicator in forced colours (Windows High Contrast)

**What:** Tailwind rings are box-shadows, which forced-colours mode strips, and many controls carry `outline-none`. Keyboard focus therefore vanishes. Fix: one unlayered `@media (forced-colors: active) { :focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; } }` in `src/index.css` next to the reduced-motion blocks (unlayered, so it beats the layered `outline-none` utility). Plus the two Dropdown triggers (pill :412, form :443) move from `focus:ring` to the `focus-visible:` pair, matching the icon/menu trigger at :474.

**House pattern:** Button.tsx / Dropdown :474 use `focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`; CSS-source tests in tapArea.test.ts.

**States:**
- Forced colours off: nothing changes anywhere (block is inside the media query). Dropdown pill/form: ring on keyboard focus only; a mouse click no longer leaves a ring (the one visible change, matching the other triggers).
- Forced colours on, keyboard focus: 2px solid CanvasText outline offset 2px on every focusable (system colour, so it adapts to the user's theme; not Highlight).
- Forced colours on, mouse click: `:focus-visible` does not match buttons/dropdown triggers, so no outline; text inputs match on click (as per browser heuristics, expected).
- Script focus on a `tabIndex={-1}` heading in forced colours: outline shows; accepted by owner decision.
- Ring box-shadow on Dropdown triggers: absent after click, present after Tab.
