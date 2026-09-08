# Notifications — Design

Status: Approved 2026-09-08 — design; implementation plan pending.

ODIP has no outbound-notification mechanism today — confirmed by grep
(`Smtp|MailKit|SendGrid|Twilio|INotification|class Notification|NotificationService`, zero
matches under `backend/`). A leave request, a shift assignment, a witness sign-off, a
caregiver submission, an incident — every one of these relies on the recipient opening the
app and finding the in-app badge themselves. This spec adds email notifications (SMS
stubbed, not implemented) behind a transactional outbox, dispatched by a new background
service, with per-user per-event-type preferences.

## Product rulings

1. Email first. SMS sits behind an `INotificationChannel` interface so preference rows and
   UI can exist for it, but no SMS provider is implemented in v1 — it always resolves
   `Skipped`.
2. Preferences are per-user, per-event-type. Absence of a preference row means the event's
   documented default applies (email ON for every v1 event, §1).
3. In-app badges are unchanged. Every read-time badge (e.g. the Rostering pending-leave
   count from `docs/specs/2026-09-07-staff-leave-unavailability-design.md`) keeps working
   exactly as today — email is additive, never a replacement.
4. Architecture is a transactional outbox: the row recording "notify user X about event Y"
   is written in the same `SaveChangesAsync` call as the domain write that caused it, so a
   notification is never sent for a write that rolls back, and never lost to one that
   commits.

## Context — what exists today

- No email/SMS/notification code anywhere in `backend/`. The closest existing pattern is
  `ParticipantAlertsService` (`backend/Odip.Infrastructure/Services/ParticipantAlertsService.cs`),
  a read-time computed badge with nothing persisted; the sibling leave spec's own
  pending-count badge explicitly states "no email/push, per ruling scope" — this spec fills
  that gap.
- The only hosted service registered anywhere is `HolidaySyncBackgroundService`
  (`backend/Odip.Infrastructure/BackgroundServices/HolidaySyncBackgroundService.cs`,
  `builder.Services.AddHostedService<...>()` at `backend/Odip.Api/Program.cs:182`): a
  `BackgroundService` subclass taking `IServiceScopeFactory`/`IConfiguration`/`ILogger<T>`,
  creating a fresh DI scope per tick (`using var scope = _scopeFactory.CreateScope();`,
  lines 57-58) and reading config directly via `IConfiguration.GetValue<T>("HolidaySync:Key",
  default)` (lines 78, 82-83) — there is no `IOptions<T>` binding anywhere in the codebase
  (zero matches for `class.*Options\b` under `Odip.Api`/`Odip.Infrastructure`). This is the
  shape `NotificationDispatchBackgroundService` follows.
- `ICurrentTenant` (`backend/Odip.Domain/Interfaces/ICurrentTenant.cs`) is `{ Guid?
  TenantId, bool IsSuperAdmin, Guid? ViewAsUserId }`. Its one implementation, `CurrentTenant`
  (`backend/Odip.Infrastructure/Services/CurrentTenant.cs`), reads the JWT `tenant_id` claim
  via `IHttpContextAccessor` in its constructor and is registered
  `AddScoped<ICurrentTenant, CurrentTenant>()` (`Program.cs:374`) — it is HTTP-request-shaped
  and has no seam for a background caller to set `TenantId` explicitly.
