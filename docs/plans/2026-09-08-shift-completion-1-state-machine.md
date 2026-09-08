# Shift Completion — PR 1: State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a `Shift` a real Start→Finish→Review lifecycle with server-stamped actual times: a worker taps Start/Finish on their own shift (portal), and office review (Approve/Returns) is the *only* path to `ShiftStatus.Completed`. Land the full backend state machine — entity, migration, DTOs, portal actions, rostering review endpoints, and the `UpdateShift` status-transition gate that closes the "PUT any status" backdoor. No UI, no claim generation — those are PR 2 and PR 3.
**Architecture:** .NET 8 layered (Domain → Application → Infrastructure → Api). Controllers call `OdipDbContext` directly — no CQRS/MediatR despite the package reference. Tests in `Odip.Tests` (xUnit + Moq + EF Core InMemory), fixtures inline per file, no shared base class.
**Tech Stack:** .NET 8 / EF Core (Npgsql in production, InMemory in tests) / xUnit / Moq.
**Spec:** docs/specs/2026-09-08-shift-completion-design.md

## Global Constraints

- Migration `AddShiftCompletion` must be additive-only (one new table, one new column on `Shifts`), placed after `20260907071508_AddStaffLeaveAndRecurringUnavailability` (the current latest) — never rename/reorder an existing migration id; `Program.cs`'s `__EFMigrationsHistory` self-healing is keyed to specific existing ids.
- `ShiftStatus` is append-only: `Draft=0, Published=1, Completed=2, Cancelled=3` (unchanged, persisted data) plus new `InProgress=4, PendingReview=5`.
- `ActualStart/ActualEnd/StartedAt/SubmittedAt/ReviewedAt` are always server-stamped `DateTime.UtcNow` — the client never supplies the real timestamp. Exception: Finish's manual-start path sets `ActualStart = dto.ActualStart` (client-supplied), but `StartedAt` still stamps the real Finish-time `UtcNow`.
- Geolocation (`latitude/longitude`) is optional on both Start and Finish; `geolocationDeclined` records a decline but never blocks the action.
- Finish 409s `SHIFT_NOTE_REQUIRED` unless `_db.ShiftNotes.AnyAsync(n => n.ShiftId == id)` is true — checked first, before any status branch, so the worker gets one clear reason.
- Rostered times = `Shift.ServiceDate` + `StartTime`/`EndTime` (`EndTime`'s date rolls `+1` day when `EndsNextDay`), interpreted as local time in `ShiftCompletion.TimeZoneId` and converted to UTC via `TimeZoneInfo.ConvertTimeToUtc`. `TimeZoneId` is resolved once at Start from a static AU-state → IANA map keyed off `ProviderSettings.State` (`VIC/NSW/ACT/TAS`→`Australia/Sydney`, `QLD`→`Australia/Brisbane`, `SA`→`Australia/Adelaide`, `WA`→`Australia/Perth`, `NT`→`Australia/Darwin`; unmatched/null state falls back to `Australia/Sydney` — a ruling this plan makes, see the report for why).
- Role gates: Portal `start`/`finish` use `[Authorize]` + `ResolveCurrentStaffIdAsync` self-scoping, 404 never 403 for a shift that isn't the caller's own. Rostering `completions`/`approve`/`return` inherit `RosteringController`'s class-level `[Authorize(Roles="SuperAdmin,Admin,Coordinator")]` — no per-action override.
- Error codes (`SHIFT_NOT_STARTABLE`, `SHIFT_NOTE_REQUIRED`, `SHIFT_NOT_IN_PROGRESS`, `SHIFT_NOT_PENDING_REVIEW`, `STATUS_TRANSITION_VIA_COMPLETION`) are carried on a new `ApiResponse<T>.Code` property via a new `Fail(string error, string code)` overload, added additively to `ApiResponse.cs` in Task 1 — the human message stays a plain sentence in `Errors`, matching every existing `Fail(string)` call site, and PR 2's frontend can branch on `Code` instead of parsing message text. `Program.cs` already sets `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull`, so the new nullable `code` field is simply omitted from JSON on every pre-existing response (not serialised as `null`) — no existing caller sees a new field. Status codes: 409 for every state-machine conflict, 400 for Return's missing reason, 404 for not-found/not-yours.
- `ShiftCompletion` joins `AuditedEntities.Types` in Task 1 — same file/justification as `Shift.OverrideReason`.
- Return's `SHIFT_ALREADY_CLAIMED` defence-in-depth guard is **not** implemented in PR 1 — `ClaimLineItem.ShiftId` doesn't exist until PR 3's own migration, and nothing in PR 1 can attach a claim to a shift, so the guard is structurally unreachable until PR 3 (a ruling this plan makes, see the report).
- `Rostering:VarianceReviewMinutes` config is **not** wired into any PR 1 endpoint — the spec's own §4 says the 15-minute threshold ships hardcoded on the frontend (PR 2), and no DTO in PR 1's API surface carries a threshold value, so reading the config here would be dead code (a ruling this plan makes, see the report).

---

## File Structure

| File | Responsibility |
|---|---|
| `odip-prototype/odip/backend/Odip.Domain/Rostering/RosteringEntities.cs` | Modify: append `ShiftStatus.InProgress/PendingReview`, add `Shift.ReturnCount` |
| `odip-prototype/odip/backend/Odip.Application/Common/ApiResponse.cs` | Modify: add `Code` property + `Fail(string error, string code)` overload |
| `odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs` | Create: `ReviewOutcome` enum, `ShiftCompletion` entity, `StateTimeZoneMap`, `ShiftVarianceCalculator` |
| `odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs` | Modify: `ShiftCompletions` DbSet, entity config (incl. partial unique index), tenant query filter |
| `odip-prototype/odip/backend/Odip.Infrastructure/Audit/AuditedEntities.cs` | Modify: register `typeof(ShiftCompletion)` |
| `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftCompletion.cs` + `.Designer.cs` | Create (generated): additive migration |
| `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/OdipDbContextModelSnapshot.cs` | Modify (generated): updated model snapshot |
| `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs` | Create: `StartShiftDto`, `FinishShiftDto`, `ShiftCompletionDto`, `CompletionQueueItemDto`, `ReturnCompletionDto` |
| `odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs` | Modify: `PortalShiftDetailDto` gains `Completion`/`ReturnCount` |
| `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` | Modify: `StartShift`/`FinishShift` actions, `GetShiftDetail` refactor, shared DTO-building helpers |
| `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` | Modify: `GetCompletions`/`GetShiftCompletion`/`ApproveCompletion`/`ReturnCompletion`, `UpdateShift` status gate, helpers |
| `odip-prototype/odip/backend/Odip.Tests/Audit/ShiftCompletionAuditTests.cs` | Create: entity/DbSet/config/audit-registration coverage |
| `odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs` | Create: `Fail(string, string)`/`Code` coverage |
| `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionVarianceTests.cs` | Create: variance calc + timezone map coverage |
| `odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs` | Modify: `GetShiftDetail` now returns `Completion`/`ReturnCount` |
| `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs` | Create: Start/Finish transitions, 409/404 guards |
| `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs` | Create: completions list/detail, Approve/Return, `ReturnCount`, `IsActive` flips |
| `odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs` | Create: `UpdateShift` status-transition gate |

---

### Task 1: `ShiftStatus` append + `Shift.ReturnCount` + `ShiftCompletion` entity + DbContext config + audit registration

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Domain/Rostering/RosteringEntities.cs:8-14` (enum), `:77` (new property)
- Modify: `odip-prototype/odip/backend/Odip.Application/Common/ApiResponse.cs` (add `Code` + `Fail(string, string)` overload)
- Create: `odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs`
- Modify: `odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs:99` (DbSet), `:1120` (entity config), `:1541` (tenant filter)
- Modify: `odip-prototype/odip/backend/Odip.Infrastructure/Audit/AuditedEntities.cs:64-65`
- Test: `odip-prototype/odip/backend/Odip.Tests/Audit/ShiftCompletionAuditTests.cs`
- Test: `odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs`

**Interfaces:**
- Consumes: `ITenantEntity` (`Odip.Domain.Interfaces`), `Shift` (`Odip.Domain.Rostering`), `AuditInterceptor` (`Odip.Infrastructure.Audit`), the existing `ApiResponse<T>` shape (`Odip.Application.Common`).
- Produces: `ReviewOutcome` enum, `ShiftCompletion` entity (every field later tasks read/write), `OdipDbContext.ShiftCompletions` DbSet, and `ApiResponse<T>.Code`/`ApiResponse<T>.Fail(string error, string code)` — all consumed by every later task (Tasks 4, 5, 7, 8, 9 use `Fail(string, string)` for their state-machine error codes).

- [ ] **Step 1: Write the failing test**
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Audit/ShiftCompletionAuditTests.cs
  using System.Security.Claims;
  using Microsoft.AspNetCore.Http;
  using Microsoft.EntityFrameworkCore;
  using Moq;
  using Odip.Domain.Entities;
  using Odip.Domain.Enums;
  using Odip.Domain.Interfaces;
  using Odip.Domain.Rostering;
  using Odip.Infrastructure.Audit;
  using Odip.Infrastructure.Data;
  using Xunit;

  namespace Odip.Tests.Audit;

  /// <summary>
  /// Confirms ShiftCompletion (design spec §1, joining AuditedEntities.Types "on day one" — same
  /// justification as Shift.OverrideReason) actually produces an AuditLog row via
  /// AuditInterceptor. Mirrors Odip.Tests/Rostering/RosteringAuditTests.cs's scaffold exactly.
  /// </summary>
  public class ShiftCompletionAuditTests
  {
      private static readonly Guid TenantId = Guid.NewGuid();
      private static readonly DateOnly ServiceDate = new(2026, 9, 8);

      private static OdipDbContext CreateDb(Guid actingUserId)
      {
          var tenant = new Mock<ICurrentTenant>();
          tenant.Setup(t => t.TenantId).Returns((Guid?)null);
          tenant.Setup(t => t.IsSuperAdmin).Returns(true);

          var identity = new ClaimsIdentity(
              [
                  new Claim(ClaimTypes.NameIdentifier, actingUserId.ToString()),
                  new Claim("fullName", "Jane Coordinator")
              ],
              "Test");
          var accessor = new Mock<IHttpContextAccessor>();
          accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

          var options = new DbContextOptionsBuilder<OdipDbContext>()
              .UseInMemoryDatabase(Guid.NewGuid().ToString())
              .AddInterceptors(new AuditInterceptor(accessor.Object))
              .Options;

          return new OdipDbContext(options, tenant.Object);
      }

      private static Participant NewParticipant() => new()
      {
          Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng"
      };

      private static User NewStaff() => new()
      {
          Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
          Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
          Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
      };

      private static Shift NewShift(Participant participant, User staff) => new()
      {
          Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, UserId = staff.Id,
          ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
          Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.InProgress,
      };

      [Fact]
      public async Task CreateShiftCompletion_WritesCreatedAuditLog()
      {
          var actingUserId = Guid.NewGuid();
          using var db = CreateDb(actingUserId);
          var participant = NewParticipant();
          var staff = NewStaff();
          db.Participants.Add(participant);
          db.Users.Add(staff);
          await db.SaveChangesAsync();

          var shift = NewShift(participant, staff);
          db.Shifts.Add(shift);
          await db.SaveChangesAsync();

          var completion = new ShiftCompletion
          {
              Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id,
              ActualStart = DateTime.UtcNow, TimeZoneId = "Australia/Sydney",
              SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow, IsActive = true,
          };
          db.ShiftCompletions.Add(completion);
          await db.SaveChangesAsync();

          var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(ShiftCompletion)).ToList());
          Assert.Equal(completion.Id, log.EntityId);
          Assert.Equal(AuditAction.Created, log.Action);
          Assert.Equal("Jane Coordinator", log.ChangedByName);
      }

      [Fact]
      public async Task ReturnShiftCompletion_WritesAuditLogWithTheReturnReason()
      {
          var actingUserId = Guid.NewGuid();
          using var db = CreateDb(actingUserId);
          var participant = NewParticipant();
          var staff = NewStaff();
          db.Participants.Add(participant);
          db.Users.Add(staff);
          await db.SaveChangesAsync();

          var shift = NewShift(participant, staff);
          db.Shifts.Add(shift);
          await db.SaveChangesAsync();

          var completion = new ShiftCompletion
          {
              Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id,
              ActualStart = DateTime.UtcNow, TimeZoneId = "Australia/Sydney",
              SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow, IsActive = true,
          };
          db.ShiftCompletions.Add(completion);
          await db.SaveChangesAsync();

          completion.ReviewOutcome = ReviewOutcome.Returned;
          completion.ReturnReason = "Actual times look implausible, please double check.";
          completion.IsActive = false;
          completion.ReviewedByUserId = actingUserId;
          completion.ReviewedAt = DateTime.UtcNow;
          await db.SaveChangesAsync();

          var updateLog = db.AuditLogs
              .Where(a => a.EntityType == nameof(ShiftCompletion) && a.EntityId == completion.Id && a.Action == AuditAction.Updated)
              .Single();
          Assert.Contains("ReturnReason", updateLog.Changes);
          Assert.Contains("Actual times look implausible, please double check.", updateLog.Changes);
      }

      [Fact]
      public void ShiftCompletion_IsRegisteredInAuditedEntitiesTypes()
      {
          Assert.Contains(typeof(ShiftCompletion), AuditedEntities.Types);
      }
  }
  ```
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs
  using Odip.Application.Common;
  using Xunit;

  namespace Odip.Tests.Common;

  /// <summary>
  /// ApiResponse.Fail(string, string) — a machine-readable Code alongside the existing plain-
  /// sentence Errors message, added additively for the shift-completion state machine's 409
  /// codes (SHIFT_NOT_STARTABLE etc., Tasks 4/5/7/8/9) so PR 2's frontend can branch on Code
  /// instead of parsing message text. Every pre-existing Fail(string) call site is unaffected —
  /// Code stays null on those responses.
  /// </summary>
  public class ApiResponseCodeTests
  {
      [Fact]
      public void Fail_WithMessageAndCode_SetsBothErrorsAndCode()
      {
          var response = ApiResponse<string>.Fail("This shift can't be started right now.", "SHIFT_NOT_STARTABLE");

          Assert.False(response.Success);
          Assert.Equal("SHIFT_NOT_STARTABLE", response.Code);
          Assert.Equal("This shift can't be started right now.", Assert.Single(response.Errors!));
      }

      [Fact]
      public void Fail_WithMessageOnly_LeavesCodeNull()
      {
          var response = ApiResponse<string>.Fail("Shift not found.");

          Assert.Null(response.Code);
          Assert.Equal("Shift not found.", Assert.Single(response.Errors!));
      }
  }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/backend`): `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionAuditTests|FullyQualifiedName~ApiResponseCodeTests"`
  Expected: FAIL to compile — `ShiftCompletionAuditTests` fails with `CS0246 The type or namespace name 'ShiftCompletion' could not be found` (the type doesn't exist yet); `ApiResponseCodeTests` fails with `CS1501 No overload for method 'Fail' takes 2 arguments` and `CS1061 'ApiResponse<string>' does not contain a definition for 'Code'`.
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Domain/Rostering/RosteringEntities.cs`, replace lines 8-14:
  ```csharp
  /// <summary>Lifecycle of a <see cref="Shift"/>.</summary>
  public enum ShiftStatus
  {
      Draft = 0,
      Published = 1,
      Completed = 2,
      Cancelled = 3,
      InProgress = 4,      // NEW — worker has tapped Start (design spec §1)
      PendingReview = 5,   // NEW — worker has tapped Finish, awaiting office review
  }
  ```
  In the same file, insert after the `AcknowledgedFindingCodes` property (currently line 77), before `CreatedAt`:
  ```csharp
      /// <summary>Comma-separated <see cref="Services.RosterFinding.Code"/> values the coordinator acknowledged.</summary>
      public string? AcknowledgedFindingCodes { get; set; }

      /// <summary>Incremented every time office Returns this shift for correction (design spec §1/§3).</summary>
      public int ReturnCount { get; set; }

      public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
  ```
  Create `odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs`:
  ```csharp
  using Odip.Domain.Interfaces;

  namespace Odip.Domain.Rostering;

  /// <summary>Outcome of an office review of a submitted <see cref="ShiftCompletion"/> (design spec §1/§3).</summary>
  public enum ReviewOutcome
  {
      Approved = 0,
      Returned = 1
  }

  /// <summary>
  /// One worker Start/Finish submission against a <see cref="Shift"/>, and the office's review of
  /// it (design spec §1). "At most one active" per Shift is enforced by
  /// IX_ShiftCompletions_ShiftId_Active (a partial unique index on ShiftId WHERE "IsActive",
  /// configured in OdipDbContext) — see <see cref="IsActive"/>'s own remarks for why an explicit
  /// bool was chosen over deriving activeness from <see cref="ReviewOutcome"/>.
  /// </summary>
  public class ShiftCompletion : ITenantEntity
  {
      public Guid Id { get; set; }
      public Guid TenantId { get; set; }

      public Guid ShiftId { get; set; }
      public Shift? Shift { get; set; }

      /// <summary>UTC. Server-stamped at Start unless <see cref="StartWasManual"/> (then supplied by the worker on Finish).</summary>
      public DateTime ActualStart { get; set; }
      /// <summary>UTC. Null until Finish; may fall on the next calendar day for an overnight shift.</summary>
      public DateTime? ActualEnd { get; set; }
      /// <summary>IANA id used to compute variance — resolved once at Start from <see cref="StateTimeZoneMap"/>.</summary>
      public string TimeZoneId { get; set; } = string.Empty;

      public decimal? StartLatitude { get; set; }
      public decimal? StartLongitude { get; set; }
      public decimal? EndLatitude { get; set; }
      public decimal? EndLongitude { get; set; }
      public bool GeolocationDeclined { get; set; }

      /// <summary>True when Finish supplied ActualStart because Start was skipped.</summary>
      public bool StartWasManual { get; set; }

      /// <summary>The worker — Shift.UserId at Start (or manual-Finish) time.</summary>
      public Guid SubmittedByUserId { get; set; }
      /// <summary>= ActualStart unless StartWasManual, in which case this is the real Finish-time stamp.</summary>
      public DateTime StartedAt { get; set; }
      /// <summary>Set on Finish.</summary>
      public DateTime? SubmittedAt { get; set; }

      public Guid? ReviewedByUserId { get; set; }
      public DateTime? ReviewedAt { get; set; }
      public ReviewOutcome? ReviewOutcome { get; set; }
      public string? ReturnReason { get; set; }

      /// <summary>ActualStart - rostered start, signed minutes (positive = late).</summary>
      public int VarianceMinutesStart { get; set; }
      /// <summary>ActualEnd - rostered end, signed minutes. 0 until Finish.</summary>
      public int VarianceMinutesEnd { get; set; }

      /// <summary>
      /// True for the one "current" row per Shift. Return sets this false in the same
      /// transaction that flips Shift.Status back to Published, excluding it from the active 1:1
      /// without deleting it — full history stays queryable by ShiftId alone. Approve never
      /// touches this — an Approved row is the active row forever, since a Completed shift can
      /// never be re-started.
      /// </summary>
      public bool IsActive { get; set; } = true;

      public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
      public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
  }
  ```
  In `odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs`, insert after line 99 (`public DbSet<ShiftNote> ShiftNotes => Set<ShiftNote>();`):
  ```csharp
      /// <summary>Shift-completion state machine: see <see cref="Entities.ShiftCompletion"/>'s type doc.</summary>
      public DbSet<ShiftCompletion> ShiftCompletions => Set<ShiftCompletion>();
  ```
  Insert after the `ShiftNote` entity-config block (currently ending line 1120, `});`):
  ```csharp
          // ── ShiftCompletion (shift-completion state machine) ────────
          modelBuilder.Entity<ShiftCompletion>(entity =>
          {
              entity.HasKey(e => e.Id);
              entity.Property(e => e.TimeZoneId).HasMaxLength(100);
              entity.Property(e => e.ReturnReason).HasMaxLength(2000);

              // Restrict: same idiom as ShiftNote -> Shift — a shift's completion history must
              // not be silently cascade-deleted out from under it.
              entity.HasOne(e => e.Shift)
                  .WithMany()
                  .HasForeignKey(e => e.ShiftId)
                  .OnDelete(DeleteBehavior.Restrict);

              entity.HasIndex(e => new { e.TenantId, e.ShiftId });

              // "At most one active" per Shift — mirrors CaregiverProfileSubmission's
              // partial-index precedent (OdipDbContext.cs:~650-653).
              entity.HasIndex(e => e.ShiftId)
                  .IsUnique()
                  .HasDatabaseName("IX_ShiftCompletions_ShiftId_Active")
                  .HasFilter("\"IsActive\"");
          });
  ```
  Insert after the `ShiftNote` tenant-filter block (currently ending line 1541):
  ```csharp
          modelBuilder.Entity<ShiftCompletion>()
              .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
          modelBuilder.Entity<ShiftCompletion>()
              .HasIndex(e => e.TenantId);
  ```
  In `odip-prototype/odip/backend/Odip.Infrastructure/Audit/AuditedEntities.cs`, insert before the closing `};` of `Types` (after `typeof(StaffAvailability),`):
  ```csharp
          typeof(StaffAvailability),

          // Shift-completion state machine: a Return's reason and every review decision must be
          // recoverable — same reasoning as Shift.OverrideReason above.
          typeof(ShiftCompletion),
      };
  ```
  In `odip-prototype/odip/backend/Odip.Application/Common/ApiResponse.cs`, insert a new `Code` property after `Errors` (line 11), and a new `Fail(string, string)` overload directly after the existing `Fail(string error)` (lines 16-17):
  ```csharp
  public class ApiResponse<T>
  {
      public bool Success { get; set; }
      public T? Data { get; set; }
      public string? Message { get; set; }
      public List<string>? Errors { get; set; }
      public string? Code { get; set; }

      public static ApiResponse<T> Ok(T data, string? message = null) =>
          new() { Success = true, Data = data, Message = message };

      public static ApiResponse<T> Fail(string error) =>
          new() { Success = false, Errors = new List<string> { error } };

      /// <summary>Machine-readable code for clients that branch on the failure kind — e.g. state-machine 409s. Human text stays in Errors.</summary>
      public static ApiResponse<T> Fail(string error, string code) =>
          new() { Success = false, Errors = new List<string> { error }, Code = code };

      public static ApiResponse<T> Fail(List<string> errors) =>
          new() { Success = false, Errors = errors };

      /// <summary>
      /// A failure that still carries a payload in <see cref="Data"/> — e.g. a rejected roster
      /// write returning its findings. Callers that read a successful response's data off the
      /// same <c>data</c> field (rather than a separate errors/findings field) need this on the
      /// 422/400 path too, so the envelope shape never changes between success and failure.
      /// </summary>
      public static ApiResponse<T> Fail(T data, List<string> errors, string? message = null) =>
          new() { Success = false, Data = data, Errors = errors, Message = message };
  }
  ```
  Every other line in the file (the `PagedResult<T>` class below it) is unchanged. Because `Program.cs` sets `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull` on the controllers' JSON options, the new nullable `Code` property is simply omitted from the JSON body on every response that doesn't set it — no existing consumer sees a new `code` field at all, null or otherwise.
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionAuditTests|FullyQualifiedName~ApiResponseCodeTests"`
  Expected: PASS (3 audit facts + 2 `ApiResponseCodeTests` facts).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Domain/Rostering/RosteringEntities.cs odip-prototype/odip/backend/Odip.Application/Common/ApiResponse.cs odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs odip-prototype/odip/backend/Odip.Infrastructure/Audit/AuditedEntities.cs odip-prototype/odip/backend/Odip.Tests/Audit/ShiftCompletionAuditTests.cs odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): ShiftStatus append, ShiftCompletion entity, audit registration, ApiResponse.Code

  Adds InProgress/PendingReview to ShiftStatus (append-only), Shift.ReturnCount,
  the new ShiftCompletion entity/DbContext config with its "at most one active"
  partial unique index, and registers it in AuditedEntities.Types. Also adds
  ApiResponse<T>.Code + a Fail(string, string) overload, additively, so the
  state machine's error codes (Tasks 4/5/7/8/9) ride alongside the existing
  plain-sentence Errors message instead of being embedded in it.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Migration `AddShiftCompletion`

