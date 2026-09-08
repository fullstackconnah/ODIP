# Shift Completion — Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address every P1/P2/P3 finding in the PR #124 critique — idempotent Start/Finish so a
retried request never reads as lost work, diagnosable error codes with a plain-English message
per cause, a review-queue signal (outlier variance, return count, timezone) so the coordinator
knows what to look at first, return-reason context surfaced back to the worker, a closed
un-cancel backdoor on `UpdateShift` with one consistent `SHIFT_*` code family, a paged/indexed/
projected review queue, three P3 cleanups (duplicated lookup blocks, an overly-broad
`DbUpdateException` catch, `ResolveCurrentUserId`'s `Guid.Empty` audit fallback, missing
lat/long `[Range]`), and a batch-approve endpoint. Backend only — no frontend changes.

**Architecture:** .NET 8 layered (Domain → Application → Infrastructure → Api). Controllers call
`OdipDbContext` directly — no CQRS/MediatR despite the package reference. Tests in `Odip.Tests`
(xUnit + Moq + EF Core InMemory), fixtures inline per file, no shared base class. PR #124 already
landed the base state machine plus several defensive fixes beyond the original PR1 plan
(`SHIFT_TIMES_LOCKED`, DST-safe `ToUtcSafe`, a shared `ShiftCompletionMapper`, `ActualStart`
`DateTimeKind` normalisation) — this plan works against that actual code, not the PR1 plan draft.

**Tech Stack:** .NET 8 / EF Core (Npgsql in production, InMemory in tests) / xUnit / Moq.

**Spec:**
- Findings (authoritative list of what to fix): `.impeccable/critique/2026-09-08T14-51-47Z__odip-prototype-odip-backend-odip-api-controllers.md` (repo root, i.e. `F:\Projects\personal\ODIP\.impeccable\critique\...`, not under this worktree)
- Design spec: `docs/specs/2026-09-08-shift-completion-design.md`

## Carry-forwards to PR2 (frontend — do not implement here)

- `extractErrorMessage` (`frontend/src/api/intakeFormat.ts:30`) must read `code`, not just
  `errors[0]`/`message` — every 409/400 this plan adds carries a `code`.
- `SHIFT_STATUSES` enum in `frontend/src/api/types/enums.ts` is missing `InProgress`/
  `PendingReview` (design spec already flagged this — PR1 added the backend values, PR2 must
  add the frontend ones).
- New codes PR2 must map to copy/UI treatment: `SHIFT_ALREADY_FINISHED`,
  `SHIFT_ALREADY_COMPLETED`, `SHIFT_CANCELLED`, `SHIFT_NOT_PUBLISHED`,
  `SHIFT_ACTUAL_START_IN_FUTURE`, `SHIFT_ACTUAL_START_TOO_EARLY`, `SHIFT_RETURN_REASON_REQUIRED`,
  `SHIFT_RETURN_REASON_TOO_LONG`, `SHIFT_STATUS_LOCKED` (renamed from
  `STATUS_TRANSITION_VIA_COMPLETION`), `SHIFT_BATCH_SIZE_INVALID`, `AUTH_USER_MISSING` — plus
  every pre-existing code (`SHIFT_NOT_STARTABLE`, `SHIFT_NOTE_REQUIRED`, `SHIFT_NOT_IN_PROGRESS`,
  `SHIFT_NOT_PENDING_REVIEW`, `SHIFT_TIMES_LOCKED`).
- Manual-start `ActualStart` sent from the client needs a `Z` suffix (or another
  unambiguous-UTC representation) — `FinishShift`'s `DateTimeKind` normalisation treats
  unsuffixed values as UTC already, but the request body itself should stop relying on that
  fallback once PR2 builds the manual-start form.
- `GET /rostering/completions` is now paged (`page`/`pageSize` query params, `PagedResult<T>`
  response envelope) — PR2's queue page must page through results, not assume one flat array.

## Global Constraints

- Backend only. No changes under `odip-prototype/odip/frontend/`.
- Never rename or reorder an existing migration id — `Program.cs`'s raw-SQL
  `__EFMigrationsHistory` self-healing is keyed to specific migration ids. This plan adds exactly
  one new additive migration (`AddShiftStatusIndex`, Task 6), placed after
  `20260908113607_AddShiftCompletion` (the current latest).
- Tenant isolation is via the existing `ICurrentTenant`/`ITenantEntity` global query filters —
  every query added in this plan inherits that filtering automatically; do not bypass it.
- Cross-tenant access is always 404, never 403 (existing convention on both controllers).
- Every new 4xx body uses `ApiResponse<T>.Fail(message, code)` with a `SHIFT_*` code (the one
  exception is `AUTH_USER_MISSING` in Task 7, which is an auth-shaped code, not a shift one).
- Every error message is a plain English sentence addressed to the user, and says what to do
  next where that's meaningful (matching the existing `SHIFT_TIMES_LOCKED` message, which the
  critique calls out as the template to follow).
- `dotnet build Odip.sln` must be 0 errors and `dotnet test Odip.Tests` fully green after every
  task, run from `odip-prototype/odip/backend`.
- Every commit uses `git -c safe.directory='*'` and ends with:
  ```
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  ```

## File Structure

| File | Responsibility |
|---|---|
| `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` | Modify: idempotent Start/Finish, split `ActualStart` validation, `LastReturnReason`, `ResolveOwnedShiftAsync` extraction, narrowed `DbUpdateException` catch, `[Range]`-driven 400s pass through unchanged |
| `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` | Modify: queue signal/sort/paging, `GetShiftCompletions` history endpoint, `UpdateShift` un-cancel + `SHIFT_STATUS_LOCKED` rename, `ResolvePendingReviewCompletionAsync` extraction, `ResolveCurrentUserId` → `Guid?`, batch approve |
| `odip-prototype/odip/backend/Odip.Api/Rostering/ShiftCompletionMapper.cs` | Modify: `IsOutlierVariance`/`VarianceReviewMinutes`/`ReturnCount` on `ShiftCompletionDto` |
| `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs` | Modify: new DTO fields, `ApproveBatchDto`, `ApproveBatchResultDto`, `StartShiftDto`/`FinishShiftDto` `[Range]` on lat/long |
| `odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs` | Modify: `PortalShiftDetailDto.LastReturnReason` |
| `odip-prototype/odip/backend/Odip.Application/Common/ShiftErrorCodes.cs` | Create: centralised `SHIFT_*` code constants |
| `odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs` | Modify: `(TenantId, Status, ServiceDate)` index on `Shift` |
| `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftStatusIndex.cs` + `.Designer.cs` | Create (generated): additive migration |
| `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/OdipDbContextModelSnapshot.cs` | Modify (generated) |
| `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs` | Modify: idempotency + split validation tests |
| `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs` | Modify: queue signal/sort/paging, return context, batch approve, resolver-extraction tests |
| `odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs` | Modify: un-cancel cases, `SHIFT_STATUS_LOCKED` |
| `odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs` | Modify: `ShiftErrorCodes` coverage test |
| `odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs` | Modify: `LastReturnReason`, `[Range]` 400s |
| `docs/specs/2026-09-08-shift-completion-design.md` | Modify (Task 9): error table + un-cancel ruling |

---

### Task 1: Idempotent Start/Finish (P1)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (`StartShift` L187-245, `FinishShift` L253-344)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs`

**Interfaces:**
- Consumes: `BuildShiftDetailDtoAsync` (existing shared builder), `ShiftStatus` (existing enum).
- Produces: no new public surface — `StartShift`/`FinishShift` gain new response branches for
  every non-actionable status. `SHIFT_NOT_STARTABLE` narrows to mean *only* "the DB rejected a
  racing double-Start" (its `DbUpdateException` catch, unchanged) — every status-based rejection
  now uses a distinct code.

Ownership (404-never-403 on a shift that isn't the caller's own) is already correct and
untouched by this task — only the status-branching *after* ownership is resolved changes.

- [ ] **Step 1: Write the failing tests**
  In `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs`,
  replace the existing `StartShift_AlreadyInProgress_Returns409SHIFT_NOT_STARTABLE_AndDoesNotDuplicate`
  fact (lines 109-124) and the `StartShift_NotPublished_Returns409SHIFT_NOT_STARTABLE` theory
  (lines 126-142) with:
  ```csharp
  [Fact]
  public async Task StartShift_AlreadyInProgress_ReturnsCurrentDetail_NoDuplicateCompletion()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.InProgress);
      var existing = Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow.AddHours(-1),
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
          StartedAt = DateTime.UtcNow.AddHours(-1), IsActive = true,
      });
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
      Assert.Equal(ShiftStatus.InProgress, body.Data!.Status);
      Assert.Equal(existing.Id, body.Data.Completion!.Id);

      var completions = await db.ShiftCompletions.Where(c => c.ShiftId == shift.Id).ToListAsync();
      var only = Assert.Single(completions);
      Assert.Equal(existing.Id, only.Id);
      Assert.Equal(existing.ActualStart, only.ActualStart);
      Assert.Equal(existing.StartedAt, only.StartedAt); // idempotent replay must not re-stamp
  }

  [Theory]
  [InlineData(ShiftStatus.PendingReview, "SHIFT_ALREADY_FINISHED")]
  [InlineData(ShiftStatus.Completed, "SHIFT_ALREADY_COMPLETED")]
  [InlineData(ShiftStatus.Cancelled, "SHIFT_CANCELLED")]
  [InlineData(ShiftStatus.Draft, "SHIFT_NOT_PUBLISHED")]
  public async Task StartShift_NotStartable_ReturnsDistinctCodePerStatus(ShiftStatus status, string expectedCode)
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, status);
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.StartShift(shift.Id, new StartShiftDto(), CancellationToken.None);

      var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
      Assert.Equal(expectedCode, body.Code);
      Assert.Empty(await db.ShiftCompletions.ToListAsync());
  }
  ```
  Replace the `FinishShift_NotPublishedOrInProgress_Returns409SHIFT_NOT_IN_PROGRESS(ShiftStatus status)`
  theory (lines 360-379) — it asserted `SHIFT_NOT_IN_PROGRESS` for `PendingReview`/`Completed`/
  `Cancelled`/`Draft`, which the ruling replaces — with:
  ```csharp
  [Fact]
  public async Task FinishShift_PendingReview_ReturnsCurrentDetail_NoWrites()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.PendingReview);
      var existing = Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id,
          ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow.AddHours(-1),
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id,
          StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow.AddHours(-1), IsActive = true,
      });
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
      Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
      Assert.Equal(existing.Id, body.Data.Completion!.Id);

      var completions = await db.ShiftCompletions.Where(c => c.ShiftId == shift.Id).ToListAsync();
      var only = Assert.Single(completions);
      Assert.Equal(existing.ActualEnd, only.ActualEnd);
      Assert.Equal(existing.SubmittedAt, only.SubmittedAt); // idempotent replay must not re-stamp
      var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
      Assert.Equal(0, saved.ReturnCount);
  }

  [Theory]
  [InlineData(ShiftStatus.Completed, "SHIFT_ALREADY_COMPLETED")]
  [InlineData(ShiftStatus.Cancelled, "SHIFT_CANCELLED")]
  [InlineData(ShiftStatus.Draft, "SHIFT_NOT_PUBLISHED")]
  public async Task FinishShift_NotFinishable_ReturnsDistinctCodePerStatus(ShiftStatus status, string expectedCode)
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, status);
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.FinishShift(shift.Id, new FinishShiftDto(), CancellationToken.None);

      var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(conflict.Value);
      Assert.Equal(expectedCode, body.Code);
  }
  ```
  Leave `FinishShift_PublishedNoActualStartSupplied_Returns409SHIFT_NOT_IN_PROGRESS` (lines
  257-272) unchanged — that case still 409s `SHIFT_NOT_IN_PROGRESS` per the ruling.