- `OdipDbContext`'s constructor is `OdipDbContext(DbContextOptions<OdipDbContext> options,
  ICurrentTenant tenant)` (`backend/Odip.Infrastructure/Data/OdipDbContext.cs:21-25`) — a
  plain two-argument constructor, not DI-container-bound at the call site. Its
  `SaveChangesAsync` override (lines 1620-1635) auto-populates `TenantId` on newly-added
  `ITenantEntity` rows only `if (_tenant.TenantId.HasValue)` (line 1623) and only `if
  (entry.Entity.TenantId == default)` (line 1629) — never overwrites an explicit value, does
  nothing when tenant is null. Every tenant-scoped entity's query filter (e.g.
  `modelBuilder.Entity<Shift>().HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId ==
  _tenant.TenantId)`, repeated from `OdipDbContext.cs:1436` on) means a context built with
  `TenantId = null, IsSuperAdmin = false` reads **zero rows** of any tenant-scoped table —
  both facts drive how the dispatcher sets tenant context per row (§3).
- Audit is an EF `SaveChanges` interceptor (`backend/Odip.Infrastructure/Audit/AuditInterceptor.cs`)
  driven by the allow-list `AuditedEntities.Types`
  (`backend/Odip.Infrastructure/Audit/AuditedEntities.cs:8-65`) — only listed types get
  `AuditLog` rows. The sibling leave feature added `LeaveRequest`/`RecurringUnavailability`/
  `StaffAvailability` to it (lines 62-64); this feature's own audit decision is in §1.
- DI registration is a flat list in `Program.cs:159-182` (`ClaimGenerationService` through
  `HolidaySyncBackgroundService`) — plain `AddScoped<TInterface, TImpl>()` per service;
  `IStaffUnavailabilityQuery` (line 173, from the sibling leave feature) is the most recent
  precedent for "new Infrastructure interface, registered beside what it composes with."
- Config env-var convention: ASP.NET Core maps `Section:Key` to env var `Section__Key`
  automatically — `Notifications:Smtp:Host` needs no new plumbing to also be settable as
  `Notifications__Smtp__Host`.
- `User` (`backend/Odip.Domain/Entities/User.cs:12-22`) has `Email` (line 18, non-nullable
  `string`, always populated) and `Role` (line 22, `UserRole`). `UserRole`
  (`backend/Odip.Domain/Enums/Enums.cs:244-251`): `Admin, Coordinator, SupportWorker,
  ReadOnly, SuperAdmin`. No existing query filters `Users` by `Role == Admin || Role ==
  Coordinator` (grepped, zero matches) — recipient resolution for "coordinators/admins of
  the tenant" is new code, straightforward given `User`'s own `TenantId` query filter
  already scopes any `_db.Users` query to the ambient tenant.
- `ReadOnlyMiddleware` (per root `CLAUDE.md`: "403s writes for the 'ReadOnly' role") only
  gates HTTP requests — irrelevant to the dispatcher, which never goes through the HTTP
  pipeline. A `ReadOnly`-role user is a legitimate email recipient like any other role.
- Frontend: `frontend/src/api/hooks/index.ts` is a flat `export * from './<domain>'` barrel
  (line 39: `export * from './leave'`, added by the sibling leave PR).
  `frontend/src/pages/SettingsPage.tsx` holds local `tab` state, an `allTabs` array of `{
  key, label, superAdminOnly? }` filtered by `isSuperAdmin` (lines 105-131), rendered via
  `TabNav`, each tab's body a small component defined in the same file
  (`QualificationSettingsTab`, `ProviderSettingsTab`, etc.) — the shape both new
  Notifications tabs (§6) fit directly.
- `AdminUsersController` (`api/v1/admin/users`,
  `backend/Odip.Api/Controllers/AdminUsersController.cs:15`) and `TenantsController`
  (`api/v1/admin/tenants`, `backend/Odip.Api/Controllers/TenantsController.cs:14`) are the
  precedent for an `api/v1/admin/<noun>` prefix restricted to elevated roles.
- `Odip.Application/Interfaces/` (e.g. `IPublicHolidaySyncService.cs`) is where cross-layer
  interfaces already live — `INotificationChannel`/`INotificationRaiser` land there;
  implementations land in `Odip.Infrastructure/Notifications/` and
  `Odip.Infrastructure/BackgroundServices/`, mirroring `IPublicHolidaySyncService` →
  `PublicHolidaySyncService`/`HolidaySyncBackgroundService`.

## 1. Data model

Three new tenant-scoped entities in `backend/Odip.Domain/Notifications/` (new folder,
mirroring `Odip.Domain/Rostering/`'s co-location), plus one migration.

```csharp
// backend/Odip.Domain/Notifications/NotificationEntities.cs (new file)

public enum NotificationEventType
{
    LeaveRequestSubmitted = 0,
    LeaveRequestDecided = 1,
    ShiftAssigned = 2,
    ShiftCompletionPendingReview = 3,   // wired in docs/specs/2026-09-08-shift-completion-design.md
    ShiftCompletionReturned = 4,        // wired in docs/specs/2026-09-08-shift-completion-design.md
    WitnessRequested = 5,
    CaregiverSubmissionReceived = 6,
    IncidentReported = 7,
    ServiceAgreementSent = 8,           // wired in docs/specs/2026-09-08-service-agreements-and-budgets-design.md
    ServiceAgreementSigned = 9,         // wired in docs/specs/2026-09-08-service-agreements-and-budgets-design.md
    IntegrationDegraded = 10,           // wired in docs/specs/2026-09-08-integration-framework-design.md
}
// Append-only — never renumber. Same discipline as CaregiverSubmissionStatus
// (backend/Odip.Domain/Enums/CaregiverSubmissionStatus.cs: "do not reorder"). A plain int
// EF column (repo default); DTOs serialise it as a string name (§2).

public enum NotificationChannelKind { Email = 0, Sms = 1 }
public enum NotificationOutboxStatus { Pending = 0, Sent = 1, Failed = 2, Skipped = 3 }

public class NotificationOutbox : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public NotificationEventType EventType { get; set; }
    public string EntityType { get; set; } = string.Empty;   // e.g. "LeaveRequest", "Shift"
    public Guid EntityId { get; set; }
    public Guid RecipientUserId { get; set; }
    public string PayloadJson { get; set; } = string.Empty;  // template inputs, JSON-serialised
    public NotificationOutboxStatus Status { get; set; } = NotificationOutboxStatus.Pending;
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
}

public class NotificationPreference : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public NotificationEventType EventType { get; set; }
    public NotificationChannelKind Channel { get; set; }
    public bool Enabled { get; set; } = true;
}