**Files:**
- Create (generated): `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<timestamp>_AddShiftCompletion.cs`
- Create (generated): `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<timestamp>_AddShiftCompletion.Designer.cs`
- Modify (generated): `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/OdipDbContextModelSnapshot.cs`

**Interfaces:**
- Consumes: the `OdipDbContext` model as configured by Task 1 (this is a pure `dotnet ef` diff — no hand-written model changes should be needed if Task 1 is complete).
- Produces: the `ShiftCompletions` table and `Shifts.ReturnCount` column in the real Postgres schema.

Migrations aren't exercised by `Odip.Tests` (it runs entirely on EF Core InMemory, which builds its schema from the model directly and ignores migrations) — there is no unit-testable "behaviour" for this task, so it has no failing-test step. Verification is: the migration is additive-only, and the solution builds.

- [ ] **Step 1: Generate the migration**
  Run (from `odip-prototype/odip/backend`): `dotnet ef migrations add AddShiftCompletion --project Odip.Infrastructure --startup-project Odip.Api`
  If this errors with "No executable found matching command dotnet-ef": check for `odip-prototype/odip/backend/.config/dotnet-tools.json` first — if it exists, run `dotnet tool restore`; if not, run `dotnet tool install --global dotnet-ef --version 8.*` (matching the solution's net8.0 target) and retry.
- [ ] **Step 2: Verify the migration is additive-only**
  Open the generated `<timestamp>_AddShiftCompletion.cs`. Confirm `Up()` contains exactly: one `migrationBuilder.AddColumn<int>(name: "ReturnCount", table: "Shifts", ...)` call, and one `migrationBuilder.CreateTable(name: "ShiftCompletions", ...)` call plus its `CreateIndex` calls (including `IX_ShiftCompletions_ShiftId_Active` with a `filter: "\"IsActive\""` argument — confirming the partial unique index came through). Confirm `Up()` contains **no** `DropColumn`/`DropTable`/`RenameColumn`/`RenameTable` calls against any existing table. Confirm `Down()` reverses both additions (`DropTable("ShiftCompletions")`, `DropColumn("ReturnCount", "Shifts")`) and nothing else.
- [ ] **Step 3: Build**
  Run (from `odip-prototype/odip/backend`): `dotnet build`
  Expected: clean build — confirms the generated migration and updated `OdipDbContextModelSnapshot.cs` compile.
- [ ] **Step 4: Run the full test suite**
  Run: `dotnet test Odip.Tests`
  Expected: no new failures (InMemory tests are migration-independent, so this mainly re-confirms Task 1 still passes).
- [ ] **Step 5: Commit**
  Substitute the actual generated filename (the `<timestamp>` prefix `dotnet ef` stamped) for `<ts>` below.
  ```bash
  git -c safe.directory='*' add "odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftCompletion.cs" "odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftCompletion.Designer.cs" odip-prototype/odip/backend/Odip.Infrastructure/Migrations/OdipDbContextModelSnapshot.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): add AddShiftCompletion migration

  Additive-only: creates the ShiftCompletions table (incl. the partial unique
  "at most one active per shift" index) and adds Shifts.ReturnCount. Placed
  after 20260907071508_AddStaffLeaveAndRecurringUnavailability, the prior latest.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: DTOs + timezone map + variance calculator + `PortalShiftDetailDto` extension

**Files:**
- Create: `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs`
- Modify: `odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs:104-118`
- Modify: `odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs` (append `StateTimeZoneMap`, `ShiftVarianceCalculator`)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs:110-153` (refactor `GetShiftDetail`, add helpers)
- Test: `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionVarianceTests.cs` (new)
- Test: `odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs` (modify — add 1 fact)

**Interfaces:**
- Consumes: `ShiftCompletion`/`ReviewOutcome` (Task 1), `Shift` (`ServiceDate`/`StartTime`/`EndTime`/`EndsNextDay`), `ProviderSettings.State`.
- Produces: `StartShiftDto`, `FinishShiftDto`, `ShiftCompletionDto`, `CompletionQueueItemDto`, `ReturnCompletionDto` (used by Tasks 4-9); `StateTimeZoneMap.Resolve(string?)` and `ShiftVarianceCalculator.ResolveRosteredTimesUtc(Shift, string)`/`.VarianceMinutes(DateTime, DateTime)` (used by Tasks 4, 5, 6); `PortalController.BuildShiftDetailDtoAsync(Shift, CancellationToken)` and `.ToShiftCompletionDtoAsync(ShiftCompletion, CancellationToken)` (used by Tasks 4, 5).

- [ ] **Step 1: Write the failing tests**
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionVarianceTests.cs
  using Odip.Domain.Rostering;
  using Xunit;

  namespace Odip.Tests.Rostering;

  /// <summary>Variance calc against rostered times (design spec §3), incl. an EndsNextDay
  /// sleepover shift crossing midnight, and the state→timezone map.</summary>
  public class ShiftCompletionVarianceTests
  {
      [Fact]
      public void ResolveRosteredTimesUtc_SimpleDayShift_ConvertsSydneyLocalToUtc()
      {
          var shift = new Shift
          {
              ServiceDate = new DateOnly(2026, 9, 8), // AEST (no DST — starts 4 Oct 2026)
              StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
          };

          var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, "Australia/Sydney");

          Assert.Equal(new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), start);
          Assert.Equal(new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc), end);
      }

      [Fact]
      public void ResolveRosteredTimesUtc_SleepoverShiftEndsNextDay_RollsEndDateForward()
      {
          var shift = new Shift
          {
              ServiceDate = new DateOnly(2026, 9, 8),
              StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true,
          };

          var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, "Australia/Sydney");

          Assert.Equal(new DateTime(2026, 9, 8, 12, 0, 0, DateTimeKind.Utc), start); // 22:00 AEST 8 Sep
          Assert.Equal(new DateTime(2026, 9, 8, 20, 0, 0, DateTimeKind.Utc), end);   // 06:00 AEST 9 Sep
      }

      [Fact]
      public void VarianceMinutes_ActualLaterThanRostered_ReturnsPositiveMinutes()
      {
          var rostered = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
          Assert.Equal(12, ShiftVarianceCalculator.VarianceMinutes(rostered.AddMinutes(12), rostered));
      }

      [Fact]
      public void VarianceMinutes_ActualEarlierThanRostered_ReturnsNegativeMinutes()
      {
          var rostered = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc);
          Assert.Equal(-5, ShiftVarianceCalculator.VarianceMinutes(rostered.AddMinutes(-5), rostered));
      }

      [Theory]
      [InlineData("VIC", "Australia/Sydney")]
      [InlineData("NSW", "Australia/Sydney")]
      [InlineData("ACT", "Australia/Sydney")]
      [InlineData("TAS", "Australia/Sydney")]
      [InlineData("QLD", "Australia/Brisbane")]
      [InlineData("SA", "Australia/Adelaide")]
      [InlineData("WA", "Australia/Perth")]
      [InlineData("NT", "Australia/Darwin")]
      [InlineData(null, "Australia/Sydney")]
      [InlineData("XX", "Australia/Sydney")]
      public void Resolve_MapsEveryAustralianStateAndFallsBackForUnknown(string? state, string expectedZone)
      {
          Assert.Equal(expectedZone, StateTimeZoneMap.Resolve(state));
      }
  }
  ```
  Add to `odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs` (new fact, reusing the file's existing `CreateDb`/`MakeController`/`SeedUser`/`SeedParticipant`/`SeedShift` helpers):
  ```csharp
  [Fact]
  public async Task GetShiftDetail_NoCompletionYet_ReturnsNullCompletionAndZeroReturnCount()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id);
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.GetShiftDetail(shift.Id, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
      Assert.Null(body.Data!.Completion);
      Assert.Equal(0, body.Data.ReturnCount);
  }
  ```
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionVarianceTests|FullyQualifiedName~PortalControllerTests"`
  Expected: FAIL to compile — `ShiftVarianceCalculator`/`StateTimeZoneMap` don't exist yet (`ShiftCompletionVarianceTests`), and `PortalShiftDetailDto` has no `Completion`/`ReturnCount` members yet (`PortalControllerTests`).
