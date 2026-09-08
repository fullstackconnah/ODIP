# Integration Framework — Design

Status: Approved 2026-09-08 — design; implementation plan pending.

An NDIS provider running ODIP today still keeps a separate browser tab open for care
management (Brevity), accounting (Xero), payroll (Employment Hero), fleet telematics
(Linxio), and budget tracking (Budgetly, Splose) — ODIP replaces none of them, it sits
beside them. The point of ODIP is to consolidate that operator's day into one interface
that *talks to* each of those systems rather than replacing them outright. This spec is
therefore not "add a Xero integration" — it is an **integration framework**: one set of
entities, one background dispatcher, one credential-encryption path, one review-before-apply
staging model, shared by every connector ODIP ever grows. Xero, Employment Hero, and Brevity
are the first three connectors built against it, chosen because they cover the three
shapes every future connector will need — a live OAuth2 API, a no-API file handoff, and a
no-official-API reverse-engineered bridge — and Splose/Linxio/Budgetly get placeholder tiles
now so the "one dashboard, many systems" story is visible on day one even before those three
are built out.

## Product rulings

1. **Xero is a live API connector.** OAuth2 authorization-code + PKCE; invoices pushed out
   (`ACCREC`); paid status pulled back by polling. Webhooks are deferred — they need a
   public HTTPS callback endpoint and signature verification this deployment doesn't have
   yet (ODIP sits behind nginx on a homelab box per root `CLAUDE.md`, not a stable public
   domain today).
2. **Employment Hero is file-based in v1.** ODIP produces a timesheet import CSV from
   Approved `ShiftCompletion` rows; there is no EH API call anywhere in this delivery. No
   award interpretation — rostered hours, flat, matching the shift-completion spec's own
   "billing is against rostered hours" ruling.
3. **Brevity has no official API.** v1 drives a reverse-engineered web transport
   (`BrevityWebTransport`) using the tenant's own Brevity login, strictly inbound, with
   every pulled change staged for review-before-apply. The moment Brevity ships an official
   API, `BrevityApiTransport` replaces the web transport behind the same `IBrevityTransport`
   seam with zero change to the connector logic above it.
4. **Splose, Linxio, and Budgetly are tiles only.** `NotConfigured` cards (name, logo
   placeholder, one-line description, "Coming soon") on the dashboard — no connector code,
   so the consolidation story is visible without pretending these three are built.
5. **An integration failure never blocks ODIP's own workflows.** Overspend, a degraded
   connector, a stuck sync job — all of it surfaces on the Integrations dashboard, never as
   a 500 thrown into a claims or rostering action. ODIP has to keep working with Xero
   completely down.

## Context — what exists today

- **No prior integration code exists**, with one structural precedent worth copying:
  `NagerHolidayProvider` (public holiday sync) is registered
  `builder.Services.AddHttpClient<Odip.Infrastructure.Services.NagerHolidayProvider>()`
  (`odip-prototype/odip/backend/Odip.Api/Program.cs:176`) — the **typed-client** pattern
  (constructor takes a plain `HttpClient`, injected by the registration call). There is no
  `IHttpClientFactory`-named-client usage anywhere (grepped) — the brief's "named client
  'xero'" language doesn't match this codebase, so Xero/Brevity's HTTP clients below use the
  same typed pattern, not a named client.
- **`HolidaySyncBackgroundService`** (`Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs`)
  is the only hosted service registered anywhere (`AddHostedService<...>()` at
  `Program.cs:182`): constructor-injects `IServiceScopeFactory`/`IConfiguration`/`ILogger<T>`,
  one DI scope per run (line 57), reads config directly via
  `_config.GetValue<int>("HolidaySync:FromYear", 2025)` (line 78) — no `IOptions<T>` binding
  anywhere in the codebase. `IntegrationSyncBackgroundService` (§1) copies this shape exactly.
- **Data Protection is not registered anywhere** (grepped `DataProtection` — zero matches).
  `Odip.Api.csproj` (`Microsoft.NET.Sdk.Web`) gets the ASP.NET Core shared framework for free,
  so `AddDataProtection()` itself needs no new package there — only
  `PersistKeysToDbContext<OdipDbContext>()` does, which ships in the separate
  `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` package. `Odip.Infrastructure.csproj`
  is a plain `Microsoft.NET.Sdk` library (confirmed by reading it) with no shared framework, so
  the `CredentialProtector` service living there (§1) needs
  `Microsoft.AspNetCore.DataProtection.Abstractions` added explicitly just to see
  `IDataProtectionProvider`/`IDataProtector`.
- **No Polly reference exists anywhere** (grepped, zero matches) — the brief's "manual retry,
  no Polly" ruling is therefore the only option that doesn't add a new dependency.
- **Rate limiting** (`Program.cs:208-282`) defines three named policies: `"login"` (sliding
  window, dev-auth exemption branch), `"api"` (fixed window, 100/min per client IP, lines
  261-269 — what every existing authenticated controller uses), and `"public"` (fixed window,
  30/min, for the no-bearer-token caregiver routes, lines 273-281). Every new integrations
  endpoint here is JWT-authenticated, so it uses `"api"` like everything else — no new policy
  needed. None of this governs *outbound* calls: Xero/EH/Brevity traffic ODIP itself makes is
  server-to-server and never touches this limiter.
- **CSP note.** Outside Development, `Program.cs:496` sets a CSP whose `connect-src` allows
  only `'self'` plus the Firebase identity endpoints. This governs what the **browser** may
  fetch — it has no effect on backend outbound calls to Xero/Brevity/EH, which run
  server-side. The Xero OAuth flow is a full top-level redirect to `login.xero.com`, not an
  XHR, so `connect-src` doesn't gate it either. No CSP change is needed for this feature.
- **Audit exclusion is property-name-keyed, globally, not per entity type.**
  `AuditedEntities.ExcludedProperties` (`Odip.Infrastructure/Audit/AuditedEntities.cs:67-70`)
  is currently `{"CreatedAt", "UpdatedAt"}`, checked by `AuditInterceptor.BuildChanges`
  (`AuditInterceptor.cs:113-116`) for every audited entity's every property. Adding
  `"EncryptedCredentials"` to that same set excludes the credential column from every
  audited entity's diff in one line — the smallest possible fix, safe because only
  `IntegrationConnection` will ever have a property with that exact name.
- **`CatalogueImportService`** (`Odip.Infrastructure/Services/CatalogueImportService.cs`) is
  the "import with report" precedent: `PreviewImportAsync` (read-only, per-row
  `IsNew`/`PriceChanged` flags + a `Warnings` list, lines 38-80) then a separate
  `CommitImportAsync` (deactivates existing rows, inserts new ones, lines 86-134). The
  Employment Hero staff-mapping CSV upload (§3) copies this two-call preview/commit shape.
- **`ProviderSettings`** (`Odip.Domain/Entities/ProviderSettings.cs`) is a single tenant-wide
  row — `ProviderSettingsController.Get` does a bare `FirstOrDefaultAsync` with no id (line
  22). Confirmed fields: `ABN` (line 11), `State` (default `"VIC"`, line 14), `GSTRegistered`
  (line 15), plus `OrganisationName`/`Address`/`RegistrationNumber`/banking fields
  (`ProviderSettingsController.cs:25-33`). The Xero connector reads `GSTRegistered`/`State`
  from here exactly as `InvoiceService` already does.
- **`TripClaimStatus` correction to the approved brief.** `Odip.Domain/Enums/Enums.cs:385-395` defines
  **eight** values — `Draft=0, Ready=1, Submitted=2, Approved=3, Paid=4, PartiallyPaid=5,
  Rejected=6, Cancelled=7` — not the seven the source-facts pass listed; `Cancelled=7`
  exists too. `Ready` is the correct trigger for `XeroPushInvoices`: `UpdateClaim`
  (`ClaimsController.cs:136-141`) treats `Submitted`/`Paid` as externally-facing transitions
  with their own side effects already, so `Ready` — sitting between `Draft` and `Submitted`
  — is ODIP's own "internally reviewed, about to go out" state, the natural push point.
- **Significant correction to the approved brief: a `TripClaim` is not 1:1 with an invoice.**
  `InvoiceService.GenerateInvoiceAsync(Guid claimId, Guid bookingId, ...)`
  (`InvoiceService.cs:24-25`) generates one PDF **per (claim, participant booking) pair** — a
  claim can carry `ClaimLineItem`s across several `ParticipantBooking`s (several participants
  on one trip), invoice-numbered
  `$"INV-{claim.ClaimReference}-{booking.Id.ToString("N")[..8].ToUpper()}"` (line 53). The
  brief's "`InvoiceNumber` = `ClaimReference`" idempotency rule doesn't hold at claim
  granularity — §2 pushes at the same (claim, booking) granularity the existing PDF path
  uses, reusing that exact number format for Xero's own `InvoiceNumber`. Note also: the
  shift-completion spec (`docs/specs/2026-09-08-shift-completion-design.md:210-226`) adds a
  second claim shape, `TripClaim.Kind == Shift` (no `ParticipantBooking` at all,
  `ClaimLineItem.ShiftId` instead) — §2's push job branches on `Kind` accordingly.
