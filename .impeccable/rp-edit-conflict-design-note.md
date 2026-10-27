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
