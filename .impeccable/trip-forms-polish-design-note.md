# Trip forms polish: design note (written before any edit)

Skills called first: ponytail:ponytail, impeccable:impeccable, apple-design. Mode: Operate (task forms).
House parts only. No new component, token or colour.

## 1. "+ Create new" (AccommodationTab.tsx ~421)
- Part: `TAP_AREA` (components/tapArea.ts), as ActionButtons does. A transparent 44px `::before` pad on coarse; the mouse look is unchanged (`text-xs`, same box).
- `relative` is inside TAP_AREA, so no other position on the button. Pad overhang is (44-16)/2 = 14px above and below; the label row is `items-baseline` beside the "Property" label with `mb-1` below, so the pad overlaps only blank space and the label, which is not a control. The Property dropdown sits below by 4px, so the pad can cover its top 10px on touch. Mitigation: the pad is centred on the 16px text, and the later sibling (the dropdown) paints above the earlier `::before` only if it is positioned; to be safe the numeric check reads the hit box height and the shot is checked for overlap. If the overlap shows, use TAP_FLOOR instead (real 44px height on touch).
- States: default, hover underline (kept), focus-visible ring (browser/global), label toggles "Select existing" (same class).
- apple-design: hit target reaches 44px without growing the visual (response/familiarity); no motion added.

## 2. Add Activity (AddActivityModal.tsx)
- Part: `Modal stickyFooter` (the prop AccommodationTab and BookingsTab already pass): footer stays pinned while the body scrolls.
- Part: `FormField error={timeError}` on End Time: renders `<p role="alert" id=...-error>` right under the field, with aria-invalid and aria-describedby on the input. The loose `<p>` below the whole body is removed. The save-failed message stays where it is.
- States: error hidden (no text, no aria-invalid); error shown (text under End Time, input invalid); body scrolled (footer in view, buttons reachable); end before start still blocks submit (handleSubmit return unchanged); error clears on the next valid submit (setTimeError('') unchanged).
- Focus order unchanged (no element added or reordered).

## 3. Bookings checkboxes (BookingsTab.tsx, EditBookingModal.tsx)
- Part: `CheckboxField` (FormField layout=checkbox: one `<label>`, `min-h-[var(--control-h)]` = 44px coarse, `gap-3 py-1`), inside the existing `modalGrid` (BookingsTab) and the existing `grid grid-cols-1 sm:grid-cols-2 gap-3` (EditBookingModal). Same state setters, same payload.
- The raw `rounded border` class on the input is dropped: CheckboxField owns the input styling like every other call site.
- States: unchecked, checked, keyboard focus (native input focus ring), tap anywhere on the row toggles. Accessible name = label text (unchanged: Wheelchair, High Support, Night Support, Restrictive Practice).
- Desktop: row grows from ~20px to 32px (control-h fine); the 2-col grid is kept. This is the house checkbox row, accepted.

## 4. Edit trip headings (EditTripModal.tsx 130, 151, 177, 190)
- Class: `text-sm font-medium` in the default foreground colour, the exact style of the sibling section heading "Support Requirements" (BookingsTab.tsx:239, `block text-sm font-medium`). Dropped: `text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]`.
- Text: sentence case ("Basic info", "Dates & status", "Capacity & requirements", "Notes"). Source strings are already Title Case in markup, so the text is edited, not only CSS (CSS-only would have left "Basic Info").
- `id="editTripNotesLabel"` kept; the Notes textarea stays aria-labelledby it.
- apple-design: one label style, hierarchy from weight and size not caps+tracking (typography section: no fixed positive tracking on small caps).
- States: desktop layout unchanged apart from heading case and weight.

## Addendum (after the first capture)
TAP_AREA pad on "+ Create new" reaches 14px past the 16px text; the label row sat 4px above the Property dropdown, so the pad would cover its top ~10px on touch. The row takes `pointer-coarse:mb-3` (12px) so the pad stays over blank space; a mouse is unchanged.
