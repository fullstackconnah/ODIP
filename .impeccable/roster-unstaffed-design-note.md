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
