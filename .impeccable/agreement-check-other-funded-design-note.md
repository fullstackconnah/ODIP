# Agreement check: Other-funded participant (design note, written before the first edit)

Skills read first: ponytail (full), impeccable, apple-design. Mode: Operate (wizard task surface), so words and states matter, not new visuals.

## What and where
- Wizard budget bar (`AgreementBudgetBreakdown.tsx`, `status: 'none'` branch) and the footer running total (`RunningTotal.tsx`, `budgetWords`).
- No new component, no new style: the same `NOTE` paragraph the other `none` texts use.

## Words (Bunya Support, plain, says why and what is true)
- Bar: "This participant is funded another way, so there is no NDIS budget to compare the agreement against." Matches #436's vocabulary on the Funding tab ("funded another way").
- Footer: long "no NDIS budget", short "no budget". The old "no budget recorded" would claim something is missing; here nothing is missing.

## States
- loading: unchanged (nothing drawn / "checking").
- failed: unchanged (warning callout, Try again).
- ready: unchanged (the Other-funded server answer never has a budget, so ready is not reachable for it).
- none x4: NotRecorded, PlanEnded, NotStarted keep today's text and action; OtherFunded shows the new text and NO action button. Nothing is recordable (the participant is not on an NDIS plan), so a button would point at a dead end. An unknown reason on the client still falls back to NotRecorded.
- Never a warning tone and never a gate: the check stays a question.

## apple-design rules applied
- Familiarity/consistency: same paragraph style and position as the sibling none texts.
- Agency/simplicity: remove the action that cannot help; one sentence, no jargon.
- Feedback (status kind): the footer short form fits the narrow footer (no truncation of meaning).
- No motion or press changes; reduced-motion unaffected.