- [ ] **Step 3: Write minimal implementation**
  Create `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs`:
  ```csharp
  using System.ComponentModel.DataAnnotations;
  using Odip.Domain.Rostering;

  namespace Odip.Application.DTOs;

  // ══════════════════════════════════════════════════════════════
  // SHIFT COMPLETION DTOs (design spec §2) — Portal (start/finish) and Rostering
  // (completions list/detail/approve/return) share this shape.
  // ══════════════════════════════════════════════════════════════

  public record StartShiftDto
  {
      public decimal? Latitude { get; init; }
      public decimal? Longitude { get; init; }
      public bool GeolocationDeclined { get; init; }
  }

  public record FinishShiftDto
  {
      public decimal? Latitude { get; init; }
      public decimal? Longitude { get; init; }
      public bool GeolocationDeclined { get; init; }
      /// <summary>Supplied only on the manual-start path — Start was skipped, so Finish supplies the real ActualStart.</summary>
      public DateTime? ActualStart { get; init; }
  }

  public record ShiftCompletionDto(
      Guid Id,
      Guid ShiftId,
      DateTime ActualStart,
      DateTime? ActualEnd,
      string TimeZoneId,
      bool GeolocationDeclined,
      bool StartWasManual,
      Guid SubmittedByUserId,
      string SubmittedByName,
      DateTime StartedAt,
      DateTime? SubmittedAt,
      Guid? ReviewedByUserId,
      string? ReviewedByName,
      DateTime? ReviewedAt,
      ReviewOutcome? ReviewOutcome,
      string? ReturnReason,
      int VarianceMinutesStart,
      int VarianceMinutesEnd);

  public record CompletionQueueItemDto(
      Guid ShiftId,
      Guid CompletionId,
      string ParticipantName,
      string StaffName,
      DateOnly ServiceDate,
      DateTime RosteredStart,
      DateTime RosteredEnd,
      DateTime ActualStart,
      DateTime? ActualEnd,
      int VarianceMinutesStart,
      int VarianceMinutesEnd,
      ShiftStatus Status);

  public record ReturnCompletionDto
  {
      [Required, StringLength(2000, MinimumLength = 1)]
      public string Reason { get; init; } = string.Empty;
  }
  ```
  In `odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs`, replace the `PortalShiftDetailDto` declaration (currently lines 104-118):
  ```csharp
  public record PortalShiftDetailDto(
      Guid Id,
      DateOnly ServiceDate,
      TimeOnly StartTime,
      TimeOnly EndTime,
      bool EndsNextDay,
      decimal DurationHours,
      SupportRatio Ratio,
      SleepoverType NightType,
      ShiftStatus Status,
      string? Notes,
      PortalParticipantSummaryDto Participant,
      List<ParticipantRoutineDto> Routines,
      List<ParticipantRiskEntryDto> RiskEntries,
      List<PortalMedicationSummaryDto> Medications,
      ShiftCompletionDto? Completion,
      int ReturnCount);
  ```
  Append to `odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs`:
  ```csharp

  /// <summary>
  /// Design spec §3: TimeZoneId is resolved once, at Start, from a static AU-state → IANA-zone
  /// map keyed off ProviderSettings.State — the only geographic signal that exists on the tenant
  /// today. Unmatched/null state falls back to Australia/Sydney (same zone as the map's largest
  /// bucket, and the same zone ProviderSettings.State's own default "VIC" resolves to).
  /// </summary>
  public static class StateTimeZoneMap
  {
      private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
      {
          ["VIC"] = "Australia/Sydney",
          ["NSW"] = "Australia/Sydney",
          ["ACT"] = "Australia/Sydney",
          ["TAS"] = "Australia/Sydney",
          ["QLD"] = "Australia/Brisbane",
          ["SA"] = "Australia/Adelaide",
          ["WA"] = "Australia/Perth",
          ["NT"] = "Australia/Darwin",
      };

      public static string Resolve(string? state) =>
          state is not null && Map.TryGetValue(state, out var zone) ? zone : "Australia/Sydney";
  }

  /// <summary>
  /// Design spec §3: rostered start/end are computed from Shift.ServiceDate + StartTime/EndTime
  /// (+1 day on EndTime if EndsNextDay), interpreted as local time in the given IANA zone and
  /// converted to UTC. Variance is the signed minute difference against ActualStart/ActualEnd
  /// (positive = late/over, negative = early/under).
  /// </summary>
  public static class ShiftVarianceCalculator
  {
      public static (DateTime RosteredStartUtc, DateTime RosteredEndUtc) ResolveRosteredTimesUtc(Shift shift, string timeZoneId)
      {
          var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
          var rosteredStartLocal = shift.ServiceDate.ToDateTime(shift.StartTime, DateTimeKind.Unspecified);
          var endDate = shift.EndsNextDay ? shift.ServiceDate.AddDays(1) : shift.ServiceDate;
          var rosteredEndLocal = endDate.ToDateTime(shift.EndTime, DateTimeKind.Unspecified);

          return (TimeZoneInfo.ConvertTimeToUtc(rosteredStartLocal, tz), TimeZoneInfo.ConvertTimeToUtc(rosteredEndLocal, tz));
      }

      public static int VarianceMinutes(DateTime actualUtc, DateTime rosteredUtc) =>
          (int)Math.Round((actualUtc - rosteredUtc).TotalMinutes);
  }
  ```
  In `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs`, replace `GetShiftDetail`'s body (currently lines 110-153) so it delegates to a new shared helper:
  ```csharp
      [HttpGet("shifts/{id:guid}")]
      public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> GetShiftDetail(Guid id, CancellationToken ct)
      {
          var staffId = await ResolveCurrentStaffIdAsync(ct);
          if (staffId is null)
              return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

          var shift = await _db.Shifts
              .Include(s => s.Participant)
              .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
          // INTAKE-08: same defence-in-depth draft exclusion as GetMyShifts above — treat it
          // identically to "no participant at all" rather than surfacing a draft's detail.
          if (shift?.Participant is null || shift.Participant.IsDraft)
              return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

          return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
      }
  ```
  Add the two new private helpers directly below `GetShiftDetail` (before the SHIFT NOTES region):
  ```csharp
      /// <summary>
      /// Shared shift-detail builder for GetShiftDetail/StartShift/FinishShift (shift-completion
      /// design spec §2) — all three need the same participant/routines/risk/medications/
      /// completion shape. Assumes shift.Participant is already loaded (every caller Includes it
      /// and null-checks first).
      /// </summary>
      private async Task<PortalShiftDetailDto> BuildShiftDetailDtoAsync(Shift shift, CancellationToken ct)
      {
          var participant = shift.Participant!;

          var routines = await _db.ParticipantRoutines
              .Where(r => r.ParticipantId == participant.Id && r.IsActive)
              .OrderByDescending(r => r.IsCritical).ThenBy(r => r.Days).ThenBy(r => r.StartTime)
              .ToListAsync(ct);

          var riskEntries = await _db.ParticipantRiskEntries
              .Where(r => r.ParticipantId == participant.Id && r.IsActive)
              .OrderBy(r => r.AtRiskParty).ThenByDescending(r => r.CreatedAt)
              .ToListAsync(ct);

          var medications = await _db.ParticipantMedications
              .Where(m => m.ParticipantId == participant.Id && m.Status == MedicationStatus.Active)
              .OrderBy(m => m.Name)
              .ToListAsync(ct);

          var activeCompletion = await _db.ShiftCompletions
              .Where(c => c.ShiftId == shift.Id && c.IsActive)
              .FirstOrDefaultAsync(ct);
          var completionDto = activeCompletion is null ? null : await ToShiftCompletionDtoAsync(activeCompletion, ct);

          return new PortalShiftDetailDto(
              shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.DurationHours,
              shift.Ratio, shift.NightType, shift.Status, shift.Notes,
              ToParticipantSummaryDto(participant),
              routines.Select(ToRoutineDto).ToList(),
              riskEntries.Select(ToRiskEntryDto).ToList(),
              medications.Select(ToMedicationSummaryDto).ToList(),
              completionDto,
              shift.ReturnCount);
      }

      /// <summary>Maps a ShiftCompletion to its DTO, resolving submitter/reviewer display names.</summary>
      private async Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, CancellationToken ct)
      {
          var submittedBy = await _db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
          User? reviewedBy = c.ReviewedByUserId.HasValue
              ? await _db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
              : null;

          return new ShiftCompletionDto(
              c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
              c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
              c.StartedAt, c.SubmittedAt,
              c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
              c.VarianceMinutesStart, c.VarianceMinutesEnd);
      }
  ```
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionVarianceTests|FullyQualifiedName~PortalControllerTests"`
  Expected: PASS — all `ShiftCompletionVarianceTests` facts, all existing `PortalControllerTests` facts (unaffected by the trailing-parameter DTO change), and the new `GetShiftDetail_NoCompletionYet_...` fact.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs odip-prototype/odip/backend/Odip.Domain/Rostering/ShiftCompletionEntities.cs odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionVarianceTests.cs odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): DTOs, timezone map, variance calculator

  Adds ShiftCompletionDTOs.cs, the AU-state->IANA timezone map, the rostered-
  time/variance calculator, and extends PortalShiftDetailDto with Completion/
  ReturnCount — refactoring GetShiftDetail into a shared builder Start/Finish
  will reuse next.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: `PortalController` Start action

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (new `StartShift` action)
- Test: `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs` (new)

