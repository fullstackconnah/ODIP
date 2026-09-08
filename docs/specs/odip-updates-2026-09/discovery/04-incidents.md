# Discovery: Incident Reporting + Medication Witness Approval

Scope: map the current incident form, its backend, the incident↔medication link, and the
medication witness-approval mechanism (the pattern to copy), to spec a rewrite of the incident
form into a wizard.

---

## 1. Current incident form — `frontend/src/pages/IncidentCreatePage.tsx`

Single reusable component for both create (`/incidents/new`) and edit (`/incidents/:id/edit`),
`IncidentCreatePage.tsx:105-108`. **Not currently a wizard** — one long page, a `<form>` wrapped
in `grid md:grid-cols-2 gap-6` (`IncidentCreatePage.tsx:399`), split into `Card`-titled sections
rendered top to bottom:

1. **Incident Details** (`:401-463`) — Title, Service Type, conditional Trip select, Incident
   Type, conditional "Specify" field, Severity, Date & Time, Location.
2. **People Involved** (`:469-500`) — Reported By, Involved Participant, Involved Staff Member.
3. **Restrictive Practice Details** (`:503-604`, only when `incidentType === 'RestrictivePracticeUse'`)
   — RP Type, conditional "Link to an authorised practice" dropdown, and a live/frozen
   authorised-vs-unauthorised banner.
4. **What Happened** (`:607-625`) — Description, Immediate Actions Taken, Were Emergency
   Services Called (checkbox), conditional Emergency Services Details.
5. **Witnesses** (`:628-636`) — Witness Names (free text), Witness Statements (free text).
6. **Review & Compliance** (`:639-715`, edit-only) — Status, QSC Reporting Status, QSC
   Reference Number, QSC Reported At, Reviewed By, Review Notes, Corrective Actions, Family
   Notified (+ at), Support Coordinator Notified (+ at).

### Full field inventory

| Field | Control | Required? | Notes |
|---|---|---|---|
| `title` | `input` (`register`) | yes | autofocus |
| `serviceType` | native `select` | yes (has default `None`) | reveals Trip select when `Trip` |
| `tripInstanceId` | native `select` | conditionally (superRefine) | only rendered when serviceType===Trip |
| `incidentType` | native `select`, 11 hardcoded `<option>`s | yes | drives 3 other conditional blocks |
| `otherTypeSpecify` | `input` | conditionally (when Other) | |
| `restrictivePracticeType` | `Dropdown` (not register-bound; `useWatch`+`setValue`) | conditionally (when RestrictivePracticeUse) | |
| `restrictivePracticeId` | `Dropdown` | no | filtered to matching-type active practices of involved participant |
| `severity` | native `select` (Low/Medium/High/Critical) | yes | |
| `incidentDateTime` | `input type="datetime-local"` | yes | |
| `location` | `input` | no | |
| `reportedByStaffId` | `SearchableSelect` | yes | staff list |
| `involvedParticipantId` | `SearchableSelect` | no | participants, `isDraft:false` |
| `involvedStaffId` | `SearchableSelect` | no | staff list |
| `description` | `textarea` | yes | |
| `immediateActionsTaken` | `textarea` | no | |
| `wereEmergencyServicesCalled` | checkbox | no | |
| `emergencyServicesDetails` | `textarea` | conditionally shown | |
| `witnessNames` | `input` | no | free text, comma-separated |
| `witnessStatements` | `textarea` | no | free text |
| `status` | native `select`, edit-only | no | Draft/Submitted/UnderReview/Escalated/Resolved/Closed |
| `qscReportingStatus` | native `select`, edit-only | no | NotRequired/Required/ReportedWithin24h/ReportedLate/Pending |
| `qscReferenceNumber` | `input`, edit-only | no | |
| `qscReportedAt` | `datetime-local`, edit-only | no | |
| `reviewedByStaffId` | `SearchableSelect`, edit-only | no | |
| `reviewNotes` | `textarea`, edit-only | no | |
| `correctiveActions` | `textarea`, edit-only | no | |
| `familyNotified` / `familyNotifiedAt` | checkbox + conditional datetime, edit-only | no | |
| `supportCoordinatorNotified` / `supportCoordinatorNotifiedAt` | checkbox + conditional datetime, edit-only | no | |

