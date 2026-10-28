# Design note: three small owner answers (23 Oct meeting): I9, O6, I5

Skills called first: ponytail, impeccable, apple-design. Mode: Operate (office coordinator forms). No new visuals; every change reuses a house component.

## I9 Overnight dropdown (Dropdown variant="form", via OVERNIGHT_SUPPORT_ITEMS + itemsIncludingCurrent)
- What: "Sleepover Support" leaves the Overnight Support options. "Overnight Sleepover" stays.
- Where: intake SupportNeedsStep, profile sharedFieldControls, participant SupportProfileTab edit.
- States:
  - New record or any other stored value: 4 options (None, Active Night, Passive Night, Overnight Sleepover).
  - Existing SleepoverSupport record: the stored value is appended by itemsIncludingCurrent, so the trigger shows "Sleepover Support" (not blank) and saving without a change sends the same value. Choosing another option removes it from the list afterwards.
  - Read-only fact text is unchanged (uses the full label map).
- apple-design: agency/forgiveness (existing data is never silently rewritten), familiarity (same dropdown, same order), restraint (no notice or badge added).

## O6 Footer links (PlatformFooter)
- What: Privacy, Terms, Accessibility open in a new tab (target=_blank, rel=noopener noreferrer) so a half-filled form is not lost.
- Match the status link: it uses a visually hidden " (opens in a new tab)" span and no icon, so add the same span to each. Visible text and the tap area (LINK class) do not change.
- States: public page and form page render the same links; hover/focus/active unchanged; 44px coarse target comes from LINK and is unchanged.
- apple-design: wayfinding (never trap the user), feedback to assistive tech via the sr-only text.

## I5 Intake step "Cultural Considerations" (Card, same heading level)
- What: LGBTIQA+ and Family / Community move from the "Cultural Background" card into a new Card titled "Support considerations", placed between Cultural Background and Information Received. Step name and step list unchanged.
- States: 390 single column, cards stack with --section-gap; 1440 same layout as the neighbouring cards. Cultural Background keeps CALD and Aboriginal/Torres Strait Islander. No empty card.
- apple-design: grouping and mapping (proximity implies relationship), simplicity.