- [ ] **Step 2: Run tests to verify they fail**
  Run (from `odip-prototype/odip/backend`): `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: the new `StartShift_NotStartable_ReturnsDistinctCodePerStatus` and
  `FinishShift_NotFinishable_ReturnsDistinctCodePerStatus` theories FAIL (current code returns
  `SHIFT_NOT_STARTABLE`/`SHIFT_NOT_IN_PROGRESS` for every status); the two idempotent-replay
  facts FAIL with a `ConflictObjectResult`/wrong status assertion (current code 409s instead of
  replaying).
- [ ] **Step 3: Write minimal implementation**
  In `PortalController.cs`, replace the `StartShift` status check (current lines 201-203):
  ```csharp
  if (shift.Status != ShiftStatus.Published)
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift can't be started right now.", "SHIFT_NOT_STARTABLE"));
  ```
  with:
  ```csharp
  if (shift.Status != ShiftStatus.Published)
  {
      // Idempotent replay: a worker's retry after a dropped response must read as success, not
      // as a repeat failure (critique P1). SHIFT_NOT_STARTABLE now means only "the database
      // rejected a racing double-Start" — see the DbUpdateException catch below.
      if (shift.Status == ShiftStatus.InProgress)
          return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

      if (shift.Status == ShiftStatus.PendingReview)
          return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
              "This shift has already been finished and is waiting for review.", "SHIFT_ALREADY_FINISHED"));

      if (shift.Status == ShiftStatus.Completed)
          return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
              "This shift has already been reviewed and completed.", "SHIFT_ALREADY_COMPLETED"));

      if (shift.Status == ShiftStatus.Cancelled)
          return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
              "This shift has been cancelled.", "SHIFT_CANCELLED"));

      // Draft
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift hasn't been published yet.", "SHIFT_NOT_PUBLISHED"));
  }
  ```
  In `FinishShift`, insert new pre-checks directly after the shift-ownership 404 (current lines
  263-264, before the `hasNote` check at line 266) so an idempotent replay or an already-elsewhere
  shift never gets blocked by the note gate:
  ```csharp
  if (shift?.Participant is null || shift.Participant.IsDraft)
      return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

  // Idempotent replay / already-elsewhere guards, checked before the note-required gate — none
  // of these states can be fixed by adding a note, so the note gate would be a misleading error.
  if (shift.Status == ShiftStatus.PendingReview)
      return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

  if (shift.Status == ShiftStatus.Completed)
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift has already been reviewed and completed.", "SHIFT_ALREADY_COMPLETED"));

  if (shift.Status == ShiftStatus.Cancelled)
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift has been cancelled.", "SHIFT_CANCELLED"));

  if (shift.Status == ShiftStatus.Draft)
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift hasn't been published yet.", "SHIFT_NOT_PUBLISHED"));

  var hasNote = await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct);
  ```
  (The rest of `FinishShift` — the `hasNote` check, the `Published`/`InProgress` branching, and
  the final `else` defensive branch returning `SHIFT_NOT_IN_PROGRESS` — is unchanged; only
  `Published` and `InProgress` can reach it now.)
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: PASS — all Start/Finish facts including the new idempotency and distinct-code tests.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: no new failures elsewhere (nothing outside this file calls `StartShift`/`FinishShift`
  with a non-Published/non-InProgress/non-PendingReview shift in a way that depended on the old
  single `SHIFT_NOT_STARTABLE`/`SHIFT_NOT_IN_PROGRESS` codes).
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  fix(shift-completion): idempotent Start/Finish replay instead of failing

  A worker's retry after a dropped response (poor connectivity, per PRODUCT.md's
  Field Support Worker persona) now reads as success: Start on an already-
  InProgress shift, and Finish on an already-PendingReview shift, both 200 with
  the current detail and no new writes. Every other non-actionable status gets
  its own SHIFT_* code (SHIFT_ALREADY_FINISHED/SHIFT_ALREADY_COMPLETED/
  SHIFT_CANCELLED/SHIFT_NOT_PUBLISHED) instead of one shared SHIFT_NOT_STARTABLE/
  SHIFT_NOT_IN_PROGRESS. SHIFT_NOT_STARTABLE now means only "the database
  rejected a racing double-Start".

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 2: `ActualStart` validation split + 5-minute clock-skew grace (P1)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (`FinishShift`'s manual-start branch, ~lines 291-298)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs`

**Interfaces:**
- Consumes: `ShiftVarianceCalculator.ResolveRosteredTimesUtc` (existing, unchanged).
- Produces: `SHIFT_ACTUAL_START_IN_FUTURE`, `SHIFT_ACTUAL_START_TOO_EARLY` replace
  `SHIFT_ACTUAL_START_INVALID` (which is deleted entirely — no code needs to preserve it).

- [ ] **Step 1: Write the failing tests**
  In `ShiftCompletionStateMachineTests.cs`, update
  `FinishShift_ManualStart_FutureActualStart_Returns400` (lines 298-317) and
  `FinishShift_ManualStart_ActualStartTooEarly_Returns400` (lines 319-339) to assert the new
  codes, and add a grace-window pass case:
  ```csharp
  [Fact]
  public async Task FinishShift_ManualStart_FutureActualStart_Returns400()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
      AddNote(db, shift.Id, user.Id);
      var controller = MakeController(db, tenant.Object, user.Id);
      var futureStart = DateTime.UtcNow.AddHours(1);

      var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = futureStart }, CancellationToken.None);

      var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(badRequest.Value);
      Assert.Equal("SHIFT_ACTUAL_START_IN_FUTURE", body.Code);
      Assert.Empty(await db.ShiftCompletions.ToListAsync());
      var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
      Assert.Equal(ShiftStatus.Published, saved.Status);
  }

  [Fact]
  public async Task FinishShift_ManualStart_ActualStartTooEarly_Returns400()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
      AddNote(db, shift.Id, user.Id);
      var controller = MakeController(db, tenant.Object, user.Id);
      // Rostered start = 2026-09-08 09:00 Australia/Sydney (AEST, no DST) = 2026-09-07T23:00Z.
      var tooEarly = new DateTime(2026, 9, 7, 23, 0, 0, DateTimeKind.Utc).AddHours(-25);

      var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = tooEarly }, CancellationToken.None);

      var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(badRequest.Value);
      Assert.Equal("SHIFT_ACTUAL_START_TOO_EARLY", body.Code);
      Assert.Empty(await db.ShiftCompletions.ToListAsync());
      var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
      Assert.Equal(ShiftStatus.Published, saved.Status);
  }

  [Fact]
  public async Task FinishShift_ManualStart_ActualStartWithinClockSkewGrace_Returns200()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id, ShiftStatus.Published);
      AddNote(db, shift.Id, user.Id);
      var controller = MakeController(db, tenant.Object, user.Id);
      var withinGrace = DateTime.UtcNow.AddMinutes(2); // < the 5-minute grace, must still pass

      var result = await controller.FinishShift(shift.Id, new FinishShiftDto { ActualStart = withinGrace }, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
      Assert.Equal(ShiftStatus.PendingReview, body.Data!.Status);
  }
  ```
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: `FinishShift_ManualStart_FutureActualStart_Returns400` and
  `..._ActualStartTooEarly_Returns400` FAIL (current code returns `SHIFT_ACTUAL_START_INVALID`
  for both); `..._ActualStartWithinClockSkewGrace_Returns200` FAILS (current code has no grace —
  now+2min is not itself `> now`, so today's code actually already lets it through... verify by
  running; if it already passes, the new grace test simply confirms no regression once the
  future-check gains `.AddMinutes(5)`).
- [ ] **Step 3: Write minimal implementation**
  In `PortalController.cs`, replace the manual-start validation (current lines 291-298):
  ```csharp
  var (manualRosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, timeZoneId);
  if (actualStartUtc > now || actualStartUtc < manualRosteredStartUtc.AddHours(-24))
      return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
          "Actual start time is invalid.", "SHIFT_ACTUAL_START_INVALID"));
  ```
  with:
  ```csharp
  var (manualRosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, timeZoneId);
  // F3, hardened: split into two distinct causes (critique P1 — "never says which bound
  // failed") plus a 5-minute grace on the future side for ordinary device clock skew.
  if (actualStartUtc > now.AddMinutes(5))
      return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
          "Actual start time can't be in the future.", "SHIFT_ACTUAL_START_IN_FUTURE"));
  if (actualStartUtc < manualRosteredStartUtc.AddHours(-24))
      return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
          "Actual start time can't be more than 24 hours before the rostered start.", "SHIFT_ACTUAL_START_TOO_EARLY"));
  ```
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: PASS — all Finish facts including the three updated/new ones. Confirm
  `FinishShift_ManualStart_UnspecifiedKind_StoredAsUtc` (lines 341-358) is unaffected — its fixed
  timestamp falls well inside both bounds.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: no new failures.
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  fix(shift-completion): split SHIFT_ACTUAL_START_INVALID into two diagnosable codes

  The manual-start ActualStart guard collapsed "in the future" and "more than
  24h before rostered start" into one undiagnosable SHIFT_ACTUAL_START_INVALID
  (critique P1). Splits into SHIFT_ACTUAL_START_IN_FUTURE / SHIFT_ACTUAL_START_
  TOO_EARLY with the bound named in the message, and adds a 5-minute grace on
  the future side for ordinary device clock skew.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 3: Queue signal — `IsOutlierVariance`, `VarianceReviewMinutes`, `ReturnCount`, `TimeZoneId`, outlier-first sort (P1)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs` (`ShiftCompletionDto`, `CompletionQueueItemDto`)
- Modify: `odip-prototype/odip/backend/Odip.Api/Rostering/ShiftCompletionMapper.cs` (`IsOutlierVariance` helper + `ToDtoAsync` signature)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (constructor gains optional `IConfiguration?`, wrapper call site)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (constructor gains optional `IConfiguration?`, `GetCompletions` sort, wrapper call site)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`

**Design decision:** `RosteringController`/`PortalController` gain a trailing *optional*
`IConfiguration? config = null` constructor parameter rather than a required one — ASP.NET
Core's controller activator resolves an optional constructor parameter from DI when the service
is registered (`IConfiguration` always is), so production gets the real config while every
existing `new RosteringController(db, compatLink, unavailabilityQuery)` /
`new PortalController(db, tenant)` test call site keeps compiling unchanged. This means ZERO
existing test call sites change as part of this task.

- [ ] **Step 1: Write the failing tests**
  In `RosteringCompletionReviewTests.cs`, add `using Microsoft.Extensions.Configuration;` to the
  file's usings, and change **only** `MakeController`'s signature (lines 47-58) to thread an
  optional config through:
  ```csharp
  private static RosteringController MakeController(OdipDbContext db, IConfiguration? config = null)
  {
      var identity = new ClaimsIdentity(
          [new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString())], "Test");
      return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), config)
      {
          ControllerContext = new ControllerContext
          {
              HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
          }
      };
  }
  ```
  Every existing `MakeController(db)` call site — including the two other places in this file
  that build a `RosteringController` directly (`ReturnThenResubmit_...` and
  `ApproveCompletion_OtherTenant_Returns404`, both of which pass 3 constructor args with no
  trailing config) — keeps compiling unchanged. Then append new facts:
  ```csharp
  [Fact]
  public async Task GetCompletions_VarianceWithinThreshold_IsOutlierVarianceFalse()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id,
          ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
          StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow,
          VarianceMinutesStart = 10, VarianceMinutesEnd = -5, IsActive = true, // both < 15
      });
      var controller = MakeController(db);

      var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
      var item = Assert.Single(body.Data!.Items);
      Assert.False(item.IsOutlierVariance);
      Assert.Equal(15, item.VarianceReviewMinutes);
      Assert.Equal("Australia/Sydney", item.TimeZoneId);
      Assert.Equal(0, item.ReturnCount);
  }

  [Fact]
  public async Task GetCompletions_VarianceOverThreshold_IsOutlierVarianceTrue()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      shift.ReturnCount = 2;
      db.SaveChanges();
      Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id,
          ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
          StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow,
          VarianceMinutesStart = 16, VarianceMinutesEnd = 0, IsActive = true, // > 15
      });
      var controller = MakeController(db);

      var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
      var item = Assert.Single(body.Data!.Items);
      Assert.True(item.IsOutlierVariance);
      Assert.Equal(2, item.ReturnCount);
  }

  [Fact]
  public async Task GetCompletions_SortsOutliersBeforeNonOutliers_ThenByServiceDate()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);

      var early = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview); // 2026-09-08, clean
      Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = early.Id, ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddHours(-8),
          SubmittedAt = DateTime.UtcNow, VarianceMinutesStart = 0, VarianceMinutesEnd = 0, IsActive = true,
      });

      var late = Seed(db, new Shift
      {
          Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate.AddDays(3),
          StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
          NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
      });
      db.SaveChanges();
      Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = late.Id, ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddHours(-8),
          SubmittedAt = DateTime.UtcNow, VarianceMinutesStart = 30, VarianceMinutesEnd = 0, IsActive = true, // outlier, later date
      });
      var controller = MakeController(db);

      var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
      Assert.Equal(2, body.Data!.Items.Count);
      Assert.Equal(late.Id, body.Data.Items[0].ShiftId); // outlier first despite later date
      Assert.Equal(early.Id, body.Data.Items[1].ShiftId);
  }
  ```
  No other test file changes: `PortalController`'s optional `IConfiguration? config = null`
  parameter means every existing `new PortalController(db, tenant)` /
  `new PortalController(db, tenant.Object)` / `new PortalController(db, portalTenant.Object)`
  call site across `ShiftCompletionStateMachineTests.cs`, `PortalControllerTests.cs`,
  `PortalLeaveTests.cs`, `PortalWitnessRequestsTests.cs`, and `RosteringCompletionReviewTests.cs`'s
  `ReturnThenResubmit_...` fact keeps compiling unchanged.
  In addition, add one new fact to `RosteringCompletionReviewTests.cs` proving the config path is
  actually wired, not just optional-and-unused:
  ```csharp
  [Fact]
  public async Task GetCompletions_ThresholdFromConfig_OverridesDefault()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id,
          ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
          TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id,
          StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow,
          VarianceMinutesStart = 20, VarianceMinutesEnd = 0, IsActive = true, // > default 15, < overridden 30
      });
      var config = new ConfigurationBuilder()
          .AddInMemoryCollection(new Dictionary<string, string?> { ["Rostering:VarianceReviewMinutes"] = "30" })
          .Build();
      var controller = MakeController(db, config);

      var result = await controller.GetCompletions(null, null, null, 1, 50, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value);
      var item = Assert.Single(body.Data!.Items);
      Assert.False(item.IsOutlierVariance); // 20 <= 30, no longer an outlier once the threshold is overridden
      Assert.Equal(30, item.VarianceReviewMinutes);
  }
  ```
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: FAIL to compile — `RosteringController`/`PortalController` don't yet take an
  `IConfiguration` parameter; `GetCompletions` doesn't yet take `page`/`pageSize` (added here so
  Task 6 doesn't have to touch every call site a second time — Task 6 implements the actual
  paging/projection behaviour); `CompletionQueueItemDto` has no `IsOutlierVariance`/
  `VarianceReviewMinutes`/`TimeZoneId`/`ReturnCount` members yet.