**Interfaces:**
- Consumes: `ResolveCurrentStaffIdAsync`, `BuildShiftDetailDtoAsync`, `StateTimeZoneMap.Resolve` (Task 3), `ProviderSettings`.
- Produces: `POST /portal/shifts/{id}/start` — `PortalController.StartShift(Guid, StartShiftDto, CancellationToken)`.

- [ ] **Step 1: Write the failing tests**
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs
  using System.Security.Claims;
  using Microsoft.AspNetCore.Http;
  using Microsoft.AspNetCore.Mvc;
  using Microsoft.EntityFrameworkCore;
  using Moq;
  using Odip.Api.Controllers;
  using Odip.Application.Common;
  using Odip.Application.DTOs;
  using Odip.Domain.Entities;
  using Odip.Domain.Enums;
  using Odip.Domain.Interfaces;
  using Odip.Domain.Rostering;
  using Odip.Infrastructure.Data;
  using Xunit;

  namespace Odip.Tests.Rostering;

  /// <summary>
  /// PortalController Start/Finish state-machine coverage (design spec §3) — every transition a
  /// worker can trigger, the double-start/finish-before-start/finish-with-no-notes 409s, and the
  /// assigned-worker-only 404 guard. Approve/Return coverage lives in
  /// RosteringCompletionReviewTests. Same EF InMemory + Moq&lt;ICurrentTenant&gt; +
  /// NameIdentifier-claim pattern as PortalControllerTests.
  /// </summary>
  public class ShiftCompletionStateMachineTests
  {
      private static readonly DateOnly ServiceDate = new(2026, 9, 8);

      private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb()
      {
          var tenant = new Mock<ICurrentTenant>();
          tenant.Setup(t => t.TenantId).Returns((Guid?)null);
          tenant.Setup(t => t.IsSuperAdmin).Returns(true);

          var options = new DbContextOptionsBuilder<OdipDbContext>()
              .UseInMemoryDatabase(Guid.NewGuid().ToString())
              .Options;

          return (new OdipDbContext(options, tenant.Object), tenant);
      }

      private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId)
      {
          var identity = new ClaimsIdentity(
              [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
          return new PortalController(db, tenant)
          {
              ControllerContext = new ControllerContext
              {
                  HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
              }
          };
      }

      private static T Seed<T>(OdipDbContext db, T entity) where T : class
      {
          db.Set<T>().Add(entity);
          db.SaveChanges();
          return entity;
      }

      private static User SeedUser(OdipDbContext db) => Seed(db, new User
      {
          Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
          Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
          Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
      });

      private static Participant SeedParticipant(OdipDbContext db) => Seed(db, new Participant
      {
          Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true,
      });

      private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid staffId, ShiftStatus status = ShiftStatus.Published) => Seed(db, new Shift
      {
          Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = ServiceDate,
          StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
          NightType = SleepoverType.None, Status = status,
      });

      // ══════════════════════════════════════════════════════════════
      // START
      // ══════════════════════════════════════════════════════════════

      [Fact]
      public async Task StartShift_PublishedOwnShift_CreatesActiveCompletion_FlipsInProgress()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
          Assert.Equal(ShiftStatus.InProgress, body.Data!.Status);
          Assert.NotNull(body.Data.Completion);
          Assert.False(body.Data.Completion!.StartWasManual);

          var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
          Assert.Equal(ShiftStatus.InProgress, saved.Status);
          var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
          Assert.True(completion.IsActive);
          Assert.Equal(user.Id, completion.SubmittedByUserId);
      }

      [Fact]
      public async Task StartShift_AlreadyInProgress_Returns409SHIFT_NOT_STARTABLE_AndDoesNotDuplicate()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
          Assert.Equal("SHIFT_NOT_STARTABLE", body.Code);
          Assert.Empty(await db.ShiftCompletions.ToListAsync());
      }

      [Theory]
      [InlineData(ShiftStatus.Draft)]
      [InlineData(ShiftStatus.Cancelled)]
      [InlineData(ShiftStatus.PendingReview)]
      [InlineData(ShiftStatus.Completed)]
      public async Task StartShift_NotPublished_Returns409SHIFT_NOT_STARTABLE(ShiftStatus status)
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, status);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

          Assert.IsType<ConflictObjectResult>(result.Result);
      }

      [Fact]
      public async Task StartShift_ForeignShift_Returns404NotFound()
      {
          var (db, tenant) = CreateDb();
          var owner = SeedUser(db);
          var caller = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, owner.Id);
          var controller = MakeController(db, tenant.Object, caller.Id);

          var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

          Assert.IsType<NotFoundObjectResult>(result.Result);
      }

      [Fact]
      public async Task StartShift_GeolocationDeclined_RecordsDeclineWithNoCoordinates()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.StartShift(shift.Id, new StartShiftDto { GeolocationDeclined = true }, CancellationToken.None);

          Assert.IsType<OkObjectResult>(result.Result);
          var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
          Assert.True(completion.GeolocationDeclined);
          Assert.Null(completion.StartLatitude);
          Assert.Null(completion.StartLongitude);
      }
  }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: FAIL to compile — `PortalController.StartShift` doesn't exist yet.
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs`, add directly after `GetShiftDetail` and its two new helper methods (before the SHIFT NOTES region):
  ```csharp
      // ══════════════════════════════════════════════════════════════
      // SHIFT COMPLETION (design spec §2/§3)
      // ══════════════════════════════════════════════════════════════

      /// <summary>
      /// Worker taps Start on one of their own Published shifts. ActualStart/StartedAt are the
      /// server's own DateTime.UtcNow — the client never supplies the "real" timestamp, only an
      /// optional geolocation stamp and decline flag (spec ruling 1). Same 404-never-403
      /// ownership scoping as every other portal action.
      /// </summary>
      [HttpPost("shifts/{id:guid}/start")]
      public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> StartShift(
          Guid id, [FromBody] StartShiftDto dto, CancellationToken ct)
      {
          var staffId = await ResolveCurrentStaffIdAsync(ct);
          if (staffId is null)
              return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

          var shift = await _db.Shifts
              .Include(s => s.Participant)
              .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
          if (shift?.Participant is null || shift.Participant.IsDraft)
              return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

          if (shift.Status != ShiftStatus.Published)
              return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                  "This shift can't be started right now.", "SHIFT_NOT_STARTABLE"));

          var providerSettings = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
          var now = DateTime.UtcNow;

          var completion = new ShiftCompletion
          {
              Id = Guid.NewGuid(),
              ShiftId = shift.Id,
              ActualStart = now,
              TimeZoneId = StateTimeZoneMap.Resolve(providerSettings?.State),
              StartLatitude = dto.Latitude,
              StartLongitude = dto.Longitude,
              GeolocationDeclined = dto.GeolocationDeclined,
              StartWasManual = false,
              SubmittedByUserId = shift.UserId!.Value,
              StartedAt = now,
              IsActive = true,
          };
          _db.ShiftCompletions.Add(completion);

          shift.Status = ShiftStatus.InProgress;
          shift.UpdatedAt = now;

          await _db.SaveChangesAsync(ct);
          return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
      }
  ```
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: PASS (all 5 START facts).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): PortalController Start action

  POST /portal/shifts/{id}/start: 404 for a shift that isn't the caller's own,
  409 SHIFT_NOT_STARTABLE unless Published, creates an active ShiftCompletion
  and flips the shift InProgress.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: `PortalController` Finish action (ShiftNote gate + geolocation + manual-start path)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (new `FinishShift` action)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs` (append FINISH facts)