- **`TripClaim` is not `ITenantEntity`.** `Odip.Domain/Entities/TripClaim.cs` declares no
  `TenantId` and implements no `ITenantEntity` (confirmed by reading the file — the class
  body has no such property or interface), and its `modelBuilder.Entity<TripClaim>(...)`
  configuration (`OdipDbContext.cs:675`) sets up no tenant query filter. Every other
  tenant-scoped entity in this codebase gets that filter automatically; `TripClaim` does not
  — a bare `_db.TripClaims.Where(...)` inside a tenant-scoped `OdipDbContext` (§1) returns
  every tenant's rows, not just the ambient one. `XeroPushInvoices` (§2) must scope
  explicitly through the parent it does have a `TenantId` on: `TripInstance.TenantId` for a
  `Trip`-kind claim, `Participant.TenantId` for a `Shift`-kind claim.
- **Bill-to resolution**, exactly as `InvoiceService` computes it (lines 41, 60-72):
  `var planType = booking.PlanTypeOverride ?? booking.Participant.PlanType;` — `AgencyManaged`
  throws today ("Agency-managed participants use the BPR CSV, not invoices"); `PlanManaged`
  bills `participant.PlanManagerContact` (a `Contact`: `FullName`/`Organisation`/address
  fields); `SelfManaged` bills the `Participant` directly. `PlanType`
  (`Odip.Domain/Enums/Enums.cs:3`): `SelfManaged, PlanManaged, AgencyManaged`.
- **GST.** `ClaimGenerationService` sets each line item's `GSTCode` from
  `settings.GSTRegistered ? GSTCode.P1 : GSTCode.P2` (`ClaimGenerationService.cs:95`).
  `GSTCode` (`Odip.Domain/Enums/Enums.cs:426`): `P1=0, P2=1, P5=2, GST=3, NoGST=4, Exempt=5`. Which of these
  six map to which Xero `TaxType` is a finance-team decision this grep can't settle —
  flagged in Open questions, with a safe interim default.
- **Correction to the approved brief: there is no separate `StaffMember` entity.** Per
  `User.cs`'s own doc comment (lines 6-10), the former `Staff` entity was absorbed into
  `User` during staff/user-unification — every staff member IS a `User` row, with `Email`
  (non-nullable, line 18) and `FullName` already on it. Employment Hero's "staff email
  fallback" and every `ExternalRef.EntityType = "StaffMember"` row resolve against
  `Odip.Domain.Entities.User` — `"StaffMember"` stays the `EntityType` label, but `EntityId`
  is a `User.Id`.
- **Settings routing precedent.** `/settings` (`frontend/src/App.tsx:127`) renders
  `SettingsPage.tsx`, a single page with an internal tab strip (`allTabs`, line 120, filtered
  by `superAdminOnly`, rendered via `TabNav`) — every existing settings surface is a tab
  inside that page; there's no precedent for a settings sub-*route*. `/rostering/leave`
  (`App.tsx:137`) is the closer precedent: a distinct page at a nested path, gated by its own
  `PageKey` (`leave-approvals`) rather than the parent's. `/settings/integrations` follows
  that shape, because it needs a materially different layout (a tile grid) and tighter roles
  (Admin/SuperAdmin only) than `settings` currently enforces.
- **`permissions.ts`'s `canAccessPage`** (`frontend/src/lib/permissions.ts:78-81`) only
  special-cases `SupportWorker` via `SUPPORT_WORKER_PAGES` — every other role passes for
  every `PageKey` today (Coordinator passes `canAccessPage('settings')`, only blocked at the
  write-action level, e.g. `canEditProviderSettings`, line 204). There is no existing
  "Admin/SuperAdmin-only page" precedent — §5 adds an `ADMIN_ONLY_PAGES` array beside
  `SUPPORT_WORKER_PAGES` and extends `canAccessPage` with one more branch.
- **`mock-api/server.js` dispatch mechanics.** GET dispatch (`routes`, line 743, matched
  932-938) never reads `url.searchParams` — confirmed by reading the loop, which calls
  `handler(...params)` with only path-segment params. POST dispatch (`postRoutes`, line 859,
  matched 956-963) is **POST-only** — `PUT`/`PATCH` fall through to the generic echo-back
  handler. So `PUT integrations/{kind}/settings` gets the generic echo (fine — a settings
  save just needs to look successful), while every action needing a specific response shape
  (`connect`, `sync`, `probe`, `resume`, `retry`, accept/reject) needs its own `postRoutes`
  entry, same as the leave feature's approve/decline/cancel entries.

## 1. Framework core

New folders: `Odip.Domain/Integrations/` (entities/enums) and
`Odip.Infrastructure/Integrations/` (connectors, background service, credential protector),
mirroring how `Odip.Domain/Notifications/`/`Odip.Infrastructure/Notifications/` are laid out
in the sibling spec. One migration, `AddIntegrationFramework` (after
`20260907071508_AddStaffLeaveAndRecurringUnavailability`, the current latest per the fact
pass — verify against whatever else has landed by the time this ships, since the shift-
completion and notifications specs both queue migrations of their own).

```csharp
// Odip.Domain/Integrations/IntegrationEnums.cs (new file)

public enum IntegrationKind
{
    Xero = 1,
    EmploymentHero = 2,
    Brevity = 3,
    Splose = 4,
    Linxio = 5,
    Budgetly = 6,
}
// Append-only — never renumber, same discipline as CaregiverSubmissionStatus
// ("do not reorder") and NotificationEventType (sibling notifications spec, §1).

public enum IntegrationStatus { NotConfigured = 0, Connected = 1, FileBased = 2, Degraded = 3, Disconnected = 4 }
```

| `IntegrationStatus` | Meaning |
|---|---|
| `NotConfigured` | No `IntegrationConnection` row exists for `(TenantId, Kind)` yet — the tile's default state, and permanent state for Splose/Linxio/Budgetly (§5). |
| `Connected` | Credentials are present and the most recent sync or probe succeeded (Xero). |
| `FileBased` | The connector has no live transport — "connected" means a mapping template/settings exist, not that anything was contacted (Employment Hero, permanently, in v1). |
| `Degraded` | The live transport is failing a fingerprint or health check, or has ≥3 consecutive sync failures — sync is paused (`PausedUntil` set) until an admin resumes. |
| `Disconnected` | The user explicitly disconnected, or a refresh token was revoked/expired and re-auth is required. |

```csharp
// Odip.Domain/Integrations/IntegrationConnection.cs (new file)

public class IntegrationConnection : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public IntegrationKind Kind { get; set; }
    public IntegrationStatus Status { get; set; } = IntegrationStatus.NotConfigured;
    public string DisplayName { get; set; } = string.Empty;   // e.g. the connected Xero org name
    public string? EncryptedCredentials { get; set; }         // Data Protection payload — see below
    public DateTime? CredentialsUpdatedAt { get; set; }
    public string? ExternalTenantId { get; set; }              // e.g. Xero's own tenant id from `connections`
    public string SettingsJson { get; set; } = "{}";           // per-connector non-secret config (jsonb)
    public DateTime? LastSyncAt { get; set; }
    public DateTime? LastSuccessAt { get; set; }
    public string? LastError { get; set; }
    public int ConsecutiveFailures { get; set; }
    public DateTime? PausedUntil { get; set; }
    public Guid? ConnectedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
```

`OdipDbContext` configuration: `HasIndex(x => new { x.TenantId, x.Kind }).IsUnique()` — one
row per tenant per kind, plus the standard `HasQueryFilter`/`HasIndex(TenantId)` every
tenant-scoped entity gets (from `OdipDbContext.cs:1436` on, per the sibling specs' own
citation of that block).

**Credential encryption.** `CredentialProtector`
(`Odip.Infrastructure/Integrations/CredentialProtector.cs`, scoped —
`AddScoped<CredentialProtector>()`) wraps
`IDataProtectionProvider.CreateProtector("Odip.Integrations.Credentials.v1")`, exposing
`string Protect(string plaintext)` / `string Unprotect(string cipherText)`. The purpose
string is versioned (`.v1`) so a future credential-format change can add `.v2` without
breaking rows still encrypted under the old purpose. `Program.cs` adds:

```csharp
builder.Services.AddDataProtection()
    .PersistKeysToDbContext<OdipDbContext>();
```

`PersistKeysToDbContext<T>()` requires `T` to implement `IDataProtectionKeyContext`
(`DbSet<DataProtectionKey> DataProtectionKeys { get; set; }`) — `OdipDbContext` gains that
interface and DbSet; EF Core self-configures the `DataProtectionKeys` table from the
package's own model (no manual `OnModelCreating` entry), swept into the same
`AddIntegrationFramework` migration. This is what makes the key ring survive a container
restart instead of regenerating (and orphaning every encrypted credential) — Data
Protection's filesystem-key default doesn't survive a container recreate on this deployment.