public class NotificationLog : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OutboxId { get; set; }
    public NotificationOutbox? Outbox { get; set; }
    public NotificationChannelKind Channel { get; set; }
    public string? ProviderMessageId { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public string RecipientAddress { get; set; } = string.Empty;
}
```

**`OdipDbContext` configuration** (new block in `OnModelCreating`, alongside the
`LeaveRequest`/`RecurringUnavailability` block at `OdipDbContext.cs:1122-1155`): each entity
gets the standard `HasQueryFilter`/`HasIndex(TenantId)` pair every tenant-scoped entity has
(from `OdipDbContext.cs:1436` on), plus:

```csharp
modelBuilder.Entity<NotificationOutbox>(e => {
    e.HasIndex(x => new { x.Status, x.NextAttemptAt });                              // dispatcher poll
    e.HasIndex(x => new { x.TenantId, x.EventType, x.EntityId, x.RecipientUserId, x.CreatedAt });  // dedupe lookup
});
modelBuilder.Entity<NotificationPreference>(e =>
    e.HasIndex(x => new { x.TenantId, x.UserId, x.EventType, x.Channel }).IsUnique());
modelBuilder.Entity<NotificationLog>(e => e.HasIndex(x => x.OutboxId));
```

**Dedupe rule** (application code, inside `INotificationRaiser.RaiseAsync` — a 5-minute
sliding window can't be a DB unique index): before adding a row, query for an existing one
with the same `(EventType, EntityId, RecipientUserId)` and `CreatedAt >=
DateTime.UtcNow.AddMinutes(-5)`. If found, the raise is silently dropped (fire-and-forget
from the caller's point of view) — this guards a double-click or retry-on-transient-error
re-submitting the same action, not two legitimate raises further apart than 5 minutes.

**Preference defaults when no row exists** — email ON for every v1 event (every one is
either time-sensitive for its recipient or a compliance-relevant admin alert; none should
default to silence). SMS `NotificationPreference` rows may exist (the UI shows the disabled
column) but the dispatcher never sends over that channel regardless of `Enabled`, since
`SmsChannel` always returns `NotSupported` (§3).

**Audit allow-list.** `NotificationPreference` joins `AuditedEntities.Types`
(`AuditedEntities.cs:8`) — a user's own "stop emailing me about X" is worth a history.
`NotificationOutbox`/`NotificationLog` do **not**: outbox rows churn every dispatcher tick
(`Attempts`/`Status`/`NextAttemptAt` update repeatedly on `Pending` rows) and would flood
`AuditLog` with zero-investigative-value noise — their own `Status`/`LastError`/`SentAt`
fields already are the purpose-built delivery trail.

## 2. API + permissions

There is no existing `api/v1/me/*` prefix anywhere in the 17 controllers (grepped) —
rather than invent one, self-service preferences are actions on a new
`NotificationsController`, matching how `PortalController` puts self-scoped actions
directly under its own route. The admin surface follows the existing `api/v1/admin/<noun>`
precedent (`AdminUsersController` → `api/v1/admin/users`, `TenantsController` →
`api/v1/admin/tenants`).

**`NotificationsController`** (new file, `[Authorize]`, `[Route("api/v1/notifications")]`):

| Method | Route | Roles | Request | Response | Status |
|---|---|---|---|---|---|
| GET | `notifications/preferences` | any authenticated | — | `NotificationPreferenceGridDto` (every event × channel, `enabled` = the user's row or the event default) | 200 |
| PUT | `notifications/preferences` | any authenticated | `UpdateNotificationPreferenceDto[]` (`{eventType,channel,enabled}[]`) | `NotificationPreferenceGridDto` | 200, 400 |

`PUT` upserts the caller's own `(UserId, EventType, Channel)` rows. There is no `userId`
field on the request DTO at all — the endpoint is self-scoped by construction, the same
"nothing to let the caller act as someone else" idiom `PortalController` uses.

**`AdminNotificationsController`** (new file, `[Authorize(Roles = "SuperAdmin,Admin")]`,
`[Route("api/v1/admin/notifications")]`):

| Method | Route | Request | Response | Status |
|---|---|---|---|---|
| GET | `admin/notifications?status=&from=&to=` | — | `NotificationOutboxDto[]` | 200 |
| POST | `admin/notifications/{id}/retry` | — | `NotificationOutboxDto` | 200, 404, 409 (not Failed) |
| POST | `admin/notifications/test-email` | `{ to: string }` | `{ sent: bool, error: string? }` | 200, 400 |

`retry` resets `Status = Pending`, `Attempts = 0`, `NextAttemptAt = now`, `LastError = null`
— 409 if not currently `Failed`. `test-email` calls `SmtpEmailChannel.SendAsync` directly
with a synthetic message, bypassing the outbox — its job is "prove SMTP config works right
now," not "queue a real notification."

**DTOs** — `backend/Odip.Application/DTOs/NotificationDTOs.cs` (new file), the same
camelCase-stable-on-the-wire discipline `RosteringDTOs.cs`/`LeaveDTOs.cs` follow:
`NotificationPreferenceGridDto { rows: {eventType,channel,enabled}[] }`,
`UpdateNotificationPreferenceDto { eventType, channel, enabled }`, `NotificationOutboxDto {
id, eventType, entityType, entityId, recipientUserId, recipientName, status, attempts,
nextAttemptAt, lastError, createdAt, sentAt }`. `eventType`/`channel`/`status` serialise as
string enum names — the API already globally installs `JsonStringEnumConverter`
(`Program.cs:369`), so this is the default, not extra code.

**Frontend permissions** — preferences need no new boolean (any non-`ReadOnly`
authenticated user; `ReadOnlyMiddleware` already 403s the `PUT` ahead of the controller).
One new `frontend/src/lib/permissions.ts` boolean for the admin surface:

```ts
/** Mirrors AdminNotificationsController's [Authorize(Roles = "Admin,SuperAdmin")]. */
canManageNotifications: isSuperAdmin || isAdmin,
```

## 3. Outbox + dispatcher

**`INotificationRaiser`** (`Odip.Application/Interfaces/INotificationRaiser.cs`, scoped —
`AddScoped<INotificationRaiser, NotificationRaiser>()`):

```csharp
public interface INotificationRaiser
{
    Task RaiseAsync(NotificationEventType type, string entityType, Guid entityId,
        IEnumerable<Guid> recipientUserIds, object payload, CancellationToken ct = default);
}
```

`NotificationRaiser` (`Odip.Infrastructure/Notifications/NotificationRaiser.cs`) takes the
same `OdipDbContext` the calling controller action already has injected — same tracked
context, so "same `SaveChanges`" needs no explicit transaction plumbing. `RaiseAsync` does
the dedupe check per recipient, then `_db.NotificationOutbox.Add(...)` for survivors — it
**never calls `SaveChangesAsync` itself**. The caller's own existing
`await _db.SaveChangesAsync(ct)` (already present at every trigger point in §5) commits the
outbox rows atomically with the domain write; if that call throws, no outbox row exists
either, which is correct.

**`INotificationChannel`** (`Odip.Application/Interfaces/INotificationChannel.cs`):

```csharp
public enum ChannelSendOutcome { Sent, Skipped, TransientFailure, PermanentFailure, NotSupported }
public record ChannelSendResult(ChannelSendOutcome Outcome, string? ProviderMessageId, string? Reason);
public record NotificationMessage(string RecipientAddress, string Subject, string PlainTextBody, string HtmlBody);