- [ ] **Step 3: Write minimal implementation**
  In `ShiftCompletionDTOs.cs`, replace `ShiftCompletionDto` and `CompletionQueueItemDto`:
  ```csharp
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
      int VarianceMinutesEnd,
      bool IsOutlierVariance,
      int VarianceReviewMinutes,
      int ReturnCount);

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
      ShiftStatus Status,
      string TimeZoneId,
      bool IsOutlierVariance,
      int VarianceReviewMinutes,
      int ReturnCount);
  ```
  In `ShiftCompletionMapper.cs`, add the shared threshold helper and thread it through
  `ToDtoAsync` — replace the whole file body:
  ```csharp
  using Microsoft.EntityFrameworkCore;
  using Odip.Application.DTOs;
  using Odip.Domain.Entities;
  using Odip.Domain.Rostering;
  using Odip.Infrastructure.Data;

  namespace Odip.Api.Rostering;

  /// <summary>
  /// Maps a <see cref="ShiftCompletion"/> to its DTO, resolving submitter/reviewer display names
  /// and the "is this outlier variance" queue signal — shared by
  /// <see cref="Odip.Api.Controllers.PortalController"/> (Start/Finish/detail) and
  /// <see cref="Odip.Api.Controllers.RosteringController"/> (completions list/detail/approve/
  /// return) so the two controllers can't drift. Same pattern as <see cref="RosterGate"/>.
  /// </summary>
  public static class ShiftCompletionMapper
  {
      /// <summary>
      /// True when either variance leg exceeds the configured review threshold (critique P1 —
      /// "the coordinator's review queue has no signal for what actually needs attention").
      /// </summary>
      public static bool IsOutlierVariance(int varianceMinutesStart, int varianceMinutesEnd, int thresholdMinutes) =>
          Math.Abs(varianceMinutesStart) > thresholdMinutes || Math.Abs(varianceMinutesEnd) > thresholdMinutes;

      public static async Task<ShiftCompletionDto> ToDtoAsync(OdipDbContext db, ShiftCompletion c, int varianceReviewMinutes, CancellationToken ct)
      {
          var submittedBy = await db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
          User? reviewedBy = c.ReviewedByUserId.HasValue
              ? await db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
              : null;
          var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == c.ShiftId, ct);

          return new ShiftCompletionDto(
              c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
              c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
              c.StartedAt, c.SubmittedAt,
              c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
              c.VarianceMinutesStart, c.VarianceMinutesEnd,
              IsOutlierVariance(c.VarianceMinutesStart, c.VarianceMinutesEnd, varianceReviewMinutes),
              varianceReviewMinutes, shift?.ReturnCount ?? 0);
      }
  }
  ```
  In `PortalController.cs`: add `using Microsoft.Extensions.Configuration;`, add a field and
  constructor parameter, and update the wrapper:
  ```csharp
  private readonly OdipDbContext _db;
  private readonly ICurrentTenant _currentTenant;
  private readonly IConfiguration? _config;

  public PortalController(OdipDbContext db, ICurrentTenant currentTenant, IConfiguration? config = null)
  {
      _db = db;
      _currentTenant = currentTenant;
      _config = config;
  }

  private int VarianceReviewMinutes => _config?.GetValue<int>("Rostering:VarianceReviewMinutes", 15) ?? 15;
  ```
  ```csharp
  /// <summary>Maps a ShiftCompletion to its DTO — thin wrapper so this and RosteringController's
  /// identical mapping need to stay in one place; see <see cref="ShiftCompletionMapper"/>.</summary>
  private Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, CancellationToken ct) =>
      ShiftCompletionMapper.ToDtoAsync(_db, c, VarianceReviewMinutes, ct);
  ```
  In `RosteringController.cs`: same optional `IConfiguration?` field/constructor addition, same
  wrapper change, plus `GetCompletions`'s signature gains `page`/`pageSize` (paging *behaviour*
  lands in Task 6 — for now the params exist and are ignored except by the new sort):
  ```csharp
  private readonly OdipDbContext _db;
  private readonly RosterConflictService _conflictService = new();
  private readonly ShiftPatternExpander _expander = new();
  private readonly StaffCompatibilityLinkService _compatLink;
  private readonly IStaffUnavailabilityQuery _unavailabilityQuery;
  private readonly IConfiguration? _config;

  public RosteringController(OdipDbContext db, StaffCompatibilityLinkService compatLink, IStaffUnavailabilityQuery unavailabilityQuery, IConfiguration? config = null)
  {
      _db = db;
      _compatLink = compatLink;
      _unavailabilityQuery = unavailabilityQuery;
      _config = config;
  }

  private int VarianceReviewMinutes => _config?.GetValue<int>("Rostering:VarianceReviewMinutes", 15) ?? 15;
  ```
  Replace `GetCompletions` (current lines 465-496):
  ```csharp
  [HttpGet("completions")]
  public async Task<ActionResult<ApiResponse<PagedResult<CompletionQueueItemDto>>>> GetCompletions(
      [FromQuery] ShiftStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
      [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
  {
      page = Math.Max(page, 1);
      pageSize = Math.Clamp(pageSize, 1, 200);
      var statusFilter = status ?? ShiftStatus.PendingReview;
      var thresholdMinutes = VarianceReviewMinutes;

      var query = _db.Shifts
          .Include(s => s.Participant)
          .Include(s => s.User)
          .Where(s => s.Status == statusFilter);
      if (from.HasValue) query = query.Where(s => s.ServiceDate >= from.Value);
      if (to.HasValue) query = query.Where(s => s.ServiceDate <= to.Value);

      var shifts = await query.ToListAsync(ct);
      var shiftIds = shifts.Select(s => s.Id).ToList();

      var completionsByShiftId = await _db.ShiftCompletions
          .Where(c => shiftIds.Contains(c.ShiftId) && c.IsActive)
          .ToDictionaryAsync(c => c.ShiftId, ct);

      var items = new List<CompletionQueueItemDto>();
      foreach (var shift in shifts)
      {
          if (!completionsByShiftId.TryGetValue(shift.Id, out var completion)) continue;
          var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
          var isOutlier = ShiftCompletionMapper.IsOutlierVariance(completion.VarianceMinutesStart, completion.VarianceMinutesEnd, thresholdMinutes);
          items.Add(new CompletionQueueItemDto(
              shift.Id, completion.Id, shift.Participant?.FullName ?? string.Empty, shift.User?.FullName ?? string.Empty,
              shift.ServiceDate, rosteredStartUtc, rosteredEndUtc, completion.ActualStart, completion.ActualEnd,
              completion.VarianceMinutesStart, completion.VarianceMinutesEnd, shift.Status,
              completion.TimeZoneId, isOutlier, thresholdMinutes, shift.ReturnCount));
      }

      // Outlier-first, then chronological — the coordinator's queue previously had "no signal
      // for what actually needs attention" (critique P1). In-memory sort: IsOutlierVariance and
      // the RosteredStart used for the date/time tiebreak are both derived (timezone-aware),
      // not translatable to SQL.
      var sorted = items
          .OrderByDescending(i => i.IsOutlierVariance)
          .ThenBy(i => i.ServiceDate)
          .ThenBy(i => i.RosteredStart)
          .ToList();

      var totalCount = sorted.Count;
      var paged = sorted.Skip((page - 1) * pageSize).Take(pageSize).ToList();

      return Ok(ApiResponse<PagedResult<CompletionQueueItemDto>>.Ok(
          new PagedResult<CompletionQueueItemDto> { Items = paged, Page = page, PageSize = pageSize, TotalCount = totalCount }));
  }
  ```
  Paging is real starting here, not a placeholder — `page`/`pageSize` default to `1`/`50`, are
  clamped (`page` to a minimum of 1, `pageSize` to `[1, 200]`), and drive a real `Skip`/`Take`
  over the outlier-sorted list. Task 6 does not touch this signature or the paging/sort logic —
  it only swaps the `.Include(Participant)`/`.Include(User)` query for a narrower `.Select()`
  projection and adds the supporting `(TenantId, Status, ServiceDate)` index. Add
  `using Odip.Application.Common;` if not already present — it already is, via the existing
  `ApiResponse` using.
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: PASS — all `GetCompletions` facts including the three new ones. Update the two
  pre-existing `GetCompletions_...` facts (`GetCompletions_DefaultsToPendingReview_...`,
  `GetCompletions_StatusFilter_...`) to call `controller.GetCompletions(null, null, null, 1, 50, ...)` /
  `controller.GetCompletions(ShiftStatus.InProgress, null, null, 1, 50, ...)` and to unwrap
  `body.Data!.Items` instead of `body.Data!` directly.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: PASS. No existing test call-site changes are required — both constructors' new
  `IConfiguration?` parameter is optional, so every pre-existing `new RosteringController(...)`/
  `new PortalController(...)` call site across the whole test project keeps compiling unchanged.
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs odip-prototype/odip/backend/Odip.Api/Rostering/ShiftCompletionMapper.cs odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): review-queue outlier signal, sort, and context

  CompletionQueueItemDto and ShiftCompletionDto both gain IsOutlierVariance
  (either variance leg beyond Rostering:VarianceReviewMinutes, default 15),
  VarianceReviewMinutes, and ReturnCount; CompletionQueueItemDto also gains
  TimeZoneId. GetCompletions now sorts outliers before non-outliers, then by
  service date — the queue previously had "no signal for what actually needs
  attention" (critique P1). ShiftCompletionMapper.IsOutlierVariance is the one
  place the threshold comparison lives.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 4: Return context — `LastReturnReason`, reason validation codes, completion history endpoint (P2)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs` (`PortalShiftDetailDto`)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (`BuildShiftDetailDtoAsync`)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (`ReturnCompletion` validation, new `GetShiftCompletions`)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs`
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`

**Interfaces:**
- Produces: `PortalShiftDetailDto.LastReturnReason` (string?), `GET /rostering/shifts/{id}/completions`
  (all completions, active + inactive, `SubmittedAt desc`/`StartedAt desc`), `SHIFT_RETURN_REASON_REQUIRED`
  / `SHIFT_RETURN_REASON_TOO_LONG` codes.

**Not in scope:** the critique's P2 finding "`ReturnCount` is a permanent, undifferentiated
scoreboard — pair with `TotalCompletions` or keep the last-N outcomes" is explicitly out of
scope for this plan (product ruling) — `GetShiftCompletions` (below) already gives PR2's UI a
way to compute a rate client-side from full history without a new persisted field.

- [ ] **Step 1: Write the failing tests**
  In `PortalControllerTests.cs`, add (reusing the file's `CreateDb`/`SeedUser`/`SeedParticipant`/
  `SeedShift`/`MakeController` helpers):
  ```csharp
  [Fact]
  public async Task GetShiftDetail_PublishedAfterReturn_ExposesLastReturnReason()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id);
      shift.ReturnCount = 1;
      db.ShiftCompletions.Add(new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow.AddDays(-1),
          ActualEnd = DateTime.UtcNow.AddDays(-1).AddHours(8), TimeZoneId = "Australia/Sydney",
          SubmittedByUserId = user.Id, StartedAt = DateTime.UtcNow.AddDays(-1),
          SubmittedAt = DateTime.UtcNow.AddDays(-1).AddHours(8),
          ReviewedByUserId = Guid.NewGuid(), ReviewedAt = DateTime.UtcNow,
          ReviewOutcome = ReviewOutcome.Returned, ReturnReason = "Times look wrong, please recheck.",
          IsActive = false,
      });
      db.SaveChanges();
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.GetShiftDetail(shift.Id, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
      Assert.Equal("Times look wrong, please recheck.", body.Data!.LastReturnReason);
  }

  [Fact]
  public async Task GetShiftDetail_NeverReturned_LastReturnReasonIsNull()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id);
      var controller = MakeController(db, tenant.Object, user.Id);

      var result = await controller.GetShiftDetail(shift.Id, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
      Assert.Null(body.Data!.LastReturnReason);
  }
  ```
  In `RosteringCompletionReviewTests.cs`, update `ReturnCompletion_EmptyReason_Returns400`
  (lines 300-321) to assert the new code, and add length + history-endpoint facts:
  ```csharp
  [Fact]
  public async Task ReturnCompletion_EmptyReason_Returns400WithCode()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      var completion = SeedCompletion(db, shift.Id, staff.Id);
      var controller = MakeController(db);

      var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "" }, CancellationToken.None);

      var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(badRequest.Value);
      Assert.Equal("A return reason is required.", body.Errors!.Single());
      Assert.Equal("SHIFT_RETURN_REASON_REQUIRED", body.Code);

      var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
      Assert.True(savedCompletion.IsActive);
  }

  [Fact]
  public async Task ReturnCompletion_ReasonOver500Chars_Returns400SHIFT_RETURN_REASON_TOO_LONG()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      SeedCompletion(db, shift.Id, staff.Id);
      var controller = MakeController(db);
      var tooLong = new string('a', 501);

      var result = await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = tooLong }, CancellationToken.None);

      var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(badRequest.Value);
      Assert.Equal("SHIFT_RETURN_REASON_TOO_LONG", body.Code);
  }

  [Fact]
  public async Task ReturnCompletion_ReasonWithSurroundingWhitespace_IsTrimmedBeforeSaving()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      var completion = SeedCompletion(db, shift.Id, staff.Id);
      var controller = MakeController(db);

      await controller.ReturnCompletion(shift.Id, new ReturnCompletionDto { Reason = "  Recheck please.  " }, CancellationToken.None);

      var saved = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
      Assert.Equal("Recheck please.", saved.ReturnReason);
  }

  [Fact]
  public async Task GetShiftCompletions_ReturnsActiveAndInactive_NewestFirst()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      var older = Seed(db, new ShiftCompletion
      {
          Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = DateTime.UtcNow.AddDays(-2),
          ActualEnd = DateTime.UtcNow.AddDays(-2).AddHours(8), TimeZoneId = "Australia/Sydney",
          SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddDays(-2),
          SubmittedAt = DateTime.UtcNow.AddDays(-2).AddHours(8), IsActive = false,
          ReviewOutcome = ReviewOutcome.Returned, ReturnReason = "First attempt was off.",
      });
      var newer = SeedCompletion(db, shift.Id, staff.Id, isActive: true);
      var controller = MakeController(db);

      var result = await controller.GetShiftCompletions(shift.Id, CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<List<ShiftCompletionDto>>>(ok.Value);
      Assert.Equal(2, body.Data!.Count);
      Assert.Equal(newer.Id, body.Data[0].Id);
      Assert.Equal(older.Id, body.Data[1].Id);
  }

  [Fact]
  public async Task GetShiftCompletions_NoCompletions_Returns404()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.Published);
      var controller = MakeController(db);

      var result = await controller.GetShiftCompletions(shift.Id, CancellationToken.None);

      Assert.IsType<NotFoundObjectResult>(result.Result);
  }
  ```
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~PortalControllerTests|FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: FAIL — `PortalShiftDetailDto` has no `LastReturnReason`; `ReturnCompletion` still
  returns no `Code` on the empty-reason 400 and has no length cap; `RosteringController` has no
  `GetShiftCompletions` method.
- [ ] **Step 3: Write minimal implementation**
  In `PortalDTOs.cs`, append `LastReturnReason` to `PortalShiftDetailDto`:
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
      int ReturnCount,
      string? LastReturnReason);
  ```
  In `PortalController.cs`'s `BuildShiftDetailDtoAsync`, add the lookup and thread it through the
  final `return`:
  ```csharp
  var activeCompletion = await _db.ShiftCompletions
      .Where(c => c.ShiftId == shift.Id && c.IsActive)
      .FirstOrDefaultAsync(ct);
  var completionDto = activeCompletion is null ? null : await ToShiftCompletionDtoAsync(activeCompletion, ct);

  // Return context (critique P2) — "return archives the completion and GET /portal/shifts/{id}
  // returns only the active one, so the resubmitting worker sees ReturnCount and nothing about
  // why". Most recent Returned row's reason, independent of the current active completion.
  var lastReturnReason = await _db.ShiftCompletions
      .Where(c => c.ShiftId == shift.Id && !c.IsActive && c.ReviewOutcome == ReviewOutcome.Returned)
      .OrderByDescending(c => c.ReviewedAt)
      .Select(c => c.ReturnReason)
      .FirstOrDefaultAsync(ct);

  return new PortalShiftDetailDto(
      shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.DurationHours,
      shift.Ratio, shift.NightType, shift.Status, shift.Notes,
      ToParticipantSummaryDto(participant),
      routines.Select(ToRoutineDto).ToList(),
      riskEntries.Select(ToRiskEntryDto).ToList(),
      medications.Select(ToMedicationSummaryDto).ToList(),
      completionDto,
      shift.ReturnCount,
      lastReturnReason);
  ```
  In `RosteringController.cs`, replace `ReturnCompletion`'s reason check (current lines 566-567):
  ```csharp
  if (string.IsNullOrWhiteSpace(dto.Reason))
      return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("A return reason is required."));
  ```
  with:
  ```csharp
  var trimmedReason = (dto.Reason ?? string.Empty).Trim(); // JSON null must not NRE
  if (trimmedReason.Length == 0)
      return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("A return reason is required.", "SHIFT_RETURN_REASON_REQUIRED"));
  if (trimmedReason.Length > 500)
      return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("Return reason must be 500 characters or fewer.", "SHIFT_RETURN_REASON_TOO_LONG"));
  ```
  and change `completion.ReturnReason = dto.Reason.Trim();` (current line 577) to
  `completion.ReturnReason = trimmedReason;`.
  In `ShiftCompletionDTOs.cs`, remove the `[StringLength(2000)]` attribute from
  `ReturnCompletionDto.Reason` and update its "F2" comment — the controller now owns BOTH the
  empty check (`SHIFT_RETURN_REASON_REQUIRED`) and the 500-char cap
  (`SHIFT_RETURN_REASON_TOO_LONG`) added above, so leaving the 2000-char model-binding attribute
  in place would let a >2000-char body get rejected by ASP.NET's generic, code-less
  validation-problem 400 before the controller's own check ever runs:
  ```csharp
  public record ReturnCompletionDto
  {
      // F2: no [Required]/[StringLength] — RosteringController.ReturnCompletion's own empty-
      // check and 500-char cap own the entire reason-validation contract (both carry a SHIFT_*
      // code), so model-binding validation must not pre-empt either with a generic, code-less 400.
      public string Reason { get; init; } = string.Empty;
  }
  ```
  Add `GetShiftCompletions` directly after `GetShiftCompletion` (current lines 498-509):
  ```csharp
  /// <summary>
  /// Every completion for one shift, active and inactive, newest first — the review history
  /// PR2's review page needs (critique P2: "the resubmitting worker sees ReturnCount and nothing
  /// about why" — this is the coordinator-side counterpart). Same 404 rule as
  /// GetShiftCompletion: no rows for this ShiftId (whether the shift itself doesn't exist, or it
  /// simply hasn't been started yet) 404s identically — this surface never distinguishes them.
  /// </summary>
  [HttpGet("shifts/{id:guid}/completions")]
  public async Task<ActionResult<ApiResponse<List<ShiftCompletionDto>>>> GetShiftCompletions(Guid id, CancellationToken ct)
  {
      var completions = await _db.ShiftCompletions
          .Where(c => c.ShiftId == id)
          .OrderByDescending(c => c.SubmittedAt)
          .ThenByDescending(c => c.StartedAt)
          .ToListAsync(ct);
      if (completions.Count == 0)
          return NotFound(ApiResponse<List<ShiftCompletionDto>>.Fail("Shift completion not found."));

      var thresholdMinutes = VarianceReviewMinutes;
      var dtos = new List<ShiftCompletionDto>();
      foreach (var c in completions)
          dtos.Add(await ShiftCompletionMapper.ToDtoAsync(_db, c, thresholdMinutes, ct));
      return Ok(ApiResponse<List<ShiftCompletionDto>>.Ok(dtos));
  }
  ```
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~PortalControllerTests|FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: PASS — all new and updated facts.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: PASS. `PortalShiftDetailDto`'s new trailing positional parameter only breaks a
  compile if some other test constructs it directly with positional args — fix any such site by
  adding a trailing `null`/reason argument.
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Application/DTOs/PortalDTOs.cs odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Portal/PortalControllerTests.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): surface return reason back to the worker + review history

  PortalShiftDetailDto.LastReturnReason carries the most recent Returned
  completion's reason so a resubmitting worker sees why, not just ReturnCount
  (critique P2). ReturnCompletion's blank-reason 400 gains
  SHIFT_RETURN_REASON_REQUIRED (previously code-less, breaking envelope
  consistency); a new 500-char cap adds SHIFT_RETURN_REASON_TOO_LONG. New GET
  /rostering/shifts/{id}/completions returns full active+inactive history for
  PR2's review page.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 5: `UpdateShift` un-cancel + `SHIFT_STATUS_LOCKED` rename + centralised `ShiftErrorCodes` (P2)