**Interfaces:**
- Consumes: `ShiftVarianceCalculator` (Task 3), `_db.ShiftNotes`, `StateTimeZoneMap.Resolve`.
- Produces: `POST /portal/shifts/{id}/finish` — `PortalController.FinishShift(Guid, FinishShiftDto, CancellationToken)`.

- [ ] **Step 1: Write the failing tests**
  Append to `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs`, inside the class, after the START region:
  ```csharp
      // ══════════════════════════════════════════════════════════════
      // FINISH
      // ══════════════════════════════════════════════════════════════

      private static void AddNote(OdipDbContext db, Guid shiftId, Guid authorId) => Seed(db, new ShiftNote
      {
          Id = Guid.NewGuid(), ShiftId = shiftId, AuthorUserId = authorId, AuthorName = "Ben Turner", Body = "All good today.",
      });

      [Fact]
      public async Task FinishShift_InProgressWithNote_ComputesVariance_FlipsPendingReview()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
          Seed(db, new ShiftCompletion
          {
              Id = Guid.NewGuid(), ShiftId = shift.Id,
              ActualStart = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), // exactly on time
              TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
              StartedAt = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc), IsActive = true,
          });
          AddNote(db, shift.Id, user.Id);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
          Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
          Assert.NotNull(body.Data.Completion!.ActualEnd);
          Assert.NotNull(body.Data.Completion.SubmittedAt);
          Assert.Equal(0, body.Data.Completion.VarianceMinutesStart);

          var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
          Assert.Equal(ShiftStatus.PendingReview, saved.Status);
      }

      [Fact]
      public async Task FinishShift_NoShiftNotes_Returns409SHIFT_NOTE_REQUIRED()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
          Seed(db, new ShiftCompletion
          {
              Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow,
              TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id, StartedAt = DateTime.UtcNow, IsActive = true,
          });
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
          Assert.Equal("SHIFT_NOTE_REQUIRED", body.Code);
      }

      [Fact]
      public async Task FinishShift_PublishedNoActualStartSupplied_Returns409SHIFT_NOT_IN_PROGRESS()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
          AddNote(db, shift.Id, user.Id);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
          Assert.Equal("SHIFT_NOT_IN_PROGRESS", body.Code);
      }

      [Fact]
      public async Task FinishShift_PublishedWithActualStartSupplied_ManualStartPath_CreatesCompletionAndFinishes()
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
          AddNote(db, shift.Id, user.Id);
          var controller = MakeController(db, tenant.Object, user.Id);
          var manualStart = DateTime.UtcNow.AddHours(-8);

          var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = manualStart }, CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
          Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
          Assert.True(body.Data.Completion!.StartWasManual);

          var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
          Assert.Equal(manualStart, completion.ActualStart);
          Assert.True(completion.StartWasManual);
          Assert.NotEqual(manualStart, completion.StartedAt); // StartedAt is the real Finish-time stamp
      }

      [Theory]
      [InlineData(ShiftStatus.Draft)]
      [InlineData(ShiftStatus.Cancelled)]
      [InlineData(ShiftStatus.PendingReview)]
      [InlineData(ShiftStatus.Completed)]
      public async Task FinishShift_NotPublishedOrInProgress_Returns409SHIFT_NOT_IN_PROGRESS(ShiftStatus status)
      {
          var (db, tenant) = CreateDb();
          var user = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, user.Id, status);
          AddNote(db, shift.Id, user.Id);
          var controller = MakeController(db, tenant.Object, user.Id);

          var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
          Assert.Equal("SHIFT_NOT_IN_PROGRESS", body.Code);
      }

      [Fact]
      public async Task FinishShift_ForeignShift_Returns404NotFound()
      {
          var (db, tenant) = CreateDb();
          var owner = SeedUser(db);
          var caller = SeedUser(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, owner.Id, ShiftStatus.InProgress);
          var controller = MakeController(db, tenant.Object, caller.Id);

          var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

          Assert.IsType<NotFoundObjectResult>(result.Result);
      }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: FAIL to compile — `PortalController.FinishShift` doesn't exist yet.
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs`, add directly after `StartShift`:
  ```csharp
      /// <summary>
      /// Worker taps Finish. 409 SHIFT_NOTE_REQUIRED if zero ShiftNote rows exist on the shift,
      /// checked first so the worker gets one clear reason. Supports the manual-start path
      /// (dto.ActualStart supplied while Shift.Status is still Published) per spec §3.
      /// </summary>
      [HttpPost("shifts/{id:guid}/finish")]
      public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> FinishShift(
          Guid id, [FromBody] FinishShiftDto dto, CancellationToken ct)
      {
          var staffId = await ResolveCurrentStaffIdAsync(ct);
          if (staffId is null)
              return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

          var shift = await _db.Shifts
              .Include(s => s.Participant)
              .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
          if (shift?.Participant is null || shift.Participant.IsDraft)
              return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

          var hasNote = await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct);
          if (!hasNote)
              return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                  "Add a shift note before finishing.", "SHIFT_NOTE_REQUIRED"));

          var now = DateTime.UtcNow;
          ShiftCompletion completion;

          if (shift.Status == ShiftStatus.Published)
          {
              if (dto.ActualStart is null)
                  return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                      "This shift hasn't been started.", "SHIFT_NOT_IN_PROGRESS"));

              var providerSettings = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
              completion = new ShiftCompletion
              {
                  Id = Guid.NewGuid(),
                  ShiftId = shift.Id,
                  ActualStart = dto.ActualStart.Value,
                  TimeZoneId = StateTimeZoneMap.Resolve(providerSettings?.State),
                  StartWasManual = true,
                  SubmittedByUserId = shift.UserId!.Value,
                  StartedAt = now,
                  IsActive = true,
              };
              _db.ShiftCompletions.Add(completion);
          }
          else if (shift.Status == ShiftStatus.InProgress)
          {
              var existing = await _db.ShiftCompletions
                  .FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive, ct);
              if (existing is null)
                  return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                      "This shift hasn't been started.", "SHIFT_NOT_IN_PROGRESS"));
              completion = existing;
          }
          else
          {
              return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                  "This shift hasn't been started.", "SHIFT_NOT_IN_PROGRESS"));
          }

          completion.ActualEnd = now;
          completion.SubmittedAt = now;
          completion.EndLatitude = dto.Latitude;
          completion.EndLongitude = dto.Longitude;
          completion.GeolocationDeclined = completion.GeolocationDeclined || dto.GeolocationDeclined;

          var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
          completion.VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(completion.ActualStart, rosteredStartUtc);
          completion.VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(completion.ActualEnd.Value, rosteredEndUtc);
          completion.UpdatedAt = now;

          shift.Status = ShiftStatus.PendingReview;
          shift.UpdatedAt = now;

          await _db.SaveChangesAsync(ct);
          return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
      }
  ```
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: PASS (all START + FINISH facts).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): PortalController Finish action

  POST /portal/shifts/{id}/finish: 409 SHIFT_NOTE_REQUIRED unless a ShiftNote
  exists, supports the manual-start path when Start was skipped, computes
  variance against rostered times, and flips the shift PendingReview.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: `RosteringController` completions list + detail

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (new `GetCompletions`/`GetShiftCompletion` actions + helpers)
- Test: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs` (new)

**Interfaces:**
- Consumes: `ShiftVarianceCalculator` (Task 3), `Shift.Participant`/`Shift.User` navigations.
- Produces: `GET /rostering/completions?status=&from=&to=`, `GET /rostering/shifts/{id}/completion` — `RosteringController.GetCompletions`/`.GetShiftCompletion`; private helper `ToShiftCompletionDtoAsync` (reused by Tasks 7, 8).

- [ ] **Step 1: Write the failing tests**
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  using System.Reflection;
  using System.Security.Claims;
  using Microsoft.AspNetCore.Authorization;
  using Microsoft.AspNetCore.Http;
  using Microsoft.AspNetCore.Mvc;
  using Microsoft.EntityFrameworkCore;
  using Moq;
  using Odip.Api.Controllers;
  using Odip.Application.Common;
  using Odip.Application.DTOs;
  using Odip.Domain.Entities;
  using Odip.Domain.Enums;
  using Odip.Domain.Interfaces;
  using Odip.Domain.Rostering;
  using Odip.Infrastructure.Data;
  using Odip.Infrastructure.Rostering;
  using Odip.Infrastructure.Services;
  using Xunit;

  namespace Odip.Tests.Rostering;

  /// <summary>
  /// RosteringController's shift-completion review surface (design spec §2/§3): completions
  /// list/detail, Approve/Return, ReturnCount increments, IsActive flips across a
  /// Return-then-resubmit cycle. Class-level [Authorize(Roles=...)] coverage already lives in
  /// RosteringControllerTests.RosteringController_AuthorizeAttribute_RestrictsToCoordinatorAndAbove
  /// — this file only confirms the new actions don't carry a stray per-action override.
  /// </summary>
  public class RosteringCompletionReviewTests
  {
      private static readonly DateOnly ServiceDate = new(2026, 9, 8);
      private static readonly Guid ReviewerId = Guid.NewGuid();

      private static OdipDbContext CreateDb()
      {
          var tenant = new Mock<ICurrentTenant>();
          tenant.Setup(t => t.TenantId).Returns((Guid?)null);
          tenant.Setup(t => t.IsSuperAdmin).Returns(true);

          var options = new DbContextOptionsBuilder<OdipDbContext>()
              .UseInMemoryDatabase(Guid.NewGuid().ToString())
              .Options;

          return new OdipDbContext(options, tenant.Object);
      }

      private static RosteringController MakeController(OdipDbContext db)
      {
          var identity = new ClaimsIdentity(
              [new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString())], "Test");
          return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
          {
              ControllerContext = new ControllerContext
              {
                  HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
              }
          };
      }

      private static T Seed<T>(OdipDbContext db, T entity) where T : class
      {
          db.Set<T>().Add(entity);
          db.SaveChanges();
          return entity;
      }

      private static User SeedStaff(OdipDbContext db) => Seed(db, new User
      {
          Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
          Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
          Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
      });

      private static Participant SeedParticipant(OdipDbContext db) => Seed(db, new Participant
      {
          Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true,
      });

      private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid staffId, ShiftStatus status) => Seed(db, new Shift
      {
          Id = Guid.NewGuid(), ParticipantId = participantId, UserId = staffId, ServiceDate = ServiceDate,
          StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
          NightType = SleepoverType.None, Status = status,
      });

      private static ShiftCompletion SeedCompletion(OdipDbContext db, Guid shiftId, Guid staffId, bool isActive = true) => Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shiftId, ActualStart = DateTime.UtcNow.AddHours(-8),
          ActualEnd = DateTime.UtcNow, TimeZoneId = "Australia/Sydney", SubmittedByUserId = staffId,
          StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow, IsActive = isActive,
      });

      // ── Completions list/detail ──────────────────────────────────────

      [Fact]
      public async Task GetCompletions_DefaultsToPendingReview_ReturnsQueueItemWithVariance()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          // Rostered 09:00-17:00 Australia/Sydney on 8 Sep 2026 = 23:00 7 Sep UTC .. 07:00 8 Sep UTC.
          var completion = Seed(db, new ShiftCompletion
          {
              Id = Guid.NewGuid(), ShiftId = shift.Id,
              ActualStart = new DateTime(2026, 9, 7, 23, 10, 0, DateTimeKind.Utc),
              ActualEnd = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc),
              TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
              StartedAt = new DateTime(2026, 9, 7, 23, 10, 0, DateTimeKind.Utc),
              SubmittedAt = new DateTime(2026, 9, 8, 7, 0, 0, DateTimeKind.Utc),
              VarianceMinutesStart = 10, VarianceMinutesEnd = 0, IsActive = true,
          });
          var controller = MakeController(db);

          var result = await controller.GetCompletions(null, null, null, CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<List<CompletionQueueItemDto>>>(ok.Value);
          var item = Assert.Single(body.Data!);
          Assert.Equal(shift.Id, item.ShiftId);
          Assert.Equal(completion.Id, item.CompletionId);
          Assert.Equal(10, item.VarianceMinutesStart);
          Assert.Equal(ShiftStatus.PendingReview, item.Status);
      }

      [Fact]
      public async Task GetCompletions_StatusFilter_ExcludesOtherStatuses()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var pending = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          SeedCompletion(db, pending.Id, staff.Id);
          var inProgress = SeedShift(db, participant.Id, staff.Id, ShiftStatus.InProgress);
          SeedCompletion(db, inProgress.Id, staff.Id);
          var controller = MakeController(db);

          var result = await controller.GetCompletions(ShiftStatus.InProgress, null, null, CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<List<CompletionQueueItemDto>>>(ok.Value);
          var item = Assert.Single(body.Data!);
          Assert.Equal(inProgress.Id, item.ShiftId);
      }

      [Fact]
      public async Task GetShiftCompletion_ActiveRowExists_ReturnsDto()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          var completion = SeedCompletion(db, shift.Id, staff.Id);
          var controller = MakeController(db);

          var result = await controller.GetShiftCompletion(shift.Id, CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
          Assert.Equal(completion.Id, body.Data!.Id);
      }

      [Fact]
      public async Task GetShiftCompletion_NoActiveRow_Returns404()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.Published);
          var controller = MakeController(db);

          var result = await controller.GetShiftCompletion(shift.Id, CancellationToken.None);

          Assert.IsType<NotFoundObjectResult>(result.Result);
      }
  }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: FAIL to compile — `RosteringController.GetCompletions`/`.GetShiftCompletion` don't exist yet.
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs`, add a new region directly after the SHIFTS region's `GetShiftNotes` action (after line 435, before the SHIFT PATTERNS region):
  ```csharp
      // ══════════════════════════════════════════════════════════════
      // SHIFT COMPLETION REVIEW (design spec §2/§3)
      // ══════════════════════════════════════════════════════════════

      /// <summary>
      /// The review queue. status defaults to PendingReview; other ShiftStatus values let the
      /// queue show shifts in other states (e.g. Completed, for already-approved history). Only
      /// shifts with a current active ShiftCompletion row are included.
      /// </summary>
      [HttpGet("completions")]
      public async Task<ActionResult<ApiResponse<List<CompletionQueueItemDto>>>> GetCompletions(
          [FromQuery] ShiftStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
      {
          var statusFilter = status ?? ShiftStatus.PendingReview;

          var query = _db.Shifts
              .Include(s => s.Participant)
              .Include(s => s.User)
              .Where(s => s.Status == statusFilter);
          if (from.HasValue) query = query.Where(s => s.ServiceDate >= from.Value);
          if (to.HasValue) query = query.Where(s => s.ServiceDate <= to.Value);

          var shifts = await query.OrderBy(s => s.ServiceDate).ToListAsync(ct);
          var shiftIds = shifts.Select(s => s.Id).ToList();

          var completionsByShiftId = await _db.ShiftCompletions
              .Where(c => shiftIds.Contains(c.ShiftId) && c.IsActive)
              .ToDictionaryAsync(c => c.ShiftId, ct);

          var items = new List<CompletionQueueItemDto>();
          foreach (var shift in shifts)
          {
              if (!completionsByShiftId.TryGetValue(shift.Id, out var completion)) continue;
              var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
              items.Add(new CompletionQueueItemDto(
                  shift.Id, completion.Id, shift.Participant?.FullName ?? string.Empty, shift.User?.FullName ?? string.Empty,
                  shift.ServiceDate, rosteredStartUtc, rosteredEndUtc, completion.ActualStart, completion.ActualEnd,
                  completion.VarianceMinutesStart, completion.VarianceMinutesEnd, shift.Status));
          }
          return Ok(ApiResponse<List<CompletionQueueItemDto>>.Ok(items));
      }

      /// <summary>The current active ShiftCompletion for one shift, or 404 if none exists.</summary>
      [HttpGet("shifts/{id:guid}/completion")]
      public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> GetShiftCompletion(Guid id, CancellationToken ct)
      {
          var completion = await _db.ShiftCompletions
              .Where(c => c.ShiftId == id && c.IsActive)
              .FirstOrDefaultAsync(ct);
          if (completion is null)
              return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found."));

          return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, ct)));
      }
  ```
  Add the private helper near the bottom HELPERS region, after `ToCompatibilityDto`:
  ```csharp
      /// <summary>Maps a ShiftCompletion to its DTO, resolving submitter/reviewer display names.</summary>
      private async Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, CancellationToken ct)
      {
          var submittedBy = await _db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
          User? reviewedBy = c.ReviewedByUserId.HasValue
              ? await _db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
              : null;

          return new ShiftCompletionDto(
              c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
              c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
              c.StartedAt, c.SubmittedAt,
              c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
              c.VarianceMinutesStart, c.VarianceMinutesEnd);
      }
  ```
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: PASS (all 4 GET facts).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): RosteringController completions list + detail

  GET /rostering/completions (status/from/to filters, defaults to
  PendingReview) and GET /rostering/shifts/{id}/completion.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: `RosteringController` Approve

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (new `ApproveCompletion` action + `ResolveCurrentUserId` helper)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs` (append Approve facts)

**Interfaces:**
- Consumes: `ToShiftCompletionDtoAsync` (Task 6).
- Produces: `POST /rostering/shifts/{id}/completion/approve` — `RosteringController.ApproveCompletion(Guid, CancellationToken)`; private helper `ResolveCurrentUserId()` (reused by Task 8).

- [ ] **Step 1: Write the failing tests**
  Append to `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`, inside the class:
  ```csharp
      // ── Authorisation posture ────────────────────────────────────────

      [Theory]
      [InlineData(nameof(RosteringController.ApproveCompletion))]
      [InlineData(nameof(RosteringController.ReturnCompletion))]
      public void CompletionAction_CarriesNoPerActionAuthorizeOverride_ReliesOnClassLevelGate(string methodName)
      {
          var method = typeof(RosteringController).GetMethod(methodName)!;
          Assert.Null(method.GetCustomAttribute<AuthorizeAttribute>());
      }

      // ── Approve ───────────────────────────────────────────────────────

      [Fact]
      public async Task ApproveCompletion_PendingReview_FlipsCompleted_StampsReviewer()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          var completion = SeedCompletion(db, shift.Id, staff.Id);
          var controller = MakeController(db);

          var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
          Assert.Equal(ReviewOutcome.Approved, body.Data!.ReviewOutcome);

          var savedShift = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
          Assert.Equal(ShiftStatus.Completed, savedShift.Status);
          var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
          Assert.Equal(ReviewOutcome.Approved, savedCompletion.ReviewOutcome);
          Assert.Equal(ReviewerId, savedCompletion.ReviewedByUserId);
          Assert.True(savedCompletion.IsActive); // Approve never touches IsActive.
      }

      [Fact]
      public async Task ApproveCompletion_ShiftNotPendingReview_Returns409()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.InProgress);
          SeedCompletion(db, shift.Id, staff.Id);
          var controller = MakeController(db);

          var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(conflict.Value);
          Assert.Equal("SHIFT_NOT_PENDING_REVIEW", body.Code);
      }

      [Fact]
      public async Task ApproveCompletion_NoShift_Returns404()
      {
          using var db = CreateDb();
          var controller = MakeController(db);

          var result = await controller.ApproveCompletion(Guid.NewGuid(), CancellationToken.None);

          Assert.IsType<NotFoundObjectResult>(result.Result);
      }

      [Fact]
      public async Task ApproveCompletion_NoActiveCompletion_Returns404()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          var controller = MakeController(db);

          var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

          Assert.IsType<NotFoundObjectResult>(result.Result);
      }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: FAIL to compile — `RosteringController.ApproveCompletion`/`.ReturnCompletion` don't exist yet (the `[Theory]` references both by name; `ReturnCompletion` lands in Task 8, so this task's compile only turns green once Task 8 also lands — note that in Step 4 below).
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs`, add `using System.Security.Claims;` to the top usings (this controller doesn't import it yet). Add directly after `GetShiftCompletion`:
  ```csharp
      /// <summary>
      /// Office approves a PendingReview shift. 404 if no shift or no active ShiftCompletion; 409
      /// SHIFT_NOT_PENDING_REVIEW if not PendingReview. No notification here — only Finish and
      /// Return raise one (deferred to the notifications spec, out of scope for this PR).
      /// </summary>
      [HttpPost("shifts/{id:guid}/completion/approve")]
      public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> ApproveCompletion(Guid id, CancellationToken ct)
      {
          var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
          if (shift is null) return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found."));

          var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == id && c.IsActive, ct);
          if (completion is null) return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found."));

          if (shift.Status != ShiftStatus.PendingReview)
              return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                  "This shift isn't awaiting review.", "SHIFT_NOT_PENDING_REVIEW"));

          var now = DateTime.UtcNow;
          completion.ReviewedByUserId = ResolveCurrentUserId();
          completion.ReviewedAt = now;
          completion.ReviewOutcome = ReviewOutcome.Approved;
          completion.UpdatedAt = now;

          shift.Status = ShiftStatus.Completed;
          shift.UpdatedAt = now;

          await _db.SaveChangesAsync(ct);
          return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, ct)));
      }
  ```
  Add the private helper near `ToShiftCompletionDtoAsync`:
  ```csharp
      /// <summary>Resolves the reviewing coordinator's own user id from the JWT's NameIdentifier claim.</summary>
      private Guid ResolveCurrentUserId()
      {
          var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
          return Guid.TryParse(claim, out var id) ? id : Guid.Empty;
      }
  ```
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: still FAILS to compile — the `[Theory]` added in Step 1 references `ReturnCompletion`, which doesn't exist until Task 8. Confirm the compile error is now ONLY about `ReturnCompletion` (no longer about `ApproveCompletion` or `ResolveCurrentUserId`) before moving to Task 8.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): RosteringController Approve action

  POST /rostering/shifts/{id}/completion/approve: 404 for no shift/no active
  completion, 409 SHIFT_NOT_PENDING_REVIEW otherwise, flips the shift
  Completed and stamps the reviewer. Task 8 (Return) is required before this
  test file compiles again.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: `RosteringController` Return (`ReturnCount` + `IsActive`)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (new `ReturnCompletion` action)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs` (append Return facts)