public interface INotificationChannel
{
    NotificationChannelKind Kind { get; }
    Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct);
}
```

- `SmtpEmailChannel` (`Odip.Infrastructure/Notifications/SmtpEmailChannel.cs`) — MailKit
  (new `MailKit`/`MimeKit` package refs, added to `Odip.Infrastructure.csproj` alongside the
  existing `ClosedXML`/`QuestPDF` refs at lines 9-14). Reads
  `Notifications:Smtp:Host/Port/User/Password/From` via direct
  `IConfiguration.GetValue<string>(...)`, the same idiom `HolidaySyncBackgroundService` uses
  — no `IOptions<T>` binding. `Notifications:Enabled` is the kill switch (default `false` —
  an operator opts in by configuring SMTP). `Notifications:DispatchIntervalSeconds` (default
  30) drives the tick. Env-var overrides (`Notifications__Smtp__Host`, etc.) work
  automatically per the framework convention already noted.
- `SmsChannel` (`Odip.Infrastructure/Notifications/SmsChannel.cs`) — a stub: `Kind =>
  Sms`, `SendAsync` always returns `new ChannelSendResult(NotSupported, null, "SMS is not
  implemented")`, no I/O. Registered so the dispatcher can resolve *a* channel for an
  SMS-preference row and get a clean `Skipped` rather than a missing-implementation
  exception.
- SMTP failure classification: MailKit's `SmtpCommandException.StatusCode` — 4xx (mailbox
  unavailable, bad address) → `PermanentFailure` (retrying won't help); 5xx,
  `SmtpProtocolException`, socket/timeout errors → `TransientFailure`. Any other unexpected
  exception (bad host, auth failure, TLS negotiation) is also classified `TransientFailure`
  conservatively, so a config problem surfaces as repeated visible failures rather than a
  single silent drop.

**`NotificationDispatchBackgroundService`**
(`Odip.Infrastructure/BackgroundServices/NotificationDispatchBackgroundService.cs`,
registered `AddHostedService<...>()` in `Program.cs` right after the existing
`HolidaySyncBackgroundService` line) — same shape as that service: constructor injection of
`IServiceScopeFactory`/`IConfiguration`/`ILogger<T>`, a loop with
`Task.Delay(TimeSpan.FromSeconds(dispatchIntervalSeconds), stoppingToken)` between ticks,
`using var scope = _scopeFactory.CreateScope()` per tick.

**Tenant context per row.** `OdipDbContext`'s constructor takes `ICurrentTenant` as a plain
argument (`OdipDbContext.cs:21`, `OdipDbContext(DbContextOptions<OdipDbContext> options,
ICurrentTenant tenant)`) — it is never resolved from the ambient DI container by interface
lookup at the call site, it's just passed in. That is the seam this feature uses, with no
change to `CurrentTenant` or any controller:

```csharp
// Odip.Infrastructure/Notifications/ScopedTenantOverride.cs (new file)
public sealed class ScopedTenantOverride : ICurrentTenant
{
    public Guid? TenantId { get; init; }
    public bool IsSuperAdmin { get; init; }
    public Guid? ViewAsUserId { get; init; }
}
```

Per tenant-group within a tick, the dispatcher builds its own `OdipDbContext` directly —
`new OdipDbContext(dbOptions, new ScopedTenantOverride { TenantId = tenantId })` — where
`dbOptions` (`DbContextOptions<OdipDbContext>`) is resolved once from the tick's DI scope
(it is registered by the existing `AddDbContext<OdipDbContext>(...)` call and carries no
tenant state itself). This context's query filters and `SaveChangesAsync` TenantId-stamping
then behave exactly as they would for a real request scoped to that tenant — no DI
registration change, no risk of the override leaking into request-scoped resolution, and
`ICurrentTenant`/`CurrentTenant` are untouched. The batch-select step (next) instead uses
`ScopedTenantOverride { IsSuperAdmin = true }` (no `TenantId`) so its query filter admits
every tenant's `Pending` rows in one read.

**Per-tick algorithm:**
1. Batch-select (superadmin-scoped context, read-only): `Pending` rows with `NextAttemptAt
   <= now`, ordered by `CreatedAt`, capped at `Notifications:BatchSize` (default 50).
2. If `Notifications:Enabled` is `false`, skip the whole batch — **rows stay `Pending`,
   never dropped**. This is the explicit kill-switch ruling: a deliberate outage (e.g. SMTP
   creds rotating) should never lose a leave-decision or witness-request notification; the
   backlog draining once re-enabled is the intended behaviour, not something to guard
   against with a 24h drop. (If an unbounded backlog after a long outage ever proves a
   problem in practice, that's a separate later ruling, not silent data loss now.)
3. Group the batch by `TenantId`; for each group, build one tenant-scoped `OdipDbContext` as
   above and process its rows:
   a. Resolve the recipient `User` (tenant-scoped query) — not found → `Skipped`,
      `LastError = "Recipient not found"`.
   b. Resolve the effective preference for `(RecipientUserId, EventType, Email)` — an
      explicit disabled row → `Skipped`, `LastError = "User preference disabled"`;
      otherwise proceed (default ON, §1).
   c. `User.Email` is never null by the entity's own definition, so "no email" in practice
      means an empty string — treated the same as not-found: `Skipped`, `LastError =
      "Recipient has no email address"`.
   d. Render the template (§4), call `SmtpEmailChannel.SendAsync`.
   e. `Sent` → `Status = Sent`, `SentAt = now`, insert a `NotificationLog` row.
   f. `TransientFailure` → `Attempts += 1`; `Attempts >= 5` → `Status = Failed`; else
      `NextAttemptAt = now + backoff[Attempts]` with `backoff = [1, 5, 15, 60, 240]`
      minutes (indexed by the post-increment `Attempts`, so the 5th failure lands `Failed`
      instead of scheduling a 6th attempt).
   g. `PermanentFailure` → `Status = Failed` immediately, no further retry.
   h. `NotSupported` (only from `SmsChannel`) → `Skipped`, `LastError` from `Reason`.
   i. One `SaveChangesAsync` per tenant-group, not per row.

**Single-instance constraint.** No distributed lock, no `SELECT ... FOR UPDATE SKIP
LOCKED`, no leader election — the dispatcher assumes exactly one running instance, matching
today's deployment (a single API container per `deploy/compose.yaml`, per root
`CLAUDE.md`). **If the API is ever scaled to more than one replica this becomes a
correctness bug**: two dispatcher instances could pick up the same `Pending` row in the
same poll window and send the same email twice (the 5-minute dedupe in `RaiseAsync` only
prevents duplicate *raises*, not duplicate *dispatch* of an already-raised row). The fix at
that point is a Postgres advisory lock or `FOR UPDATE SKIP LOCKED` around the batch-select,
or running the dispatcher as one dedicated worker process outside the API replicas — not
built now because it isn't needed now, but the first thing to revisit before scaling out.

## 4. Templates

`Odip.Infrastructure/Notifications/Templates/` (new folder) — one static class per event
type, plain C# string building, no Razor or templating library (matches the codebase's
existing pattern of building output directly, e.g. `BprCsvService`'s CSV row-writing):

```csharp
// Odip.Infrastructure/Notifications/Templates/LeaveRequestSubmittedTemplate.cs
public static class LeaveRequestSubmittedTemplate
{
    public static NotificationMessage Render(LeaveRequestSubmittedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Leave request from {p.RequesterName}",
        PlainTextBody: $"{p.RequesterName} has requested {p.LeaveType} leave from " +
                       $"{p.StartDate:d MMM yyyy} to {p.EndDate:d MMM yyyy}.\n\nReview it: {baseUrl}/rostering/leave",
        HtmlBody: $"<p>{p.RequesterName} has requested {p.LeaveType} leave from " +
                  $"{p.StartDate:d MMM yyyy} to {p.EndDate:d MMM yyyy}.</p>" +
                  $"<p><a href=\"{baseUrl}/rostering/leave\">Review it</a></p>");
}
```

One payload record per event type, holding only names/dates/a deep-link route — **never
participant clinical detail** (diagnosis, medication, behaviour-support content, incident
description text). This is a hard rule: an email leaves the audited, access-controlled
application boundary onto a mail server this system doesn't control, so bodies carry
identification and a link, and nothing a participant's `MedicalSummary`/
`BehaviourRiskSummary`/incident `Description` would ever populate — the recipient
authenticates in-app to see detail. `IncidentReported`'s email carries no participant name
at all (type/severity/participant identity together are more re-identifying than any single
field); every other event type may use a staff member's own name (e.g. "X requested leave"
is not participant data).

