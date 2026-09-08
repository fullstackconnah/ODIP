# Service Agreements and Plan Budgets — Design

Status: Approved 2026-09-08 — design; implementation plan pending.

ODIP has no `ServiceAgreement`/`Agreement` entity anywhere (grepped `backend/` for
`ServiceAgreement|class Agreement\b`: zero matches) and no per-support-category budget wired
to the live claim pipeline — a participant's plan window and manager live as scalar fields
directly on `Participant`, and the only category-budget shape in the codebase sits on an
unwired, controller-free model. This spec adds e-signed service agreements — a token-link
flow that mirrors the existing caregiver wizard exactly — and manually-entered plan budgets
per PACE support category, drawn down by claims with an overspend warning surfaced at claim
preview time, never a block.

## Product rulings

1. Service agreements are e-signed via a token link, exactly like the caregiver wizard: the
   office creates the agreement and sends a link; the participant or their nominee opens it
   with no login, reviews it, types their name, and ticks consent. The server renders and
   stores a PDF snapshot plus a SHA-256 hash of it at the moment of signing.
2. Plan budgets per PACE support category are entered manually by the office. There is no
   automatic import from PRODA or a plan PDF.
3. Budget overspend on claim generation is a WARNING, never a block. A coordinator can always
   generate a claim that pushes a category negative; the UI just tells them so.

## Context — what exists today

- **No agreement entity.** Grepped `backend/` for `ServiceAgreement|class Agreement\b`: zero
  matches.
- **Plan dates are scalars on `Participant`.** `PlanStartDate`/`PlanEndDate` (`DateOnly?`) and
  `PlanManagerContactId`/`PlanManagerContact` (`backend/Odip.Domain/Entities/Participant.cs`)
  live directly on `Participant` — there is no separate `Plan`/`FundingPlan` entity to attach
  a budget to.
- **The only per-category budget concept is unwired.** `Odip.Domain/Billing/
  BillingEntities.cs` defines `FundingSource` (line 52, one `BudgetCategory` string + `Budget`
  decimal per row), `ServiceBooking`/`ServiceBookingLine` (78/96,
  `AllocatedAmount`/`ClaimedAmount`/`RemainingAmount` per `SupportItemNumber`), and
  `BillableEvent` (114). `FundingSource.RouteType` duplicates `Participant.PlanType`
  (`Enums.cs:3`), the field the live claim/invoice pipeline actually reads. All four types
  have `DbSet<>`s but no controller/service ever touches them —
  `ClaimGenerationService`/`InvoiceService`/`BprCsvService` read `Participant.PlanType`
  directly. This design does **not** build on them — see Out of scope's Retire note.
- **No document is persisted anywhere today.** `ParticipantDocumentService`/`InvoiceService`/
  `BprCsvService` all return `(byte[] Content, string FileName)` computed on demand and
  streamed straight back; nothing is written to DB or disk (grepped `class Document\b`: zero
  matches). The signed agreement's stored `PdfSnapshot` is the **first** persisted document in
  this codebase.
- **The token-link pattern to reuse is the caregiver wizard.**
  `CaregiverProfileSubmission` (`backend/Odip.Domain/Entities/
  CaregiverProfileSubmission.cs`) stores `TokenHash` (SHA-256 hex; the raw token is never
  persisted) and `Status` (`CaregiverSubmissionStatus`: `Draft=0, Submitted=1, Accepted=2,
  Rejected=3, Revoked=4` — "do not reorder"). `CaregiverTokenService`
  (`backend/Odip.Infrastructure/Services/CaregiverTokenService.cs`, static) exposes
  `GenerateRawToken()` (32 random bytes, base64url) and `Hash(string rawToken)` (SHA-256 hex)
  — reused **verbatim**, no rename, to keep the diff small. The partial-unique-index pattern
  for "at most one active token row" (`OdipDbContext.cs:645-653`,
  `HasFilter("\"Status\" IN (0, 1)")`) is mirrored by `ServiceAgreement`'s own "at most one
  Sent per participant" index (§1). The link-issue/shown-once response shape —
  `CaregiverSubmissionsController.CreateLink` (`backend/Odip.Api/Controllers/
  CaregiverSubmissionsController.cs:58-86`) returns `CaregiverLinkDto { Token = raw,
  ExpiresAt }` **once**, expiry from `config.GetValue<int?>("Caregiver:LinkExpiryDays") ?? 14`
  (line 47, direct `IConfiguration.GetValue`, no `IOptions<T>` anywhere in the codebase) — is
  what `ServiceAgreementLinkDto`/`Agreements:LinkExpiryDays` (default 14) both copy.