**Threat model, stated honestly.** This is encryption-**at-rest** for the
`EncryptedCredentials` column — it protects a leaked Postgres backup, not against someone
with access to the running app server, who can always call `Unprotect` (the key ring lives
in the same database). That's the accepted v1 posture; a proper HSM/KMS-backed secret store
is out of scope (see below). Plaintext credentials are never logged and never returned by any
API — every read-side DTO exposes only `hasCredentials: bool` and, for Xero, the connected
org's display name.

```csharp
// Odip.Domain/Integrations/ExternalRef.cs (new file)
public class ExternalRef : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public IntegrationKind Kind { get; set; }
    public string EntityType { get; set; } = string.Empty;   // "Participant" | "Contact" | "ParticipantBooking" | "TripClaim" | "StaffMember"
    public Guid EntityId { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string? ExternalUrl { get; set; }
    public DateTime LastSyncedAt { get; set; } = DateTime.UtcNow;
    public string? SyncHash { get; set; }
}
```

`HasIndex(x => new { x.TenantId, x.Kind, x.EntityType, x.EntityId }).IsUnique()` and
`HasIndex(x => new { x.TenantId, x.Kind, x.EntityType, x.ExternalId }).IsUnique()`. One
cross-walk table beats a `XeroContactId`/`XeroInvoiceId`/... column sprayed across
`Participant`/`Contact`/`TripClaim`/`User`: no schema churn per connector added or dropped,
domain entities stay connector-agnostic, "forget mappings" on disconnect is one
`DELETE FROM ExternalRef WHERE Kind = ...` instead of a column reset scattered across five
tables, and "is this synced to anything" is one generic query instead of a UNION.

```csharp
// Odip.Domain/Integrations/SyncJob.cs (new file)
public enum SyncJobType
{
    XeroPushInvoices = 1, XeroPullPayments = 2,
    EhExportTimesheets = 3,
    BrevityPullParticipants = 4, BrevityPullStaff = 5, BrevityPullShifts = 6,
}
public enum SyncJobStatus { Queued = 0, Running = 1, Succeeded = 2, Failed = 3, DeadLettered = 4 }

public class SyncJob : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public IntegrationKind Kind { get; set; }
    public SyncJobType JobType { get; set; }
    public SyncJobStatus Status { get; set; } = SyncJobStatus.Queued;
    public int Attempt { get; set; }
    public const int MaxAttempts = 5;
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public int ItemsProcessed { get; set; }
    public int ItemsFailed { get; set; }
    public string? Error { get; set; }
    public Guid? TriggeredByUserId { get; set; }   // null = scheduled, not manual
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Npgsql xmin concurrency token — see §1's claim-loop discussion below.
    [Timestamp] public uint RowVersion { get; set; }
}
```

Backoff schedule `[1, 5, 15, 60, 240]` minutes, identical to the notifications outbox
(sibling spec §3) — deliberately the same numbers so an operator only has to learn one
retry cadence across the whole app. `DeadLettered` after `MaxAttempts` (5); the dashboard's
per-connector job list shows a dead-letter count with a Retry button that resets
`Status = Queued, Attempt = 0, NextAttemptAt = now`.

```csharp
// Odip.Domain/Integrations/SyncItemResult.cs (new file)
public enum SyncItemOutcome { Created = 0, Updated = 1, Skipped = 2, Failed = 3 }
public class SyncItemResult
{
    public Guid Id { get; set; }
    public Guid SyncJobId { get; set; }
    public SyncJob? SyncJob { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string? ExternalId { get; set; }
    public SyncItemOutcome Outcome { get; set; }
    public string? Message { get; set; }
}
```

Not itself `ITenantEntity` — it's always read through its parent `SyncJob`, which is
tenant-scoped; `HasIndex(x => x.SyncJobId)` is enough. This is the per-item log that makes
"why did invoice #4 in this run fail" answerable without re-running the job.

```csharp
// Odip.Domain/Integrations/InboundChange.cs (new file)
public enum InboundProposedAction { Create = 0, Update = 1, Unlink = 2 }
public enum InboundChangeStatus { Pending = 0, Accepted = 1, Rejected = 2, Superseded = 3 }

public class InboundChange : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public IntegrationKind Kind { get; set; }
    public string EntityType { get; set; } = string.Empty;   // "Participant" | "StaffMember" | "Shift"
    public string ExternalId { get; set; } = string.Empty;
    public InboundProposedAction ProposedAction { get; set; }
    public Guid? MatchedEntityId { get; set; }
    public string? BeforeJson { get; set; }
    public string AfterJson { get; set; } = string.Empty;
    public string DiffSummary { get; set; } = string.Empty;
    public InboundChangeStatus Status { get; set; } = InboundChangeStatus.Pending;
    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public Guid SyncJobId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

This is the staging table Brevity (§4) writes to, and *only* Brevity writes to, in v1 —
Accept applies `AfterJson` onto the matched/new domain entity inside a transaction and writes
an `ExternalRef`; Reject just records the decision. A row superseded by a newer pull for the
same `(Kind, EntityType, ExternalId)` while still `Pending` flips to `Superseded` rather than
being deleted, so the review queue never shows two competing proposals for the same record.

**Audit.** `IntegrationConnection` and `InboundChange` join `AuditedEntities.Types`
(`Odip.Infrastructure/Audit/AuditedEntities.cs:8`) on day one — a credential rotation, a
disconnect, and every Accept/Reject decision are exactly the kind of history this repo
already audits for leave decisions and caregiver submissions. `EncryptedCredentials` is
excluded from the diff via the one-line `ExcludedProperties` addition described in Context.
`SyncJob`/`SyncItemResult` are **not** audited — like the notification outbox's own rows
(sibling spec §1), they churn every dispatcher tick and would flood `AuditLog` with
zero-investigative-value noise; their own `Status`/`Error`/`ItemsFailed` fields are already
the purpose-built trail.

```csharp
// Odip.Application/Interfaces/IIntegrationConnector.cs (new file, mirrors
// IPublicHolidaySyncService's placement)
public record ProbeResult(bool Success, string? Message);
public record SyncResult(int ItemsProcessed, int ItemsFailed, IReadOnlyList<SyncItemResult> Items);

public interface IIntegrationConnector
{
    IntegrationKind Kind { get; }
    IReadOnlyList<SyncJobType> SupportedJobs { get; }
    Task<ProbeResult> ProbeAsync(IntegrationConnection connection, CancellationToken ct);
    Task<SyncResult> RunAsync(SyncJob job, IntegrationConnection connection, CancellationToken ct);
}

