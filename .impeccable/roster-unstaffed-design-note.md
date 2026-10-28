# Roster: unstaffed shifts are not drafts (design note)

Rule (display only): a chip is "Draft" on screen only when `status === 'Draft' && isFilled`. Nobody on it = the existing dashed neutral Needs staff card.
House pieces reused, nothing new: tray `bg-surface-container-low`, the dashed `[data-shift-box]` (`dashed` prop), the muted italic "Needs staff" label / plus, `TONE.warning.soft` + word "Draft" only for staffed drafts.

| State | Tray | Box | Words | Accessible name / title end |
|---|---|---|---|---|
| unstaffed + Draft | neutral, border-border | dashed, bg-card | Needs staff (participant row / lane plus); no "Draft" | "..., Needs staff" (not "Draft") |
| unstaffed + Published | neutral | dashed | Needs staff | "..., Published" (unchanged) |
| staffed + Draft | warning tint | solid | "Draft" in header | "..., Draft" (unchanged) |
| staffed + Published | neutral | solid | none | "Published" (unchanged) |
| on leave (staffed, Draft or Published) | tint if Draft | dashed + On leave | unchanged | unchanged |
| locked / cancelled | neutral | unchanged | lock words | lock words (unchanged) |

Contexts: staff row (label = participant), participant row (label = staff or "Needs staff"), Unfilled lane (always dashed, staff context) all render through ShiftChip, so one change covers them. Findings marker on an unstaffed Draft is the bare 12px marker (no tint to outrank). Menu keeps "Publish" (status is still Draft; endpoint unchanged). No new motion, no colour: colour still means "needs attention" only for a staffed draft.

## FIX1: Publish week holds unstaffed shifts (owner, 2026-10-28: "Hold until staffed")

Skills read first: ponytail:ponytail, impeccable:impeccable, apple-design. Apple rules used: restraint (no new element, the existing banner/confirm/menu only), feedback that tells the truth (the confirm says what stays back and why), familiarity (an offered action only when it can work), agency (nothing is published that the coordinator has not staffed).

Rule: Publish week acts on staffed Drafts only. An unstaffed Draft stays Draft in the data, shows as Needs staff, and goes out with the next Publish week after someone is put on it.

| State | Banner | Confirm body | Chip menu | Slide-over Status |
|---|---|---|---|---|
| week with staffed + unstaffed Drafts | "N shifts not visible to staff yet", N = staffed Drafts; Publish week button | "N draft shifts go out to staff. The P people on them are notified. U still need(s) staff and stay(s) unpublished until someone is on them/it." | staffed Draft: Edit, Publish, ...; unstaffed Draft: Edit, Assign to..., Delete (no Publish) | Published item hidden while nobody is on the shift |
| only unstaffed Drafts | none (as for 0 drafts today) | not reachable | no Publish | Published hidden |
| only staffed Drafts | unchanged | first two sentences only (no third) | Publish | all three |
| staffed Draft whose worker is Blocking | unchanged (counted, blocked line) | unchanged | Publish (server refuses, as today) | unchanged |
| Published, unstaffed | none | none | no Publish (not a Draft) | Published kept (it is the current value) |

No new colour, motion or component. The third sentence is plain text in the existing ConfirmDialog body; "All published" beside the range still follows the staffed-draft count, as the brief says 0 behaves as today.