`Notifications:PublicBaseUrl` (config) is the `baseUrl` every deep link is built from — a
background service has no `HttpContext.Request` to infer the origin from.

## 5. Event trigger points

Every trigger already exists in code and today does nothing beyond the domain write. Wiring
means: inject `INotificationRaiser`, call `RaiseAsync(...)` before the controller's existing
`SaveChangesAsync(ct)` so the outbox rows join the same commit.

| Event | Trigger (file:line, raise before the cited `SaveChangesAsync`) | Recipients |
|---|---|---|
| `LeaveRequestSubmitted` | `PortalController.CreateMyLeaveRequest`, `backend/Odip.Api/Controllers/PortalController.cs:424-451` (before line 448) | Tenant's `Admin`/`Coordinator` users |
| `LeaveRequestDecided` | `LeaveController.ApproveLeave` (`backend/Odip.Api/Controllers/LeaveController.cs:78-100`, before line 93) and `.DeclineLeave` (lines 102-123, before line 121) | `leave.UserId` — the staff member whose leave it is, not `RequestedByUserId` (which is the coordinator on an on-behalf entry) |
| `ShiftAssigned` | `RosteringController.AssignShift`, `backend/Odip.Api/Controllers/RosteringController.cs:390-416` (before line 414) — only when `dto.StaffId.HasValue`; clearing an assignment has no recipient | `dto.StaffId.Value` |
| `WitnessRequested` | `MedicationsController.RecordAdministration`, `backend/Odip.Api/Controllers/MedicationsController.cs:329-436`, the `witnessStaff != null` branch (lines 357-370, `WitnessStatus.Pending` set line 426) (before line 434) | `witnessStaff.Id` |
| `CaregiverSubmissionReceived` | `CaregiverController.Submit` → `.WriteAsync(submit: true)`, `backend/Odip.Api/Controllers/CaregiverController.cs:95-123`, inside the `if (submit)` block (lines 113-117) (before line 121) | Tenant's `Admin`/`Coordinator` users, scoped by `sub.TenantId` — this action runs with **no authenticated principal** (its own comment at line 119), so recipient resolution must key off `sub.TenantId`, not `ICurrentTenant`; the design already satisfies this since recipients are an explicit id list |
| `IncidentReported` | `IncidentsController.Create`, `backend/Odip.Api/Controllers/IncidentsController.cs:282-386` (before line 386) | Tenant's `Admin`/`Coordinator` users |