**Interfaces:**
- Consumes: `ResolveCurrentUserId`, `ToShiftCompletionDtoAsync` (Task 7), `PortalController.StartShift` (Task 4, for the resubmit-cycle test).
- Produces: `POST /rostering/shifts/{id}/completion/return` — `RosteringController.ReturnCompletion(Guid, ReturnCompletionDto, CancellationToken)`.

- [ ] **Step 1: Write the failing tests**
  Append to `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`, inside the class:
  ```csharp
      // ── Return ────────────────────────────────────────────────────────

      [Fact]
      public async Task ReturnCompletion_PendingReview_WithReason_FlipsPublished_IncrementsReturnCount_DeactivatesCompletion()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          var completion = SeedCompletion(db, shift.Id, staff.Id);
          var controller = MakeController(db);

          var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "Times look wrong, please recheck." }, CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(ok.Value);
          Assert.Equal(ReviewOutcome.Returned, body.Data!.ReviewOutcome);
          Assert.Equal("Times look wrong, please recheck.", body.Data.ReturnReason);

          var savedShift = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
          Assert.Equal(ShiftStatus.Published, savedShift.Status);
          Assert.Equal(1, savedShift.ReturnCount);
          var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
          Assert.False(savedCompletion.IsActive);
      }

      [Fact]
      public async Task ReturnCompletion_BlankReason_Returns400_DoesNotChangeShiftOrCompletion()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          SeedCompletion(db, shift.Id, staff.Id);
          var controller = MakeController(db);

          var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "   " }, CancellationToken.None);

          Assert.IsType<BadRequestObjectResult>(result.Result);
          var savedShift = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
          Assert.Equal(ShiftStatus.PendingReview, savedShift.Status);
          Assert.Equal(0, savedShift.ReturnCount);
      }

      [Fact]
      public async Task ReturnCompletion_ShiftNotPendingReview_Returns409()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.Published);
          var controller = MakeController(db);

          var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "reason" }, CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(conflict.Value);
          Assert.Equal("SHIFT_NOT_PENDING_REVIEW", body.Code);
      }

      [Fact]
      public async Task ReturnThenResubmit_OldCompletionStaysInactive_NewActiveRowCreated()
      {
          using var db = CreateDb();
          var staff = SeedStaff(db);
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
          var firstCompletion = SeedCompletion(db, shift.Id, staff.Id);
          var rosteringController = MakeController(db);

          await rosteringController.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "Recheck please." }, CancellationToken.None);

          // Worker resubmits via Start — reuse PortalController directly against the same db.
          var portalTenant = new Mock<ICurrentTenant>();
          portalTenant.Setup(t => t.TenantId).Returns((Guid?)null);
          portalTenant.Setup(t => t.IsSuperAdmin).Returns(true);
          var portalIdentity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, staff.Id.ToString())], "Test");
          var portalController = new PortalController(db, portalTenant.Object)
          {
              ControllerContext = new ControllerContext
              {
                  HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(portalIdentity) }
              }
          };
          await portalController.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

          var allCompletions = await db.ShiftCompletions.Where(c => c.ShiftId == shift.Id).ToListAsync();
          Assert.Equal(2, allCompletions.Count);
          var old = allCompletions.Single(c => c.Id == firstCompletion.Id);
          Assert.False(old.IsActive);
          var fresh = allCompletions.Single(c => c.Id != firstCompletion.Id);
          Assert.True(fresh.IsActive);
      }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: FAIL to compile — `RosteringController.ReturnCompletion` doesn't exist yet.
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs`, add directly after `ApproveCompletion`:
  ```csharp
      /// <summary>
      /// Office returns a PendingReview shift to the worker for correction. Same 404/409 as
      /// Approve, plus 400 if reason is blank. Sets ReviewOutcome = Returned, IsActive = false
      /// (excluding this row from the "current" 1:1 without deleting it), increments
      /// Shift.ReturnCount, flips Shift.Status back to Published.
      /// </summary>
      [HttpPost("shifts/{id:guid}/completion/return")]
      public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> ReturnCompletion(
          Guid id, [FromBody] ReturnCompletionDto dto, CancellationToken ct)
      {
          var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
          if (shift is null) return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found."));

          var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == id && c.IsActive, ct);
          if (completion is null) return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found."));

          if (shift.Status != ShiftStatus.PendingReview)
              return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                  "This shift isn't awaiting review.", "SHIFT_NOT_PENDING_REVIEW"));

          if (string.IsNullOrWhiteSpace(dto.Reason))
              return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("A return reason is required."));

          // SHIFT_ALREADY_CLAIMED (design spec §3) is deliberately not implemented here —
          // ClaimLineItem.ShiftId doesn't exist until PR 3's migration, and nothing in PR 1 can
          // attach a claim to a shift, so the check is structurally unreachable until then.

          var now = DateTime.UtcNow;
          completion.ReviewedByUserId = ResolveCurrentUserId();
          completion.ReviewedAt = now;
          completion.ReviewOutcome = ReviewOutcome.Returned;
          completion.ReturnReason = dto.Reason.Trim();
          completion.IsActive = false;
          completion.UpdatedAt = now;

          shift.Status = ShiftStatus.Published;
          shift.ReturnCount += 1;
          shift.UpdatedAt = now;

          await _db.SaveChangesAsync(ct);
          return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, ct)));
      }
  ```
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: PASS — every fact in the file (list/detail from Task 6, Approve from Task 7, Return facts above, and the authorisation-posture theory).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): RosteringController Return action

  POST /rostering/shifts/{id}/completion/return: 400 for a blank reason, 404/
  409 mirroring Approve, deactivates the current completion row, increments
  Shift.ReturnCount, flips the shift back to Published for resubmission.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: `UpdateShift` status-transition gate

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs:352` (insert guard in `UpdateShift`)
- Test: `odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs` (new)

**Interfaces:**
- Consumes: `ShiftStatus` (Task 1).
- Produces: `UpdateShift` now rejects any `Status` outside Draft↔Published with 409 `STATUS_TRANSITION_VIA_COMPLETION`.

- [ ] **Step 1: Write the failing tests**
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs
  using Microsoft.AspNetCore.Mvc;
  using Microsoft.EntityFrameworkCore;
  using Moq;
  using Odip.Api.Controllers;
  using Odip.Application.Common;
  using Odip.Application.DTOs;
  using Odip.Domain.Entities;
  using Odip.Domain.Enums;
  using Odip.Domain.Interfaces;
  using Odip.Domain.Rostering;
  using Odip.Infrastructure.Data;
  using Odip.Infrastructure.Rostering;
  using Odip.Infrastructure.Services;
  using Xunit;

  namespace Odip.Tests.Controllers;

  /// <summary>
  /// UpdateShift's status-transition gate (design spec §2): PUT can still toggle Draft↔Published
  /// (today's only real use) but can no longer jump straight to Completed/InProgress/
  /// PendingReview — those are only reachable via the shift-completion endpoints from this point on.
  /// </summary>
  public class RosteringUpdateShiftStatusGateTests
  {
      private static readonly DateOnly ServiceDate = new(2026, 9, 8);

      private static OdipDbContext CreateDb()
      {
          var tenant = new Mock<ICurrentTenant>();
          tenant.Setup(t => t.TenantId).Returns((Guid?)null);
          tenant.Setup(t => t.IsSuperAdmin).Returns(true);

          var options = new DbContextOptionsBuilder<OdipDbContext>()
              .UseInMemoryDatabase(Guid.NewGuid().ToString())
              .Options;

          return new OdipDbContext(options, tenant.Object);
      }

      private static Participant SeedParticipant(OdipDbContext db)
      {
          var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
          db.Participants.Add(participant);
          db.SaveChanges();
          return participant;
      }

      private static Shift SeedShift(OdipDbContext db, Guid participantId, ShiftStatus status)
      {
          var shift = new Shift
          {
              Id = Guid.NewGuid(), ParticipantId = participantId, ServiceDate = ServiceDate,
              StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
              NightType = SleepoverType.None, Status = status,
          };
          db.Shifts.Add(shift);
          db.SaveChanges();
          return shift;
      }

      private static UpdateShiftDto DtoFor(Shift shift, ShiftStatus newStatus) => new()
      {
          ParticipantId = shift.ParticipantId, StaffId = shift.UserId, ServiceDate = shift.ServiceDate,
          StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
          Ratio = shift.Ratio, NightType = shift.NightType, Status = newStatus,
      };

      [Theory]
      [InlineData(ShiftStatus.Draft, ShiftStatus.Published)]
      [InlineData(ShiftStatus.Published, ShiftStatus.Draft)]
      [InlineData(ShiftStatus.Draft, ShiftStatus.Draft)]
      public async Task UpdateShift_DraftPublishedToggle_Succeeds(ShiftStatus from, ShiftStatus to)
      {
          using var db = CreateDb();
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, from);
          var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

          var result = await controller.UpdateShift(shift.Id, DtoFor(shift, to), CancellationToken.None);

          var ok = Assert.IsType<OkObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
          Assert.Equal(to, body.Data!.Status);
      }

      [Theory]
      [InlineData(ShiftStatus.Draft, ShiftStatus.Completed)]
      [InlineData(ShiftStatus.Published, ShiftStatus.InProgress)]
      [InlineData(ShiftStatus.Published, ShiftStatus.PendingReview)]
      [InlineData(ShiftStatus.Published, ShiftStatus.Completed)]
      [InlineData(ShiftStatus.InProgress, ShiftStatus.Published)]
      [InlineData(ShiftStatus.PendingReview, ShiftStatus.Completed)]
      [InlineData(ShiftStatus.Completed, ShiftStatus.Published)]
      public async Task UpdateShift_AnyOtherStatusJump_Returns409_WithStatusTransitionCode(ShiftStatus from, ShiftStatus to)
      {
          using var db = CreateDb();
          var participant = SeedParticipant(db);
          var shift = SeedShift(db, participant.Id, from);
          var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

          var result = await controller.UpdateShift(shift.Id, DtoFor(shift, to), CancellationToken.None);

          var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
          var body = Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value);
          Assert.Equal("STATUS_TRANSITION_VIA_COMPLETION", body.Code);

          var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
          Assert.Equal(from, saved.Status); // rejected write must not persist
      }
  }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringUpdateShiftStatusGateTests"`
  Expected: FAIL — the 7 `UpdateShift_AnyOtherStatusJump_...` cases fail because `UpdateShift` currently writes `dto.Status` verbatim with no gate (they'd get `OkObjectResult`, not `ConflictObjectResult`).
- [ ] **Step 3: Write minimal implementation**
  In `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs`'s `UpdateShift` action, insert directly after the existing `refError` check (currently lines 351-352, before `var candidate = new Shift`):
  ```csharp
          if (dto.Status != shift.Status
              && !(shift.Status is ShiftStatus.Draft or ShiftStatus.Published
                   && dto.Status is ShiftStatus.Draft or ShiftStatus.Published))
              return Conflict(ApiResponse<ShiftDto>.Fail(
                  "Status can only be changed via the shift-completion endpoints.", "STATUS_TRANSITION_VIA_COMPLETION"));

  ```
- [ ] **Step 4: Run test to verify it passes**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringUpdateShiftStatusGateTests"`
  Expected: PASS (all 10 theory cases). Then run `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringControllerTests"` to confirm the existing `UpdateShift` Draft/Published-toggle coverage in that file still passes unchanged.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): close the UpdateShift status-transition backdoor

  PUT /rostering/shifts/{id} now rejects any Status outside Draft<->Published
  with 409 STATUS_TRANSITION_VIA_COMPLETION — Completed/InProgress/
  PendingReview are only reachable via the shift-completion endpoints.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Final build + full test suite verification