**Files:**
- Create: `odip-prototype/odip/backend/Odip.Application/Common/ShiftErrorCodes.cs`
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (`UpdateShift` gate, every `SHIFT_*`/`STATUS_TRANSITION_VIA_COMPLETION` literal)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs` (every `SHIFT_*` literal)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs`
- Modify: `odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs`

**Ruling:** un-cancel is now allowed — `Cancelled → Draft` and `Cancelled → Published` pass the
gate; every other transition into/out of `InProgress`/`PendingReview`/`Completed` stays blocked.
`STATUS_TRANSITION_VIA_COMPLETION` renames to `SHIFT_STATUS_LOCKED` with a coordinator-facing
message (the critique calls the old one jargon: "endpoints" means nothing to a coordinator).

- [ ] **Step 1: Write the failing tests**
  In `RosteringUpdateShiftStatusGateTests.cs`, add `Cancelled` to the "succeeds" theory (lines
  68-73) and remove the now-wrong `Cancelled` "any other status jump" cases — there are none
  currently (the theory at lines 88-95 has no `Cancelled` `from` case, so nothing to remove there;
  it also has no `Cancelled → Completed` "still blocked" case, which the ruling explicitly wants
  added):
  ```csharp
  [Theory]
  [InlineData(ShiftStatus.Draft, ShiftStatus.Published)]
  [InlineData(ShiftStatus.Published, ShiftStatus.Draft)]
  [InlineData(ShiftStatus.Draft, ShiftStatus.Draft)]
  [InlineData(ShiftStatus.Draft, ShiftStatus.Cancelled)]
  [InlineData(ShiftStatus.Published, ShiftStatus.Cancelled)]
  [InlineData(ShiftStatus.Cancelled, ShiftStatus.Draft)]
  [InlineData(ShiftStatus.Cancelled, ShiftStatus.Published)]
  public async Task UpdateShift_DraftPublishedToggle_Succeeds(ShiftStatus from, ShiftStatus to)
  ```
  ```csharp
  [Theory]
  [InlineData(ShiftStatus.Draft, ShiftStatus.Completed)]
  [InlineData(ShiftStatus.Published, ShiftStatus.InProgress)]
  [InlineData(ShiftStatus.Published, ShiftStatus.PendingReview)]
  [InlineData(ShiftStatus.Published, ShiftStatus.Completed)]
  [InlineData(ShiftStatus.InProgress, ShiftStatus.Published)]
  [InlineData(ShiftStatus.PendingReview, ShiftStatus.Completed)]
  [InlineData(ShiftStatus.Completed, ShiftStatus.Published)]
  [InlineData(ShiftStatus.Cancelled, ShiftStatus.Completed)]
  [InlineData(ShiftStatus.Cancelled, ShiftStatus.InProgress)]
  public async Task UpdateShift_AnyOtherStatusJump_Returns409_WithStatusTransitionCode(ShiftStatus from, ShiftStatus to)
  {
      using var db = CreateDb();
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, from);
      var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

      var result = await controller.UpdateShift(shift.Id, DtoFor(shift, to), CancellationToken.None);

      var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value);
      Assert.Equal("SHIFT_STATUS_LOCKED", body.Code);

      var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
      Assert.Equal(from, saved.Status); // rejected write must not persist
  }
  ```
  No other change needed in this file — `RosteringController`'s `IConfiguration?` parameter is
  optional, so every other existing `new RosteringController(db, new
  StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))` call site in this file
  keeps compiling unchanged.
  In `ApiResponseCodeTests.cs`, add:
  ```csharp
  using System.IO;
  using System.Linq;
  using System.Text.RegularExpressions;
  ```
  and:
  ```csharp
  /// <summary>
  /// After the Task 5 sweep, PortalController/RosteringController must reference every SHIFT_*
  /// code exclusively through ShiftErrorCodes — codified after the critique found one code
  /// (STATUS_TRANSITION_VIA_COMPLETION) breaking the SHIFT_* prefix and another (the return-
  /// reason 400) shipping with no code at all. A literal-matching test (asserting each literal
  /// has a corresponding constant) would assert nothing once zero literals remain, so this
  /// instead asserts the sweep is complete (no raw SHIFT_* literals left in either controller)
  /// and that ShiftErrorCodes itself stays well-formed (every value matches the SHIFT_* prefix
  /// and no two constants collide on the same value).
  /// </summary>
  public class ShiftErrorCodesTests
  {
      private static readonly string BackendRoot = FindBackendRoot();

      private static string FindBackendRoot()
      {
          var dir = AppContext.BaseDirectory;
          while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
          {
              var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
              if (parent == dir) break;
              dir = parent;
          }
          if (dir is null || !File.Exists(Path.Combine(dir, "Odip.sln")))
              throw new InvalidOperationException($"Could not locate Odip.sln above {AppContext.BaseDirectory}");
          return dir;
      }

      [Theory]
      [InlineData("Odip.Api/Controllers/PortalController.cs")]
      [InlineData("Odip.Api/Controllers/RosteringController.cs")]
      public void NoRawShiftCodeLiteralsRemain(string relativePath)
      {
          var source = File.ReadAllText(Path.Combine(BackendRoot, relativePath));

          var literalCodes = Regex.Matches(source, "\"(SHIFT_[A-Z_]+)\"")
              .Select(m => m.Groups[1].Value)
              .Distinct()
              .ToList();

          Assert.True(literalCodes.Count == 0,
              $"{relativePath} still has raw SHIFT_* string literal(s) instead of ShiftErrorCodes constants: {string.Join(", ", literalCodes)}");
      }

      [Fact]
      public void EveryShiftErrorCodesConstant_MatchesPrefixAndIsUnique()
      {
          var values = typeof(ShiftErrorCodes).GetFields()
              .Where(f => f.IsLiteral)
              .Select(f => (string)f.GetRawConstantValue()!)
              .ToList();

          Assert.NotEmpty(values);
          foreach (var value in values)
              Assert.Matches("^SHIFT_[A-Z_]+$", value);

          var duplicates = values.GroupBy(v => v).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
          Assert.True(duplicates.Count == 0, $"Duplicate ShiftErrorCodes value(s): {string.Join(", ", duplicates)}");
      }
  }
  ```
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringUpdateShiftStatusGateTests|FullyQualifiedName~ShiftErrorCodesTests"`
  Expected: FAIL — `Cancelled → Draft`/`Cancelled → Published` still 409 (current gate blocks
  every transition where `shift.Status` isn't `Draft`/`Published`); the two new `Cancelled → ...`
  "still blocked" cases assert `SHIFT_STATUS_LOCKED` but the code doesn't exist yet;
  `ShiftErrorCodesTests` fails to compile — `ShiftErrorCodes` doesn't exist yet.
- [ ] **Step 3: Write minimal implementation**
  Create `odip-prototype/odip/backend/Odip.Application/Common/ShiftErrorCodes.cs`:
  ```csharp
  namespace Odip.Application.Common;

  /// <summary>
  /// Every SHIFT_* ApiResponse.Fail code used by PortalController/RosteringController's
  /// shift-completion surface, centralised so the two controllers can't drift and a code can't
  /// silently break the SHIFT_* prefix (critique P2 — STATUS_TRANSITION_VIA_COMPLETION did).
  /// </summary>
  public static class ShiftErrorCodes
  {
      public const string ShiftNotStartable = "SHIFT_NOT_STARTABLE";
      public const string ShiftAlreadyFinished = "SHIFT_ALREADY_FINISHED";
      public const string ShiftAlreadyCompleted = "SHIFT_ALREADY_COMPLETED";
      public const string ShiftCancelled = "SHIFT_CANCELLED";
      public const string ShiftNotPublished = "SHIFT_NOT_PUBLISHED";
      public const string ShiftNotInProgress = "SHIFT_NOT_IN_PROGRESS";
      public const string ShiftNoteRequired = "SHIFT_NOTE_REQUIRED";
      public const string ShiftActualStartInFuture = "SHIFT_ACTUAL_START_IN_FUTURE";
      public const string ShiftActualStartTooEarly = "SHIFT_ACTUAL_START_TOO_EARLY";
      public const string ShiftNotPendingReview = "SHIFT_NOT_PENDING_REVIEW";
      public const string ShiftReturnReasonRequired = "SHIFT_RETURN_REASON_REQUIRED";
      public const string ShiftReturnReasonTooLong = "SHIFT_RETURN_REASON_TOO_LONG";
      public const string ShiftStatusLocked = "SHIFT_STATUS_LOCKED";
      public const string ShiftTimesLocked = "SHIFT_TIMES_LOCKED";
      public const string ShiftBatchSizeInvalid = "SHIFT_BATCH_SIZE_INVALID";
  }
  ```
  In `RosteringController.cs`, replace the `UpdateShift` status gate (current lines 355-359):
  ```csharp
  if (dto.Status != shift.Status
      && !(shift.Status is ShiftStatus.Draft or ShiftStatus.Published
           && dto.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled))
      return Conflict(ApiResponse<ShiftDto>.Fail(
          "Status can only be changed via the shift-completion endpoints.", "STATUS_TRANSITION_VIA_COMPLETION"));
  ```
  with:
  ```csharp
  // Un-cancelling is allowed (critique P2 — pre-PR this was reachable and the spec's own
  // matrix left it a product-ruling gap): Cancelled -> Draft/Published passes, alongside the
  // existing Draft<->Published toggle and either status -> Cancelled. Every transition
  // into/out of InProgress/PendingReview/Completed stays locked to the completion endpoints.
  var fromAllowed = shift.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled;
  var toAllowed = dto.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled;
  if (dto.Status != shift.Status && !(fromAllowed && toAllowed))
      return Conflict(ApiResponse<ShiftDto>.Fail(
          "This shift's status can only be changed by starting, finishing, approving or returning it.",
          ShiftErrorCodes.ShiftStatusLocked));
  ```
  Then sweep both controllers, replacing every remaining `SHIFT_*` string literal with the
  matching `ShiftErrorCodes.*` constant (`using Odip.Application.Common;` is already present in
  both files via the existing `ApiResponse` using). In `PortalController.cs`: `StartShift`'s
  `SHIFT_NOT_STARTABLE`/`SHIFT_ALREADY_FINISHED`/`SHIFT_ALREADY_COMPLETED`/`SHIFT_CANCELLED`/
  `SHIFT_NOT_PUBLISHED` (Task 1) and the `DbUpdateException` catch's `SHIFT_NOT_STARTABLE`;
  `FinishShift`'s `SHIFT_ALREADY_COMPLETED`/`SHIFT_CANCELLED`/`SHIFT_NOT_PUBLISHED` (Task 1),
  `SHIFT_NOTE_REQUIRED`, `SHIFT_NOT_IN_PROGRESS` (both occurrences), `SHIFT_ACTUAL_START_IN_FUTURE`/
  `SHIFT_ACTUAL_START_TOO_EARLY` (Task 2). In `RosteringController.cs`: `SHIFT_TIMES_LOCKED`,
  `SHIFT_NOT_PENDING_REVIEW` (both `ApproveCompletion` and `ReturnCompletion`),
  `SHIFT_RETURN_REASON_REQUIRED`/`SHIFT_RETURN_REASON_TOO_LONG` (Task 4).
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringUpdateShiftStatusGateTests|FullyQualifiedName~ShiftErrorCodesTests"`
  Expected: PASS — un-cancel cases 200, still-blocked cases 409 `SHIFT_STATUS_LOCKED`, and every
  literal in both controllers resolves to a `ShiftErrorCodes` constant.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: PASS — no other test asserts the literal string `"STATUS_TRANSITION_VIA_COMPLETION"`
  (confirmed absent outside this file by the earlier research pass; if one turns up, update it to
  `"SHIFT_STATUS_LOCKED"`).
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Application/Common/ShiftErrorCodes.cs odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Tests/Controllers/RosteringUpdateShiftStatusGateTests.cs odip-prototype/odip/backend/Odip.Tests/Common/ApiResponseCodeTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  fix(shift-completion): allow un-cancel via PUT, rename to SHIFT_STATUS_LOCKED

  UpdateShift's status gate now allows Cancelled -> Draft/Published (pre-PR
  this was reachable; the critique flagged it as newly, silently blocked with
  no path back). STATUS_TRANSITION_VIA_COMPLETION renames to SHIFT_STATUS_
  LOCKED with a coordinator-facing message (the old one said "endpoints",
  meaningless to a non-engineer). Adds Odip.Application.Common.ShiftErrorCodes
  centralising every SHIFT_* code, with a test enforcing no literal drifts from
  it.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 6: Queue performance — index, real paging, projection (P2)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs` (`Shift` entity index)
- Create (generated): `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftStatusIndex.cs` + `.Designer.cs`
- Modify (generated): `odip-prototype/odip/backend/Odip.Infrastructure/Migrations/OdipDbContextModelSnapshot.cs`
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (`GetCompletions`)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`