Sibling-spec events (`ShiftCompletionPendingReview`/`ShiftCompletionReturned`,
`ServiceAgreementSent`/`ServiceAgreementSigned`, `IntegrationDegraded`) are reserved in the
enum now (append-only, §1) but wired in their own PRs once those features exist.

**Related, out of scope for v1 wiring:** `IncidentsController.Create` also creates
`IncidentWitness` rows with `WitnessStatus.Pending` for a staff witness
(`IncidentsController.cs:372-384`) — the same "witness sign-off" shape as the MAR witness
request, but the approved design names only the MAR path for `WitnessRequested` v1. Wiring
the incident-witness case is a natural, low-effort follow-up, not built here.

## 6. UI

**Settings → Notifications** (`frontend/src/pages/SettingsPage.tsx`): `allTabs` gains `{
key: 'notifications', label: 'Notifications' }` (no `superAdminOnly` — every user gets it).
Body: a new `NotificationPreferencesTab` component (following `TenantsTab.tsx`'s precedent
of a settings sub-page in its own file) — a grid, rows = event types grouped by area
(Leave, Rostering, Medications, Caregiver, Incidents), columns = Email/SMS. Email cells
toggle via `useNotificationPreferences`/`useUpdateNotificationPreferences`; SMS cells render
disabled with "Coming soon", never wired to a mutation. A "Send test email" button, visible
only when `canManageNotifications`, calls `useSendTestEmail` and shows `{ sent, error }`
inline.