**Note on Witnesses**: the incident form's own "Witnesses" section (`witnessNames`,
`witnessStatements`) is unrelated to the medication witness-approval mechanism in §4 below — it's
just two free-text fields with no entity, no user link, no approval flow. This is the gap the
wizard rewrite is presumably meant to close by reusing the medication pattern.

### Zod schema — `IncidentCreatePage.tsx:41-86`

```ts
const incidentSchema = z.object({
  serviceType: z.string().optional(),
  tripInstanceId: z.string().optional(),
  incidentType: z.string().min(1, 'Incident type is required'),
  otherTypeSpecify: z.string().optional(),
  restrictivePracticeType: z.string().optional(),
  restrictivePracticeId: z.string().optional(),
  severity: z.string().min(1, 'Severity is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  reportedByStaffId: z.string().min(1, 'Reporter is required'),
  incidentDateTime: z.string().min(1, 'Date/time is required'),
  location: z.string().optional(),
  participantBookingId: z.string().optional(),
  involvedParticipantId: z.string().optional(),
  involvedStaffId: z.string().optional(),
  immediateActionsTaken: z.string().optional(),
  wereEmergencyServicesCalled: z.boolean().optional(),
  emergencyServicesDetails: z.string().optional(),
  witnessNames: z.string().optional(),
  witnessStatements: z.string().optional(),
  // Edit-only fields
  status: z.string().optional(),
  qscReportingStatus: z.string().optional(),
  qscReferenceNumber: z.string().optional(),
  qscReportedAt: z.string().optional(),
  reviewedByStaffId: z.string().optional(),
  reviewNotes: z.string().optional(),
  correctiveActions: z.string().optional(),
  familyNotified: z.boolean().optional(),
  familyNotifiedAt: z.string().optional(),
  supportCoordinatorNotified: z.boolean().optional(),
  supportCoordinatorNotifiedAt: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.serviceType === 'Trip' && !data.tripInstanceId) { ... }
  if (data.incidentType === 'Other' && !data.otherTypeSpecify?.trim()) { ... }
  if (data.incidentType === 'RestrictivePracticeUse' && !data.restrictivePracticeType) { ... }
})
```
Uses a hand-rolled `Resolver` (`:94-103`) instead of `zodResolver` because the installed
`@hookform/resolvers` v3 is incompatible with zod v4's dropped `.errors` getter — same workaround
pattern as `ParticipantCreatePage`.

### Submit handler — `IncidentCreatePage.tsx:288-357`
Builds a `CreateIncidentDto`/`UpdateIncidentDto`, calls `useCreateIncident`/`useUpdateIncident`
(`frontend/src/api/hooks/incidents.ts:40-62`), and on success:
- Resets the dirty flag (`flushSync(() => reset(data))`, avoids the unsaved-changes prompt
  firing during navigation) and navigates to `/incidents`.
- If this submission came from a shift-note prefill (`shiftNotePrefill` truthy), fires a
  fire-and-forget `apiPost('/portal/notes/{id}/acknowledge-flags')` (errors swallowed —
  never blocks/`fails` the incident submission).

### Prefill sources (client-side only, nothing persisted until submit)
- **MAR prefill** (INC-03, `:119-124`, `:244-263`) — arrives via router `location.state` from
  `RecordAdministrationModal`'s "Report as incident" button. See §3.
- **Shift-note prefill** (NOTES-02, `:126-130`, `:268-286`) — arrives via router state from the
  portal's `ShiftNotesSection` "file an incident report" banner action.

### Tests — `IncidentCreatePage.test.tsx`
694 lines, organized by requirement tag:
- **INC-01** service type / trip linkage (conditional Trip dropdown, submit blocked without a
  trip when Trip is selected).