**Design decision:** `Odip.Application/Common/ApiResponse.cs` already defines a `PagedResult<T>`
class (`Items`, `TotalCount`, `Page`, `PageSize`, `TotalPages`, `HasNext`, `HasPrevious`, and a
static `CreateAsync(IQueryable<T>, page, pageSize, ct)` used by `TripsController.GetAll`) — reuse
it verbatim, do not define a new type. The active-completion dictionary lookup stays (per the
ruling's own allowance) rather than a single `.Select()` projection: `IsOutlierVariance` and the
rostered-time conversion both need `TimeZoneInfo` calls per row, which EF Core cannot translate
to SQL, so the shift/completion join still happens in memory — the projection this task adds is
narrower `.Select()`s on the *Shift* and *Participant/User* queries (name-only, no full
`Include`), which removes the `Participant`/`User` graph hydration the critique flagged.

- [ ] **Step 1: Write the failing tests**
  In `RosteringCompletionReviewTests.cs`, add:
  ```csharp
  [Fact]
  public async Task GetCompletions_PagesResults()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      for (var i = 0; i < 3; i++)
      {
          var shift = Seed(db, new Shift
          {
              Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id,
              ServiceDate = ServiceDate.AddDays(i), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
              Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
          });
          SeedCompletion(db, shift.Id, staff.Id);
      }
      var controller = MakeController(db);

      var page1 = await controller.GetCompletions(null, null, null, 1, 2, CancellationToken.None);
      var page2 = await controller.GetCompletions(null, null, null, 2, 2, CancellationToken.None);

      var body1 = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(Assert.IsType<OkObjectResult>(page1.Result).Value);
      var body2 = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(Assert.IsType<OkObjectResult>(page2.Result).Value);
      Assert.Equal(2, body1.Data!.Items.Count);
      Assert.Equal(1, body2.Data!.Items.Count);
      Assert.Equal(3, body1.Data.TotalCount);
      Assert.Equal(3, body2.Data.TotalCount);
  }

  [Fact]
  public async Task GetCompletions_PageSizeClampedTo200()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      SeedCompletion(db, shift.Id, staff.Id);
      var controller = MakeController(db);

      var result = await controller.GetCompletions(null, null, null, 1, 5000, CancellationToken.None);

      var body = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
      Assert.Equal(200, body.Data!.PageSize);
  }
  ```
  Update every existing `GetCompletions(...)` call site in this file that currently passes
  `1, 50` positionally — no change needed, they already match the new signature from Task 3.
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: `GetCompletions_PagesResults` and `GetCompletions_PageSizeClampedTo200` already PASS —
  Task 3 already implemented real `page`/`pageSize` paging and clamping (Edit B), so these two
  facts exist here purely as this task's coverage of that behaviour, not as new failures. Nothing
  in this task's *implementation* changes paging behaviour; Step 3's index and projection changes
  are functionally transparent, so run the full file to confirm no regression before proceeding.
- [ ] **Step 3: Write minimal implementation**
  In `OdipDbContext.cs`, insert into the `Shift` entity config block, directly after the existing
  pattern-generation index (current line 1057, before the block's closing `});`):
  ```csharp
  entity.HasIndex(e => new { e.ShiftPatternId, e.ServiceDate });
  // Review-queue filter (design spec §2, GetCompletions): status + date-range scan, tenant-scoped.
  entity.HasIndex(e => new { e.TenantId, e.Status, e.ServiceDate });
  ```
  In `RosteringController.cs`, replace `GetCompletions` (the version Task 3 left in place) with
  this narrower-projection version — paging/sort logic is unchanged from Task 3, only the query
  shape changes:
  ```csharp
  [HttpGet("completions")]
  public async Task<ActionResult<ApiResponse<PagedResult<CompletionQueueItemDto>>>> GetCompletions(
      [FromQuery] ShiftStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
      [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
  {
      page = Math.Max(page, 1);
      pageSize = Math.Clamp(pageSize, 1, 200);
      var statusFilter = status ?? ShiftStatus.PendingReview;
      var thresholdMinutes = VarianceReviewMinutes;

      // Narrow projection (critique P2 — "hydrates full graphs") instead of .Include(Participant)/
      // .Include(User): only the fields GetCompletions actually needs, including the three the
      // rostered-time conversion below needs (StartTime/EndTime/EndsNextDay).
      var shiftQuery = _db.Shifts
          .Where(s => s.Status == statusFilter);
      if (from.HasValue) shiftQuery = shiftQuery.Where(s => s.ServiceDate >= from.Value);
      if (to.HasValue) shiftQuery = shiftQuery.Where(s => s.ServiceDate <= to.Value);

      var shiftRows = await shiftQuery
          .Select(s => new
          {
              s.Id, s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay, s.Status, s.ReturnCount,
              ParticipantName = s.Participant != null ? s.Participant.FullName : string.Empty,
              StaffName = s.User != null ? s.User.FullName : string.Empty,
          })
          .ToListAsync(ct);
      var shiftIds = shiftRows.Select(s => s.Id).ToList();

      // Active-completion dictionary lookup stays (Task 6 design decision above) — IsOutlierVariance
      // and the rostered-time conversion need per-row TimeZoneInfo calls EF can't translate to SQL.
      var completionsByShiftId = await _db.ShiftCompletions
          .Where(c => shiftIds.Contains(c.ShiftId) && c.IsActive)
          .ToDictionaryAsync(c => c.ShiftId, ct);

      var items = new List<CompletionQueueItemDto>();
      foreach (var row in shiftRows)
      {
          if (!completionsByShiftId.TryGetValue(row.Id, out var completion)) continue;
          var rosteredShift = new Shift
          {
              ServiceDate = row.ServiceDate, StartTime = row.StartTime, EndTime = row.EndTime, EndsNextDay = row.EndsNextDay,
          };
          var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(rosteredShift, completion.TimeZoneId);
          var isOutlier = ShiftCompletionMapper.IsOutlierVariance(completion.VarianceMinutesStart, completion.VarianceMinutesEnd, thresholdMinutes);
          items.Add(new CompletionQueueItemDto(
              row.Id, completion.Id, row.ParticipantName, row.StaffName,
              row.ServiceDate, rosteredStartUtc, rosteredEndUtc, completion.ActualStart, completion.ActualEnd,
              completion.VarianceMinutesStart, completion.VarianceMinutesEnd, row.Status,
              completion.TimeZoneId, isOutlier, thresholdMinutes, row.ReturnCount));
      }

      var sorted = items
          .OrderByDescending(i => i.IsOutlierVariance)
          .ThenBy(i => i.ServiceDate)
          .ThenBy(i => i.RosteredStart)
          .ToList();

      var totalCount = sorted.Count;
      var paged = sorted.Skip((page - 1) * pageSize).Take(pageSize).ToList();

      return Ok(ApiResponse<PagedResult<CompletionQueueItemDto>>.Ok(
          new PagedResult<CompletionQueueItemDto> { Items = paged, Page = page, PageSize = pageSize, TotalCount = totalCount }));
  }
  ```
  Run `dotnet ef migrations add AddShiftStatusIndex --project Odip.Infrastructure --startup-project Odip.Api`
  from `odip-prototype/odip/backend` (the exact command Task 2 of the PR1 plan used — see
  `docs/plans/2026-09-08-shift-completion-1-state-machine.md`'s Task 2). If it errors with
  "No executable found matching command dotnet-ef": check for
  `odip-prototype/odip/backend/.config/dotnet-tools.json` first — if it exists, run
  `dotnet tool restore`; if not, run `dotnet tool install --global dotnet-ef --version 8.*` and
  retry.
- [ ] **Step 4: Verify the migration is additive-only, then run tests**
  Open the generated `<ts>_AddShiftStatusIndex.cs`. Confirm `Up()` contains exactly one
  `migrationBuilder.CreateIndex(name: "IX_Shifts_TenantId_Status_ServiceDate", table: "Shifts", columns: new[] { "TenantId", "Status", "ServiceDate" })`
  call (or EF's chosen auto-name for that column tuple) and nothing else; confirm `Down()`
  reverses it with one `DropIndex`. Run:
  `dotnet build` (expect clean), then
  `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: PASS — including the two new paging facts.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: PASS.
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Infrastructure/Data/OdipDbContext.cs "odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftStatusIndex.cs" "odip-prototype/odip/backend/Odip.Infrastructure/Migrations/<ts>_AddShiftStatusIndex.Designer.cs" odip-prototype/odip/backend/Odip.Infrastructure/Migrations/OdipDbContextModelSnapshot.cs odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  perf(shift-completion): index + page + project the review queue

  GetCompletions was unpaginated, unindexed on Status, and Included full
  Participant/User graphs (critique P2). Adds a (TenantId, Status, ServiceDate)
  index (migration AddShiftStatusIndex, additive-only after AddShiftCompletion),
  real page/pageSize paging via the existing PagedResult<T>, and narrows the
  Shift query to a name-only .Select() projection. The active-completion
  dictionary lookup stays — IsOutlierVariance and rostered-time conversion need
  per-row TimeZoneInfo calls EF can't translate to SQL.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 7: P3 cleanups — resolver extraction, narrowed `DbUpdateException` catch, `ResolveCurrentUserId` → `Guid?`, lat/long `[Range]`

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs`
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs`
- Modify: `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs` (`[Range]` on `StartShiftDto`/`FinishShiftDto`)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs`
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`

- [ ] **Step 1: Write the failing tests**
  In `RosteringCompletionReviewTests.cs`, add:
  ```csharp
  [Fact]
  public async Task ApproveCompletion_ReviewerIdentityUnresolvable_ReturnsUnauthorizedAUTH_USER_MISSING()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      SeedCompletion(db, shift.Id, staff.Id);
      // No NameIdentifier claim at all — an authenticated-but-claimless principal.
      var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
      {
          ControllerContext = new ControllerContext
          {
              HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity("Test")) }
          }
      };

      var result = await controller.ApproveCompletion(shift.Id, CancellationToken.None);

      var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<ShiftCompletionDto>>(unauthorized.Value);
      Assert.Equal("AUTH_USER_MISSING", body.Code);

      var savedCompletion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id);
      Assert.Null(savedCompletion.ReviewedByUserId); // no partial write on the auth failure
  }
  ```
  In `ShiftCompletionStateMachineTests.cs`, add:
  ```csharp
  [Fact]
  public async Task StartShift_LatitudeOutOfRange_Returns400()
  {
      var (db, tenant) = CreateDb();
      var user = SeedUser(db);
      var participant = SeedParticipant(db);
      var shift = SeedShift(db, participant.Id, user.Id);
      var controller = MakeController(db, tenant.Object, user.Id);
      var context = new ValidationContext(new StartShiftDto { Latitude = 95m });
      var results = new List<ValidationResult>();

      var isValid = Validator.TryValidateObject(new StartShiftDto { Latitude = 95m }, context, results, validateAllProperties: true);

      Assert.False(isValid);
      Assert.Contains(results, r => r.MemberNames.Contains(nameof(StartShiftDto.Latitude)));
  }
  ```
  (This validates the `[Range]` attribute directly via `System.ComponentModel.DataAnnotations`
  rather than through model binding — the same level ASP.NET Core's own binder validates at, and
  the level the ruling's own note says will now emit ASP.NET's generic 400. Add
  `using System.ComponentModel.DataAnnotations;` to the file.)
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests|FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: FAIL — `ApproveCompletion` currently falls back to `Guid.Empty` and proceeds (no
  `UnauthorizedObjectResult`); `StartShiftDto.Latitude` has no `[Range]`, so validation passes.
- [ ] **Step 3: Write minimal implementation**
  **(a) Resolver extraction.** In `PortalController.cs`, add a shared shift-lookup helper
  directly after `ToShiftCompletionDtoAsync` (used by `GetShiftDetail`, `StartShift`,
  `FinishShift`, which currently each repeat the same 6 lines):
  ```csharp
  /// <summary>
  /// Resolves one of the caller's own shifts (Participant included, draft-excluded — same rule
  /// as every portal shift read), or the 404 ActionResult to short-circuit with. Extracted
  /// (critique P3) from the identical block previously duplicated across GetShiftDetail/
  /// StartShift/FinishShift.
  /// </summary>
  private async Task<(Shift? Shift, ActionResult<ApiResponse<PortalShiftDetailDto>>? Error)> ResolveOwnedShiftAsync(Guid id, CancellationToken ct)
  {
      var staffId = await ResolveCurrentStaffIdAsync(ct);
      if (staffId is null)
          return (null, NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found.")));

      var shift = await _db.Shifts
          .Include(s => s.Participant)
          .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
      if (shift?.Participant is null || shift.Participant.IsDraft)
          return (null, NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found.")));

      return (shift, null);
  }
  ```
  Replace the ownership block at the top of `GetShiftDetail`, `StartShift`, and `FinishShift`
  (each currently repeats the same `ResolveCurrentStaffIdAsync` + `_db.Shifts.Include(...)
  .FirstOrDefaultAsync` + null-check) with:
  ```csharp
  var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
  if (error is not null) return error;
  ```
  (`shift` is non-null past this point in all three call sites — the existing `shift!`/direct
  usage below each site is unchanged.)
  In `RosteringController.cs`, add directly after `ToShiftCompletionDtoAsync`:
  ```csharp
  /// <summary>
  /// Resolves a PendingReview shift and its active ShiftCompletion for Approve/Return, or the
  /// ActionResult to short-circuit with. Preserves the existing check order: shift-404 ->
  /// status-409 -> completion-404. Extracted (critique P3) from the identical block previously
  /// duplicated across ApproveCompletion/ReturnCompletion.
  /// </summary>
  private async Task<(Shift? Shift, ShiftCompletion? Completion, ActionResult<ApiResponse<ShiftCompletionDto>>? Error)> ResolvePendingReviewCompletionAsync(Guid shiftId, CancellationToken ct)
  {
      var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == shiftId, ct);
      if (shift is null)
          return (null, null, NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found.")));

      if (shift.Status != ShiftStatus.PendingReview)
          return (null, null, Conflict(ApiResponse<ShiftCompletionDto>.Fail(
              "This shift isn't awaiting review.", ShiftErrorCodes.ShiftNotPendingReview)));

      var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shiftId && c.IsActive, ct);
      if (completion is null)
          return (null, null, NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found.")));

      return (shift, completion, null);
  }
  ```
  Replace the lookup blocks at the top of `ApproveCompletion` and `ReturnCompletion` (each
  currently repeats shift-lookup + status-check + completion-lookup) with:
  ```csharp
  var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(id, ct);
  if (error is not null) return error;
  ```
  **(b) Narrowed `DbUpdateException` catch.** `BookingsAccommodationController.cs:150` already
  establishes the pattern `catch (DbUpdateException ex) when (ex.InnerException is
  PostgresException { SqlState: "23505" })` with `using Npgsql;` — `Npgsql.PostgresException` is
  reachable from `Odip.Api` transitively (`Odip.Api` → `Odip.Infrastructure` →
  `Npgsql.EntityFrameworkCore.PostgreSQL`), confirmed by that existing usage compiling today. In
  `PortalController.cs`, add `using Npgsql;` and replace `StartShift`'s catch (current lines
  238-243):
  ```csharp
  catch (DbUpdateException)
  {
      // Partial unique index IX_ShiftCompletions_ShiftId_Active rejects a racing second Start.
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift can't be started right now.", ShiftErrorCodes.ShiftNotStartable));
  }
  ```
  with:
  ```csharp
  catch (DbUpdateException ex) when (ex.InnerException is PostgresException { ConstraintName: "IX_ShiftCompletions_ShiftId_Active" })
  {
      // Partial unique index IX_ShiftCompletions_ShiftId_Active rejects a racing second Start —
      // narrowed (critique P3) from catching every DbUpdateException, which mapped any
      // unrelated DB failure to the same misleading "can't be started" message.
      return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
          "This shift can't be started right now.", ShiftErrorCodes.ShiftNotStartable));
  }
  ```
  EF Core InMemory does not enforce unique indexes, so no unit test can exercise this narrowed
  `when` clause — the implementer must verify the constraint name literal against the
  `HasIndex(...).HasDatabaseName(...)`/`HasFilter` declaration for `ShiftCompletions` in
  `OdipDbContext` and use the exact name found there.
  **(c) `ResolveCurrentUserId` → `Guid?`.** In `RosteringController.cs`, replace (current lines
  844-848):
  ```csharp
  private Guid ResolveCurrentUserId()
  {
      var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
      return Guid.TryParse(claim, out var id) ? id : Guid.Empty;
  }
  ```
  with:
  ```csharp
  /// <summary>
  /// Null when the caller's JWT has no resolvable NameIdentifier claim — previously silently
  /// fell back to Guid.Empty, which the audit trail would then record as the reviewer (critique
  /// P3). Callers must check for null and 401 rather than proceed.
  /// </summary>
  private Guid? ResolveCurrentUserId()
  {
      var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
      return Guid.TryParse(claim, out var id) ? id : null;
  }
  ```
  In `ApproveCompletion` and `ReturnCompletion`, insert a null-check directly after the
  `ResolvePendingReviewCompletionAsync` call (before any write to `completion`):
  ```csharp
  var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(id, ct);
  if (error is not null) return error;

  var reviewerId = ResolveCurrentUserId();
  if (reviewerId is null)
      return Unauthorized(ApiResponse<ShiftCompletionDto>.Fail(
          "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));
  ```
  and change `completion!.ReviewedByUserId = ResolveCurrentUserId();` to
  `completion!.ReviewedByUserId = reviewerId;` in both actions (`shift`/`completion` are
  non-null past the `error is not null` check in both).
  **(d) `[Range]` on lat/long.** In `ShiftCompletionDTOs.cs`, add `[Range]` to `StartShiftDto`/
  `FinishShiftDto`:
  ```csharp
  public record StartShiftDto
  {
      [Range(-90, 90)]
      public decimal? Latitude { get; init; }
      [Range(-180, 180)]
      public decimal? Longitude { get; init; }
      public bool GeolocationDeclined { get; init; }
  }

  public record FinishShiftDto
  {
      [Range(-90, 90)]
      public decimal? Latitude { get; init; }
      [Range(-180, 180)]
      public decimal? Longitude { get; init; }
      public bool GeolocationDeclined { get; init; }
      public DateTime? ActualStart { get; init; }
  }
  ```
  (`using System.ComponentModel.DataAnnotations;` is already present in this file for
  `ReturnCompletionDto`.) Model-binding will now emit ASP.NET's generic validation-problem 400
  for an out-of-range value submitted through the real HTTP pipeline — this plan's controller-
  level tests call the action methods directly, bypassing model binding, so
  `StartShift_LatitudeOutOfRange_Returns400` (Step 1) validates the attribute in isolation via
  `Validator.TryValidateObject` rather than asserting on `StartShift`'s return value.
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests|FullyQualifiedName~ShiftCompletionStateMachineTests"`
  Expected: PASS.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: PASS — confirm no other test directly asserts on the old `Guid ResolveCurrentUserId()`
  return type or constructs `RosteringController`/`PortalController` in a way this task's
  extraction breaks (it doesn't change any constructor signature).
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Api/Controllers/PortalController.cs odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs odip-prototype/odip/backend/Odip.Tests/Rostering/ShiftCompletionStateMachineTests.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  refactor(shift-completion): P3 cleanups — resolvers, narrowed catch, auth guard, [Range]

  Extracts ResolveOwnedShiftAsync (PortalController) and
  ResolvePendingReviewCompletionAsync (RosteringController) from duplicated
  Start/Finish and Approve/Return lookup blocks. Narrows StartShift's
  DbUpdateException catch to the specific unique-constraint violation instead
  of any DB failure. ResolveCurrentUserId now returns Guid? — a caller with no
  resolvable identity 401s AUTH_USER_MISSING instead of silently auditing as
  Guid.Empty. Adds [Range(-90,90)]/[Range(-180,180)] to Start/FinishShiftDto's
  Latitude/Longitude.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 8: Batch approve (P3)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs` (`ApproveBatchDto`, `ApproveBatchResultDto`)
- Modify: `odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs` (`ApproveBatch`)
- Modify: `odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs`

**Interfaces:**
- Produces: `POST /rostering/completions/approve-batch`, body `ApproveBatchDto(List<Guid> ShiftIds)`.

- [ ] **Step 1: Write the failing tests**
  In `RosteringCompletionReviewTests.cs`, add `using Odip.Infrastructure.Audit;` to the file's
  usings (needed by the audit test below — `AuditAction` is already reachable via the existing
  `Odip.Domain.Enums` using). Then add:
  ```csharp
  [Fact]
  public async Task ApproveBatch_MixedOutcomes_ApprovesValidOnes_ReportsOthers_OneSaveChanges()
  {
      using var db = CreateDb();
      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);

      var ok1 = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      SeedCompletion(db, ok1.Id, staff.Id);
      var ok2 = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      SeedCompletion(db, ok2.Id, staff.Id);
      var notPending = SeedShift(db, participant.Id, staff.Id, ShiftStatus.InProgress);
      SeedCompletion(db, notPending.Id, staff.Id);
      var missingId = Guid.NewGuid();
      var controller = MakeController(db);

      var result = await controller.ApproveBatch(
          new ApproveBatchDto([ok1.Id, ok2.Id, notPending.Id, missingId]), CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<List<ApproveBatchResultDto>>>(ok.Value);
      Assert.Equal(4, body.Data!.Count);
      Assert.True(body.Data.Single(r => r.ShiftId == ok1.Id).Approved);
      Assert.True(body.Data.Single(r => r.ShiftId == ok2.Id).Approved);
      var notPendingResult = body.Data.Single(r => r.ShiftId == notPending.Id);
      Assert.False(notPendingResult.Approved);
      Assert.Equal("SHIFT_NOT_PENDING_REVIEW", notPendingResult.Code);
      var missingResult = body.Data.Single(r => r.ShiftId == missingId);
      Assert.False(missingResult.Approved);
      Assert.Null(missingResult.Code); // 404 path — not-found carries no machine code, matching GetShiftCompletion

      var savedOk1 = await db.Shifts.SingleAsync(s => s.Id == ok1.Id);
      var savedOk2 = await db.Shifts.SingleAsync(s => s.Id == ok2.Id);
      var savedNotPending = await db.Shifts.SingleAsync(s => s.Id == notPending.Id);
      Assert.Equal(ShiftStatus.Completed, savedOk1.Status);
      Assert.Equal(ShiftStatus.Completed, savedOk2.Status);
      Assert.Equal(ShiftStatus.InProgress, savedNotPending.Status); // untouched

      var completion1 = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == ok1.Id);
      Assert.Equal(ReviewOutcome.Approved, completion1.ReviewOutcome);
      Assert.Equal(ReviewerId, completion1.ReviewedByUserId);
  }

  [Fact]
  public async Task ApproveBatch_OtherTenantShift_ReportedAsNotFound()
  {
      var dbName = Guid.NewGuid().ToString();
      var tenantB = Guid.NewGuid();
      var tenantBContext = new Mock<ICurrentTenant>();
      tenantBContext.Setup(t => t.TenantId).Returns(tenantB);
      tenantBContext.Setup(t => t.IsSuperAdmin).Returns(false);
      var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
      Guid otherTenantShiftId;
      using (var seedDb = new OdipDbContext(options, tenantBContext.Object))
      {
          var staff = SeedStaff(seedDb);
          var participant = SeedParticipant(seedDb);
          var shift = SeedShift(seedDb, participant.Id, staff.Id, ShiftStatus.PendingReview);
          SeedCompletion(seedDb, shift.Id, staff.Id);
          otherTenantShiftId = shift.Id;
      }

      var tenantAContext = new Mock<ICurrentTenant>();
      tenantAContext.Setup(t => t.TenantId).Returns(Guid.NewGuid());
      tenantAContext.Setup(t => t.IsSuperAdmin).Returns(false);
      using var db = new OdipDbContext(options, tenantAContext.Object);
      var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString())], "Test");
      var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
      {
          ControllerContext = new ControllerContext
          {
              HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
          }
      };

      var result = await controller.ApproveBatch(new ApproveBatchDto([otherTenantShiftId]), CancellationToken.None);

      var ok = Assert.IsType<OkObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<List<ApproveBatchResultDto>>>(ok.Value);
      Assert.False(Assert.Single(body.Data!).Approved);
  }

  [Fact]
  public async Task ApproveBatch_Approved_WritesAuditLogPerShiftCompletion()
  {
      // Audit coverage needs AuditInterceptor wired (this file's CreateDb() doesn't, since most
      // facts here don't need it) — same construction as Odip.Tests/Audit/ShiftCompletionAuditTests.cs.
      var actingUserId = Guid.NewGuid();
      var tenant = new Mock<ICurrentTenant>();
      tenant.Setup(t => t.TenantId).Returns((Guid?)null);
      tenant.Setup(t => t.IsSuperAdmin).Returns(true);
      var identity = new ClaimsIdentity(
          [new Claim(ClaimTypes.NameIdentifier, actingUserId.ToString()), new Claim("fullName", "Jane Coordinator")], "Test");
      var accessor = new Mock<IHttpContextAccessor>();
      accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
      var options = new DbContextOptionsBuilder<OdipDbContext>()
          .UseInMemoryDatabase(Guid.NewGuid().ToString())
          .AddInterceptors(new AuditInterceptor(accessor.Object))
          .Options;
      using var db = new OdipDbContext(options, tenant.Object);

      var staff = SeedStaff(db);
      var participant = SeedParticipant(db);
      var shift1 = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      var completion1 = SeedCompletion(db, shift1.Id, staff.Id);
      var shift2 = SeedShift(db, participant.Id, staff.Id, ShiftStatus.PendingReview);
      var completion2 = SeedCompletion(db, shift2.Id, staff.Id);
      var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
      {
          ControllerContext = new ControllerContext
          {
              HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
          }
      };

      await controller.ApproveBatch(new ApproveBatchDto([shift1.Id, shift2.Id]), CancellationToken.None);

      var updateLogs = db.AuditLogs
          .Where(a => a.EntityType == nameof(ShiftCompletion) && a.Action == AuditAction.Updated
                      && (a.EntityId == completion1.Id || a.EntityId == completion2.Id))
          .ToList();
      Assert.Equal(2, updateLogs.Count); // one audit row per approved ShiftCompletion, from the single SaveChangesAsync
      Assert.All(updateLogs, l => Assert.Contains("ReviewOutcome", l.Changes));
  }

  [Theory]
  [InlineData(0)]
  [InlineData(101)]
  public async Task ApproveBatch_InvalidSize_Returns400SHIFT_BATCH_SIZE_INVALID(int count)
  {
      using var db = CreateDb();
      var controller = MakeController(db);
      var ids = Enumerable.Range(0, count).Select(_ => Guid.NewGuid()).ToList();

      var result = await controller.ApproveBatch(new ApproveBatchDto(ids), CancellationToken.None);

      var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
      var body = Assert.IsType<ApiResponse<List<ApproveBatchResultDto>>>(badRequest.Value);
      Assert.Equal("SHIFT_BATCH_SIZE_INVALID", body.Code);
  }
  ```
- [ ] **Step 2: Run tests to verify they fail**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: FAIL to compile — `ApproveBatchDto`, `ApproveBatchResultDto`, and
  `RosteringController.ApproveBatch` don't exist yet.
- [ ] **Step 3: Write minimal implementation**
  In `ShiftCompletionDTOs.cs`, append:
  ```csharp
  public record ApproveBatchDto(List<Guid> ShiftIds);

  public record ApproveBatchResultDto(Guid ShiftId, bool Approved, string? Code, string? Message);
  ```
  In `RosteringController.cs`, add directly after `ReturnCompletion`:
  ```csharp
  /// <summary>
  /// Approves up to 100 PendingReview shifts in one call (critique P3 — "no batch approve"; the
  /// queue previously had no way to clear a day's clean submissions at once). Each id follows
  /// exactly the single-approve rules via ResolvePendingReviewCompletionAsync — a failure on one
  /// id doesn't abort the batch. One SaveChangesAsync at the end; overall response is always 200
  /// even when some items failed, since the response body itself reports per-item outcome.
  /// </summary>
  [HttpPost("completions/approve-batch")]
  public async Task<ActionResult<ApiResponse<List<ApproveBatchResultDto>>>> ApproveBatch(
      [FromBody] ApproveBatchDto dto, CancellationToken ct)
  {
      if (dto.ShiftIds is null || dto.ShiftIds.Count == 0 || dto.ShiftIds.Count > 100)
          return BadRequest(ApiResponse<List<ApproveBatchResultDto>>.Fail(
              "Select between 1 and 100 shifts.", ShiftErrorCodes.ShiftBatchSizeInvalid));

      var reviewerId = ResolveCurrentUserId();
      if (reviewerId is null)
          return Unauthorized(ApiResponse<List<ApproveBatchResultDto>>.Fail(
              "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

      var now = DateTime.UtcNow;
      var results = new List<ApproveBatchResultDto>();

      foreach (var shiftId in dto.ShiftIds)
      {
          var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(shiftId, ct);
          if (error is not null)
          {
              var (code, message) = ExtractBatchFailure(error);
              results.Add(new ApproveBatchResultDto(shiftId, false, code, message));
              continue;
          }

          completion!.ReviewedByUserId = reviewerId;
          completion.ReviewedAt = now;
          completion.ReviewOutcome = ReviewOutcome.Approved;
          completion.UpdatedAt = now;

          shift!.Status = ShiftStatus.Completed;
          shift.UpdatedAt = now;

          results.Add(new ApproveBatchResultDto(shiftId, true, null, null));
      }

      await _db.SaveChangesAsync(ct);
      return Ok(ApiResponse<List<ApproveBatchResultDto>>.Ok(results));
  }

  /// <summary>Unwraps the Code/Message a single-approve rejection would have returned, for the batch's per-item report.</summary>
  private static (string? Code, string? Message) ExtractBatchFailure(ActionResult<ApiResponse<ShiftCompletionDto>> error)
  {
      var value = error.Result switch
      {
          ConflictObjectResult conflict => conflict.Value as ApiResponse<ShiftCompletionDto>,
          NotFoundObjectResult notFound => notFound.Value as ApiResponse<ShiftCompletionDto>,
          _ => null,
      };
      return (value?.Code, value?.Errors?.FirstOrDefault());
  }
  ```
- [ ] **Step 4: Run tests to verify they pass**
  Run: `dotnet test Odip.Tests --filter "FullyQualifiedName~RosteringCompletionReviewTests"`
  Expected: PASS — mixed-batch, cross-tenant, and invalid-size facts.
- [ ] **Step 5: Run the full suite**
  Run: `dotnet test Odip.Tests`
  Expected: PASS.
- [ ] **Step 6: Commit**
  ```bash
  git -c safe.directory='*' add odip-prototype/odip/backend/Odip.Application/DTOs/ShiftCompletionDTOs.cs odip-prototype/odip/backend/Odip.Api/Controllers/RosteringController.cs odip-prototype/odip/backend/Odip.Tests/Rostering/RosteringCompletionReviewTests.cs
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  feat(shift-completion): batch approve up to 100 shifts in one call

  POST /rostering/completions/approve-batch takes 1-100 shift ids (else 400
  SHIFT_BATCH_SIZE_INVALID) and approves each via the same rules as single
  approve (ResolvePendingReviewCompletionAsync) — a per-item failure doesn't
  abort the batch, one SaveChangesAsync commits every success, and the
  response is always 200 with a per-item Approved/Code/Message report
  (critique P3 — the queue had no way to clear a day's clean submissions at
  once).

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```

---

### Task 9: Full verification + spec update

**Files:**
- Modify: `docs/specs/2026-09-08-shift-completion-design.md` (§ Error handling, lines 495-519)

- [ ] **Step 1: Full build**
  Run (from `odip-prototype/odip/backend`): `dotnet build Odip.sln`
  Expected: 0 errors, 0 new warnings beyond whatever the tree already carried before this plan.
- [ ] **Step 2: Full test run**
  Run: `dotnet test Odip.Tests`
  Expected: 100% pass, no skips. If anything fails, stop and fix it with a follow-up commit in
  the task that owns the broken area before proceeding — do not patch it here.
- [ ] **Step 3: Update the error table**
  In `docs/specs/2026-09-08-shift-completion-design.md`, replace the "Error handling" table
  (current lines 497-508):
  ```markdown
  | Rule | Status | Code / message |
  |---|---|---|
  | Start on an owned shift already `InProgress` (idempotent replay) | 200 | current `PortalShiftDetailDto`, no writes |
  | Start on an owned shift `PendingReview` | 409 | `SHIFT_ALREADY_FINISHED` |
  | Start on an owned shift `Completed` | 409 | `SHIFT_ALREADY_COMPLETED` |
  | Start on an owned shift `Cancelled` | 409 | `SHIFT_CANCELLED` |
  | Start on an owned shift `Draft` | 409 | `SHIFT_NOT_PUBLISHED` |
  | Start racing a concurrent Start (DB constraint) | 409 | `SHIFT_NOT_STARTABLE` |
  | Finish on an owned shift already `PendingReview` (idempotent replay) | 200 | current `PortalShiftDetailDto`, no writes |
  | Finish on an owned shift `Completed` | 409 | `SHIFT_ALREADY_COMPLETED` |
  | Finish on an owned shift `Cancelled` | 409 | `SHIFT_CANCELLED` |
  | Finish on an owned shift `Draft` | 409 | `SHIFT_NOT_PUBLISHED` |
  | Finish with zero `ShiftNote` rows on the shift | 409 | `SHIFT_NOTE_REQUIRED` |
  | Finish before Start with no `actualStart` supplied, or `Published` with no `actualStart` | 409 | `SHIFT_NOT_IN_PROGRESS` |
  | Manual-start `actualStart` more than 5 minutes in the future | 400 | `SHIFT_ACTUAL_START_IN_FUTURE` |
  | Manual-start `actualStart` more than 24h before the rostered start | 400 | `SHIFT_ACTUAL_START_TOO_EARLY` |
  | Start/Finish on a shift not belonging to the caller | 404 | (never 403 — matches `PortalController`'s existing idiom) |
  | Approve/Return on a shift not `PendingReview` | 409 | `SHIFT_NOT_PENDING_REVIEW` |
  | Return with a blank `reason` | 400 | `SHIFT_RETURN_REASON_REQUIRED` — "A return reason is required." |
  | Return with a `reason` over 500 characters | 400 | `SHIFT_RETURN_REASON_TOO_LONG` — "Return reason must be 500 characters or fewer." |
  | Return on a shift that already has a claim line | 409 | `SHIFT_ALREADY_CLAIMED` (includes `ClaimReference`) — still deferred to PR3, unreachable until then |
  | `UpdateShift` PUT with a `Status` outside Draft/Published/Cancelled↔Draft/Published | 409 | `SHIFT_STATUS_LOCKED` — "This shift's status can only be changed by starting, finishing, approving or returning it." (renamed from `STATUS_TRANSITION_VIA_COMPLETION`) |
  | `UpdateShift` PUT changing rostered times once `InProgress`/`PendingReview`/`Completed` | 409 | `SHIFT_TIMES_LOCKED` |
  | Batch-approve with an empty or >100-id list | 400 | `SHIFT_BATCH_SIZE_INVALID` — "Select between 1 and 100 shifts." |
  | Approve/Return with no resolvable reviewer identity on the JWT | 401 | `AUTH_USER_MISSING` — "Your session is missing a user identity. Sign in again." |
  | Claim-from-shifts with no Completed/unclaimed shifts in range | 400 | "No completed, unclaimed shifts found in this date range." |
  ```
  Directly below the "State-transition matrix" table (current lines 510-519), replace the
  `Cancelled` row:
  ```markdown
  | Cancelled | — | — | — | Coordinator (PUT, un-cancel — hardening plan ruling, see docs/plans/2026-09-09-shift-completion-hardening.md) |
  ```
  with:
  ```markdown
  | Cancelled | — | — | — | Coordinator (PUT, un-cancel now allowed — hardening plan ruling 5) |
  ```
  and add one sentence directly below the matrix noting the ruling:
  ```markdown
  **Un-cancel ruling (post-launch hardening).** The matrix above originally left every
  `Cancelled` cell blank, matching a PUT gate that blocked all transitions out of `Cancelled`.
  The hardening pass (`docs/plans/2026-09-09-shift-completion-hardening.md`, Task 5) allows
  `Cancelled → Draft` and `Cancelled → Published` via `UpdateShift`, restoring the pre-PR-#124
  un-cancel path — every other transition into/out of `InProgress`/`PendingReview`/`Completed`
  remains locked to the completion endpoints (`SHIFT_STATUS_LOCKED`, renamed from
  `STATUS_TRANSITION_VIA_COMPLETION`).
  ```
- [ ] **Step 4: Commit**
  ```bash
  git -c safe.directory='*' add docs/specs/2026-09-08-shift-completion-design.md
  git -c safe.directory='*' commit -m "$(cat <<'EOF'
  docs(shift-completion): update spec error table + un-cancel ruling

  Reflects the hardening pass's new/renamed codes (SHIFT_ALREADY_FINISHED,
  SHIFT_ALREADY_COMPLETED, SHIFT_CANCELLED, SHIFT_NOT_PUBLISHED,
  SHIFT_ACTUAL_START_IN_FUTURE/TOO_EARLY, SHIFT_RETURN_REASON_REQUIRED/
  TOO_LONG, SHIFT_STATUS_LOCKED, SHIFT_BATCH_SIZE_INVALID, AUTH_USER_MISSING)
  and documents the un-cancel ruling that allows Cancelled -> Draft/Published
  via UpdateShift.

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VacPYDpXb2NDDer7SZxQeH
  EOF
  )"
  ```
