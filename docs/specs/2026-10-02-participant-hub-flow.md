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
| In onboarding | `IsDraft`, not `IsActive`, `IntakeCompletedAt` set | Onboarding |
| Active | `!IsDraft` and `IsActive` | Active participants |
| Archived | `!IsDraft` and not `IsActive` | Active participants, Archived view |

Completing the intake moves a participant from the first two to Onboarding. **Completing the profile** (`POST /participants/{id}/complete-profile`,
the Profile wizard's Complete Profile) finalises them and applies the organisation's readiness mode: Warn activates, Enforce does not (no signed
agreement evidence exists yet). The wizard then opens `/participants?tab=active` with a one-off confirmation. The status endpoint cannot be the
step that ends onboarding: it refuses a draft ("Complete their intake and profile first"), and a participant in onboarding is a draft until their
profile is complete.

## Endpoints

| Endpoint | Change |
|---|---|
| `GET /inquiries/onboarding-worklist` | Lists participants in onboarding by the rule above. A participant with no onboarding row (intake completed before completion created one; no migration backfilled it) is listed with a blank checklist. Active, archived and open-intake participants are no longer listed. |
| `GET /inquiries/{id}/onboarding` | Returns the blank checklist for such a participant instead of 404, writing nothing. A participant who is not in onboarding and has no row is still 404. |
| `POST /inquiries/{id}/onboarding/profile-validation`, `.../service-needs-confirmation` | Store the missing row in the same save as the validation. |
| `GET /inquiries` | Also returns drafts with an open intake that no enquiry links: `IsDirectIntake`, `Id` = the participant's id, empty `Source`. The tab lists only open enquiries (New, Draft intake). |

No schema change, no migration.

## Interface

- Enquiries: New / Draft intake only, no filter chips, search kept, "No open enquiries". A direct intake can be resumed, not edited as an enquiry.
- Active participants: Active and Archived views. The Drafts view, its query branch and its row action are gone; an old `?view=drafts` link opens
  Enquiries (the view was never a URL param at the time of the change, so this only catches links from other builds).
- Onboarding and the checklist say that completing the profile finishes onboarding when readiness allows it.

## Known limitation

Under Enforce, Complete Profile finalises a participant who cannot be activated. They are no longer in onboarding and not active, so they are listed
under Archived, where Restore shows the server's evidence message. Keeping them on Onboarding needs a "never activated" marker the data does not
have; decide before Enforce is switched on for an organisation.

## Tests

`ParticipantHubFlowTests` and `ParticipantStagesSqlTests` (backend, including the Npgsql translation of the stage predicates);
`ParticipantsLifecycle.wire.test.tsx` runs the real hub, both wizards and the checklist over an in-memory server with the app's 30 second staleTime:
enquiry, intake in progress, Onboarding, Active (Warn), and the Enforce outcome.
