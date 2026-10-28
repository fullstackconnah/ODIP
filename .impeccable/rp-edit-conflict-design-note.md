# Design note: restrictive practice edit conflict (written before the frontend edit, 2026-10-28)

Skills loaded first: ponytail:ponytail (full), impeccable:impeccable, apple-design.

- **What:** when a save is refused because someone else changed the entry (HTTP 409), the Edit modal says so. No new UI element.
- **Where:** RestrictivePracticesTab.tsx, the existing Edit modal (house `Modal`), in its existing `<Callout tone="error">` at the top of the body, fed by `modalError` through `extractErrorMessage`.
- **Copy (owner-side decision 3):** "Someone else just changed this entry. Close it and open it again to see their changes." Plain, says what happened and the one next step; no product name, no em dash, no "Reload" (the modal has no reload button).
- **States:**
  - 409: modal stays open, typed values stay (nothing resets the form), Callout shows the sentence, Save re-enables (a second Save re-sends the stale version and gets the same safe 409). The list is refetched in the background so closing and reopening carries the new version.
  - Other errors (400, 500, network): unchanged, their own message in the same Callout.
  - Loading, saving, focus, hover, touch, empty: unchanged (house Button/Modal/FormField; 44 px touch targets stay).
  - Older open tab without a version: server saves as before.
- **apple-design rules applied:** restraint and purpose (no new element, reuse the error feedback kind); agency and forgiveness (typed work is never thrown away, user decides when to reopen); simplicity (one clear sentence); the refetch is silent, no motion added so reduced-motion needs nothing.

## FIX1 (2026-10-28)

Skills loaded first: ponytail:ponytail (full), impeccable:impeccable, apple-design. (Written after the first FIX1 edit to RestrictivePracticesTab.tsx, not before: a process miss, reported.)

- **What:** a refused save is now seen and the 409 is a warning, not an error. Same Callout, same place (top of the Edit modal body); no new element.
- **Refusal scrolls and focuses:** the Callout sits in a focusable wrapper (`tabIndex=-1`, `scroll-mt-4`, no outline), keyed on a refusal counter. Every failed save scrolls it into view and moves focus to it, so at 390 a user who changed a field below the fold is not left looking at an unchanged Save button. The key re-mounts the Callout, so a repeat Save is announced again. Follows SectionEditPanel.
- **Tone:** 409 only is `warning` (someone else changed it; the sibling conflict surfaces, SectionEditPanel and the agreement draft, do the same). 400, 500 and network errors stay `error` with today's words. Both tones are `role="alert"`, so announcement is unchanged.
- **Copy (owner-side decision):** "Someone else just changed this entry, so your changes weren't saved. Close it and open it again to see theirs." It now states the outcome, not only the next step.
- **States:** typed values stay, modal stays open, Save re-enables, list refetches silently; light and dark use the house warning-container tokens; touch targets unchanged (44 px).
- **apple-design rules applied:** feedback must be seen where the user is looking (response and wayfinding); agency and forgiveness (typed work kept); restraint (no recovery button, no motion added, so reduced-motion needs nothing); the focus move is instant, with no animation.