- **INC-02** "Other" incident type specify field (shown by default since `incidentType` defaults
  to `'Other'`; blocks submit if empty).
- **INC-03** MAR drop-into-draft prefill — banner text, field population, and a same-name-
  different-id regression test proving `reportedByStaffId` is resolved by id only, never by
  name-matching (`recordedByUserId`, never `recordedByName` fallback).
- **NOTES-02** shift-note prefill acknowledges flags on submit (fire-and-forget, tolerant of
  failure).
- **INC-04** RP incident authorisation determination (live preview on create, frozen banner on
  edit that never recomputes even if fields change).
- **INC-05** link to an authorised practice (filtered by type, prefills empty description only,
  never overwrites typed text).
- **UX-01** SearchableSelect keyboard-only smoke tests for the four staff/participant pickers.

---

## 2. Incident backend

### Entity — `backend/Odip.Domain/Entities/IncidentReport.cs`
Full field list (see file for XML docs): `Id`, `ServiceType` (`ServiceStreams`, default `None`),
`TripInstanceId`/`TripInstance`, `ParticipantBookingId`/`ParticipantBooking`,
`InvolvedParticipantId`/`InvolvedParticipant`, `InvolvedUserId`/`InvolvedUser`,
`ReportedByUserId`/`ReportedByUser` (required), `IncidentType`, `OtherTypeSpecify`,
`RestrictivePracticeType?`, `RestrictivePracticeId?`/`RestrictivePractice?`,
`IsRestrictivePracticeAuthorised: bool?` (computed once at Create, frozen forever — see doc
comment `:62-74`), `Severity`, `Status` (default `Draft`), `Title`, `Description`,
`IncidentDateTime`, `Location`, `ImmediateActionsTaken`, `WereEmergencyServicesCalled`,
`EmergencyServicesDetails`, `WitnessNames`, `WitnessStatements` (both plain strings — no entity,
no user link — this is the gap vs. §4), `QscReportingStatus` (default `NotRequired`),
`QscReportedAt`, `QscReferenceNumber`, `ReviewedByUserId`/`ReviewedByUser`, `ReviewedAt`,
`ReviewNotes`, `CorrectiveActions`, `ResolvedAt`, `FamilyNotified`/`FamilyNotifiedAt`,
`SupportCoordinatorNotified`/`SupportCoordinatorNotifiedAt`, `IsActive` (default true, used as a
soft-delete flag), `CreatedAt`, `UpdatedAt`.

### Controller — `backend/Odip.Api/Controllers/IncidentsController.cs`, route `api/v1/incidents`
| Verb + route | Auth | Purpose |
|---|---|---|
| `GET /incidents` | any authenticated | list, filters: `tripId`, `status`, `severity`, `qscStatus`, `isActive` (`:107-155`) |
| `GET /incidents/{id:guid}` | any authenticated | detail (`:157-225`) |
| `POST /incidents` | `Admin,Coordinator,SupportWorker,SuperAdmin` | create (`:227-317`) |
| `PUT /incidents/{id:guid}` | `Admin,Coordinator,SuperAdmin` | update (`:319-414`) |
| `DELETE /incidents/{id:guid}` | `Admin,Coordinator,SuperAdmin` | soft delete, sets `IsActive=false` (`:416-426`) |
| `GET /incidents/trip/{tripId:guid}` | any authenticated | incidents for a trip (`:428-461`) |
| `GET /incidents/overdue-qsc` | any authenticated | QSC-required, unreported, >24h old (`:463-498`) |

Validation helpers (`:26-105`): `IsValidUserRefAsync`, `IsValidTripRefAsync`,
`ValidateServiceTypeAndIncidentType` (mirrors the frontend superRefine — Trip needs a trip id,
Other needs specify text, RestrictivePracticeUse needs an RP type),
`ValidateRestrictivePracticeLinkAsync` (INC-05 FK check: linked practice must belong to the
involved participant and match the selected type), `DetermineRestrictivePracticeAuthorisationAsync`
(INC-04, called only from `Create`, never `Update`).