**Files:** none (verification only — no code changes, no commit).

**Interfaces:** N/A — this task validates the combined output of Tasks 1-9.

- [ ] **Step 1: Full clean build**
  Run (from `odip-prototype/odip/backend`): `dotnet build`
  Expected: 0 errors, 0 new warnings.
- [ ] **Step 2: Full test suite**
  Run: `dotnet test Odip.Tests`
  Expected: 0 failures — every pre-existing test still passes (in particular `RosteringControllerTests`, `PortalControllerTests`, `RosteringAuditTests`, `LeaveAuditTests`, `StaffAssignmentGateTests`) alongside every new file from Tasks 1-9 (`Audit/ShiftCompletionAuditTests`, `Rostering/ShiftCompletionVarianceTests`, `Rostering/ShiftCompletionStateMachineTests`, `Rostering/RosteringCompletionReviewTests`, `Controllers/RosteringUpdateShiftStatusGateTests`).
- [ ] **Step 3: Spec coverage re-check**
  Re-read `docs/specs/2026-09-08-shift-completion-design.md`'s Delivery §PR1 bullet and Error handling/State-transition-matrix tables; confirm every row has a corresponding test from Tasks 1-9 (Start's 409/404, Finish's three 409 variants + manual-start path, Approve's 404/409, Return's 400/404/409 + `ReturnCount`/`IsActive`, `UpdateShift`'s gate). Confirm no PR 2 (UI/mock-api/Permissions-Policy) or PR 3 (claims) file was touched.
- [ ] **Step 4: Report**
  Summarize: build status, test counts (pass/fail/skipped), and explicitly confirm the two ruled-out-of-PR1 items (`SHIFT_ALREADY_CLAIMED` guard body, `Rostering:VarianceReviewMinutes` config read) remain absent by design, not by omission.
