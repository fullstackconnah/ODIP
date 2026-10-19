# Roster unassigned counter — design note

Recorded before implementation, 2026-10-19 UTC.

- Surface: retain the existing compact participant-row coverage badge and its existing warning/check states; no layout or toolbar redesign.
- Meaning: show the number of actual shifts satisfying `isUnfilledShift`, never empty days or rendered grid cells. Reuse the predicate so its established missing/null/empty `staffId` semantics remain authoritative.
- States: zero actual unassigned shifts uses the existing success badge; one/many uses the existing warning badge with accessible singular/plural copy; the existing whole-empty-week suppression, focus, hover, touch, and responsive layout remain unchanged.
- No new cancellation or non-working policy: this UI counts exactly the shifts supplied by the board under the predicate.
