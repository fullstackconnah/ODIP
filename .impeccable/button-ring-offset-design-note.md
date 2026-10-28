# Button focus ring offset (design note)

**What:** keyboard focus on every Button variant is a 2px outline drawn 2px away from the button, in --color-ring.
**Where:** components/buttonClasses.ts BASE only (Button, and Dropdown trigger / other buttonClasses users inherit it).
**House pattern:** same colour token and 2px width as every other ring; only the gap is new. Outline (not ring-offset) so the gap is transparent on any surface and survives forced colours.
**Why:** --color-ring equals --color-primary, so the old flush ring vanished on a primary fill.

## States
- Keyboard focus (primary, secondary, danger, ghost, ghost-danger): 2px solid ring colour, 2px gap, follows rounded corners. Page background, Card, dialog footer, ActionBar; light (#396200) and dark (#a6d66b).
- Mouse click: focus-visible does not match, no indicator.
- Hover/active: unchanged colours; 0.97 press scale from #434 unchanged (outline takes no layout).
- Disabled: unchanged 50% opacity, not focusable.
- Layout/touch target: unchanged (outline is not in flow). Overflow: 4px reach, checked against clipping ancestors.