public interface IIntegrationRegistry
{
    IReadOnlyList<IIntegrationConnector> Connectors { get; }
    IIntegrationConnector? Find(IntegrationKind kind);
}
```

`IntegrationRegistry` (`Odip.Infrastructure/Integrations/IntegrationRegistry.cs`) is a thin
scoped service taking `IEnumerable<IIntegrationConnector>` from DI (each connector
self-registers `AddScoped<IIntegrationConnector, XeroConnector>()` etc. in `Program.cs`, one
line per connector). Kinds with **no** registered connector — Splose, Linxio, Budgetly in v1
— are never `Find`-able; every generic endpoint and the dashboard tile logic treat that as
"permanently `NotConfigured`, tile action is 'Coming soon'," since no endpoint can create a
connection row for a kind with no connector (Error handling).

**`IntegrationSyncBackgroundService`**
(`Odip.Infrastructure/BackgroundServices/IntegrationSyncBackgroundService.cs`, registered
`AddHostedService<...>()` beside `HolidaySyncBackgroundService`/
`NotificationDispatchBackgroundService`) — same shape as
`HolidaySyncBackgroundService`: constructor-injected
`IServiceScopeFactory`/`IConfiguration`/`ILogger<T>`, a loop with
`Task.Delay(TimeSpan.FromSeconds(pollSeconds), stoppingToken)` between ticks, one DI scope
per tick, `pollSeconds = _config.GetValue<int>("Integrations:PollSeconds", 30)` — direct
`IConfiguration.GetValue`, no `Options` class, matching every other config read in this
codebase.

**Per-tick algorithm:**
1. Kill switch: if `_config.GetValue<bool>("Integrations:Enabled", true)` is `false`, skip
   the tick — jobs stay `Queued`, nothing claimed, nothing dropped. Same ruling as the
   notification dispatcher's own kill switch (sibling spec §3.2).
2. **Scheduling.** For each `(TenantId, Kind)` with a `Connected`/`FileBased` connection and
   at least one `SyncJobType` due (compare `IntegrationConnection.LastSyncAt` against the
   per-connector schedule in `SettingsJson` — default Xero pull-payments every 6 hours,
   Brevity pull nightly at 02:00 local; `EhExportTimesheets`/`XeroPushInvoices` are
   user-triggered only, no default schedule), insert one `Queued` `SyncJob` if none is
   already `Queued`/`Running` for that `(Kind, JobType)`.
3. **Claim, one job at a time.** Load up to `Integrations:BatchSize` (default 10) `Queued`
   rows with `NextAttemptAt <= now`, ordered by `CreatedAt`. For each: set `Status =
   Running`, `StartedAt = now`, `Attempt += 1`, `SaveChangesAsync`. This is the EF equivalent
   of `FOR UPDATE SKIP LOCKED` reachable without raw SQL: `SyncJob.RowVersion` (`[Timestamp]`,
   mapped by Npgsql to Postgres `xmin`) makes that save a compare-and-swap — a race (in
   practice: a manual "Sync now" click racing the tick) throws
   `DbUpdateConcurrencyException`, caught and skipped for this tick rather than double-processed.
4. Build a tenant-scoped `OdipDbContext` using
   `Odip.Infrastructure/Notifications/ScopedTenantOverride.cs` (sibling spec §3 — referenced
   by path, not redefined here): `new OdipDbContext(dbOptions, new ScopedTenantOverride {
   TenantId = job.TenantId })`. Resolve via `IIntegrationRegistry.Find(job.Kind)`, call
   `RunAsync(job, connection, ct)`.
5. On success: `Status = Succeeded`, persist `SyncItemResult` rows, reset
   `ConsecutiveFailures = 0`, set `LastSyncAt = LastSuccessAt = now`.
6. On failure: `Attempt >= SyncJob.MaxAttempts` (5) → `DeadLettered`; else `Queued` with
   `NextAttemptAt = now + backoff[Attempt]` (same `[1,5,15,60,240]` minute table as the
   notification dispatcher). Increment `ConsecutiveFailures`; at `>= 3`, flip `Status =
   Degraded`, set `PausedUntil` (24h, or indefinite for a fingerprint mismatch — §4), and call
   `INotificationRaiser.RaiseAsync` (sibling spec's exact signature) with `type =
   NotificationEventType.IntegrationDegraded` (reserved at value 10, that spec's §1) and
   `recipientUserIds` = every tenant `User` with `Role == Admin`. A `Degraded` connection is
   skipped by scheduling until `POST integrations/{kind}/resume` (§5) clears
   `PausedUntil`/`ConsecutiveFailures`.

**Single-instance constraint.** Identical caveat to the notification dispatcher (sibling
spec §3): no distributed lock, no leader election — one running API instance, matching the
current single-container deployment. The `xmin` check in step 3 only guards a manual-trigger
race within one process; a second dispatcher process would need a real advisory lock, not
built now since a single replica is the deployed reality.

## 2. Xero connector

`Odip.Infrastructure/Integrations/Xero/` — `XeroConnector` (`IIntegrationConnector`),
`XeroApiClient` (the typed `HttpClient` wrapper, registered
`builder.Services.AddHttpClient<XeroApiClient>()` in `Program.cs`, same call shape as
`NagerHolidayProvider`'s registration), `XeroOAuthService` (authorize-URL building, code
exchange, token refresh).

**OAuth2 authorization-code + PKCE.**

- `GET api/v1/integrations/xero/connect` (Admin/SuperAdmin) — generates a PKCE
  `code_verifier`/`code_challenge` pair and a random `state`, builds the Xero authorize URL
  (`client_id` from `Integrations:Xero:ClientId`, `redirect_uri` from
  `Integrations:Xero:RedirectUri`, `scope = "openid profile email accounting.transactions
  accounting.contacts offline_access"`), and returns it for the frontend to redirect/open in
  a popup to. Before returning, it persists a row:

  ```csharp
  // Odip.Domain/Integrations/OAuthState.cs (new file)
  public class OAuthState : ITenantEntity
  {
      public Guid Id { get; set; }            // = the `state` query parameter, opaque random
      public Guid TenantId { get; set; }
      public IntegrationKind Kind { get; set; }
      public string CodeVerifier { get; set; } = string.Empty;
      public Guid CreatedByUserId { get; set; }
      public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(10);
  }
  ```

  **A dedicated short-lived table, not a column on `IntegrationConnection` — deliberately.**
  The connection row's lifetime is "as long as the tenant stays connected" (years); the PKCE
  verifier's is "until the OAuth redirect finishes or is abandoned" (minutes). Cramming a
  10-minute value into a row meant to persist indefinitely means either stale verifiers
  sitting in `SettingsJson` forever or bespoke cleanup logic bolted onto a row with no other
  notion of "this field expires." A dedicated table needs none: the callback deletes its own
  row on use, and `connect` opportunistically deletes the tenant's expired rows before
  inserting a new one — no background job. `CodeVerifier` is not Data-Protection-encrypted:
  it's a one-time nonce, worthless within minutes, not a durable secret like a refresh token.

- `GET api/v1/integrations/xero/callback?code=&state=` — looks up `OAuthState` by `state`;
  missing/expired → 400 (Error handling). Exchanges `code` (with the stored `CodeVerifier`)
  for tokens via Xero's token endpoint, calls Xero's `connections` endpoint to get the
  tenant's `ExternalTenantId` and org name, `Protect`s the access+refresh tokens into
  `EncryptedCredentials` (a small JSON envelope: `{accessToken, refreshToken, expiresAt}`),
  sets `Status = Connected`, `DisplayName = <org name>`, `ConnectedByUserId`, deletes the
  `OAuthState` row. If a `Connected` Xero connection already exists for the tenant → 409
  unless the request carries `?reconnect=true` (Error handling).
- **Token lifetimes.** Xero access tokens expire in 30 minutes, refresh tokens in 60 days,
  and Xero **rotates the refresh token on every use** — every refresh response replaces both
  tokens in `EncryptedCredentials`, never just the access token. A refresh failure (revoked
  token, expired 60-day window) flips `Status = Disconnected` and raises
  `IntegrationDegraded` to admins.
- **Retry, no Polly.** `XeroApiClient` wraps each call in a small manual loop (up to 3
  attempts, exponential 1s/2s/4s) for transient network/5xx failures only — 4xx (other than
  429, below) is never retried. Intentionally minimal; Polly isn't referenced anywhere in
  this codebase (Context) and isn't added for one connector's retry logic.