**QSC auto-escalation** (`Create`, `:276-286`): `QscReportingStatus` is auto-set to `Required`
when `Severity == Critical`, OR `IncidentType` is in `QscRequiredTypes` (`Abuse, Neglect, Death,
RestrictivePracticeUse, MissingPerson`, `:20-24`), OR the RP authorisation determination came back
`false` (unauthorised). This is the only "escalation"/reportable-incident logic in the backend —
still just a status field, no notification is sent.

### DTOs, verbatim — `backend/Odip.Application/DTOs/DTOs.cs:1938-1986`
```csharp
public record CreateIncidentDto
{
    public ServiceStreams ServiceType { get; init; } = ServiceStreams.None;
    public Guid? TripInstanceId { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? InvolvedParticipantId { get; init; }
    public Guid? InvolvedStaffId { get; init; }
    [Required]
    public Guid ReportedByStaffId { get; init; }
    public IncidentType IncidentType { get; init; }
    [StringLength(500)]
    public string? OtherTypeSpecify { get; init; }
    public RestrictivePracticeType? RestrictivePracticeType { get; init; }
    public Guid? RestrictivePracticeId { get; init; }
    public IncidentSeverity Severity { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    [Required, StringLength(10000, MinimumLength = 1)]
    public string Description { get; init; } = string.Empty;
    public DateTime IncidentDateTime { get; init; }
    [StringLength(300)]
    public string? Location { get; init; }
    [StringLength(4000)]
    public string? ImmediateActionsTaken { get; init; }
    public bool WereEmergencyServicesCalled { get; init; }
    [StringLength(2000)]
    public string? EmergencyServicesDetails { get; init; }
    [StringLength(1000)]
    public string? WitnessNames { get; init; }
    [StringLength(4000)]
    public string? WitnessStatements { get; init; }
}

public record UpdateIncidentDto : CreateIncidentDto
{
    public IncidentStatus Status { get; init; }
    public QscReportingStatus QscReportingStatus { get; init; }
    public DateTime? QscReportedAt { get; init; }
    public string? QscReferenceNumber { get; init; }
    public Guid? ReviewedByStaffId { get; init; }
    public string? ReviewNotes { get; init; }
    public string? CorrectiveActions { get; init; }
    public bool FamilyNotified { get; init; }
    public DateTime? FamilyNotifiedAt { get; init; }
    public bool SupportCoordinatorNotified { get; init; }
    public DateTime? SupportCoordinatorNotifiedAt { get; init; }
}
```
`IncidentListDto`/`IncidentDetailDto` mirror `frontend/src/api/types/incidents.ts:7-67`
(reported in §1's field table plus display-only names/dates).

### Enums, verbatim — `backend/Odip.Domain/Enums/Enums.cs`
```csharp
public enum IncidentType { Injury, Illness, MedicationError, BehaviourOfConcern,
    RestrictivePracticeUse, PropertyDamage, MissingPerson, Abuse, Neglect, Death, Other }

public enum IncidentSeverity { Low, Medium, High, Critical }

public enum IncidentStatus { Draft, Submitted, UnderReview, Escalated, Resolved, Closed }

public enum QscReportingStatus { NotRequired, Required, ReportedWithin24h, ReportedLate, Pending }

public enum RestrictivePracticeType { Seclusion, ChemicalRestraint, MechanicalRestraint,
    PhysicalRestraint, EnvironmentalRestraint, Unclassified }
```
`ServiceStreams` (`[Flags]`, `:610-620`): `None=0, STA=1, BSP=2, InHomeSupport=4, Trip=8,
HIDPA=16, CommunityAccessDailyLiving=32, CommunityNursing=64`. The incident form's service-type
picker is single-select over this flags enum plus `'None'` (`IncidentServiceType = ServiceStream
| 'None'`, `frontend/src/api/types/incidents.ts:5`).

### Status/workflow "state machine"
`IncidentStatus` (Draft→Submitted→UnderReview→Escalated→Resolved→Closed) is **not enforced** as a
state machine anywhere — the Update endpoint accepts any `IncidentStatus` value with no transition
guard. The only status-linked side effects: `ResolvedAt` is stamped the first time `Status`
becomes `Resolved` (`:379-380`), and `ReviewedAt` is stamped the first time `ReviewedByStaffId` is
set (`:383-384`). Similarly `QscReportingStatus` has no transition guard — the UI just offers all
5 values in a plain select (`IncidentCreatePage.tsx:654-660`).

---

## 3. Incident ↔ medication automated workflow

**There is no backend link between medications and incidents.** Confirmed by grep: neither
`IncidentsController.cs`/`IncidentReport.cs` reference `Medication`, nor does
`MedicationsController.cs` reference `Incident`. The "automated workflow" is entirely a
**frontend, client-side prompt/prefill hand-off** — nothing is persisted linking the two records;
an incident this flow starts is exactly as manually-submitted as any other, once submitted.

### The trigger — `frontend/src/pages/medications/RecordAdministrationModal.tsx`
After a medication administration is recorded with an outcome of `Refused`, `Withheld`,
`Missed`, or `WrongMedication` (the 4 non-`Administered` outcomes, `:43-46`), the modal saves the
administration as normal, then re-purposes itself into a "Report as incident?" prompt
(`savedTriggerAdministration` state, `:128`, modal title/footer at `:317-345`) offering **Not
now** (`dismissIncidentPrompt`, `:157-160`, just closes — no ghost draft) or **Report as incident**
(`goToIncident`, `:162-184`) — gated behind `canCreateIncidents` permission (only staff with
incident-create rights see the second button; others just get a dismiss).

`goToIncident` (`:162-184`) builds a `MarIncidentPrefillState` object (source, outcome,
participant id/name, medication name/strength/dose, scheduled/administered timestamps + tz,
`recordedByName`/`recordedByUserId`, reason, notes (only for `WrongMedication`), trip instance
id) and does `navigate('/incidents/new', { state: prefill })`. `IncidentCreatePage` reads this
via `isMarIncidentPrefillState(location.state)` (`frontend/src/lib/incidentPrefill.ts`) and
skeleton-fills title/description/type/severity/participant/reporter/datetime
(`IncidentCreatePage.tsx:244-263`) — see §1's INC-03 test coverage for the "never resolve
reportedByStaffId by name" integrity rule.

### Second (unrelated) trigger — flagged shift notes, NOTES-02
`frontend/src/pages/portal/components/ShiftNotesSection.tsx` shows a banner on a shift note
carrying `flaggedCategories` (unacknowledged, `:224`) with a "file an incident report" action;
same router-state hand-off pattern (`ShiftNoteIncidentPrefillState`), mutually exclusive with the
MAR prefill. Not medication-specific (categories can be e.g. Falls), included here since it's the
only other incident-triggering prefill and shares the same wizard-relevant plumbing.

### Notification/escalation/reportable-incident logic
Nothing beyond the QSC auto-`Required` status bump described in §2 — there is no email/push
notification, no dashboard alert beyond `GET /incidents/overdue-qsc` (a pull query the
`useOverdueQscIncidents` hook, `frontend/src/api/hooks/incidents.ts:33-38`, presumably surfaces on
a dashboard) and no automated escalation once `QscReportingStatus` is `Required`.

---

## 4. Medication witness approval (the pattern to copy)

This is a real, persisted, cross-user approval workflow — unlike the incident form's own
free-text "Witnesses" fields (§1/§2).

### How a witness is nominated
At administration-record time, in `RecordAdministrationModal.tsx` (**not** on
`MedicationFormPage.tsx` — that page only sets the medication's `isHighRisk` flag,
`ParticipantMedication.cs:65`, `MedicationsController.cs:92,160`). When
`isHighRisk && status === 'Administered'` (`requiresWitness`, `:132`), the form shows a required
**Witness** `SearchableSelect` of staff (`:453-458`, hint: "select the staff member who witnessed
this dose. They will need to approve it in their portal."). Validation blocks self-witnessing
(`:212-213`, mirrored server-side at `MedicationsController.cs:372-373`).

### How the approval request reaches the other user
Purely a database write + a pull-based portal page — no push notification/email. On
`POST /api/v1/medications/{id}/administrations` (`MedicationsController.cs:329-437`), if
`dto.WitnessStaffId` resolves to an active user, the new `MedicationAdministration` row is created
with `WitnessUserId` set, `WitnessStatus = Pending`, `WitnessRequestedAt = UtcNow`
(`:424-427`). The nominated witness discovers it by visiting
`/portal` → **Witness approvals** (`PortalWitnessApprovalsPage.tsx`), which polls
`GET /api/v1/portal/witness-requests` every 60s (`usePendingWitnessRequests`,
`frontend/src/api/hooks/portal.ts:60-66`).

### Entity fields — `backend/Odip.Domain/Entities/MedicationAdministration.cs`
```csharp
public string? WitnessName { get; set; }           // display name, backward-compat / legacy free text
public Guid? WitnessUserId { get; set; }            // the nominated witness — only they may respond
public User? WitnessUser { get; set; }
public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
public DateTime? WitnessRequestedAt { get; set; }
public DateTime? WitnessRespondedAt { get; set; }   // "approved-at" equivalent, set on either response
```
No statement-text field — approve/decline is a pure state transition, no comment captured (the
confirm dialog on decline just re-states "confirm you did NOT witness..." as UI copy, not
persisted, `PortalWitnessApprovalsPage.tsx:141`).

`WitnessStatus` enum (`Enums.cs:527-533`): `NotRequired, Pending, Approved, Declined`.
`NotRequired` covers both "not high-risk" and the legacy free-text-only path (nothing to
approve). `Pending` is set the instant a witness user is selected; only that user can move it to
`Approved`/`Declined`.

### Endpoints — `backend/Odip.Api/Controllers/PortalController.cs`
| Verb + route | Scoping | Purpose |
|---|---|---|
| `GET /api/v1/portal/witness-requests` | caller's own, via resolved user id | list caller's `Pending` requests (`:279-298`) |
| `POST /api/v1/portal/witness-requests/{id}/approve` | caller must be the named `WitnessUserId` | → `Approved` (`:307-309`) |
| `POST /api/v1/portal/witness-requests/{id}/decline` | same | → `Declined` (`:311-313`) |

Shared handler `RespondToWitnessRequestAsync` (`:315-337`): 404s identically whether the id
doesn't exist, belongs to someone else, or the caller has no linked identity (documented
anti-enumeration pattern, class doc `:15-33`); 400s if already responded to
(`WitnessStatus != Pending`). On success sets `WitnessStatus`, `WitnessRespondedAt = UtcNow`,
`UpdatedAt`.

`GetWitnessRequests` query (`:283-292`): `_db.MedicationAdministrations.Include(Participant).
Include(ParticipantMedication).Where(a => a.WitnessUserId == staffId && a.WitnessStatus ==
Pending).OrderBy(a => a.CreatedAt)`.

Response DTO, verbatim — `backend/Odip.Application/DTOs/PortalDTOs.cs:126-138`:
```csharp
public record PortalWitnessRequestDto(
    Guid Id,
    Guid ParticipantId,
    string ParticipantName,
    Guid MedicationId,
    string MedicationName,
    string? Strength,
    string DoseDescription,
    string? DoseGiven,
    string RecordedByName,
    DateTime? AdministeredAt,
    string? AdministeredAtTimeZone,
    WitnessStatus WitnessStatus,
    DateTime? WitnessRespondedAt,
    DateTime CreatedAt);
```
Mapped in `ToWitnessRequestDto` (`PortalController.cs:415-420`). Deliberately minimal — "no full
clinical/consent detail" per its doc comment.

### Frontend UI for a pending approval — `frontend/src/pages/portal/PortalWitnessApprovalsPage.tsx`
Full page (148 lines) at presumably `/portal/witness-approvals` (route not explicitly grepped but
linked from `/portal`). Renders a card per pending request (medication+strength, participant+dose,
"Recorded by X · <datetime formatted in the recording tz>"), with **Decline** (opens a
`ConfirmDialog`, `:136-145`) and **Approve** (`handleApprove`, immediate) buttons, 44px min
touch targets, skeleton loading state, and empty/error `EmptyState`s. Approve/decline call
`useApproveWitnessRequest`/`useDeclineWitnessRequest` (`frontend/src/api/hooks/portal.ts:68-82`),
which invalidate the `portal-witness-requests` query key on success.

### Where a user sees their pending witness requests
Only `PortalWitnessApprovalsPage` (linked from `/portal` "My Shifts", per its own back-link at
`:66-68`) — no badge/count elsewhere was found in this pass (worth a follow-up grep on `AppLayout`
for a nav badge if the wizard needs one for incident witness requests too).

---

## 5. Restrictive practices data (for listing on the incident wizard)

Hook — `frontend/src/api/hooks/restrictive-practices.ts:8-17`:
```ts
export function useRestrictivePractices(participantId: string | undefined, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['restrictive-practices', participantId, includeInactive ?? false],
    queryFn: () =>
      apiGet<RestrictivePracticeDto[]>(`/participants/${participantId}/restrictive-practices`, {
        includeInactive: includeInactive ?? undefined,
      }),
    enabled: !!participantId,
  })
}
```
Defaults to active-only (matches what INC-04/INC-05 need). DTO —
`frontend/src/api/types/restrictive-practices.ts:20-33`:
```ts
export interface RestrictivePracticeDto {
  id: string
  participantId: string
  type: RestrictivePracticeType
  description: string
  authorisedBy: string | null
  authorisationDate: string | null
  reviewDate: string | null            // "YYYY-MM-DD"; past date = overdue in UI
  relatedMedicationId: string | null
  relatedMedicationName: string | null // only meaningful when type === 'ChemicalRestraint'
  isActive: boolean
  createdAt: string
  updatedAt: string
}
```

---

## 6. Participant / staff pickers

**No dedicated `ParticipantPicker`/`StaffPicker` component exists** (grepped, zero matches). The
one generic, reusable searchable-combobox component is:

`frontend/src/components/SearchableSelect.tsx` — props (`:10-56`):
```ts
export type SearchableSelectItem = DropdownItem   // { value: string; label: string; description?: string }
export type SearchableSelectProps = {
  items: SearchableSelectItem[]
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
  noMatchMessage?: string
  className?: string
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: string
  'aria-invalid'?: string
  'aria-describedby'?: string
}
```
It's a generic value/label list combobox — callers (e.g. `IncidentCreatePage.tsx:471-476`) map
`useParticipants()`/`useStaff()` results into `items` themselves each time. There's a documented
convention (referenced in `IncidentCreatePage.tsx:466-468`, "see components/README.md 'Picking a
picker'") for when to use `SearchableSelect` (unbounded/large sets — participants, staff) vs. the
plain `Dropdown` (small bounded sets — e.g. RP register entries).

Data hooks: `useParticipants(params?: Record<string,string>)` (`frontend/src/api/hooks/
participants.ts:13-21`, unwraps `PagedResult<ParticipantListDto>.items`) and
`useStaff(params?: Record<string,string>)` (`frontend/src/api/hooks/staff.ts:16-21`, returns
`StaffListDto[]` directly). Both accept plain query-param records (e.g. `useParticipants({
isDraft: 'false' })` used by the incident form, `IncidentCreatePage.tsx:116`).

**For the wizard**: there is no packaged "picker with built-in data fetching" — every page wires
`SearchableSelect` + its own `useParticipants`/`useStaff` call. A wizard step would do the same.

---

## 7. Wizard precedent — `frontend/src/pages/ParticipantCreatePage.tsx`

3,608 lines. **Not an extractable/reusable shell** — it's one monolithic component with the step
machinery hand-rolled inline (no generic `Wizard`/`Stepper` component exists anywhere in
`frontend/src`, confirmed by filename search).

Shape, for reference if the incident wizard is hand-rolled the same way:
- `WIZARD_STEPS: WizardStep[]` array (`:771-793`), each `{ key, label, fields: (keyof
  ParticipantFormData)[] }` — e.g. `{ key: 'identity', label: 'Identity', fields:
  STEP_IDENTITY_FIELDS }`. 11 steps total ending in a synthetic `review` step;
  `REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1` (`:795`).
- `stepIndex` state, `currentStep = WIZARD_STEPS[stepIndex]` (`:1078`), `currentStepFieldSet`
  (`:1079`) used to filter `errors` down to just the current step's fields for a per-step error
  summary (`:1080-1081`, rendered `:2076-2081`).
- `goToStep(index)` (`:1085-1088`), `handleBack` (`:1090`, clamps at 0), `handleNext` (`:1092+`,
  presumably per-step-schema validation before advancing — see `STEP_SCHEMAS`/
  `fieldToStepIndex` referenced in comments around `:297-344`).
- A visual step-progress row with `aria-current="step"` on the active step (`:2043-2045`),
  clickable to jump via `goToStep`.
- A **Review** step (`stepIndex === REVIEW_STEP_INDEX`, `:3277+`) that renders one `Card` per
  earlier step (`reviewGroups`, grouped by `group.step`) with an "Edit" button
  (`onClick={() => goToStep(group.step)}`, `:3532`) jumping straight back to that step.
- Footer Back/Next buttons at `:3560` / `:3586`.

Per-step field ownership is managed via constants like `STEP_IDENTITY_FIELDS`,
`STEP_NDIS_FIELDS`, etc. (defined earlier in the file, referenced from `WIZARD_STEPS`) — adding a
step means adding a new fields-constant + inserting it into the `WIZARD_STEPS` array (the file's
comments describe past step insertions/renames in detail, e.g. `:680-737`).

**Recommendation for the incident wizard spec**: this pattern (steps array + fieldSet-scoped
validation + review-step-with-edit-links) is copyable but not reusable-as-a-library today —
building the incident wizard will mean either (a) hand-rolling the same pattern again inside
`IncidentCreatePage.tsx`, or (b) extracting a small generic `useWizard`/`<WizardShell>` first.
Given the incident form has far fewer fields/steps than the participant intake wizard, (a) is
probably proportionate unless a wizard is planned for a third form soon.

---

## 8. Body diagram / injury map

**None.** Grepped `frontend/src` for `BodyMap`, `body-map`, `BodyDiagram`, `injury diagram`, and
inline `<svg>` outside of icon/logo contexts — no matches. If the incident wizard wants a body
map for injury location, it will need to be built from scratch (e.g. an SVG figure with
clickable/tappable regions) — there is no existing asset or component to extend.

---

## Summary for wizard spec purposes

- The current incident form is a **single non-wizard page**, ~330 lines of JSX across 6
  conditional `Card` sections, backed by a 30-field Zod schema and a 24-field `CreateIncidentDto`
  (+8 more on `UpdateIncidentDto` for edit-only review/compliance fields).
- The incident↔medication link (INC-03) is a **client-side-only, non-persisted prefill hand-off**
  from `RecordAdministrationModal` on a Refused/Withheld/Missed/WrongMedication outcome — not a
  backend workflow. A parallel NOTES-02 hand-off exists from flagged shift notes.
- The **medication witness approval** pattern (nominate a staff user at write-time → `Pending` row
  → the named user alone can `Approve`/`Decline` via a dedicated portal page, no notification push,
  polling instead) is the shape to copy for a real "incident witness" flow, replacing the current
  free-text `WitnessNames`/`WitnessStatements` fields. It has no statement-text capture today — if
  the incident version needs a witness statement, that'd be a new field beyond this precedent.
- No generic wizard shell, no dedicated participant/staff picker component (just `SearchableSelect`
  + ad hoc data hooks), and no body-diagram asset exist — all three would be built fresh (or the
  `ParticipantCreatePage` step pattern duplicated) as part of this work.
