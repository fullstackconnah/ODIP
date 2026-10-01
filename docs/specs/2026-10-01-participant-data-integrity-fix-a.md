# Participant data integrity (code review round 2, section A)

**Status:** implemented on `fix/participant-data-integrity`. **Date:** 2026-10-01.

## Why

`PUT /participants/{id}` is a full replace: it assigns every column from the DTO. Several screens only own part of a participant and sent
partial objects to it, so each of them could wipe what it did not show. Production data shows nothing was destroyed yet (the paths were
latent or unreachable), which is why this is a contract fix and not a data repair.

## The rule

**No screen calls `PUT /participants/{id}`.** Each writes through an endpoint that carries its change and nothing else. The scope is
decided on the server (an allow-list), not by what the client chooses to send, so the next screen that forgets a field cannot wipe it.
`PUT /participants/{id}` stays for API clients and is hardened (below). Why not a field-presence (true partial) contract: the DTO has
about 170 fields, the existing `PATCH` groups cannot express the intake scope (the `personalDetails` group carries middle name, gender,
place of birth and country, which the Intake wizard does not own), and an allow-list per screen is the smaller blast radius.

## Endpoints

| Endpoint | Caller | Writes | Notes |
|---|---|---|---|
| `POST /participants/{id}/status` `{ isActive, reason? }` | hub Change status | `IsActive` | Admin/Coordinator/SuperAdmin. One audit row; the reason rides on it (`AuditInterceptor.ReasonItemKey`). A draft cannot be activated; activation uses `ParticipantReadiness.MayActivateAsync` (Enforce needs evidence). Omitted flag is a 400. Answers `{ id, isActive, isDraft, changed, warnings[] }`: archiving warns about upcoming shifts, live patterns and trip bookings and cancels none of them; activating lists readiness gaps. |
| `POST /participants/{id}/restore` | hub Archived view | `IsActive` | Same rules as status with `isActive: true`; touches no other field. |
| `PUT /participants/{id}/intake` | Intake wizard, resuming | the intake scope | Body is the wizard payload (same shape as POST). Writes exactly `ParticipantIntakeSnapshotService.IntakeScopeFieldNames` (the list the immutable intake evidence is built from; a reflection test holds the two together). Never reads or changes `IsDraft`/`IsActive`. Creates the contacts and risk entries in the payload that the participant does not have (exact duplicates skipped, everything validated before anything is written). Keeps the linked enquiry's name and contact details in step. Drops a stale onboarding attestation when identity changes. Idempotent on `completionRequestId`. |
| `POST /participants/{id}/complete-profile` | Profile wizard, Complete Profile | `IsDraft` (and activation per readiness) | Carries no profile field; each step is saved by its own PATCH. Idempotent. Finalises a draft whose intake is complete (400 otherwise). Never reactivates an archived participant. |
| `POST /participants` | Intake wizard, creating | new row | Unchanged, except a replay with a completion request id that already has intake evidence returns the first participant (HTTP 200) instead of creating a second participant, PDF and onboarding row. |
| `GET /participants?search=` | hub search | | Case-insensitive on Npgsql (both sides lower-cased). |
| `GET /inquiries` | Enquiries tab | | Rows gain `participantIsDraft`, `participantIsActive`, `participantIntakeCompletedAt`. |
| `POST/PUT /inquiries` | enquiry form | | A blank email is valid and stored as null; blank phone and provenance are stored as null. |

`PUT /participants/{id}` (full replace) hardening: it never turns a finalised participant into a draft (a legacy participant with a NULL
`IntakeCompletedAt` stays non-draft), and "intake complete" is now an explicit precondition of its implicit activation.

## Interface notes

- The participants tab of the hub has Active / Drafts / Archived views and a server-side search; Archived is not narrowed by the onboarding
  stage rule. Drafts lists every `isDraft=true` participant, including drafts saved from the wizard that have no onboarding row.
- The status dialog stays open until the server answers and shows its message; a saved change shows a notice with the warnings.
- The Enquiries tab shows New / Draft intake / Intake complete / Participant and offers the next step that is real.
- Wizards, the enquiry form and the participant detail lists distinguish loading, failed (with retry) and empty; "none recorded" only
  follows a request that succeeded.

## Not done (follow-ups)

- L2-11: the immutable intake PDFs (`useParticipantIntakeSnapshots`, `useDownloadParticipantIntakeSnapshotPdf`) have no screen since the
  intake form that listed them was removed. The API and hooks are intact; the list needs a home on the participant or onboarding page.
- L1-14: no way to archive or delete a mistaken enquiry or a draft (`DELETE` is a no-op on a draft).
- L1-06: a service-agreement draft the server accepts (agreement outliving the plan) can never satisfy "Confirm service needs".
- L1-13: check-then-insert races (a concurrent identical create can pass the idempotency lookup; no unique index was added because a
  migration that fails on historic duplicate request ids would stop the API starting).
- Participants archived after going through onboarding still show on the Onboarding tab as "Onboarding incomplete" (it never drops a row).
- Enforce mode: a legacy participant (NULL `IntakeCompletedAt`) fails the strict gate; unchanged by this work.