- `POST api/v1/integrations/xero/disconnect` — revokes the refresh token via Xero's
  revocation endpoint, clears `EncryptedCredentials`/`CredentialsUpdatedAt`, sets
  `Status = Disconnected`. `ExternalRef` rows for Xero are **kept** by default (so
  reconnecting doesn't re-push and duplicate invoices already sent) unless the request body
  sets `forgetMappings: true`, which deletes them.

**`XeroPushInvoices`.** Handles `TripClaim.Kind` (`Trip = 0` / `Shift = 1`, added by the
sibling shift-completion spec — `docs/specs/2026-09-08-shift-completion-design.md:210-226`)
differently, since a `Kind == Shift` claim has no `ParticipantBooking` at all: its
`ClaimLineItem`s carry `ShiftId` instead, with `ParticipantBookingId` null, per that spec's
own invariant.

**Tenant scoping.** As noted in Context, `TripClaim` is not `ITenantEntity` — the load step
below must filter explicitly through the parent that does carry `TenantId`, not rely on a
query filter that doesn't exist for this entity: `Kind == Trip` rows via
`.Include(c => c.TripInstance)` and `c.TripInstance.TenantId == job.TenantId`; `Kind ==
Shift` rows via `.Include(c => c.Participant)` and `c.Participant.TenantId ==
job.TenantId`. Exactly one of `TripInstance`/`Participant` is non-null per claim (the shift-
completion spec's own invariant), so a single query unions both with no overlap risk.

1. Load every `Status == TripClaimStatus.Ready` claim for the tenant, scoped as above.
2. **`Kind == Trip`** — because a claim may span multiple `ParticipantBooking`s (several
   participants on one trip), group the claim's `ClaimLineItem`s by `ParticipantBookingId`
   and push **one invoice per (claim, booking) group**, matching `InvoiceService`'s own unit
   of work. Per group: resolve `planType = booking.PlanTypeOverride ??
   booking.Participant.PlanType`; skip (not fail — `SyncItemOutcome.Skipped`) if
   `AgencyManaged` (NDIA-managed claims go through PRODA, never Xero); skip if an
   `ExternalRef` already exists for `(Xero, "ParticipantBooking", bookingId)`.
   `InvoiceNumber = $"INV-{claim.ClaimReference}-{booking.Id.ToString("N")[..8].ToUpper()}"`
   (identical to `InvoiceService`'s existing PDF numbering — Context); `ExternalRef` keyed
   `(Xero, "ParticipantBooking", bookingId)`.
3. **`Kind == Shift`** (new — there is no booking, so **one invoice covers the whole
   claim**). Resolve `planType = claim.Participant.PlanType` directly — a shift-kind claim's
   line items have no `ParticipantBooking`, so there is no `PlanTypeOverride` to consult;
   skip if `AgencyManaged`; skip if an `ExternalRef` already exists for `(Xero, "TripClaim",
   claim.Id)`. `InvoiceNumber = $"INV-{claim.ClaimReference}"` (no booking suffix — there is
   only ever one invoice for a shift-kind claim); `ExternalRef` keyed `(Xero, "TripClaim",
   claim.Id)`.
4. Resolve the Xero Contact — the same rule for both kinds, against whichever `Participant`
   was resolved above: `SelfManaged` → the `Participant`; `PlanManaged` →
   `participant.PlanManagerContact` — each via its own `ExternalRef (Xero, "Participant"/
   "Contact", id)`. If no `ExternalRef` exists yet, search Xero's Contacts API by name/email
   first (avoid a duplicate from a prior job run), create if genuinely absent, write the ref.
5. Build the Xero `Invoice`: `Type = ACCREC`, `Contact` from step 4, `Reference =
   claim.ClaimReference`, `InvoiceNumber` from step 2/3, one `LineItem` per `ClaimLineItem`
   in scope (`Description`, `Quantity = Hours`, `UnitAmount = UnitPrice`, `AccountCode` from
   `SettingsJson.SalesAccountCode`, `TaxType` from `SettingsJson.TaxTypeMap` — Open questions
   for the default).
6. **Idempotency.** Before creating, query Xero for an existing invoice with this
   `InvoiceNumber` (Xero enforces per-org uniqueness, so this doubles as a correctness check)
   — if found, use its `InvoiceID` instead. Write the `ExternalRef` and `SyncItemResult` in
   the same transaction as this lookup-or-create, so a retry after a network failure
   re-queries by number instead of re-creating.
7. Once every eligible unit is pushed — every non-`AgencyManaged` booking group for a `Trip`
   claim, or the single invoice for a `Shift` claim — flip `TripClaim.Status = Submitted` and
   `SubmittedDate = DateTime.UtcNow` — the exact fields `UpdateClaim` already sets on that
   transition (`ClaimsController.cs:139`). A partially-pushed `Trip` claim (one booking
   succeeded, another hit a transient error) stays `Ready` so the next run only retries the
   missing groups.
8. **Rate limits.** Xero allows 60 calls/minute, 5,000/day per org. The job honours
   `Retry-After` on a 429 by requeuing the whole `SyncJob` (not failing it), and caps itself
   at 50 invoices per run to leave headroom for the pull job and any manual "Sync now."

This job's PR (Delivery, PR 2) has a build-order dependency on the shift-completion spec's PR
3 (its `AddShiftClaims` migration, which adds `TripClaim.Kind`/`ParticipantId`/
`PeriodFrom`/`PeriodTo` and `ClaimLineItem.ShiftId` — see Delivery).

**`XeroPullPayments`.** Fetches invoices modified since `IntegrationConnection.LastSuccessAt`
(Xero's `If-Modified-Since` header) via Xero's Invoices endpoint. For each returned invoice
with `Status == "PAID"`, look up its `ExternalRef` by `ExternalId` (the Xero `InvoiceID`) —
a `(Xero, "ParticipantBooking", bookingId)` match means a `Trip`-kind claim, stamping every
`ClaimLineItem` in that booking's most recent claim; a `(Xero, "TripClaim", claimId)` match
means a `Shift`-kind claim, stamping that claim directly. Either way the target fields are on
`TripClaim` itself.

**`PaidDate` already exists — this is a reuse, not a new field.**
`Odip.Domain/Entities/TripClaim.cs:18` already declares
`public DateTime? PaidDate { get; set; }` (alongside `SubmittedDate` at line 17), already
exposed in `ClaimsController.cs:107`'s `TripClaimDetailDto`, and already set manually by
`UpdateClaim`'s `Submitted`/`Paid` transitions (`ClaimsController.cs:139-140`). This job sets
that same column — it does not add `TripClaim.PaidAt`. The only new column is
`PaymentReference` (a Xero payment reference/receipt number), via the additive migration
`AddClaimPaymentFields` (PR2):

```csharp
// Odip.Domain/Entities/TripClaim.cs — append-only
public string? PaymentReference { get; set; }   // Xero payment reference / receipt number, max 64 chars
```

This job **does not** touch `TripClaim.Status` — ODIP's own internal review state (Draft →
Ready → Submitted → Approved/Rejected) is deliberately distinct from "has Xero recorded a
payment," the same reasoning the shift-completion spec uses to keep billing hours separate
from clocked hours: two systems own two different facts, and collapsing them loses
information. `PaidDate` (reused) and `PaymentReference` (new) are facts this job writes
alongside `Status`, not a replacement for it — a claim's own `Status` might already be
`Paid` from a manual `UpdateClaim` call before this job ever runs, in which case it only
backfills `PaymentReference` and leaves `PaidDate` as whatever value is already there
(never overwritten once set, so a manually-recorded date is never clobbered by a later poll).

## 3. Employment Hero connector

`Odip.Infrastructure/Integrations/EmploymentHero/` — no HTTP client, no `IIntegrationConnector`
live-sync job beyond the export/mapping actions below (there's nothing to "run" on a
schedule; `EhExportTimesheets` only ever fires from an explicit user action).

**Export.** `POST api/v1/integrations/employment-hero/timesheets/export` (body `{ from, to
}`, Admin/SuperAdmin) streams a CSV of Approved `ShiftCompletion` rows (join `Shift` →
`User`) in the period, one row per shift:

| Canonical column | Source |
|---|---|
| `EmployeeIdentifier` | `ExternalRef (EmploymentHero, "StaffMember", user.Id)` if mapped, else `user.Email` — lets a provider start exporting before the staff-mapping table is finished. |
| `ShiftDate` | `Shift.ServiceDate` |
| `RosteredStart` / `RosteredEnd` | `Shift.StartTime`/`Shift.EndTime` — **billed hours are rostered hours**, per the shift-completion spec's ruling; these two columns are what payroll should import. |
| `ActualStart` / `ActualEnd` | `ShiftCompletion.ActualStart`/`ActualEnd` — extra, informational, never the billed figure. |
| `BreakMinutes` | `0` — no break model exists on `Shift`/`ShiftCompletion`; column exists for shape stability if one is added later. |
| `WorkType` / `Location` | `SettingsJson.DefaultWorkType` — one flat value per tenant, no per-shift classification exists. |
| `ShiftId` | `Shift.Id` — traceability back to ODIP, not an EH field. |

**This spec does not claim an exact Employment Hero column-header set as fact** — nothing in
this codebase establishes what EH's own CSV importer expects. `SettingsJson.ColumnTemplate`
maps each canonical column to a configurable output header name; the shipped default is
labelled *"Employment Hero timesheet import (verify against your EH template)"*, and
confirming the real EH header set is an Open question, not asserted here.

**Staff mapping.** A table UI (§5) pairs each `User` with an EH employee id, writing
`ExternalRef (EmploymentHero, "StaffMember", user.Id) → employeeId`. Bulk mapping via CSV
upload reuses `CatalogueImportService`'s preview/commit shape (Context): `POST
.../mapping/preview` returns a row-by-row preview (matched by email, `IsNew`/`AlreadyMapped`
flags, unmatched-email warnings) without writing; `POST .../mapping/commit` applies it.
`Status` flips to `FileBased` the moment a `ColumnTemplate` exists, regardless of whether any
staff are mapped yet — "connected" for this file-based connector means "configured to export
against," not "a live system was contacted."

**Export history.** Every export creates a `SyncJob` (`JobType = EhExportTimesheets`,
`Status = Succeeded` immediately — synchronous, not queued) with `ItemsProcessed` = row
count, so "what's already gone to payroll" is answerable from the same jobs list every
connector uses. Re-exporting an already-exported shift is allowed (payroll sometimes needs a
re-send) but flagged: the response DTO carries `alreadyExportedCount`, computed against prior
`EhExportTimesheets` jobs' `SyncItemResult.EntityId` rows in the requested range.

## 4. Brevity connector — the reverse-engineered v1

`Odip.Infrastructure/Integrations/Brevity/` — `BrevityConnector` (`IIntegrationConnector`),
`BrevityWebTransport` (v1, does the actual work), `BrevityApiTransport` (stub, throws
`NotSupportedException` until Brevity ships an official API), both behind:

```csharp
// Odip.Application/Interfaces/IBrevityTransport.cs (new file)
public interface IBrevityTransport
{
    Task<BrevitySession> LoginAsync(BrevityCredentials credentials, CancellationToken ct);
    Task<IReadOnlyList<BrevityParticipant>> ListParticipantsAsync(BrevitySession session, DateTime? since, CancellationToken ct);
    Task<IReadOnlyList<BrevityStaff>> ListStaffAsync(BrevitySession session, DateTime? since, CancellationToken ct);
    Task<IReadOnlyList<BrevityShift>> ListShiftsAsync(BrevitySession session, DateOnly from, DateOnly to, CancellationToken ct);
}
```

`BrevityConnector.RunAsync` resolves the registered `IBrevityTransport` (v1:
`BrevityWebTransport`) from DI — swapping in `BrevityApiTransport` later is a one-line DI
registration change with zero change to `BrevityConnector` itself, which is the entire point
of the seam.

**`BrevityWebTransport`.** Signs in using the tenant's own Brevity username/password (stored
via the same `CredentialProtector` path as Xero's tokens), performs whatever multi-step
login flow Brevity's web app actually uses (captured during discovery, Appendix A), keeps
the resulting session cookie **in memory only** for one `SyncJob` run — never persisted,
since it's a live bearer token with a short natural lifetime, not a durable secret. It then
calls the same JSON endpoints the Brevity web app itself calls and maps each response into
the DTOs `IBrevityTransport` declares.

**Fingerprints — the guard against Brevity silently changing their frontend.** Each
endpoint's expected response shape is captured as a constant in `BrevityFingerprints.cs`: a
JSON-schema-like signature (required top-level keys + expected types, deliberately tolerant
of *added* fields — only a removed or retyped one should break ODIP). Every response is
validated before mapping; a mismatch throws `BrevityShapeChangedException`, which
`IntegrationSyncBackgroundService` treats specially: the job fails **without** retry (no
point burning five backoff cycles re-discovering the same shape change), the connection
flips straight to `Degraded`, sync pauses indefinitely (`PausedUntil = null` — manual resume
only, since a shape change needs a human, not a timer), and `IntegrationDegraded` is raised.
The login response itself carries a fingerprint too, catching a changed login page the same way.

**Inbound only, staged.** Every record returned becomes one `InboundChange` row, matched in
order: `ExternalRef (Brevity, EntityType, externalId)` first, then NDIS number
(participants)/email (staff), else `ProposedAction = Create`. **Nothing writes to
`Participants`/`StaffMembers` (`User`)/`Shifts` directly** — every pulled record sits
`Pending` until an Admin/Coordinator reviews it (§5). Bulk-accept is offered only for
`Create` rows; `Update` rows always show a field-level diff and are accepted one at a time.

**Rate limiting and courtesy.** Max 1 request/second, nightly-window-only by default
(configurable, default 02:00 local), a custom `User-Agent` identifying ODIP by name, and a
hard stop — the login fingerprint check — if Brevity's login page itself changes shape.

**Caveats, stated plainly, not glossed over.** Automating a sign-in with a tenant's own
personal Brevity credentials, outside any documented/sanctioned API, may breach Brevity's
Terms of Service — this spec surfaces that legal question, it doesn't resolve it. The
credentials dialog (§5) requires the tenant to accept an explicit consent notice ("You are
authorising ODIP to sign in to Brevity on your behalf... may be subject to Brevity's own
terms of service") before Connect is enabled, and recommends (can't enforce) that the
provider informs Brevity. MFA on the Brevity account breaks this transport outright — the
login fingerprint check detects the unexpected MFA-challenge shape and surfaces it as
`Disconnected` with a message naming MFA specifically. This transport is explicitly a
bridge: the day Brevity ships a real API, `BrevityApiTransport` retires `BrevityWebTransport`
with no change above the transport boundary.

### Appendix A — Discovery procedure

Before `BrevityWebTransport` can be written, a developer captures Brevity's own web-app
traffic and turns it into fixtures and fingerprints:

1. **Capture.** Sign in to Brevity as a test/sandbox tenant with DevTools' Network tab open,
   exercise every screen the connector needs, then "Save all as HAR."
2. **Scrub.** The raw HAR contains real session cookies, auth headers, and participant/staff
   PII — none of that may enter the repository. `tools/brevity/scrub-har.ps1` (created in
   this PR — Delivery) strips every `Cookie`/`Authorization`/`Set-Cookie` header and replaces
   every PII field with synthetic values, preserving field *shape* (types, array lengths,
   nesting) — exactly what a fingerprint needs to describe.
3. **Catalogue.** Every distinct endpoint hit — path, method, pagination/date-filter query
   parameters, response envelope shape — is written up in
   `docs/integrations/brevity-endpoints.md` so the next reverse-engineering pass doesn't
   start from scratch.
4. **Fixture + fingerprint.** Each scrubbed capture becomes a fixture under
   `Odip.Tests/Integrations/Brevity/Fixtures/`, and its `BrevityFingerprints.cs` entry is
   derived directly from that fixture's shape — never invented ahead of a real captured
   response, since a guessed fingerprint is exactly what produces false `Degraded` alerts.

Every `BrevityWebTransport` unit test runs against these scrubbed fixtures via a fake
`HttpMessageHandler` — **no live call to Brevity ever happens in the test suite**, both
because CI has no Brevity sandbox credentials and because hammering a real tenant from every
CI run would itself be a courtesy problem.

## 5. Integrations dashboard (frontend)

**Route** `/settings/integrations`, new `PageKey` `'integrations'`
(`frontend/src/lib/permissions.ts`), gated Admin/SuperAdmin only — narrower than the general
`settings` page (Context: no existing PageKey excludes Coordinator today). This adds a
second array beside `SUPPORT_WORKER_PAGES`:

```ts
const ADMIN_ONLY_PAGES: PageKey[] = ['integrations'];

// canAccessPage, extended:
canAccessPage: (page: PageKey): boolean => {
  if (isSupportWorker) return SUPPORT_WORKER_PAGES.includes(page);
  if (ADMIN_ONLY_PAGES.includes(page)) return isSuperAdmin || isAdmin;
  return true;
},

/** Mirrors every integrations write endpoint's [Authorize(Roles = "Admin,SuperAdmin")]. */
canManageIntegrations: isSuperAdmin || isAdmin,
```

Registered in `App.tsx` beside the other nested-route precedents (`/rostering/leave`):

```tsx
<Route path="/settings/integrations" element={<PrivateRoute page="integrations"><IntegrationsDashboardPage /></PrivateRoute>} />
<Route path="/settings/integrations/brevity/review" element={<PrivateRoute page="integrations"><BrevityInboundReviewPage /></PrivateRoute>} />
```

**Dashboard** (`frontend/src/pages/settings/IntegrationsDashboardPage.tsx`, new file/folder
— no `frontend/src/pages/settings/` directory exists yet) — a `PageHeader` and a grid of six
tiles, one per `IntegrationKind`: name/logo-placeholder/description (a static per-kind array,
matching `SettingsPage.tsx`'s own static `allTabs`); a status chip from `GET integrations`
(grey `NotConfigured`, green `Connected`/`FileBased`, amber `Degraded`, red `Disconnected`);
last/next sync; and a primary action — `NotConfigured` → *Connect* (Xero: OAuth redirect;
EH/Brevity: opens the credentials/template form), `Connected`/`FileBased` → *Configure* (EH
also *Export*, Brevity also *Review N changes*, badge from `GET
integrations/brevity/inbound?status=Pending`), `Degraded` → *Resume*, any connected state →
*Disconnect*. Splose/Linxio/Budgetly render a disabled *Coming soon* button, full stop —
`IIntegrationRegistry` never returns a connector for them, so no drawer, no settings call.

**Per-connector drawer/page:**
- **Xero** — Connect opens the OAuth authorize URL in a popup (falls back to a full redirect
  if blocked), which posts back via `window.opener.postMessage` on callback and refetches
  status. Account-code settings (`SalesAccountCode`, `TaxTypeMap`) → `PUT
  integrations/xero/settings`. A recent-jobs list (`GET integrations/xero/jobs?take=20`) with
  per-row `SyncItemResult` expand and a Retry on any `DeadLettered` row.
- **Employment Hero** — `ColumnTemplate` editor, staff mapping table + CSV upload
  (preview/commit, §3), an export form (date range → CSV) and export history (same jobs-list
  shape as Xero, filtered to `EhExportTimesheets`).
- **Brevity** — credentials form gated behind the consent-notice checkbox (§4), schedule
  editor, and a link to `/settings/integrations/brevity/review`
  (`BrevityInboundReviewPage.tsx`): a `DataTable` of `InboundChange` rows with entity
  type/proposed action/diff-summary columns, Accept/Reject per row (`ConfirmDialog` for
  Reject, requiring a reason), and bulk-accept enabled only when every selected row is a
  `Create`.

**Endpoints** (all `api/v1/integrations/...`, `[Authorize(Roles = "SuperAdmin,Admin")]`,
`"api"` rate-limit policy like every other authenticated route; SuperAdmin
`X-View-As-Tenant` scoping applies exactly as it does everywhere else):

| Method | Route | Notes |
|---|---|---|
| GET | `integrations` | Tile list — all six kinds, `NotConfigured` synthesised for kinds with no registered connector. |
| GET | `integrations/{kind}` | Full connection detail for the drawer. |
| PUT | `integrations/{kind}/settings` | Updates `SettingsJson` only — never touches credentials. |
| POST | `integrations/{kind}/credentials` | Non-OAuth kinds only (EH, Brevity) — encrypts and stores. |
| DELETE | `integrations/{kind}` | Disconnect (Xero: also revokes at Xero). |
| POST | `integrations/{kind}/probe` | Calls `IIntegrationConnector.ProbeAsync` synchronously — "test this connection now." |
| POST | `integrations/{kind}/sync` | Body `{ jobType }` — enqueues one `SyncJob`, `TriggeredByUserId` = caller. |
| POST | `integrations/{kind}/resume` | Clears `Degraded`/`PausedUntil`/`ConsecutiveFailures`. |
| GET | `integrations/{kind}/jobs?take=` | Recent `SyncJob`s for the drawer's job list. |
| GET | `integrations/jobs/{id}` | One job with its `SyncItemResult`s. |
| POST | `integrations/jobs/{id}/retry` | Resets a `DeadLettered` job to `Queued`/`Attempt=0`. |
| GET | `integrations/{kind}/inbound?status=` | Brevity review queue. |
| POST | `integrations/inbound/{id}/accept` | Applies the change, writes `ExternalRef`. |
| POST | `integrations/inbound/{id}/reject` | Body `{ reason }`. |
| POST | `integrations/inbound/accept-bulk` | Body `{ ids: Guid[] }` — `Create` rows only (server-enforced, not just a UI filter). |
| GET | `integrations/xero/connect` | Returns the authorize URL + starts the `OAuthState` row. |
| GET | `integrations/xero/callback?code=&state=` | OAuth code exchange. |
| POST | `integrations/xero/disconnect` | Revokes at Xero, wipes credentials. |
| POST | `integrations/employment-hero/timesheets/export` | Body `{ from, to }` → CSV download. |
| GET/POST | `integrations/employment-hero/mapping`, `.../mapping/preview`, `.../mapping/commit` | Staff-mapping CRUD + bulk import. |

**Hooks** — `frontend/src/api/hooks/integrations.ts` (+ types file, per-domain split): the
expected CRUD/action set — `useIntegrations`, `useIntegration`,
`useUpdateIntegrationSettings`, `useSetIntegrationCredentials`, `useDisconnectIntegration`,
`useProbeIntegration`, `useSyncIntegration`, `useResumeIntegration`, `useIntegrationJobs`,
`useIntegrationJob`, `useRetryIntegrationJob`, `useBrevityInbound`,
`useAcceptInboundChange`/`useRejectInboundChange`/`useBulkAcceptInboundChanges`,
`useXeroConnectUrl`, `useExportEhTimesheets`,
`useEhMapping`/`usePreviewEhMapping`/`useCommitEhMapping`. Exported via the barrel
(`frontend/src/api/hooks/index.ts` gains `export * from './integrations'`).

**Mock API** (`odip-prototype/odip/mock-api/server.js`) — every action needing a specific
response shape (everything except the plain `PUT .../settings`, which the generic echo
fallback handles adequately per Context) gets a `postRoutes` entry, mirroring the leave
feature's approve/decline/cancel entries: `integrations/:kind/probe`, `.../sync`,
`.../resume`, `integrations/jobs/:id/retry`, `integrations/inbound/:id/accept`, `.../reject`,
`.../accept-bulk`, `integrations/xero/disconnect`,
`integrations/employment-hero/timesheets/export`, `.../mapping/commit`. The GET list/detail/
jobs/inbound routes join the plain `routes` table — per the confirmed dispatch mechanics
(Context), the inbound queue's `?status=` filter is **not** applied by the mock (query
strings are ignored); the handler returns the full fixture list and client-side filtering
does the rest, the same accepted limitation the notifications spec's mock route lives with.

## Data flow

**Xero: claim reviewed internally → invoice appears in Xero → payment flows back, claim
status stays ODIP's own.** A coordinator marks a `TripClaim`'s review complete (`Status =
Ready`, via the existing `UpdateClaim` action, unchanged). For a `Trip`-kind claim, the next
`XeroPushInvoices` run groups the claim's line items by booking, skips any `AgencyManaged`
group, resolves/creates a Xero Contact per remaining group, creates (or idempotently finds)
one `ACCREC` invoice per group, and writes an `ExternalRef` for each; a `Shift`-kind claim
(shift-completion spec) gets one invoice for the whole claim the same way. Once every
eligible unit has one, the claim flips to `Submitted` with `SubmittedDate` stamped — the same
field a manual status change would set. Later, `XeroPullPayments` sees an invoice `PAID`,
resolves the `ExternalRef` back to the claim (via the booking for `Trip`, directly for
`Shift`), and stamps `PaidDate` (the existing field, reused, never overwritten if already
set) and the new `PaymentReference` — the claim's own `Status` is untouched, because "Xero
says paid" and "ODIP's review state" are deliberately independent facts.

**Employment Hero: an admin exports what payroll needs, with full traceability of what's
already gone out.** An admin picks a pay period and clicks Export. The backend queries
Approved `ShiftCompletion` rows in range, checks each shift against prior
`EhExportTimesheets` results to compute `alreadyExportedCount`, streams a CSV using the
tenant's `ColumnTemplate`, and records a `SyncJob` with one `SyncItemResult` per row. The
admin imports that CSV into Employment Hero by hand — no API call, no confirmation EH
accepted it — but re-running the export for an overlapping range next period surfaces exactly
which shifts were already sent, so accidental double-entry into payroll is visible before it
happens.

**Brevity: a nightly pull proposes changes, nothing lands until a human accepts them.** At
02:00 local (or on demand), the pull jobs run: `BrevityWebTransport` logs in, calls Brevity's
own JSON endpoints, validates each response against its fingerprint. Every returned record
becomes one `InboundChange`, matched by `ExternalRef` → NDIS number/email → else proposed as
a `Create`. A coordinator opens the review page the next morning, bulk-accepts new-participant
`Create` rows, and works through `Update` rows one at a time against their field-level diff.
Only at Accept does anything write to `Participants`/`StaffMembers`/`Shifts` — inside a
transaction alongside the `ExternalRef` that stops the next pull re-proposing it as a
duplicate `Create`.

## Error handling

| Rule | Status | Notes |
|---|---|---|
| OAuth `state` missing/expired/unknown at callback | 400 | "This connection attempt has expired — start again." |
| Xero callback for a tenant that already has a `Connected` Xero connection, no `reconnect=true` | 409 | — |
| `POST integrations/{kind}/sync` while `Degraded`/paused | 409 | Includes the reason (`LastError` or "fingerprint mismatch — awaiting review") and `PausedUntil`. |
| `POST integrations/{kind}/credentials` for an OAuth-only kind (Xero) | 400 | "Xero connects via OAuth — use Connect, not a credentials form." |
| Any write to `integrations/{kind}/*` for a kind with no registered connector (Splose/Linxio/Budgetly) | 400 | "This integration isn't available yet." |
| `POST integrations/inbound/{id}/accept` on a row whose matched entity changed after staging (`entity.UpdatedAt` newer than the `InboundChange.CreatedAt`) | 409 | "This record has changed since the pull — re-sync before accepting." |
| `POST integrations/inbound/{id}/accept` or `/reject` on a non-`Pending` row | 409 | — |
| `POST integrations/inbound/accept-bulk` including a non-`Create` id | 400 | Bulk accept is Create-only; server-enforced, not just UI. |
| `POST .../timesheets/export` with zero Approved completions in range | 200, empty file + `warning` flag | Not a 400 — an empty pay period is a legitimate, expected export, per the approved ruling. |
| Xero 429 | Job requeued (`NextAttemptAt` from `Retry-After`), not failed/`Attempt`-consumed | — |
| `BrevityShapeChangedException` from any fingerprint check | Job fails, no retry, connection → `Degraded`, `PausedUntil = null` (manual resume only) | — |
| `Integrations:Enabled = false` | Jobs stay `Queued` | Dashboard shows a persistent banner: "Integration sync is paused platform-wide." |
| `POST integrations/jobs/{id}/retry` on a non-`DeadLettered` job | 409 | — |

## Out of scope / explicitly deferred

- Outbound writes to Brevity — v1 is inbound-only by ruling; write-back is a distinct, larger
  trust decision not made here.
- Xero webhooks — deferred until a stable public HTTPS endpoint + signature verification
  exist; polling covers v1.
- Xero payroll (a separate Xero product/API from the accounting API used here).
- An Employment Hero API connector — v1 is file-based by ruling.
- Award interpretation for the EH export — rostered hours, flat, same limitation the
  shift-completion spec accepted for claim generation.
- Splose, Linxio, Budgetly connectors — tiles only, by explicit ruling.
- Multi-org Xero — one `IntegrationConnection` per tenant, one Xero org.
- A PRODA API connector — NDIA-managed claims stay on the BPR CSV path; a separate roadmap item.
- HSM/KMS-backed key storage for Data Protection — the stated v1 threat model is the accepted
  posture; a proper secret manager is a later hardening pass.
- Adopting Polly or any resilience library — the manual retry/backoff above is deliberately
  minimal, matching this codebase's current zero-Polly reality.

## Testing

**Backend (`Odip.Tests`)**, inline in-memory `OdipDbContext` fixture + Moq'd `ICurrentTenant`,
same shape `StaffAssignmentGateTests.CreateDb` already establishes (no shared base class):

- `Integrations/CredentialProtectorTests` — round-trip through a real ephemeral data
  protection provider; `Unprotect(Protect(x)) == x`; garbage ciphertext throws.
- `Integrations/ExternalRefUniquenessTests` — both unique indexes reject a duplicate within a
  tenant; the same pair is fine across two tenants.
- `Integrations/SyncJobClaimTests` — the `xmin`-concurrency claim loop: two concurrent claims
  on one `Queued` row yield exactly one `Running`; backoff matches `[1,5,15,60,240]`;
  `DeadLettered` at attempt 6.
- `Integrations/DegradedAndNotificationTests` — three consecutive failures flip a connection
  to `Degraded`, set `PausedUntil`, and raise `IntegrationDegraded` to every tenant `Admin`
  (Moq'd `INotificationRaiser`); a `Degraded` connection is excluded from scheduling until
  `resume`.
- `Integrations/Xero/InvoiceMappingTests` — each `PlanType` branch (`AgencyManaged` skipped),
  GST on/off, idempotent re-run against a fake `HttpMessageHandler` (second run finds the
  existing invoice by number), `Submitted` firing only once every group in a multi-booking
  `Trip` claim is pushed, a `Shift`-kind claim producing exactly one invoice with
  `InvoiceNumber = "INV-{ClaimReference}"` and `ExternalRef (Xero, "TripClaim", claim.Id)`,
  and the tenant-scoping query returning zero cross-tenant `TripClaim` rows for either kind.
- `Integrations/Xero/PaymentPullTests` — a `PAID` invoice sets `PaidDate` (reused) and
  `PaymentReference` (new) for both a `Trip`-kind claim (resolved via the booking
  `ExternalRef`) and a `Shift`-kind claim (resolved via the direct `TripClaim` `ExternalRef`),
  without touching `TripClaimStatus`, and never overwrites an already-set `PaidDate`.
- `Integrations/EmploymentHero/ExportTests` — CSV columns match `ColumnTemplate`, the
  employee-id-vs-email fallback, `alreadyExportedCount` correctness, empty-range
  200-with-warning (not 400).
- `Integrations/Brevity/TransportFixtureTests` — `BrevityWebTransport` against the scrubbed
  fixtures, including one deliberately mutated fixture that must throw
  `BrevityShapeChangedException`.
- `Integrations/Brevity/InboundMatchingTests` — match priority `ExternalRef` → NDIS number →
  email → `Create`; Accept applies the change + writes `ExternalRef` in one transaction;
  stale-accept → 409; bulk-accept rejects a non-`Create` id.
- `Audit/IntegrationConnectionAuditTests` — connect/disconnect/credential-rotation land in
  `AuditLog`; `EncryptedCredentials` never appears in the diff.

**Frontend** — co-located `*.test.tsx`, `vi.mock('@/api/hooks')` + `vi.hoisted` per the
established convention: `IntegrationsDashboardPage` (all six tiles, correct status chips,
Splose/Linxio/Budgetly always "Coming soon"); `BrevityInboundReviewPage` (Accept/Reject
payloads, bulk-accept disabled on a non-Create selection); the EH export form (submit
payload, not rendered validation text, per this repo's known `zod@4`/`@hookform/resolvers@3`
mismatch); `permissions.ts`'s `ADMIN_ONLY_PAGES` branch (Coordinator denied, Admin/SuperAdmin
allowed).

## Delivery

Five PRs, each with additive-only migrations (per root `CLAUDE.md`'s migration-history
self-healing warning — never rename or reorder an existing migration id):

1. **Framework core.** `IntegrationConnection`/`ExternalRef`/`SyncJob`/`SyncItemResult`/
   `InboundChange`/`OAuthState` entities, migration `AddIntegrationFramework` (incl.
   `OdipDbContext : IDataProtectionKeyContext` + its `DataProtectionKeys` table), Data
   Protection registration + `CredentialProtector`, the two new package refs
   (`Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` in `Odip.Api.csproj`,
   `.Abstractions` in `Odip.Infrastructure.csproj`), `IIntegrationConnector`/
   `IIntegrationRegistry`/`IntegrationRegistry`, `IntegrationSyncBackgroundService`, the
   generic `integrations/*`/`integrations/jobs/*` endpoints, `AuditedEntities` additions,
   `IntegrationsDashboardPage` with all six tiles, `permissions.ts`'s
   `ADMIN_ONLY_PAGES`/`canManageIntegrations`, and every framework-level test above.
2. **Xero connector.** OAuth connect/callback/disconnect, `XeroApiClient`
   (`AddHttpClient<XeroApiClient>()`), `XeroPushInvoices`/`XeroPullPayments`, migration
   `AddClaimPaymentFields` (`TripClaim.PaymentReference` only — `PaidDate` is reused, not
   added), the Xero drawer UI, mock-api routes, Xero-specific tests. **Dependency:** the
   `Kind == Shift` branch of `XeroPushInvoices`/`XeroPullPayments` (§2) needs
   `TripClaim.Kind`/`ParticipantId`/`PeriodFrom`/`PeriodTo` and
   `ClaimLineItem.ShiftId`, which land in the shift-completion spec's own PR 3
   (`AddShiftClaims` migration — `docs/specs/2026-09-08-shift-completion-design.md:592-597`).
   This is a compile-time dependency, not a runtime one — `XeroPushInvoices` references
   `TripClaim.Kind`/`.ParticipantId`/`.PeriodFrom`/`.PeriodTo` and
   `ClaimLineItem.ShiftId` directly, so this PR cannot build until those properties exist.
   Sequencing options: land this PR after the shift-completion spec's PR 3, or land only the
   `Kind == Trip` branch first (compiling against today's `TripClaim` shape) and add the
   `Kind == Shift` branch as a small follow-up once `AddShiftClaims` has merged. Either
   ordering is acceptable; whoever schedules these two specs' PRs should pick one.
3. **Employment Hero connector.** `ColumnTemplate`/staff-mapping/export endpoints, the EH
   drawer + mapping table + CSV-upload UI (reusing `CatalogueImportService`'s preview/commit
   shape), mock-api routes, EH-specific tests.
4. **Brevity discovery.** `tools/brevity/scrub-har.ps1`, `docs/integrations/brevity-endpoints.md`,
   scrubbed fixtures, `BrevityFingerprints.cs` — a docs-and-fixtures PR, deliberately no
   runtime connector code, so the discovery work is reviewable before any transport depends on it.
5. **Brevity connector.** `IBrevityTransport`/`BrevityWebTransport`/`BrevityApiTransport`
   stub, the three pull jobs, the consent-notice credentials form, the inbound review page,
   mock-api routes, Brevity-specific tests (incl. the shape-mutation test against PR 4's
   fixtures).

## Open questions

1. **`GSTCode` → Xero `TaxType` mapping.** `ClaimLineItem.GSTCode` has six values (`P1, P2,
   P5, GST, NoGST, Exempt`) but nothing in this codebase documents what each represents in
   NDIS pricing terms, so the correct Xero `TaxType` per value can't be asserted here. Interim
   default: `SettingsJson.TaxTypeMap` ships `GST`/`P1` → `"GSTONINCOME"`, everything else →
   `"GSTFREEINCOME"`, editable per tenant — the correct default is a product/finance decision.
2. **Xero default sales account code.** `SettingsJson.SalesAccountCode` needs a sensible
   platform default, or must be hard-required before the first push — not sourceable from
   anywhere in ODIP itself.
3. **Employment Hero's real CSV header set.** §3 deliberately avoids asserting one; someone
   with a real EH timesheet-import template needs to confirm the expected headers.
4. **Brevity v1 pull scope.** Should `BrevityPullShifts` ship in PR 5 alongside
   participants/staff, or defer to a later PR while v1 only pulls the lower-risk
   participants+staff data? A scope-sequencing call, not a technical blocker.
5. **Brevity ToS consent wording.** The exact legal language for the consent notice (§4)
   needs review from whoever owns ODIP's terms/compliance posture — the wording above is a
   starting draft, not signed off.
6. **Claim re-generation against an already-invoiced booking.** If a `TripClaim` is
   regenerated for a booking that already has a Xero `ExternalRef` from a prior claim, should
   the new push create a second Xero invoice, or is that rare enough to handle manually via
   the dashboard's job/error trail? Not addressed above.