- **The public controller pattern, with two corrections.** `CaregiverController`
  (`backend/Odip.Api/Controllers/CaregiverController.cs`) has no class-level `[Authorize]`,
  routes at `[Route("api/v1/public/caregiver")]` (line 27), and — correction #1 —
  `[EnableRateLimiting("public")]` (line 28), **not** `"api"`. `Program.cs:208-282` defines
  three named policies: `"login"` (213), `"api"` (261, 100/min per IP), and `"public"` (273,
  30/min per IP — its own comment: "these routes carry no bearer token, so the only brake on a
  leaked or guessed link is this limiter"). `AgreementSigningController` uses `"public"`, the
  policy already built for exactly this route shape. Every `CaregiverController` failure
  collapses to a uniform 404 so a probing caller can't distinguish "no such token" from
  "expired"/"revoked"/"accepted" (lines 41-68); where there's no authenticated principal, the
  audit row is still attributed by name — `HttpContext.Items[AuditInterceptor.ActorItemKey] =
  $"caregiver:{sub.CaregiverName}"` (line 120). `AgreementSigningController` copies the
  no-`[Authorize]`/rate-limit/actor-attribution shape but — a deliberate product choice, not a
  bug — deviates on status codes: expired and already-used tokens return distinct 410s rather
  than a uniform 404 (§ Edge cases).
- **QuestPDF setup to copy.** `InvoiceService` (`backend/Odip.Infrastructure/Services/
  InvoiceService.cs:10-18`) sets `QuestPDF.Settings.License = LicenseType.Community` in a
  constructor that takes only `OdipDbContext` — `ServiceAgreementPdfService` follows this
  exact shape.
- **Provider name for the signing page.** `ProviderSettingsController`
  (`[Route("api/v1/provider-settings")]`, class `[Authorize(Roles = "SuperAdmin,Admin,
  Coordinator")]`) exposes one tenant-wide `ProviderSettings` row via `GET` (lines 19-34) →
  `OrganisationName`. `AgreementSigningController` reads `_db.ProviderSettings
  .FirstOrDefaultAsync` directly — no `ICurrentTenant` here, same as `CaregiverController`, so
  this resolves via the agreement's own `TenantId`, not the ambient query filter (§3).
- **`SupportActivityGroup.SupportCategory` exists but can't be reused.**
  `SupportCatalogueItem` (`backend/Odip.Domain/Entities/SupportCatalogueItem.cs`) belongs to a
  `SupportActivityGroup` that *does* carry an `int SupportCategory` field, but
  `CatalogueImportService.CommitImportAsync` (`backend/Odip.Infrastructure/Services/
  CatalogueImportService.cs:88-90`) hardcodes every imported catalogue row into the single
  seeded group `GRP_COMMUNITY_ACCESS` (`DbSeeder.cs:973-980`, `SupportCategory = 4`)
  regardless of the item's true NDIS category — every imported item lands tagged category 4
  no matter what. This confirms, rather than contradicts, building a separate
  `SupportCategoryMapping` keyed on the item-number prefix instead.
- **Item-number-prefix convention.** NDIS support item numbers encode the support category in
  their first two digits (e.g. `04_...` = Assistance with Social and Community Participation).
  The one real seeded example confirms it: `DbSeeder.cs:987-989` seeds item number
  `04_210_0125_6_1` into the group whose own `SupportCategory` was set to `4`.
  `SupportCategoryMapping.SupportItemNumberPrefix` formalises this rather than inferring it
  from the (unreliable) group.
- **Pricing precedent — correction #2.** The live price-limit switch,
  `ClaimGenerationService.GetPriceForState` (`backend/Odip.Infrastructure/Services/
  ClaimGenerationService.cs:390-402`), keys on a state string sourced from `settings.State ??
  "VIC"` (line 158) — the single tenant-wide `ProviderSettings.State`, not per-participant.
  `Participant.Region` (`Participant.cs:67`) is **free text** (`"South East QLD"`,
  `"Melbourne Metro"` — `DbSeeder.cs:296-309`) and cannot drive that switch.
  `Participant.AddressState` (`Participant.cs:145`) is the real state-code field (seeded as
  `"QLD"`/`"NSW"`/`"VIC"`, matching `PriceLimit_*` exactly). The line-picker price-limit
  prefill is therefore keyed on **`Participant.AddressState ?? ProviderSettings.State`**, not
  `Region` as the approved design assumed. (The sibling shift-completion spec,
  `docs/specs/2026-09-08-shift-completion-design.md`, makes the same "`Region` is a string"
  correction independently.)
- **Claim-line drawdown source, including the sibling shift spec's schema change.** Today
  every `ClaimLineItem` reaches its participant only via a required `ParticipantBookingId`.
  `docs/specs/2026-09-08-shift-completion-design.md` (lines 190-214) makes
  `ParticipantBookingId`/`ParticipantBooking` nullable, adds nullable `ShiftId`/`Shift` plus a
  check constraint `CK_ClaimLineItem_ExactlyOneParent`, and adds `TripClaim.Kind`/nullable
  `ParticipantId`. The drawdown query (§3) resolves participant per line as
  `line.ParticipantBooking?.ParticipantId ?? line.Shift?.ParticipantId` — correct whether or
  not that sibling spec has shipped yet (the `??` degrades gracefully when `ShiftId` is always
  null).
- **`ClaimPreviewResponseDto`** (`backend/Odip.Application/DTOs/ClaimDTOs.cs:97-107`) —
  `{ DepartureTime, ReturnTime, ActiveHoursPerDay, StaffCount, State,
  ConfirmedParticipantCount, LineItems, TotalAmount }` — this design adds one field,
  `BudgetWarnings: BudgetWarningDto[]`.
- **Participant-detail tab registry.** `frontend/src/pages/ParticipantDetailPage.tsx`: the
  `Tab` union (line 30), the `initialTab` query-param guard (32-33), the `TabNav
  tabs={[...]}` array (161-171), and per-tab body blocks (from 186) are the exact places
  `'agreements'`/`'funding'` land.
- **Public route placement.** `frontend/src/App.tsx:93` —
  `<Route path="/caregiver/:token" element={<CaregiverWizardPage />} />` — outside every
  `<PrivateRoute>`/`AppLayout`. `AgreementSignPage.tsx` gets the same treatment at
  `/agreements/sign/:token`, and needs the same kind of no-credential client
  `CaregiverWizardPage.tsx` uses (`src/api/caregiverClient.ts` — no `Authorization`/
  `X-View-As-*`, no credentials).
- **Mock API dispatch shape.** `odip-prototype/odip/mock-api/server.js`: a plain `routes`
  table for GETs (line 743, path segments only — query strings stripped/ignored), and a
  `postRoutes` `[pattern, handler]` array (line 859) dispatched at line 957 ahead of the
  generic echo fallback — PUTs route through `postRoutes` too, by the same convention the
  notifications spec's own mock-api section uses.
- **Audit allow-list.** `AuditedEntities.Types` (`backend/Odip.Infrastructure/Audit/
  AuditedEntities.cs:8-65`) has no agreement/budget entity yet. `ServiceAgreement`/
  `ServiceAgreementLine`/`PlanBudget` join it (§1) for the same reason `Shift.OverrideReason`
  and `CaregiverProfileSubmission` are there. `SupportCategoryMapping` is deliberately
  excluded — a global (non-tenant) seed-maintained lookup, not a participant- or
  money-facing record.

## 1. Data model

New file `backend/Odip.Domain/Agreements/AgreementEntities.cs` (mirrors the existing
`Odip.Domain/Rostering/`/`Odip.Domain/Notifications/` per-feature co-location), plus one
additive migration `AddServiceAgreementsAndBudgets`.

```csharp
public enum ServiceAgreementStatus
{
    Draft = 0, Sent = 1, Signed = 2, Expired = 3, Superseded = 4, Cancelled = 5
}
// Append-only, same discipline as CaregiverSubmissionStatus — never renumber.

public class ServiceAgreement : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public ServiceAgreementStatus Status { get; set; } = ServiceAgreementStatus.Draft;
    public string Title { get; set; } = string.Empty;
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public string? TokenHash { get; set; }           // null once Draft, cleared after signing (single-use)
    public DateTime? TokenExpiresAt { get; set; }
    public DateTime? SentAt { get; set; }
    public Guid? SentByUserId { get; set; }
    public DateTime? SignedAt { get; set; }
    public string? SigneeName { get; set; }
    public string? SigneeRelationship { get; set; }
    public string? SigneeIpAddress { get; set; }
    public string? SigneeUserAgent { get; set; }
    public string ConsentText { get; set; } = string.Empty;   // frozen at signing time
    public byte[]? PdfSnapshot { get; set; }
    public string? PdfSha256 { get; set; }
    public Guid? SupersededById { get; set; }
    public ServiceAgreement? SupersededBy { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<ServiceAgreementLine> Lines { get; set; } = new List<ServiceAgreementLine>();
}

public class ServiceAgreementLine : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ServiceAgreementId { get; set; }
    public ServiceAgreement? ServiceAgreement { get; set; }
    public string SupportItemNumber { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Unit { get; set; } = "H";
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalAmount { get; set; }          // Quantity * UnitPrice, computed on write
    public SupportCategory SupportCategory { get; set; }
    public int SortOrder { get; set; }
}

public enum SupportCategory
{
    // Core
    AssistanceWithDailyLife = 1,
    Transport = 2,
    Consumables = 3,
    AssistanceWithSocialAndCommunityParticipation = 4,
    // Capital
    AssistiveTechnology = 5,
    HomeModifications = 6,
    // Capacity Building
    SupportCoordination = 7,
    ImprovedLivingArrangements = 8,
    IncreasedSocialAndCommunityParticipation = 9,
    FindingAndKeepingAJob = 10,
    ImprovedRelationships = 11,
    ImprovedHealthAndWellbeing = 12,
    ImprovedLearning = 13,
    ImprovedLifeChoices = 14,
    ImprovedDailyLiving = 15,
    // PACE-era additions
    RecurringTransport = 16,
    HomeAndLivingSupports = 17,
}
// Numeric values persist on ServiceAgreementLine/PlanBudget/SupportCategoryMapping —
// append-only, same discipline as every other persisted enum in this design.

public class PlanBudget : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public DateOnly PlanStart { get; set; }
    public DateOnly PlanEnd { get; set; }
    public SupportCategory SupportCategory { get; set; }
    public decimal AllocatedAmount { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// Global (not ITenantEntity) — a seeded, catalogue-import-maintained lookup, like
// SupportActivityGroup itself but scoped to exactly the mapping problem it can't solve today.
public class SupportCategoryMapping
{
    public Guid Id { get; set; }
    public string SupportItemNumberPrefix { get; set; } = string.Empty;   // e.g. "04_"
    public SupportCategory SupportCategory { get; set; }
}
```

Every entity in this file implements `ITenantEntity` and is covered by `OdipDbContext`'s
tenant query filter and `SaveChangesAsync` TenantId stamping except `SupportCategoryMapping`,
which is deliberately global.

**EF configuration** (new block in `OnModelCreating`, alongside the pattern already used for
`CaregiverProfileSubmission` at `OdipDbContext.cs:645-653`):

```csharp
modelBuilder.Entity<ServiceAgreement>(e =>
{
    e.HasIndex(x => x.TenantId);
    e.HasIndex(x => x.TokenHash).IsUnique().HasFilter("\"TokenHash\" IS NOT NULL");
    // At most one Sent agreement per participant — Status int: Sent = 1.
    e.HasIndex(x => x.ParticipantId)
        .IsUnique()
        .HasDatabaseName("IX_ServiceAgreements_ParticipantId_Sent")
        .HasFilter("\"Status\" = 1");
    e.Property(x => x.PdfSnapshot).HasColumnType("bytea");
});
modelBuilder.Entity<PlanBudget>(e =>
    e.HasIndex(x => new { x.ParticipantId, x.PlanStart, x.SupportCategory }).IsUnique());
modelBuilder.Entity<SupportCategoryMapping>(e =>
    e.HasIndex(x => x.SupportItemNumberPrefix).IsUnique());
```

`ServiceAgreement`, `ServiceAgreementLine`, and `PlanBudget` join `AuditedEntities.Types`
(`AuditedEntities.cs:8`) on day one, per the Context rationale above.

**Storage size.** A 2-3 page QuestPDF service agreement renders to roughly 50-150 KB — the
`bytea` column is deliberately a plain byte array on the entity itself, not a blob-store
reference; a dedicated `IDocumentStore` abstraction is deferred (Out of scope) since this is
the only stored document in the system and the volume (one row per signed agreement) doesn't
justify one yet.

## 2. API + permissions

All routes require authentication; `ReadOnly` can reach every GET below (`ReadOnlyMiddleware`
403s its writes ahead of the controller). Writes are role-gated per action, not at the
controller level — verified against `ParticipantsController`
(`backend/Odip.Api/Controllers/ParticipantsController.cs`), which carries a plain class-level
`[Authorize]` (line 18) and puts `[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]` on each
individual write action (lines 230, 465, 669, 725, 780) rather than on the class. A class-level
`Roles` list would exclude `ReadOnly` from every action including GETs, which isn't the intent
here, so `ServiceAgreementsController` follows `ParticipantsController`'s shape instead.

**Agreements** — new `ServiceAgreementsController` (new file, class-level plain `[Authorize]`
per the `ParticipantsController` precedent above, with `[Authorize(Roles = "SuperAdmin,Admin,
Coordinator")]` on each write action below; every GET is reachable by any authenticated role,
`ReadOnly` included):

| Method | Route | Notes |
|---|---|---|
| GET | `participants/{participantId}/agreements` | list, newest first |
| POST | `participants/{participantId}/agreements` | creates a `Draft` with lines; 400 on an invalid line (quantity/price ≤ 0, unknown category) |
| GET | `agreements/{id}` | full detail incl. lines |
| PUT | `agreements/{id}` | Draft only → 409 otherwise |
| DELETE | `agreements/{id}` | Draft only → 409 otherwise |
| POST | `agreements/{id}/send` | Draft → Sent; issues token, returns the raw link **once** (`ServiceAgreementLinkDto { Token, ExpiresAt }`, same shape as `CaregiverLinkDto`); raises `ServiceAgreementSent` |
| POST | `agreements/{id}/revoke-link` | Sent or Expired → Draft; clears `TokenHash`/`TokenExpiresAt` |
| POST | `agreements/{id}/supersede` | any non-Draft, non-Cancelled status → creates a new `Draft` copying the source's lines; `SupersededById` is set on the *source* only once the *new* one is signed (§ Data flow) |
| POST | `agreements/{id}/cancel` | any status except `Signed` → `Cancelled` |
| GET | `agreements/{id}/pdf` | `Signed` only → 409 otherwise; streams `PdfSnapshot` |

`POST /agreements/{id}/send`'s `ServiceAgreementSent` event is a receipt to the sender, not a
participant notification: v1 has no participant/nominee user accounts (Out of scope), so the
link itself is copy-pasted by the office into an email/SMS/portal message outside ODIP — the
event exists so the sending coordinator (and any other tenant admin who's opted in) gets
confirmation the send happened, mirroring how `LeaveRequestSubmitted` notifies coordinators of
something a staff member did, not the staff member themselves.

**Budgets** — new actions on the same controller (or a small `ParticipantBudgetsController` —
either is fine structurally; this design uses actions on `ServiceAgreementsController` since
both budgets and agreements are participant-funding concerns reached from the same tab group):

| Method | Route | Request | Response |
|---|---|---|---|
| GET | `participants/{participantId}/budgets?planStart=` | — | `BudgetSummaryDto[]`: `{ category, allocated, claimed, remaining }` per category, plus one synthetic `Unmapped` row if any claimed line's item number has no `SupportCategoryMapping` prefix match |
| PUT | `participants/{participantId}/budgets` | `UpsertPlanBudgetDto[]`: `{ planStart, planEnd, category, allocated, notes }` | same as GET; 409 if any two entries in the payload, or an entry against an existing row for a different `SupportCategory`, have overlapping `[planStart, planEnd]` windows |

**Claim-preview budget warnings.** `ClaimGenerationService.PreviewClaimAsync`
(`backend/Odip.Infrastructure/Services/ClaimGenerationService.cs:17`) and the sibling
shift-based generator (`docs/specs/2026-09-08-shift-completion-design.md`) both add
`BudgetWarnings: BudgetWarningDto[]` to their preview response
(`ClaimPreviewResponseDto`, `ClaimDTOs.cs:97-107`): `{ category, allocated, projectedClaimed,
remainingAfter }`, populated only for a category whose `remainingAfter < 0` once the
previewed (not-yet-committed) lines are added to today's drawdown. This is preview-only —
`GenerateDraftClaimAsync`/the equivalent shift-side call never blocks or reads this array.

**DTOs** — `backend/Odip.Application/DTOs/AgreementDTOs.cs` (new file), camel-case-stable on
the wire per the discipline `RosteringDTOs.cs`/`LeaveDTOs.cs`/`NotificationDTOs.cs` already
document: `ServiceAgreementDto`, `ServiceAgreementLineDto`, `CreateServiceAgreementDto`,
`UpdateServiceAgreementDto`, `ServiceAgreementLinkDto { token, expiresAt }`,
`BudgetSummaryDto`, `UpsertPlanBudgetDto`, `BudgetWarningDto`. `status`/`supportCategory`
serialise as string enum names (`JsonStringEnumConverter` already installed globally,
`Program.cs:369`).

**Frontend permissions** (`frontend/src/lib/permissions.ts`) — two booleans, following the
existing `canWrite*` convention:

```ts
/** Mirrors the per-action [Authorize(Roles = "Admin,Coordinator,SuperAdmin")] on
 *  ServiceAgreementsController's write actions (class-level is plain [Authorize]). */
canManageAgreements: isSuperAdmin || isAdmin || isCoordinator,
/** Same gate as canManageAgreements — budgets share the controller. */
canManageBudgets: isSuperAdmin || isAdmin || isCoordinator,
```

New `PageKey`s are not required — Agreements/Funding are tabs inside the existing
`participants` page, not new routes gated by `canAccessPage`.

## 3. Token flow, PDF, and drawdown

**Token issuance/hashing is `CaregiverTokenService`, unchanged.**
`GenerateRawToken()`/`Hash(string)` are called verbatim from
`ServiceAgreementsController.Send` — no rename, no new shared `TokenService`, per the approved
design's own recommendation to keep the diff small. (A future rename to a shared
`TokenService` remains a clean, optional follow-up if a third token-link feature shows up —
not built here.)

**`AgreementSigningController`** (new file, `[AllowAnonymous]`, `[Route("api/v1/agreements/
sign")]`, `[EnableRateLimiting("public")]` — the correction noted in Context, not `"api"`):

| Method | Route | Behaviour |
|---|---|---|
| GET | `{token}` | Resolves by hash, `Status == Sent`, `TokenExpiresAt > now`. Returns `AgreementSignViewDto`: participant display name, lines, dates, `ConsentText`, provider `OrganisationName` (resolved via the agreement's own `TenantId`, no `ICurrentTenant`). 410 if expired or already signed/used (§ Edge cases); 404 for an unknown token (never leaks which). |
| POST | `{token}/sign` | Body `{ signeeName, signeeRelationship, consentAccepted }`. Requires `consentAccepted == true` (400 otherwise). Renders the PDF via `ServiceAgreementPdfService`, hashes the rendered bytes (SHA-256), stores `PdfSnapshot`/`PdfSha256`, sets `SigneeName`/`SigneeRelationship`/`SigneeIpAddress` (`HttpContext.Connection.RemoteIpAddress`, same resolution the rate limiter uses — `Program.cs:290-291`)/`SigneeUserAgent`/`SignedAt`, flips `Status = Signed`, **clears `TokenHash`/`TokenExpiresAt`** (single-use), raises `ServiceAgreementSigned`. Audit actor attribution follows `CaregiverController.cs:120`: `HttpContext.Items[AuditInterceptor.ActorItemKey] = $"agreement-signee:{signeeName}"`. An inactive participant at sign time is a distinct 409, not a 410 (§ Edge cases) — the agreement is still valid, just blocked from completing. |

**`ServiceAgreementPdfService`** (new file, `backend/Odip.Infrastructure/Services/
ServiceAgreementPdfService.cs`) — same constructor shape as `InvoiceService.cs:10-18`.
Renders: provider name/ABN, participant name/NDIS number, agreement title and dates, the line
table (item number, description, quantity, unit price, total), the frozen `ConsentText`, and
the signee's typed name/relationship/timestamp. `GenerateAsync(Guid agreementId,
CancellationToken ct) => Task<byte[]>` — no `FileName` tuple like `InvoiceService`/
`BprCsvService` return, because these bytes are stored, not streamed directly; `GET
agreements/{id}/pdf` builds the filename (following `ParticipantDocumentService.
BuildFileName`'s `"{Sanitized}-{docType}-{yyyyMMdd}.pdf"` shape) when it streams the stored
bytes back.

**Token expiry** — `Agreements:LinkExpiryDays` (default 14), read via direct
`IConfiguration.GetValue<int?>("Agreements:LinkExpiryDays") ?? 14` in
`ServiceAgreementsController.Send`, matching `CaregiverSubmissionsController.cs:47`'s idiom
exactly (no `IOptions<T>` binding).

**Status expiry is lazy.** There is no background job for this (the only hosted service in the
codebase, `HolidaySyncBackgroundService`, is unrelated). A `Sent` agreement whose
`TokenExpiresAt` has passed is flipped to `Expired` the next time it's read — either by
`AgreementSigningController.Get` (which then returns 410) or by
`ServiceAgreementsController.GetById`/`List` (which patches the in-memory/DB row to `Expired`
before returning it, same "compute at read time" idiom `ParticipantAlertsService` and the
sibling leave spec's pending-count badge already use elsewhere in this codebase).

**Drawdown is computed, never stored.** New Infrastructure service
`backend/Odip.Infrastructure/Services/PlanBudgetService.cs`:

```csharp
public interface IPlanBudgetService
{
    Task<IReadOnlyList<BudgetSummaryDto>> GetSummaryAsync(
        Guid participantId, DateOnly planStart, CancellationToken ct);
}
```

For each `PlanBudget` row matching `(participantId, planStart)`:
`Remaining = AllocatedAmount − Σ ClaimLineItem.TotalAmount` for every `ClaimLineItem` where:
- the resolved participant (`line.ParticipantBooking?.ParticipantId ?? line.Shift?.ParticipantId`,
  see Context) equals `participantId`;
- `line.SupportItemCode`'s two-character prefix matches a `SupportCategoryMapping` row whose
  `SupportCategory` equals the budget row's category (a code with no matching prefix is
  excluded from every named category and instead accumulated into the synthetic `Unmapped`
  bucket — surfaced in the response, never silently dropped);
- `line.SupportsDeliveredFrom` falls within `[PlanStart, PlanEnd]`;
- `line.Status` is not `Draft` or `Rejected` (`ClaimLineItemStatus`: `Draft=0, Submitted=1,
  Approved=2, Paid=3, PartiallyPaid=4, Rejected=5` — every other status counts toward spend,
  including a not-yet-approved `Submitted` line, since the point of a budget warning is to
  flag risk before money moves, not just after it clears).

## 4. UI

**Participant detail — Agreements tab.** `frontend/src/pages/participant-detail/
AgreementsTab.tsx` (new file), wired the way `RestrictivePracticesTab`/`RoutinesTab` are
today: `'agreements'` added to the `Tab` union (line 30), the `initialTab` guard (32-33), a
`TabNav` entry (161-171), a body block from line 186. A `DataTable` list with `StatusBadge`
chips; "New agreement" opens a builder modal — a line picker searching
`SupportCatalogueItem` with `UnitPrice` prefilled from `Participant.AddressState ??
ProviderSettings.State` (§ Context correction); Send opens a link modal with a copy button,
matching the caregiver-link idiom; a `Signed` row gets "Download PDF"
(`GET agreements/{id}/pdf`); Supersede is available on `Sent`/`Signed`/`Expired` rows.

**Participant detail — Funding tab.** `frontend/src/pages/participant-detail/FundingTab.tsx`
(new file), same wiring (`'funding'` alongside `'agreements'`). A grid — one row per
`SupportCategory` present plus the `Unmapped` bucket when non-zero — columns Allocated /
Claimed / Remaining, a progress bar (red past 100%), and inline edit of
`AllocatedAmount`/`Notes` per row, `PUT participants/{participantId}/budgets` on save.

**Public sign page.** `frontend/src/pages/agreements/AgreementSignPage.tsx` (new file), routed
at `/agreements/sign/:token` in `App.tsx` alongside line 93's `/caregiver/:token`, outside
every `<PrivateRoute>`/`AppLayout`. States: loading → summary (lines, dates, consent text,
provider name) with a consent checkbox and typed-name field → Sign (disabled until both are
filled) → success → distinct expired/used-token screens, driven off the controller's distinct
410s (§ Edge cases) so the copy can differ ("this link has expired" vs. "already signed").

**Hooks.** `frontend/src/api/hooks/agreements.ts` + types (new files, per-domain split):
`useAgreements`, `useAgreement`, `useCreateAgreement`, `useUpdateAgreement`,
`useDeleteAgreement`, `useSendAgreement`, `useRevokeAgreementLink`, `useSupersedeAgreement`,
`useCancelAgreement`, `useBudgets`, `useUpsertBudgets`, plus two public (no-auth-client) hooks
— `usePublicAgreement(token)`, `useSignAgreement(token)` — mirroring
`usePublicCaregiverForm`/`useSubmitCaregiverForm`'s dedicated no-credential client. Barrel:
`frontend/src/api/hooks/index.ts` gains `export * from './agreements'`.

**Mock API.** `odip-prototype/odip/mock-api/server.js` gains:
- GETs (`routes` table, line 743): `participants/:id/agreements`, `agreements/:id`,
  `agreements/sign/:token` (public), `participants/:id/budgets` (query string ignored per the
  dispatcher's existing behaviour, same caveat the notifications spec's mock-api section
  already documents).
- `postRoutes` (line 859, PUTs routed through the same array by the established convention):
  `participants/:id/agreements`, `agreements/:id` (PUT), `agreements/:id/send`,
  `agreements/:id/revoke-link`, `agreements/:id/supersede`, `agreements/:id/cancel`,
  `agreements/sign/:token/sign` (public), `participants/:id/budgets` (PUT).

## Data flow

**Office creates → sends → participant signs → budget starts counting.** A coordinator builds
a `Draft` (`POST participants/{id}/agreements`) with lines priced at the participant's state
price limit. `POST agreements/{id}/send` issues a token, flips `Status = Sent`, raises
`ServiceAgreementSent` (a receipt to the sender), and returns the raw link once for the
coordinator to paste into an email/SMS sent outside ODIP. The participant (or nominee) opens
`/agreements/sign/:token`, reviews, types their name, ticks consent, and submits.
`AgreementSigningController.Sign` renders the PDF, hashes it, stores both, flips `Status =
Signed`, clears the token, and raises `ServiceAgreementSigned`. None of this touches
`PlanBudget` directly — a budget is entered separately on the Funding tab; claims drawn
against the plan window count against `Remaining` the moment a `PlanBudget` row exists for
that category, independent of any agreement's status.

**Supersede.** Opening a signed agreement whose terms need to change and clicking Supersede
(`POST agreements/{id}/supersede`) copies the source's lines into a brand-new `Draft` — the
source's own `Lines`/`PdfSnapshot` stay untouched (immutability, § Edge cases). The new
agreement goes through Draft → Sent → Signed like any other; only once *it* reaches `Signed`
does the *original*'s `SupersededById` get set. Until then the original stays `Signed` and
fully valid — supersede is a proposal, not an immediate supersession.

**Claim generation surfaces a warning, never blocks.** A claim preview (`POST trips/{tripId}/
claims/preview` or the shift-side equivalent) computes the usual line items, then separately
calls `IPlanBudgetService` per participant and appends `BudgetWarnings` for any category that
would go negative once the previewed lines land. The coordinator can generate the claim
regardless — `GenerateDraftClaimAsync`/its sibling never consult `BudgetWarnings`.

## Error handling

| Rule | Status | Message |
|---|---|---|
| `GET {token}` on `AgreementSigningController`: token expired | 410 | "This agreement link has expired." |
| `GET {token}`/`POST {token}/sign`: token already used (no live row with that hash) | 410 | "This agreement has already been signed." |
| `GET {token}`/`POST {token}/sign`: token unknown | 404 | "This link is not valid." |
| `POST {token}/sign` with `consentAccepted: false` (or absent) | 400 | "Please tick the consent checkbox to continue." |
| `POST {token}/sign` when the participant is inactive | 409 | "This participant's record is no longer active. Contact the office." |
| `PUT`/`DELETE agreements/{id}` when not `Draft` | 409 | "Only a draft agreement can be edited or deleted." |
| `GET agreements/{id}/pdf` when not `Signed` | 409 | "This agreement has not been signed yet." |
| `POST agreements/{id}/send` when not `Draft` | 409 | "This agreement has already been sent." |
| `POST agreements/{id}/cancel` when `Signed` | 409 | "A signed agreement cannot be cancelled — supersede it instead." |
| `PUT participants/{id}/budgets`: overlapping plan windows for the same category | 409 | "This category already has a budget covering part of that date range." |
| A claimed line's item number has no `SupportCategoryMapping` prefix | 200, surfaced | counted under the response's `Unmapped` bucket, not hidden or dropped |

**State-transition matrix** (`ServiceAgreementStatus`):

| From \ To | Sent | Signed | Expired | Superseded | Cancelled |
|---|---|---|---|---|---|
| Draft | `send` | — | — | — | `cancel` |
| Sent | `revoke-link` → Draft (not shown above — see Expired row) | signee `sign` | lazy, on read past `TokenExpiresAt` | — | `cancel` |
| Expired | `revoke-link` → back to Draft (not shown above — Expired → Draft is the one non-append transition, matching "revoke and re-send") | — | — | — | `cancel` |
| Signed | — | — | — | set on the *new* agreement's own sign (§ Data flow) | — |
| Superseded / Cancelled | — | — | — | — | terminal |

**Immutability.** Once `Status = Signed`, `PdfSnapshot`/`PdfSha256`/`Lines` are never touched
by any endpoint — `PUT agreements/{id}` already 409s on anything but `Draft`, and no other
endpoint writes to those fields. Superseding creates a new row; it never mutates the old one's
content, only (eventually) its `SupersededById` pointer.

## Out of scope / explicitly deferred

- Participant/nominee login accounts — v1 has none; the link is the only authentication.
- DocuSign-style multi-party/sequential signing — one signee per agreement.
- Agreement templates or a versioned clause library — `ConsentText`/line content is entered
  fresh per agreement (or copied on supersede), not drawn from a managed template store.
- Automatic budget import from PRODA or a plan PDF — `PlanBudget` rows are entered by hand.
- A dedicated blob-storage/`IDocumentStore` abstraction — `PdfSnapshot` stays a `bytea` column
  on `ServiceAgreement` directly; revisit only if document volume or size grows enough to
  matter (§1's size note).
- **Retire**: `FundingSource`, `ServiceBooking`/`ServiceBookingLine`, `BillableEvent`,
  `ClaimBatch`, and `BillingRouter` (all in `Odip.Domain/Billing/BillingEntities.cs` and
  `Billing/Services/BillingRouter.cs`) are unwired, controller-free, and duplicate concepts
  this design and the live claim pipeline already cover properly (`FundingRouteType` vs.
  `Participant.PlanType`; `ServiceBooking`'s per-item balance vs. this design's `PlanBudget`).
  Flagged for the defect-repair backlog to remove outright — not touched by this delivery.

## Testing

**Backend (`Odip.Tests`)**, inline in-memory fixture with Moq'd `ICurrentTenant`, following
`StaffAssignmentGateTests.CreateDb`'s pattern (`backend/Odip.Tests/Rostering/
StaffAssignmentGateTests.cs:26-59`):
- `Agreements/TokenLifecycleTests` — issue/hash/lookup round-trip via `CaregiverTokenService`
  reused directly; expiry (`TokenExpiresAt` in the past → 410 on GET); single-use (`TokenHash`
  cleared after sign → a second `POST {token}/sign` 410s).
- `Agreements/ServiceAgreementStatusTests` — every transition in the matrix above, including
  the 409s on `PUT`/`DELETE`/`send`/`cancel` against the wrong starting state.
- `Agreements/PdfHashStabilityTests` — the hash of the row read back from the DB matches the
  hash computed at write time (QuestPDF determinism caveat: this sidesteps asserting two
  independent renders are byte-identical, since a metadata timestamp could make that false).
- `Agreements/DrawdownQueryTests` — `PlanBudgetService` against a mix of `ClaimLineItemStatus`
  values (excludes `Draft`/`Rejected`), lines reached via both `ParticipantBookingId` and
  `ShiftId` (proving the `??` resolution in §3 works regardless of which sibling-spec schema
  state is present), an `Unmapped` line with no matching prefix, and a plan-window boundary
  check on `SupportsDeliveredFrom`.
- `Agreements/SupersedeChainTests` — supersede copies lines immutably; `SupersededById` is set
  only when the *new* agreement reaches `Signed`, not at supersede-creation time.
- `Billing/ClaimPreviewBudgetWarningTests` — `PreviewClaimAsync` returns a `BudgetWarnings`
  entry only when `remainingAfter < 0`; generation never reads or is blocked by it.
- `Agreements/SupportCategoryMappingTests` — prefix lookup, fallback to `Unmapped`, and that
  the seeded `04_` example (`DbSeeder.cs:987-989`) resolves to
  `AssistanceWithSocialAndCommunityParticipation`.

**Frontend** — co-located `*.test.tsx`, `vi.mock('@/api/hooks')` + `vi.hoisted` per
`PortalShiftsPage.test.tsx`'s established convention: `AgreementSignPage` (loading / expired /
already-signed / success states), `AgreementsTab`'s builder (line add/remove/total
recalculation, price prefill from `AddressState`), `FundingTab`'s grid (allocated/claimed/
remaining rendering, progress-bar overflow past 100%, inline edit submit payload).

## Delivery

Three PRs, matching the sibling specs' pattern of one spec/one plan/multiple PRs:

1. **Backend entities + migration + authenticated endpoints + drawdown + tests.**
   `ServiceAgreement`/`ServiceAgreementLine`/`PlanBudget`/`SupportCategoryMapping` entities,
   the single additive `AddServiceAgreementsAndBudgets` migration (seeds
   `SupportCategoryMapping` rows for the NDIS prefix convention), `ServiceAgreementsController`
   (CRUD + send/revoke-link/supersede/cancel/pdf + budgets), `IPlanBudgetService`/
   `PlanBudgetService`, `AgreementDTOs.cs`, the `AuditedEntities.Types` additions, and every
   backend test above except the claim-preview one.
2. **Public signing controller + PDF service + sign page + notification events.**
   `AgreementSigningController`, `ServiceAgreementPdfService`, wiring
   `ServiceAgreementSent`/`ServiceAgreementSigned` through `INotificationRaiser` (per
   `docs/specs/2026-09-08-notifications-design.md`'s reserved enum values 8/9),
   `AgreementSignPage.tsx` + its route in `App.tsx`, the public hooks, `PdfHashStabilityTests`
   and `TokenLifecycleTests`.
3. **Participant-detail tabs + claim-preview budget warnings + mock-api.**
   `AgreementsTab.tsx`, `FundingTab.tsx`, the `ParticipantDetailPage.tsx` tab wiring,
   `permissions.ts` additions, `BudgetWarnings` on `ClaimPreviewResponseDto` and its UI
   surfacing, the eight mock-api routes, and every frontend test above plus
   `ClaimPreviewBudgetWarningTests`.

Migrations are additive only — `Program.cs`'s raw-SQL `__EFMigrationsHistory` self-healing is
tied to specific migration IDs (per root `CLAUDE.md`); this design never renames or reorders
an existing migration.

## Open questions

- Does the consent wording (`ConsentText`, frozen per agreement at send time) need a legal
  review pass before this ships, or is a first-draft sentence acceptable for the initial
  release with revision tracked as a follow-up? Product needs to supply or approve the actual
  text — this design only specifies where it's stored and that it's frozen.
- Is a second signer (e.g. both the participant and a plan nominee) ever required, or is one
  typed name always sufficient? The data model has room for exactly one signee; supporting two
  would need a second `SigneeName`/`SigneeRelationship` pair or a child table — not built here
  because the approved design's ruling 1 describes a single signer, but worth confirming
  before a real participant-facing rollout.