**Settings → Failed Sends (admin)** — a second tab, gated in the `tabs` filter by
`canManageNotifications` (Admin-or-SuperAdmin, unlike the existing `superAdminOnly`-only
tabs). Body: `AdminNotificationsTab` — a `DataTable` of `GET admin/notifications` with a
status `Dropdown` (default Failed), columns event type/recipient/attempts/last
error/created, and a per-row Retry button (`useRetryNotification`) — no confirm dialog, retry
is non-destructive.

**Hooks** — `frontend/src/api/hooks/notifications.ts` (+ a types file, following the
existing per-domain split): `useNotificationPreferences`, `useUpdateNotificationPreferences`,
`useFailedNotifications`, `useRetryNotification`, `useSendTestEmail`. Exported through the
barrel — `frontend/src/api/hooks/index.ts` gains `export * from './notifications'`.

**Mock API** — `odip-prototype/odip/mock-api/server.js` gains four new pairs in `postRoutes`
(the `[pattern, handler]` array declared at line 859, dispatched against incoming `POST`s at
line 957 before the generic echo-body-back fallback — the existing idiom for any endpoint
that needs a specific response shape rather than an echoed object, e.g. the
`leave/:id/approve`-style entries already there): `notifications/preferences` (PUT, per this
file's convention of matching PUT through the same `postRoutes` dispatch as POST),
`admin/notifications/:id/retry`, and `admin/notifications/test-email`. `GET
admin/notifications` joins the plain `routes` table used for all other GETs (matched by path
segments only — the dispatcher strips and ignores the query string entirely, so the mock's
`admin/notifications` handler must return its full fixture list regardless of
`?status=`/`?from=`/`?to=`, with any status filtering left to the frontend or simply
unfiltered in the mock). All four routes sit under the existing `/api/v1` base path (port
5062, `BASE`/`PORT` already defined earlier in the file).

## Data flow

**Staff submits leave → coordinators emailed → act in-app as today.** `POST /portal/leave`
(`PortalController.CreateMyLeaveRequest`) raises `LeaveRequestSubmitted` for every
Admin/Coordinator in the tenant inside the same `SaveChangesAsync`. The HTTP response
returns immediately — no wait on delivery. Within `DispatchIntervalSeconds` (default 30s)
the dispatcher renders `LeaveRequestSubmittedTemplate` and sends via `SmtpEmailChannel`. The
in-app pending-count badge is untouched — the email is purely additive.

**Witness request → nominated witness emailed → approves from `/portal/witness-approvals`
exactly as today.** `RecordAdministration` sets `WitnessStatus.Pending` and raises
`WitnessRequested` for `witnessStaff.Id` in the same commit. The approve/decline flow itself
is unchanged; the email just tells the witness there's something waiting.

**SMTP is down → rows queue → recovery drains the backlog automatically.** Five consecutive
`TransientFailure`s (backoff 1/5/15/60/240 min, ~5.2h end to end) land a row `Failed` on the
admin Failed Sends tab with `LastError` populated. An admin fixes SMTP config, then either
waits for the next affected notification (failure is per-row, unrelated rows are unaffected)
or clicks Retry to force an immediate re-attempt.

## Error handling

| Rule | Status | Message |
|---|---|---|
| `PUT notifications/preferences` with an unknown event/channel | 400 | "Unknown event type or channel." |
| `POST admin/notifications/{id}/retry` on a non-`Failed` row | 409 | "Only failed notifications can be retried." |
| `POST admin/notifications/{id}/retry` on a missing/cross-tenant id | 404 | (never 403, per the codebase's usual tenant-scoped-lookup idiom) |
| `POST admin/notifications/test-email` with a malformed address | 400 | "Enter a valid email address." |
| `POST admin/notifications/test-email` when SMTP is unreachable | 200, `{ sent: false, error: "<classified reason>" }` | not a 500 — a failed test is the endpoint's expected outcome, not a server error |
| Dispatcher: recipient not found / cross-tenant id | outbox → `Skipped` | `LastError = "Recipient not found"` |
| Dispatcher: no email / disabled preference | outbox → `Skipped` | `"Recipient has no email address"` / `"User preference disabled"` |
| Dispatcher: 5th transient failure | outbox → `Failed` | classified SMTP exception message |
| Dispatcher: permanent (4xx) SMTP failure | outbox → `Failed` immediately | same |

## Out of scope / explicitly deferred

- SMS provider selection/implementation — `SmsChannel` is a permanent v1 stub; preference
  rows and UI already exist for when a provider is added.
- Push notifications (web/mobile) — no channel, no entity support.
- Digest/batching — every event is one outbox row per recipient, sent as soon as reached.
- Per-tenant template customisation — templates are shared C# code.
- Read receipts / open tracking — `NotificationLog.ProviderMessageId` exists for
  correlating with SMTP server logs, but no tracking pixel or bounce/open webhook.
- An in-app notification centre — ruled out by product ruling 3; badges stay as-is.
- Distributed locking / multi-instance dispatch safety — see the single-instance
  constraint in §3, deferred until the deployment scales past one replica.
- Wiring sibling-spec event types (shift completion, service agreements, integration
  degraded) — enum values reserved now, trigger code lands with those features.
- Wiring `IncidentWitness`'s parallel witness-request flow under `WitnessRequested` — noted
  in §5 as a follow-up, not built here.

## Testing

**Backend (`Odip.Tests`)**
- `Notifications/NotificationOutboxTests` (EF InMemory) — an outbox row exists after
  `SaveChangesAsync` in the same call as the triggering write; `RaiseAsync` without a
  following `SaveChangesAsync` leaves no row (proves it performs no I/O itself).
- `Notifications/DedupeTests` — two `RaiseAsync` calls for the same triple within 5 minutes
  yield one row; 9 minutes apart yield two.
- `Notifications/NotificationDispatchBackgroundServiceTests` — Moq'd `INotificationChannel`:
  a disabled preference skips without calling `SendAsync`; the kill switch leaves rows
  `Pending` and never invokes `SendAsync`; `TransientFailure` increments `Attempts` and sets
  `NextAttemptAt` per `[1,5,15,60,240]`; the 5th transient failure sets `Failed` instead of
  scheduling a 6th attempt; `PermanentFailure` sets `Failed` on the first attempt.
- `Notifications/RecipientResolutionTests` — `LeaveRequestSubmitted` resolves every
  Admin/Coordinator in the tenant, no SupportWorker/ReadOnly, no cross-tenant user (Moq'd
  `ICurrentTenant`, same pattern `StaffAssignmentGateTests.CreateDb` uses).
- `Notifications/TemplateRenderingTests` — one snapshot test per event type: fixed payload
  in, exact `Subject`/`PlainTextBody` out, `HtmlBody` contains the same link — guards
  against clinical detail creeping into a template later.
- `Notifications/ScopedTenantContextTests` — a tick processing two tenants' rows tags
  `NotificationOutbox`/`NotificationLog` rows correctly per tenant, and a normal
  tenant-scoped context never sees the other tenant's rows (proves `ScopedTenantOverride`
  isolates rather than leaking superadmin visibility into written rows).
- Trigger-point tests extend each existing controller test file (leave, rostering,
  medications, caregiver, incidents) with one assertion: after the existing action, the
  expected `NotificationOutbox` row(s) exist with the right `EventType`/`RecipientUserId`.

**Frontend** — co-located `*.test.tsx`, `vi.mock('@/api/hooks')` per the established
convention (`PortalShiftsPage.test.tsx`'s `vi.hoisted` pattern): `NotificationPreferencesTab`
(grid renders every event × channel, SMS always disabled, toggling Email calls the update
mutation with the right payload), `AdminNotificationsTab` (failed rows render with error
text, Retry calls the mutation and disables while pending), `SettingsPage` (new tabs
appear/hide per `canManageNotifications`).

## Delivery

Two PRs:

1. **Backend outbox + dispatcher + email channel + preference/admin endpoints + wiring** —
   `NotificationOutbox`/`NotificationPreference`/`NotificationLog` entities, the single
   additive `AddNotifications` migration, `INotificationRaiser`/`NotificationRaiser`,
   `INotificationChannel`/`SmtpEmailChannel`/`SmsChannel`, `ScopedTenantOverride`,
   `NotificationDispatchBackgroundService` (registered beside `HolidaySyncBackgroundService`),
   `NotificationsController`, `AdminNotificationsController`, `NotificationDTOs.cs`, the
   `MailKit`/`MimeKit` package refs, the `AuditedEntities.Types` addition, and wiring the six
   v1 triggers (`LeaveRequestSubmitted`, `LeaveRequestDecided`, `ShiftAssigned`,
   `WitnessRequested`, `CaregiverSubmissionReceived`, `IncidentReported`) — plus every
   backend test above.
2. **Frontend settings grid + admin tab + mock-api** — `notifications.ts` hooks + types,
   barrel export, `NotificationPreferencesTab`, `AdminNotificationsTab`, `SettingsPage.tsx`
   tab wiring, `permissions.ts`'s `canManageNotifications`, the four mock-api routes, and
   every frontend test above.

Sibling-spec events are wired in their own PRs once those features land — this delivery
only reserves their enum values. Both PRs' migrations are additive only.

## Open questions

None — every product-facing choice (kill-switch behaviour, backoff schedule, batch size,
dedupe window, audit inclusion, single-instance constraint) is a ruling stated above, not a
decision left open.
