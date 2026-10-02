# Participants hub: one stage per participant

**Status:** implemented on `feat/participant-hub-flow`. **Date:** 2026-10-02. Follows `2026-10-01-participant-data-integrity-fix-a.md`.

## Why

The owner's request: a finished enquiry must move to the Onboarding tab (not stay on Enquiries with an "Open onboarding" button), a participant
whose onboarding is complete must move to Active participants, and the Enquiries filter chips and the register's Drafts view go. Behind it, the
Onboarding tab listed whoever had a `ParticipantOnboarding` row, so it mixed stages and could miss people (below).

## The rule

A participant is in exactly one stage, read from their own flags (`Odip.Api/Services/ParticipantStages.cs`), never from whether an enquiry or an
onboarding row happens to exist:

| Stage | Flags | Shown on |
|---|---|---|
| Enquiry | no participant yet | Enquiries, "New" |
| Intake in progress | `IsDraft` and `IntakeCompletedAt` null | Enquiries, "Draft intake" (with its enquiry, or alone: a direct intake) |
| In onboarding | `IsDraft`, `IntakeCompletedAt` set (`IsActive` is not read for a draft) | Onboarding |
| Active | `!IsDraft` and `IsActive` | Active participants |
| Archived | `!IsDraft` and not `IsActive` | Active participants, Archived view |

A draft's tab follows its intake alone. `IsActive` is not read for a draft: it defaults to true on the entity and drafts made before Create forced it to
false (the seeded demo draft is one) kept it, so asking "not active" as well left such a draft on no tab once its intake was complete.

Completing the intake moves a participant from the first two to Onboarding. **Completing the profile** (`POST /participants/{id}/complete-profile`,
the Profile wizard's Complete Profile) finalises them and, under the organisation's readiness mode, activates them: Warn does; Enforce
needs verified signed-agreement evidence, which does not exist yet, so Complete Profile is refused (see Enforce below). The wizard then opens
`/participants?tab=active` with a one-off confirmation. The status endpoint cannot be the step that ends onboarding: it refuses a draft ("Complete
their intake and profile first"), and a participant in onboarding is a draft until their profile is complete.

## Endpoints

| Endpoint | Change |
|---|---|
| `GET /inquiries/onboarding-worklist` | Lists participants in onboarding by the rule above. A participant with no onboarding row (intake completed before completion created one; no migration backfilled it) is listed with a blank checklist. Active, archived and open-intake participants are no longer listed. |
| `GET /inquiries/{id}/onboarding` | Returns the blank checklist for such a participant instead of 404, writing nothing. A participant who is not in onboarding and has no row is still 404. |
| `POST /inquiries/{id}/onboarding/profile-validation`, `.../service-needs-confirmation` | Store the missing row in the same save as the validation. If a concurrent request stored it first (the unique index on the participant rejects the second insert), the loser reloads that row and records the step on it, instead of answering 500. |
| `POST /participants/{id}/complete-profile` | Refuses with 400 ("This participant cannot be activated until their signed service agreement evidence is recorded.", the status endpoint's wording) when the participant is a draft that is not already active and the readiness mode does not allow activation; `IsDraft` stays true. Otherwise as before. |
| `GET /inquiries` | Also returns drafts with an open intake that no enquiry links: `IsDirectIntake`, `Id` = the participant's id, empty `Source`. The tab lists only open enquiries (New, Draft intake). |

No schema change, no migration.

## Interface

- Enquiries: New / Draft intake only, no filter chips, search kept, "No open enquiries". A direct intake can be resumed, not edited as an enquiry.
- Active participants: Active and Archived views. The Drafts view, its query branch and its row action are gone. (The view was component state,
  never a URL param, so nothing needed to redirect.)
- Onboarding and the checklist say that completing the profile finishes onboarding when readiness allows it. The checklist has a Complete profile
  button (a link to the Profile wizard) whenever the participant is a draft with the intake complete, so no gate state leaves nothing that ends
  onboarding; its gate action is "Validate profile data", not to be mistaken for the wizard's Complete Profile.

## Enforce

Under Enforce, finalising a draft that cannot be activated would leave it in no stage: not in onboarding, not active, and "Archived" is wrong for someone never
activated. So Complete Profile is refused for it (above); it stays a draft on Onboarding, where the checklist's agreement-evidence gate says why, and the
Profile wizard shows the server's message. A draft that is already marked active has nothing to activate and is finalised as before.

Not changed here: a participant activated under Warn whose organisation later switches to Enforce is active but not strict-ready, so the operational register
excludes them from the Active tab, and they are not in onboarding. They are on no tab until evidence exists; decide before Enforce is switched on.

## Tests

`ParticipantHubFlowTests` and `ParticipantStagesSqlTests` (backend, including the Npgsql translation of the stage predicates);
`ParticipantsLifecycle.wire.test.tsx` runs the real hub, both wizards and the checklist over an in-memory server with the app's 30 second staleTime:
enquiry, intake in progress, Onboarding, Active (Warn), and the Enforce outcome.
