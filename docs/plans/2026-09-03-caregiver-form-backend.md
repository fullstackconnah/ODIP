# Caregiver Profile Form — Backend Implementation Plan (cg01 + cg02)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A token-authenticated public API through which a primary caregiver can view, draft, and submit a participant's caregiver-visible profile fields, plus an admin API to issue/revoke links and accept/reject submissions — with nothing unreviewed ever reaching the live participant record.

**Architecture:** A `CaregiverProfileSubmission` entity stages the caregiver's edits as a `PatchParticipantDto` JSON payload. Public endpoints live on a new `CaregiverController` with no `[Authorize]`, resolve tenant and participant from the token row (never from `ICurrentTenant`), and 404 on every failure. Accept sanitises the payload (internal fields overwritten with current values, internal groups nulled) and applies it through `ParticipantPatchApplier` — the existing PATCH logic extracted, behaviour-preserving, from `ParticipantsController.Patch`.

**Tech Stack:** .NET 8, EF Core + Npgsql, xUnit + Moq + EF InMemory, `System.Security.Cryptography`, `System.Text.Json`.

**Spec:** `docs/specs/2026-09-03-caregiver-profile-form-design.md` — read it first; this plan argues from it.

## Global Constraints

- Run all backend commands from `odip-prototype/odip/backend`. Repo root for `git` is `F:\Projects\personal\ODIP`.
- Never touch `bin/`, `obj/`, `_to_delete/`, `odip-prototype.zip`, `docs/superpowers/`.
- **Migrations:** ADD only. Never rename, reorder or edit an existing migration — `Program.cs` has raw-SQL `__EFMigrationsHistory` self-healing pinned to specific IDs.
- **No MediatR handlers, no AutoMapper profiles** — both packages are referenced but unused by design.
- DTOs: `namespace Odip.Application.DTOs;`, `public record`, `{ get; init; }`, feature-named file.
- Tests: xUnit, `Mock<ICurrentTenant>` into `OdipDbContext`, controllers constructed directly with `new`, fixtures inline per file. Every 404 test asserts **both** `NotFoundObjectResult` **and** that the row was not mutated.
- Gates before every commit: `dotnet build` (0 errors) and `dotnet test` (0 failed). Baseline on `main`: **1020 tests**.
- **Before every push:** `git diff HEAD` must be empty. Verify the commit, not the working tree.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV
  ```
- The API Docker image's build context is `backend/` only. **No test may read a file outside `backend/`.**

---

## File Structure

**Branch `feat/cg01-submission-backend`** (Tasks 1–9)

| File | Responsibility |
|---|---|
| Modify `Odip.Api/Controllers/ParticipantsController.cs` | `Patch` delegates to `ParticipantPatchApplier` |
| Create `Odip.Infrastructure/Services/ParticipantPatchApplier.cs` | Static: validate + apply a `PatchParticipantDto` to a `Participant`; returns error string or null |
| Create `Odip.Domain/Enums/CaregiverSubmissionStatus.cs` | `Draft, Submitted, Accepted, Rejected, Revoked` |
| Create `Odip.Domain/Entities/CaregiverProfileSubmission.cs` | The entity, `ITenantEntity` |
| Modify `Odip.Infrastructure/Data/OdipDbContext.cs` | `DbSet` + configuration incl. partial unique index |
| Create `Odip.Infrastructure/Migrations/<ts>_AddCaregiverProfileSubmissions.cs` | Generated |
| Create `Odip.Infrastructure/Services/CaregiverTokenService.cs` | Generate raw token; hash |
| Modify `Odip.Infrastructure/Audit/AuditedEntities.cs` | Add the entity to the allowlist |
| Modify `Odip.Infrastructure/Audit/AuditInterceptor.cs` | Read `HttpContext.Items["AuditActor"]` when unauthenticated |
| Modify `Odip.Api/Program.cs` | `"public"` rate-limit policy |
| Create `Odip.Application/DTOs/CaregiverProfileDTOs.cs` | All DTOs |
| Create `Odip.Api/Controllers/CaregiverController.cs` | Public: GET / PUT draft / POST submit |
| Create `Odip.Api/Controllers/CaregiverSubmissionsController.cs` | Admin: link create/revoke, list, get, accept, reject |
| Create `Odip.Tests/Caregiver/CaregiverTokenServiceTests.cs` | |
| Create `Odip.Tests/Caregiver/CaregiverControllerTests.cs` | |
| Create `Odip.Tests/Caregiver/CaregiverSubmissionsControllerTests.cs` | |

**Branch `feat/cg02-caregiver-projection`** (Tasks 10–12)

| File | Responsibility |
|---|---|
| Create `Odip.Infrastructure/Services/CaregiverFieldPolicy.cs` | `InternalFields` set; projection builder; payload sanitiser |
| Modify `Odip.Api/Controllers/CaregiverController.cs` | GET uses the projection |
| Modify `Odip.Api/Controllers/CaregiverSubmissionsController.cs` | Accept uses the sanitiser |
| Create `Odip.Tests/Caregiver/CaregiverFieldPolicyTests.cs` | Drift guards + sanitiser tests |

---

## Task 1: Extract `ParticipantPatchApplier` (behaviour-preserving)

**Files:**
- Create: `Odip.Infrastructure/Services/ParticipantPatchApplier.cs`
- Modify: `Odip.Api/Controllers/ParticipantsController.cs` (the `Patch` action, currently starting at ~line 1072)
- Test: `Odip.Tests/Controllers/ParticipantsControllerPatchTests.cs` (existing — **must pass unmodified**)

**Interfaces:**
- Produces: `public static Task<string?> ParticipantPatchApplier.ApplyAsync(OdipDbContext db, SafetyNoteSyncService safetyNoteSync, Participant p, PatchParticipantDto dto, CancellationToken ct)` — returns a validation error message, or `null` after a successful `SaveChangesAsync`.

- [x] **Step 1: Confirm the regression net is green before touching anything**

Run: `dotnet test --filter "FullyQualifiedName~ParticipantsControllerPatchTests"`
Expected: `Passed! - Failed: 0, Passed: 24`

- [x] **Step 2: Read the whole `Patch` action**

Open `Odip.Api/Controllers/ParticipantsController.cs` and read from the `[HttpPatch("{id:guid}")]` attribute to the end of the method. Note every private helper it calls (`ValidateNames`, `ValidateGender`, `ValidatePhone`, `ValidateEmail`, `UpsertConsentsAsync`, `UpsertHealthConditionsAsync`, `UpsertAdlAssessmentsAsync`, `UpsertChecklistItemsAsync`, and any `_safetyNoteSync` / `_compatLink` calls). Write the list down — you must move or expose every one of them.

- [x] **Step 3: Create the applier with the body moved verbatim**

Create `Odip.Infrastructure/Services/ParticipantPatchApplier.cs`. Move everything in `Patch` **after** the `if (p == null) return NotFound(...)` line into it. Where the original did `return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(msg))`, the applier does `return msg;`. Where the original reached the end successfully, the applier returns `null`.

```csharp
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The PATCH apply logic, extracted verbatim from ParticipantsController.Patch so the caregiver
/// accept flow (CaregiverSubmissionsController) can apply a sanitised PatchParticipantDto
/// in-process without going through HTTP. Behaviour is identical to the pre-extraction action;
/// ParticipantsControllerPatchTests is the regression net.
/// </summary>
public static class ParticipantPatchApplier
{
    /// <returns>A validation error message to surface as 400, or null on success (changes saved).</returns>
    public static async Task<string?> ApplyAsync(
        OdipDbContext db,
        SafetyNoteSyncService safetyNoteSync,
        Participant p,
        PatchParticipantDto dto,
        CancellationToken ct)
    {
        // ── moved body of ParticipantsController.Patch goes here, verbatim ──
        // Every `return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(X));` becomes `return X;`
        // Every `_db.` becomes `db.`; every `_safetyNoteSync.` becomes `safetyNoteSync.`
        // The final `await _db.SaveChangesAsync(ct);` stays, followed by `return null;`
        // If the original built and returned a ParticipantDetailDto after saving, do NOT move
        // that part — the controller still builds the response DTO itself.
        throw new NotImplementedException("replace with the moved body");
    }

    // Move the private static Validate* helpers and the four Upsert*Async helpers here as
    // `private static` members. If Upsert*Async are instance methods using `_db`, make them
    // take `OdipDbContext db` as their first parameter.
}
```

- [x] **Step 4: Make `Patch` delegate**

Replace the moved body in `ParticipantsController.Patch` with:

```csharp
        var error = await ParticipantPatchApplier.ApplyAsync(_db, _safetyNoteSync, p, dto, ct);
        if (error != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(error));

        // Keep whatever the original did AFTER SaveChangesAsync to build the response —
        // typically a reload and `return Ok(ApiResponse<ParticipantDetailDto>.Ok(ToDetailDto(...)))`.
```

If `Create`/`Update` also call the `Upsert*Async` helpers you moved, change those call sites to `ParticipantPatchApplier.UpsertConsentsAsync(_db, ...)` etc. by making those helpers `internal static` rather than `private static`. Do not duplicate them.

- [x] **Step 5: Build and run the regression net**

Run: `dotnet build && dotnet test --filter "FullyQualifiedName~ParticipantsControllerPatchTests|FullyQualifiedName~ParticipantsControllerTests|FullyQualifiedName~ParticipantsControllerCommunityAccessTests"`
Expected: 0 errors; `Failed: 0`. If any Patch test fails, the extraction changed behaviour — fix the applier, never the test.

- [x] **Step 6: Full suite**

Run: `dotnet test`
Expected: `Passed: 1020, Failed: 0`

- [x] **Step 7: Commit**

```bash
git add Odip.Infrastructure/Services/ParticipantPatchApplier.cs Odip.Api/Controllers/ParticipantsController.cs
git commit -m "refactor(participants): extract PATCH apply logic into ParticipantPatchApplier

Behaviour-preserving extraction so the caregiver accept flow can apply a
PatchParticipantDto in-process. ParticipantsControllerPatchTests unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 2: Entity, enum, DbContext configuration, migration

**Files:**
- Create: `Odip.Domain/Enums/CaregiverSubmissionStatus.cs`
- Create: `Odip.Domain/Entities/CaregiverProfileSubmission.cs`
- Modify: `Odip.Infrastructure/Data/OdipDbContext.cs`
- Create: migration via CLI

**Interfaces:**
- Produces: `CaregiverProfileSubmission` entity; `db.CaregiverProfileSubmissions` DbSet; enum with **int values Draft=0, Submitted=1, Accepted=2, Rejected=3, Revoked=4** (the partial-index filter depends on these).

- [x] **Step 1: Enum**

```csharp
namespace Odip.Domain.Enums;

/// <summary>
/// Lifecycle of a caregiver profile submission. Stored as int; the partial unique index on
/// CaregiverProfileSubmissions filters on the Draft (0) and Submitted (1) values, so these
/// numeric assignments are load-bearing — do not reorder.
/// </summary>
public enum CaregiverSubmissionStatus
{
    Draft = 0,
    Submitted = 1,
    Accepted = 2,
    Rejected = 3,
    Revoked = 4,
}
```

- [x] **Step 2: Entity**

Check `Odip.Domain/Interfaces/ITenantEntity.cs` for its exact members (expect `Guid TenantId { get; set; }`). Then:

```csharp
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A caregiver's staged edits to one participant's caregiver-visible profile, reached via a
/// tokenised public link. Nothing here touches the Participant until an admin accepts it.
/// Tenant-scoped directly (unlike IncidentWitness) because there is no non-tenant parent to
/// inherit scope from. See docs/specs/2026-09-03-caregiver-profile-form-design.md.
/// </summary>
public class CaregiverProfileSubmission : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant Participant { get; set; } = null!;

    /// <summary>Lowercase hex SHA-256 of the raw link token. The raw token is never stored.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public CaregiverSubmissionStatus Status { get; set; } = CaregiverSubmissionStatus.Draft;

    public string? CaregiverName { get; set; }
    public string? CaregiverRelationship { get; set; }

    /// <summary>JSON-serialised PatchParticipantDto. Null until the caregiver first saves.</summary>
    public string? Payload { get; set; }
    public int PayloadVersion { get; set; } = 1;

    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }

    public DateTime? SubmittedAt { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? RejectionNote { get; set; }
}
```

- [x] **Step 3: DbContext**

In `OdipDbContext.cs`, next to the `IncidentWitnesses` DbSet (~line 70):

```csharp
        /// <summary>Caregiver profile form: see <see cref="Entities.CaregiverProfileSubmission"/>.</summary>
        public DbSet<CaregiverProfileSubmission> CaregiverProfileSubmissions => Set<CaregiverProfileSubmission>();
```

In `OnModelCreating`, after the `IncidentWitness` block (~line 617):

```csharp
        // ── CaregiverProfileSubmission (caregiver profile form) ──
        modelBuilder.Entity<CaregiverProfileSubmission>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
            e.Property(x => x.CaregiverName).HasMaxLength(300);
            e.Property(x => x.CaregiverRelationship).HasMaxLength(100);
            e.Property(x => x.Payload).HasColumnType("jsonb");
            e.Property(x => x.RejectionNote).HasMaxLength(4000);

            e.HasOne(x => x.Participant)
                .WithMany()
                .HasForeignKey(x => x.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(x => x.Tenant)
                .WithMany()
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.TenantId);

            // One ACTIVE link per participant, enforced at the database. Status ints:
            // Draft = 0, Submitted = 1 (see CaregiverSubmissionStatus).
            e.HasIndex(x => x.ParticipantId)
                .IsUnique()
                .HasDatabaseName("IX_CaregiverProfileSubmissions_ParticipantId_Active")
                .HasFilter("\"Status\" IN (0, 1)");
        });
```

Add the tenant global query filter the same way every other `ITenantEntity` gets one — find the existing pattern (search `HasQueryFilter` in `OdipDbContext.cs`) and add `CaregiverProfileSubmission` to it identically.

- [x] **Step 4: Build**

Run: `dotnet build`
Expected: 0 errors.

- [x] **Step 5: Generate the migration**

```bash
POSTGRES_CONNECTION_STRING="Host=localhost;Database=odip_design;Username=x;Password=x" \
JWT_SECRET="design-time-only-secret-that-is-at-least-32-chars-long" \
dotnet ef migrations add AddCaregiverProfileSubmissions --project Odip.Infrastructure --startup-project Odip.Api
```

If `Program.cs`'s Firebase guard blocks design-time startup, add an `IDesignTimeDbContextFactory<OdipDbContext>` in `Odip.Infrastructure/Data/OdipDbContextFactory.cs` that builds the context from `POSTGRES_CONNECTION_STRING` alone and a null-tenant `ICurrentTenant` stub — that is a legitimate, common EF pattern and is worth keeping.

- [x] **Step 6: Inspect the generated migration**

Open the new `Odip.Infrastructure/Migrations/<ts>_AddCaregiverProfileSubmissions.cs`. Confirm `Up()` contains `CreateTable("CaregiverProfileSubmissions", ...)`, the `jsonb` column, and a `CreateIndex(... unique: true, filter: "\"Status\" IN (0, 1)")`. Confirm **no other migration file changed** except `OdipDbContextModelSnapshot.cs`:

Run: `git status --short Odip.Infrastructure/Migrations/`
Expected: two new files (`.cs` + `.Designer.cs`) and one modified (`OdipDbContextModelSnapshot.cs`). Nothing else.

- [x] **Step 7: Render and eyeball the SQL**

```bash
POSTGRES_CONNECTION_STRING="Host=localhost;Database=x;Username=x;Password=x" JWT_SECRET="design-time-only-secret-that-is-at-least-32-chars-long" \
dotnet ef migrations script <previous-migration-id> AddCaregiverProfileSubmissions --project Odip.Infrastructure --startup-project Odip.Api --no-build --idempotent
```
(`<previous-migration-id>` is the newest existing migration's full name, e.g. `20260903100734_BackfillParticipantIntakeCompletedAt`.) Confirm the `CREATE UNIQUE INDEX ... WHERE "Status" IN (0, 1)` line is present.

- [x] **Step 8: Test + commit**

Run: `dotnet build && dotnet test`
Expected: 0 errors, `Failed: 0`.

```bash
git add Odip.Domain/Enums/CaregiverSubmissionStatus.cs Odip.Domain/Entities/CaregiverProfileSubmission.cs Odip.Infrastructure/Data/OdipDbContext.cs Odip.Infrastructure/Migrations/
git commit -m "feat(caregiver): CaregiverProfileSubmission entity, status enum, migration

One active link per participant enforced by a partial unique index on
Status IN (Draft, Submitted).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 3: Token service

**Files:**
- Create: `Odip.Infrastructure/Services/CaregiverTokenService.cs`
- Test: `Odip.Tests/Caregiver/CaregiverTokenServiceTests.cs`

**Interfaces:**
- Produces: `public static class CaregiverTokenService { static string GenerateRawToken(); static string Hash(string rawToken); }` — raw token is 43-char base64url; hash is 64-char lowercase hex.

- [x] **Step 1: Failing tests**

```csharp
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverTokenServiceTests
{
    [Fact]
    public void GenerateRawToken_Is43CharBase64Url()
    {
        var t = CaregiverTokenService.GenerateRawToken();
        Assert.Equal(43, t.Length);                       // 32 bytes → 43 chars unpadded
        Assert.Matches("^[A-Za-z0-9_-]+$", t);            // no '+', '/', '='
    }

    [Fact]
    public void GenerateRawToken_IsUniquePerCall()
    {
        var a = CaregiverTokenService.GenerateRawToken();
        var b = CaregiverTokenService.GenerateRawToken();
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Hash_IsDeterministicLowercaseHexSha256()
    {
        var h1 = CaregiverTokenService.Hash("abc");
        var h2 = CaregiverTokenService.Hash("abc");
        Assert.Equal(h1, h2);
        Assert.Equal(64, h1.Length);
        Assert.Matches("^[0-9a-f]+$", h1);
        // SHA-256("abc") is a known vector
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h1);
    }

    [Fact]
    public void Hash_DiffersForDifferentInput()
    {
        Assert.NotEqual(CaregiverTokenService.Hash("a"), CaregiverTokenService.Hash("b"));
    }
}
```

- [x] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverTokenServiceTests"`
Expected: build error — `CaregiverTokenService` does not exist.

- [x] **Step 3: Implement**

```csharp
using System.Security.Cryptography;
using System.Text;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Caregiver link tokens: 32 random bytes, base64url in the link, SHA-256 hex in the database.
/// The raw token exists only in the URL the admin copies; lookup is by hash only.
/// </summary>
public static class CaregiverTokenService
{
    public static string GenerateRawToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static string Hash(string rawToken)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(digest).ToLowerInvariant();
    }
}
```

- [x] **Step 4: Run to confirm pass**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverTokenServiceTests"`
Expected: `Passed: 4`.

- [x] **Step 5: Commit**

```bash
git add Odip.Infrastructure/Services/CaregiverTokenService.cs Odip.Tests/Caregiver/CaregiverTokenServiceTests.cs
git commit -m "feat(caregiver): token generation and hashing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 4: Audit allowlist + anonymous actor override

**Files:**
- Modify: `Odip.Infrastructure/Audit/AuditedEntities.cs`
- Modify: `Odip.Infrastructure/Audit/AuditInterceptor.cs` (the `changedById` / `changedByName` block at ~lines 37–49)
- Test: `Odip.Tests/Audit/AuditInterceptorTests.cs` (create if absent; if an existing audit test file exists, add to it)

**Interfaces:**
- Produces: `HttpContext.Items["AuditActor"]` (a `string`) is used as `ChangedByName` when there is no authenticated user. Public constant `AuditInterceptor.ActorItemKey = "AuditActor"`.

- [x] **Step 1: Allowlist**

In `AuditedEntities.cs`, add `typeof(CaregiverProfileSubmission)` to the `Types` `HashSet<Type>` alongside `typeof(ParticipantNote)`.

- [x] **Step 2: Failing test for the override**

Read `AuditInterceptor.BuildAuditEntries` first to see how it produces `AuditLog` rows, then write a test that saves a `CaregiverProfileSubmission` through a context with the interceptor attached and an `IHttpContextAccessor` whose `HttpContext.User` is unauthenticated and whose `Items["AuditActor"] = "caregiver:Jane Smith"`:

```csharp
[Fact]
public async Task SavingAsAnonymousWithAuditActorItem_AttributesRowToActor()
{
    var http = new DefaultHttpContext();
    http.Items[AuditInterceptor.ActorItemKey] = "caregiver:Jane Smith";
    var accessor = new Mock<IHttpContextAccessor>();
    accessor.Setup(a => a.HttpContext).Returns(http);

    var tenant = new Mock<ICurrentTenant>();
    tenant.Setup(t => t.TenantId).Returns((Guid?)null);
    tenant.Setup(t => t.IsSuperAdmin).Returns(true);

    var options = new DbContextOptionsBuilder<OdipDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .AddInterceptors(new AuditInterceptor(accessor.Object))
        .Options;
    using var db = new OdipDbContext(options, tenant.Object);

    db.CaregiverProfileSubmissions.Add(new CaregiverProfileSubmission
    {
        Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(),
        TokenHash = new string('a', 64), CreatedByUserId = Guid.NewGuid(),
        ExpiresAt = DateTime.UtcNow.AddDays(14),
    });
    await db.SaveChangesAsync();

    var row = await db.Set<AuditLog>().SingleAsync();
    Assert.Null(row.ChangedById);
    Assert.Equal("caregiver:Jane Smith", row.ChangedByName);
}
```

Adjust the `AuditLog` property names (`ChangedById`, `ChangedByName`) to whatever the entity actually calls them — read `Odip.Domain/Entities/AuditLog.cs`.

- [x] **Step 3: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~AuditInterceptorTests"`
Expected: FAIL — `ActorItemKey` undefined, or `ChangedByName` null.

- [x] **Step 4: Implement the override**

In `AuditInterceptor.cs`:

```csharp
    /// <summary>
    /// HttpContext.Items key an anonymous request handler may set to attribute audit rows when
    /// there is no authenticated principal — used by the public caregiver form ("caregiver:{name}").
    /// Ignored whenever a real user is authenticated.
    /// </summary>
    public const string ActorItemKey = "AuditActor";
```

and in the attribution block, after the `if (user?.Identity?.IsAuthenticated == true) { ... }` branch:

```csharp
        else if (_httpContextAccessor.HttpContext?.Items.TryGetValue(ActorItemKey, out var actor) == true
                 && actor is string actorName && !string.IsNullOrWhiteSpace(actorName))
        {
            changedByName = actorName;
        }
```

- [x] **Step 5: Run to confirm pass, then full suite**

Run: `dotnet test --filter "FullyQualifiedName~AuditInterceptorTests"` → `Passed`.
Run: `dotnet test` → `Failed: 0`.

- [x] **Step 6: Commit**

```bash
git add Odip.Infrastructure/Audit/ Odip.Tests/Audit/
git commit -m "feat(audit): audit CaregiverProfileSubmission; allow anonymous actor attribution

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 5: `"public"` rate-limit policy + ReadOnlyMiddleware check

**Files:**
- Modify: `Odip.Api/Program.cs` (the `AddRateLimiter` block, ~lines 207–269)
- Read: `Odip.Api/Middleware/ReadOnlyMiddleware.cs`

- [ ] **Step 1: Add the policy**

Inside the existing `builder.Services.AddRateLimiter(options => { ... })` block, after the `"api"` policy and before the closing `});`:

```csharp
    // Public, token-authenticated caregiver form. Tighter than "api": these routes carry no
    // bearer token, so the only brake on a leaked or guessed link is this limiter.
    options.AddPolicy("public", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: "public:" + RateLimitPartitionKey(context),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
```

- [ ] **Step 2: Read ReadOnlyMiddleware**

Open `Odip.Api/Middleware/ReadOnlyMiddleware.cs`. Find the role check. If it is `context.User.IsInRole("ReadOnly")` — an anonymous principal returns `false`, so anonymous PUT/POST pass through and **no change is needed**; record that finding in the commit message. If instead it blocks any write from a principal that is *not authenticated*, add, before the role check:

```csharp
        if (context.User?.Identity?.IsAuthenticated != true)
        {
            await _next(context);
            return;
        }
```

- [ ] **Step 3: Build + commit**

Run: `dotnet build` → 0 errors.

```bash
git add Odip.Api/Program.cs Odip.Api/Middleware/ReadOnlyMiddleware.cs
git commit -m "feat(caregiver): 'public' rate-limit policy for token-authenticated routes

ReadOnlyMiddleware: <state what you found — passes anonymous writes / changed>.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 6: DTOs

**Files:**
- Create: `Odip.Application/DTOs/CaregiverProfileDTOs.cs`

**Interfaces:**
- Produces every DTO the two controllers and the frontend use. Field names are the wire contract for the frontend plan.

- [ ] **Step 1: Write the file**

```csharp
using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// CAREGIVER PROFILE FORM DTOs — docs/specs/2026-09-03-caregiver-profile-form-design.md
// ══════════════════════════════════════════════════════════════
//
// Public (token) side: what the caregiver sees and sends. The participant projection is a
// JSON object built by CaregiverFieldPolicy (cg02) — never ParticipantDetailDto — so internal
// fields cannot leak by construction. The payload IS a PatchParticipantDto: the caregiver wizard
// builds it exactly as the Profile wizard does, and accept applies it through the same code.
//
// Admin side: link issue/revoke and the submission review lifecycle.

// ── Public ────────────────────────────────────────────────

public record CaregiverFormDto
{
    public CaregiverSubmissionStatus Status { get; init; }
    public string? CaregiverName { get; init; }
    public string? CaregiverRelationship { get; init; }
    public DateTime ExpiresAt { get; init; }
    public string? RejectionNote { get; init; }

    /// <summary>Caregiver-visible current values, keyed by ParticipantDetailDto JSON property name.</summary>
    public System.Text.Json.Nodes.JsonObject Current { get; init; } = new();

    /// <summary>Field ids (allocation-contract ids) the caregiver may edit. Everything else in Current is read-only.</summary>
    public IReadOnlyList<string> Editable { get; init; } = Array.Empty<string>();

    /// <summary>The caregiver's saved draft, if any.</summary>
    public PatchParticipantDto? Draft { get; init; }
}

public record CaregiverDraftDto
{
    [Required, StringLength(300)] public string CaregiverName { get; init; } = string.Empty;
    [StringLength(100)] public string? CaregiverRelationship { get; init; }
    [Required] public PatchParticipantDto Payload { get; init; } = new();
}

// ── Admin ─────────────────────────────────────────────────

public record CaregiverLinkDto
{
    /// <summary>Raw token. Returned ONCE, at creation. The frontend composes the URL as {origin}/caregiver/{token}.</summary>
    public string Token { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
}

public record CaregiverSubmissionListItemDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public CaregiverSubmissionStatus Status { get; init; }
    public string? CaregiverName { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public DateTime? SubmittedAt { get; init; }
}

public record CaregiverSubmissionDetailDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public CaregiverSubmissionStatus Status { get; init; }
    public string? CaregiverName { get; init; }
    public string? CaregiverRelationship { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public DateTime? SubmittedAt { get; init; }
    public DateTime? ReviewedAt { get; init; }
    public string? RejectionNote { get; init; }

    /// <summary>Same projection the caregiver saw — the "current" side of the diff.</summary>
    public System.Text.Json.Nodes.JsonObject Current { get; init; } = new();

    /// <summary>The caregiver's submitted payload — the "proposed" side of the diff.</summary>
    public PatchParticipantDto? Payload { get; init; }
}

public record RejectCaregiverSubmissionDto
{
    [Required, StringLength(4000)] public string Note { get; init; } = string.Empty;
}
```

- [ ] **Step 2: Build + commit**

Run: `dotnet build` → 0 errors.

```bash
git add Odip.Application/DTOs/CaregiverProfileDTOs.cs
git commit -m "feat(caregiver): DTOs for the public form and admin review

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 7: Public `CaregiverController`

**Files:**
- Create: `Odip.Api/Controllers/CaregiverController.cs`
- Test: `Odip.Tests/Caregiver/CaregiverControllerTests.cs`

**Interfaces:**
- Consumes: `CaregiverTokenService.Hash`, `AuditInterceptor.ActorItemKey`, the DTOs from Task 6.
- Produces: `GET/PUT draft/POST submit` under `api/v1/public/caregiver/{token}`. For cg01 the `Current` projection is a **placeholder empty object** with `Editable` empty — Task 11 replaces it. Everything else is final.

- [ ] **Step 1: Failing tests — the 404 matrix and the name gate**

```csharp
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
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverControllerTests
{
    private static OdipDbContext CreateDb()
    {
        // Public routes carry no principal: model that with a null-tenant, non-superadmin tenant
        // service so the global query filter would HIDE everything — proving the controller must
        // use IgnoreQueryFilters() with explicit TenantId matching, not the ambient filter.
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static CaregiverController MakeController(OdipDbContext db)
    {
        var accessor = new Mock<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        accessor.Setup(a => a.HttpContext).Returns(http);
        var controller = new CaregiverController(db, accessor.Object);
        controller.ControllerContext = new ControllerContext { HttpContext = http };
        return controller;
    }

    private static (Participant p, CaregiverProfileSubmission s, string rawToken) Seed(
        OdipDbContext db, CaregiverSubmissionStatus status = CaregiverSubmissionStatus.Draft,
        DateTime? expiresAt = null, Guid? tenantId = null)
    {
        var tid = tenantId ?? Guid.NewGuid();
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tid, FirstName = "Sophie", LastName = "Brown", IsActive = true,
            PlanType = PlanType.SelfManaged, OvernightSupport = OvernightSupportType.None,
            OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        };
        db.Participants.Add(p);
        var raw = CaregiverTokenService.GenerateRawToken();
        var s = new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(), TenantId = tid, ParticipantId = p.Id,
            TokenHash = CaregiverTokenService.Hash(raw), Status = status,
            CreatedByUserId = Guid.NewGuid(), ExpiresAt = expiresAt ?? DateTime.UtcNow.AddDays(14),
        };
        db.CaregiverProfileSubmissions.Add(s);
        db.SaveChanges();
        return (p, s, raw);
    }

    [Fact]
    public async Task Get_ValidDraftToken_ReturnsForm()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<CaregiverFormDto>>(ok.Value);
        Assert.Equal(CaregiverSubmissionStatus.Draft, body.Data!.Status);
        Assert.Equal(s.ExpiresAt, body.Data.ExpiresAt);
    }

    [Fact]
    public async Task Get_UnknownToken_Returns404()
    {
        using var db = CreateDb();
        Seed(db);
        var result = await MakeController(db).Get("not-a-real-token", CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Theory]
    [InlineData(CaregiverSubmissionStatus.Revoked)]
    [InlineData(CaregiverSubmissionStatus.Accepted)]
    public async Task Get_DeadStatus_Returns404(CaregiverSubmissionStatus status)
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, status);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_ExpiredToken_Returns404()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, expiresAt: DateTime.UtcNow.AddMinutes(-1));
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_ParticipantDeleted_Returns404()
    {
        using var db = CreateDb();
        var (p, _, raw) = Seed(db);
        db.Participants.Remove(p);
        await db.SaveChangesAsync();
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task Get_SubmittedToken_ReturnsFormReadOnlyStatus()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db).Get(raw, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<CaregiverFormDto>>(ok.Value);
        Assert.Equal(CaregiverSubmissionStatus.Submitted, body.Data!.Status);
    }

    [Fact]
    public async Task SaveDraft_EmptyName_Returns400AndDoesNotSave()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var result = await MakeController(db).SaveDraft(raw,
            new CaregiverDraftDto { CaregiverName = "  ", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result);
        var reloaded = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Null(reloaded.Payload);
        Assert.Null(reloaded.CaregiverName);
    }

    [Fact]
    public async Task SaveDraft_Valid_PersistsNameAndPayload()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var payload = new PatchParticipantDto { AboutMe = new PatchAboutMeDto { PersonalInterests = "Gardening" } };
        var result = await MakeController(db).SaveDraft(raw,
            new CaregiverDraftDto { CaregiverName = "Jane Smith", CaregiverRelationship = "Mother", Payload = payload },
            CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloaded = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Equal("Jane Smith", reloaded.CaregiverName);
        Assert.Contains("Gardening", reloaded.Payload);
        Assert.Equal(CaregiverSubmissionStatus.Draft, reloaded.Status);
    }

    [Fact]
    public async Task SaveDraft_AfterSubmit_Returns409()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db).SaveDraft(raw,
            new CaregiverDraftDto { CaregiverName = "Jane", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Submit_Valid_SetsSubmittedAndTimestamp()
    {
        using var db = CreateDb();
        var (_, s, raw) = Seed(db);
        var result = await MakeController(db).Submit(raw,
            new CaregiverDraftDto { CaregiverName = "Jane Smith", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<NoContentResult>(result);
        var reloaded = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
        Assert.Equal(CaregiverSubmissionStatus.Submitted, reloaded.Status);
        Assert.NotNull(reloaded.SubmittedAt);
    }

    [Fact]
    public async Task Submit_Twice_Returns409()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db, CaregiverSubmissionStatus.Submitted);
        var result = await MakeController(db).Submit(raw,
            new CaregiverDraftDto { CaregiverName = "Jane", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Submit_SetsAuditActorItem()
    {
        using var db = CreateDb();
        var (_, _, raw) = Seed(db);
        var controller = MakeController(db);
        await controller.Submit(raw,
            new CaregiverDraftDto { CaregiverName = "Jane Smith", Payload = new PatchParticipantDto() }, CancellationToken.None);
        Assert.Equal("caregiver:Jane Smith", controller.HttpContext.Items[Odip.Infrastructure.Audit.AuditInterceptor.ActorItemKey]);
    }
}
```

If `PatchAboutMeDto.PersonalInterests` is not the real member name, use any string member of any `Patch*Dto` group — the test only needs the payload to serialise with a recognisable value.

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverControllerTests"`
Expected: build error — `CaregiverController` does not exist.

- [ ] **Step 3: Implement**

```csharp
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The caregiver-facing half of the caregiver profile form. NO class-level [Authorize] — these
/// routes are reached by a family member with no ODIP account, authenticated solely by the link
/// token. Tenant and participant resolve from the token row: this controller never reads
/// ICurrentTenant (which is built from JWT claims/headers and is empty here) and never honours
/// X-View-As-*. Every failure is a 404 so a probing caller cannot distinguish "no such token"
/// from "expired", "revoked", "already accepted" or "another tenant's".
/// See docs/specs/2026-09-03-caregiver-profile-form-design.md §2.
/// </summary>
[ApiController]
[Route("api/v1/public/caregiver")]
[EnableRateLimiting("public")]
public class CaregiverController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IHttpContextAccessor _http;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public CaregiverController(OdipDbContext db, IHttpContextAccessor http)
    {
        _db = db;
        _http = http;
    }

    private const string NotFoundMessage = "This link is not valid.";

    /// <summary>The one lookup. Existence, liveness, expiry and participant presence all in one query.</summary>
    private async Task<(CaregiverProfileSubmission sub, Participant p)?> ResolveLiveAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var hash = CaregiverTokenService.Hash(token);
        var now = DateTime.UtcNow;
        var sub = await _db.CaregiverProfileSubmissions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TokenHash == hash
                && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted)
                && s.ExpiresAt > now, ct);
        if (sub == null) return null;

        var p = await _db.Participants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.Id == sub.ParticipantId && x.TenantId == sub.TenantId, ct);
        if (p == null) return null;
        return (sub, p);
    }

    [HttpGet("{token}")]
    public async Task<ActionResult<ApiResponse<CaregiverFormDto>>> Get(string token, CancellationToken ct)
    {
        var live = await ResolveLiveAsync(token, ct);
        if (live is null) return NotFound(ApiResponse<CaregiverFormDto>.Fail(NotFoundMessage));
        var (sub, p) = live.Value;

        var dto = new CaregiverFormDto
        {
            Status = sub.Status,
            CaregiverName = sub.CaregiverName,
            CaregiverRelationship = sub.CaregiverRelationship,
            ExpiresAt = sub.ExpiresAt,
            RejectionNote = sub.RejectionNote,
            Current = BuildProjection(p),
            Editable = EditableFields(),
            Draft = sub.Payload is null ? null : JsonSerializer.Deserialize<PatchParticipantDto>(sub.Payload, Json),
        };
        return Ok(ApiResponse<CaregiverFormDto>.Ok(dto));
    }

    [HttpPut("{token}/draft")]
    public Task<IActionResult> SaveDraft(string token, [FromBody] CaregiverDraftDto body, CancellationToken ct)
        => WriteAsync(token, body, submit: false, ct);

    [HttpPost("{token}/submit")]
    public Task<IActionResult> Submit(string token, [FromBody] CaregiverDraftDto body, CancellationToken ct)
        => WriteAsync(token, body, submit: true, ct);

    private async Task<IActionResult> WriteAsync(string token, CaregiverDraftDto body, bool submit, CancellationToken ct)
    {
        var live = await ResolveLiveAsync(token, ct);
        if (live is null) return NotFound(ApiResponse<object>.Fail(NotFoundMessage));
        var (sub, _) = live.Value;

        if (string.IsNullOrWhiteSpace(body.CaregiverName))
            return BadRequest(ApiResponse<object>.Fail("Please enter your name before continuing."));
        if (sub.Status != CaregiverSubmissionStatus.Draft)
            return Conflict(ApiResponse<object>.Fail("This form has already been submitted and is awaiting review."));

        sub.CaregiverName = body.CaregiverName.Trim();
        sub.CaregiverRelationship = string.IsNullOrWhiteSpace(body.CaregiverRelationship) ? null : body.CaregiverRelationship.Trim();
        sub.Payload = JsonSerializer.Serialize(body.Payload, Json);
        if (submit)
        {
            sub.Status = CaregiverSubmissionStatus.Submitted;
            sub.SubmittedAt = DateTime.UtcNow;
        }

        // Attribute the audit row to the caregiver — there is no authenticated principal here.
        HttpContext.Items[AuditInterceptor.ActorItemKey] = $"caregiver:{sub.CaregiverName}";
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    // cg02 (Task 11) replaces these two with CaregiverFieldPolicy.
    private static System.Text.Json.Nodes.JsonObject BuildProjection(Participant p) => new();
    private static IReadOnlyList<string> EditableFields() => Array.Empty<string>();
}
```

Register `IHttpContextAccessor` if not already: search `Program.cs` for `AddHttpContextAccessor` — it is already present because `CurrentTenant` and `AuditInterceptor` depend on it.

- [ ] **Step 4: Run tests**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverControllerTests"`
Expected: all pass. If `HttpContext.Items` is null in the actor test, ensure `MakeController` sets `ControllerContext.HttpContext` (it does above).

- [ ] **Step 5: Full suite + commit**

Run: `dotnet test` → `Failed: 0`.

```bash
git add Odip.Api/Controllers/CaregiverController.cs Odip.Tests/Caregiver/CaregiverControllerTests.cs
git commit -m "feat(caregiver): public token-authenticated form endpoints

GET / PUT draft / POST submit under api/v1/public/caregiver/{token}. Tenant and
participant resolve from the token row with IgnoreQueryFilters and an explicit
TenantId match; every failure is a 404.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 8: Admin `CaregiverSubmissionsController`

**Files:**
- Create: `Odip.Api/Controllers/CaregiverSubmissionsController.cs`
- Test: `Odip.Tests/Caregiver/CaregiverSubmissionsControllerTests.cs`

**Interfaces:**
- Consumes: `ParticipantPatchApplier.ApplyAsync` (Task 1), `CaregiverTokenService`, DTOs (Task 6), `IConfiguration["Caregiver:LinkExpiryDays"]` (default 14).
- Produces the six admin endpoints in the spec §3. For cg01, `Accept` applies the payload **unsanitised** — Task 12 adds the sanitiser call. `Get` returns `Current = new JsonObject()` — Task 11 fills it.

- [ ] **Step 1: Failing tests**

Mirror `IncidentsControllerTests`' tenant-scoped helper. Key tests:

```csharp
[Fact]
public async Task CreateLink_RevokesExistingActiveAndReturnsRawTokenOnce()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    var controller = MakeController(db, tenantId, userId: Guid.NewGuid());

    var first = await controller.CreateLink(p.Id, CancellationToken.None);
    var firstBody = Assert.IsType<ApiResponse<CaregiverLinkDto>>(Assert.IsType<OkObjectResult>(first.Result).Value);
    Assert.Equal(43, firstBody.Data!.Token.Length);

    var second = await controller.CreateLink(p.Id, CancellationToken.None);
    Assert.IsType<OkObjectResult>(second.Result);

    var rows = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().Where(s => s.ParticipantId == p.Id).ToListAsync();
    Assert.Equal(2, rows.Count);
    Assert.Single(rows, r => r.Status == CaregiverSubmissionStatus.Draft);
    Assert.Single(rows, r => r.Status == CaregiverSubmissionStatus.Revoked);
    // The raw token is never stored.
    Assert.DoesNotContain(rows, r => r.TokenHash == firstBody.Data.Token);
}

[Fact]
public async Task CreateLink_OtherTenantsParticipant_Returns404()
{
    var (db, tenantId) = CreateTenantDb();
    var foreign = SeedParticipant(db, Guid.NewGuid());
    var result = await MakeController(db, tenantId, Guid.NewGuid()).CreateLink(foreign.Id, CancellationToken.None);
    Assert.IsType<NotFoundObjectResult>(result.Result);
    Assert.Empty(await db.CaregiverProfileSubmissions.IgnoreQueryFilters().ToListAsync());
}

[Fact]
public async Task RevokeLink_SetsRevoked()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Draft);
    var result = await MakeController(db, tenantId, Guid.NewGuid()).RevokeLink(p.Id, CancellationToken.None);
    Assert.IsType<NoContentResult>(result);
    Assert.Equal(CaregiverSubmissionStatus.Revoked, (await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id)).Status);
}

[Fact]
public async Task List_DefaultsToSubmitted_TenantScoped()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted);
    SeedSubmission(db, tenantId, SeedParticipant(db, tenantId).Id, CaregiverSubmissionStatus.Draft);
    SeedSubmission(db, Guid.NewGuid(), SeedParticipant(db, Guid.NewGuid()).Id, CaregiverSubmissionStatus.Submitted);
    var result = await MakeController(db, tenantId, Guid.NewGuid()).List(null, CancellationToken.None);
    var body = Assert.IsType<ApiResponse<List<CaregiverSubmissionListItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
    Assert.Single(body.Data!);
    Assert.Equal(p.Id, body.Data![0].ParticipantId);
}

[Fact]
public async Task Accept_AppliesPayloadViaPatchAndMarksAccepted()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    var payload = new PatchParticipantDto { AboutMe = new PatchAboutMeDto { PersonalInterests = "Gardening" } };
    var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted, payload);
    var reviewer = Guid.NewGuid();
    var result = await MakeController(db, tenantId, reviewer).Accept(s.Id, CancellationToken.None);
    Assert.IsType<NoContentResult>(result);
    var reloadedSub = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
    Assert.Equal(CaregiverSubmissionStatus.Accepted, reloadedSub.Status);
    Assert.Equal(reviewer, reloadedSub.ReviewedByUserId);
    var reloadedP = await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id);
    Assert.Equal("Gardening", reloadedP.PersonalInterests);
}

[Fact]
public async Task Accept_NotSubmitted_Returns409AndDoesNotApply()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    var payload = new PatchParticipantDto { AboutMe = new PatchAboutMeDto { PersonalInterests = "Gardening" } };
    var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Draft, payload);
    var result = await MakeController(db, tenantId, Guid.NewGuid()).Accept(s.Id, CancellationToken.None);
    Assert.IsType<ConflictObjectResult>(result);
    Assert.Null((await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id)).PersonalInterests);
}

[Fact]
public async Task Reject_RequiresNote_ReopensAsDraft_ExtendsExpiry()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted);
    var oldExpiry = s.ExpiresAt;
    var controller = MakeController(db, tenantId, Guid.NewGuid());

    Assert.IsType<BadRequestObjectResult>(await controller.Reject(s.Id, new RejectCaregiverSubmissionDto { Note = " " }, CancellationToken.None));

    var result = await controller.Reject(s.Id, new RejectCaregiverSubmissionDto { Note = "Please check the phone number." }, CancellationToken.None);
    Assert.IsType<NoContentResult>(result);
    var r = await db.CaregiverProfileSubmissions.IgnoreQueryFilters().SingleAsync(x => x.Id == s.Id);
    Assert.Equal(CaregiverSubmissionStatus.Draft, r.Status);
    Assert.Null(r.SubmittedAt);
    Assert.Equal("Please check the phone number.", r.RejectionNote);
    Assert.True(r.ExpiresAt > oldExpiry);
    Assert.Equal(s.TokenHash, r.TokenHash);   // same link keeps working
}

[Fact]
public void IsRoleGated_AdminCoordinatorSuperAdmin()
{
    var attr = typeof(CaregiverSubmissionsController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
        .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>().Single();
    Assert.Equal("Admin,Coordinator,SuperAdmin", attr.Roles);
}
```

Write `CreateTenantDb`, `SeedParticipant`, `SeedSubmission(db, tenantId, participantId, status, PatchParticipantDto? payload = null)` and `MakeController(db, tenantId, userId)` helpers inline. `MakeController` must set a `ClaimsPrincipal` with a `sub`/`NameIdentifier` claim equal to `userId` on `ControllerContext.HttpContext.User` — read how `PortalControllerTests.MakeController` fakes the current user and copy that.

- [ ] **Step 2: Run to confirm failure**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverSubmissionsControllerTests"` → build error.

- [ ] **Step 3: Implement**

```csharp
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Admin half of the caregiver profile form: issue and revoke links, list and review
/// submissions, accept (apply via ParticipantPatchApplier) or reject (reopen the link).
/// Role gate matches PATCH /participants/{id}. Tenant scoping comes from the ambient query
/// filter — a wrong-tenant participant or submission simply isn't found.
/// </summary>
[ApiController]
[Route("api/v1/caregiver-submissions")]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
public class CaregiverSubmissionsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    private readonly int _expiryDays;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public CaregiverSubmissionsController(OdipDbContext db, ICurrentTenant tenant, SafetyNoteSyncService safetyNoteSync, IConfiguration config)
    {
        _db = db;
        _tenant = tenant;
        _safetyNoteSync = safetyNoteSync;
        _expiryDays = config.GetValue<int?>("Caregiver:LinkExpiryDays") ?? 14;
    }

    private Guid CurrentUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return Guid.TryParse(raw, out var id) ? id : Guid.Empty;
    }

    // ── Links ──────────────────────────────────────────────

    [HttpPost("/api/v1/participants/{participantId:guid}/caregiver-link")]
    public async Task<ActionResult<ApiResponse<CaregiverLinkDto>>> CreateLink(Guid participantId, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (p == null) return NotFound(ApiResponse<CaregiverLinkDto>.Fail("Participant not found"));

        var active = await _db.CaregiverProfileSubmissions
            .Where(s => s.ParticipantId == participantId
                && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted))
            .ToListAsync(ct);
        foreach (var a in active) a.Status = CaregiverSubmissionStatus.Revoked;

        var raw = CaregiverTokenService.GenerateRawToken();
        var sub = new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(),
            TenantId = p.TenantId,
            ParticipantId = p.Id,
            TokenHash = CaregiverTokenService.Hash(raw),
            Status = CaregiverSubmissionStatus.Draft,
            CreatedByUserId = CurrentUserId(),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(_expiryDays),
        };
        _db.CaregiverProfileSubmissions.Add(sub);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<CaregiverLinkDto>.Ok(new CaregiverLinkDto { Token = raw, ExpiresAt = sub.ExpiresAt }));
    }

    [HttpDelete("/api/v1/participants/{participantId:guid}/caregiver-link")]
    public async Task<IActionResult> RevokeLink(Guid participantId, CancellationToken ct)
    {
        var active = await _db.CaregiverProfileSubmissions
            .Where(s => s.ParticipantId == participantId
                && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted))
            .ToListAsync(ct);
        if (active.Count == 0) return NotFound(ApiResponse<object>.Fail("No active caregiver link"));
        foreach (var a in active) a.Status = CaregiverSubmissionStatus.Revoked;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ── Submissions ────────────────────────────────────────

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<CaregiverSubmissionListItemDto>>>> List([FromQuery] CaregiverSubmissionStatus? status, CancellationToken ct)
    {
        var effective = status ?? CaregiverSubmissionStatus.Submitted;
        var rows = await _db.CaregiverProfileSubmissions
            .Include(s => s.Participant)
            .Where(s => s.Status == effective)
            .OrderByDescending(s => s.SubmittedAt ?? s.CreatedAt)
            .Select(s => new CaregiverSubmissionListItemDto
            {
                Id = s.Id, ParticipantId = s.ParticipantId,
                ParticipantName = s.Participant.FirstName + " " + s.Participant.LastName,
                Status = s.Status, CaregiverName = s.CaregiverName,
                CreatedAt = s.CreatedAt, ExpiresAt = s.ExpiresAt, SubmittedAt = s.SubmittedAt,
            })
            .ToListAsync(ct);
        return Ok(ApiResponse<List<CaregiverSubmissionListItemDto>>.Ok(rows));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<CaregiverSubmissionDetailDto>>> Get(Guid id, CancellationToken ct)
    {
        var s = await _db.CaregiverProfileSubmissions.Include(x => x.Participant).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<CaregiverSubmissionDetailDto>.Fail("Submission not found"));

        var dto = new CaregiverSubmissionDetailDto
        {
            Id = s.Id, ParticipantId = s.ParticipantId,
            ParticipantName = s.Participant.FirstName + " " + s.Participant.LastName,
            Status = s.Status, CaregiverName = s.CaregiverName, CaregiverRelationship = s.CaregiverRelationship,
            CreatedAt = s.CreatedAt, ExpiresAt = s.ExpiresAt, SubmittedAt = s.SubmittedAt,
            ReviewedAt = s.ReviewedAt, RejectionNote = s.RejectionNote,
            Current = BuildProjection(s.Participant),
            Payload = s.Payload is null ? null : JsonSerializer.Deserialize<PatchParticipantDto>(s.Payload, Json),
        };
        return Ok(ApiResponse<CaregiverSubmissionDetailDto>.Ok(dto));
    }

    [HttpPost("{id:guid}/accept")]
    public async Task<IActionResult> Accept(Guid id, CancellationToken ct)
    {
        var s = await _db.CaregiverProfileSubmissions.Include(x => x.Participant).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<object>.Fail("Submission not found"));
        if (s.Status != CaregiverSubmissionStatus.Submitted)
            return Conflict(ApiResponse<object>.Fail("Only a submitted form can be accepted."));
        if (s.Payload is null)
            return BadRequest(ApiResponse<object>.Fail("This submission has no content."));

        var payload = JsonSerializer.Deserialize<PatchParticipantDto>(s.Payload, Json) ?? new PatchParticipantDto();
        payload = Sanitise(payload, s.Participant);   // cg02 Task 12 implements; identity for now

        var error = await ParticipantPatchApplier.ApplyAsync(_db, _safetyNoteSync, s.Participant, payload, ct);
        if (error != null) return BadRequest(ApiResponse<object>.Fail(error));

        s.Status = CaregiverSubmissionStatus.Accepted;
        s.ReviewedByUserId = CurrentUserId();
        s.ReviewedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/reject")]
    public async Task<IActionResult> Reject(Guid id, [FromBody] RejectCaregiverSubmissionDto body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Note))
            return BadRequest(ApiResponse<object>.Fail("A note explaining what to fix is required."));
        var s = await _db.CaregiverProfileSubmissions.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<object>.Fail("Submission not found"));
        if (s.Status != CaregiverSubmissionStatus.Submitted)
            return Conflict(ApiResponse<object>.Fail("Only a submitted form can be rejected."));

        s.Status = CaregiverSubmissionStatus.Draft;
        s.SubmittedAt = null;
        s.RejectionNote = body.Note.Trim();
        s.ReviewedByUserId = CurrentUserId();
        s.ReviewedAt = DateTime.UtcNow;
        s.ExpiresAt = DateTime.UtcNow.AddDays(_expiryDays);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    // cg02 (Tasks 11–12) replaces both of these with CaregiverFieldPolicy.
    private static System.Text.Json.Nodes.JsonObject BuildProjection(Participant p) => new();
    private static PatchParticipantDto Sanitise(PatchParticipantDto dto, Participant p) => dto;
}
```

`ParticipantPatchApplier.ApplyAsync` saves changes itself (it moved the `SaveChangesAsync`), so the subsequent status update is a second save — that is fine and keeps the applier's contract identical to the original action.

- [ ] **Step 4: Run tests, full suite, commit**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverSubmissionsControllerTests"` → all pass.
Run: `dotnet test` → `Failed: 0`.

```bash
git add Odip.Api/Controllers/CaregiverSubmissionsController.cs Odip.Tests/Caregiver/CaregiverSubmissionsControllerTests.cs
git commit -m "feat(caregiver): admin link issue/revoke and submission review endpoints

Accept applies the payload via ParticipantPatchApplier; reject reopens the same
link with a note and a fresh expiry.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 9: cg01 gates, push, PR

- [ ] **Step 1: Full gates**

Run: `dotnet build && dotnet test`
Expected: 0 errors; `Failed: 0`; Passed ≥ 1020 + your new tests.

- [ ] **Step 2: Verify committed state**

Run: `git diff HEAD --stat` → empty. `git status --short` shows nothing except possibly `.claude/settings.local.json` (never stage that).

- [ ] **Step 3: Push and PR**

```bash
git push -u origin feat/cg01-submission-backend
gh pr create --base main --title "feat(caregiver): submission entity, public token API, admin review API (cg01)" --body-file <write a body covering: the ParticipantPatchApplier extraction and that its 24 tests are unmodified; the entity + partial unique index; the 404 matrix; the audit actor override; the 'public' rate-limit policy; and that projection/sanitiser are stubs completed in cg02>
```

Do **not** merge — the orchestrator merges after independent verification.

---

## Task 10: `CaregiverFieldPolicy` — internal fields + projection (cg02)

**Files:**
- Create: `Odip.Infrastructure/Services/CaregiverFieldPolicy.cs`
- Test: `Odip.Tests/Caregiver/CaregiverFieldPolicyTests.cs`

**Interfaces:**
- Consumes: `ParticipantFieldEntryMap.Entries` (field ids + phase), `ParticipantDocumentFieldMap.Entries` (`ParticipantPropertyName` per field id), `ParticipantDetailDto` (the JSON property names the frontend already knows).
- Produces:
  - `public static readonly IReadOnlySet<string> InternalFields` — **JSON property names on `ParticipantDetailDto`** (camelCase) that must never reach a caregiver.
  - `public static JsonObject BuildProjection(ParticipantDetailDto detail)` — serialises the detail DTO with web options, removes every `InternalFields` key, returns the rest.
  - `public static IReadOnlyList<string> EditableFieldIds()` — allocation-contract field ids with `Phase == Profile` whose mapped DTO property is not internal.

- [ ] **Step 1: Failing drift-guard tests**

```csharp
using System.Text.Json;
using System.Text.Json.Nodes;
using Odip.Application.DTOs;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverFieldPolicyTests
{
    private static readonly string[] DetailDtoJsonNames = typeof(ParticipantDetailDto)
        .GetProperties()
        .Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name))
        .ToArray();

    [Fact]
    public void EveryInternalFieldExistsOnParticipantDetailDto()
    {
        // A renamed DTO property must not silently un-exclude a field.
        var missing = CaregiverFieldPolicy.InternalFields.Where(f => !DetailDtoJsonNames.Contains(f)).ToList();
        Assert.True(missing.Count == 0, "InternalFields names not on ParticipantDetailDto: " + string.Join(", ", missing));
    }

    [Fact]
    public void ProjectionNeverContainsAnInternalField()
    {
        var detail = new ParticipantDetailDto { Id = Guid.NewGuid(), FirstName = "S", LastName = "B" };
        var projection = CaregiverFieldPolicy.BuildProjection(detail);
        foreach (var f in CaregiverFieldPolicy.InternalFields)
            Assert.False(projection.ContainsKey(f), $"projection leaked internal field '{f}'");
    }

    [Fact]
    public void ProjectionContainsAtLeastTheIdentityFields()
    {
        var detail = new ParticipantDetailDto { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown" };
        var projection = CaregiverFieldPolicy.BuildProjection(detail);
        Assert.Equal("Sophie", projection["firstName"]!.GetValue<string>());
    }

    [Fact]
    public void EveryProfileFieldIsEitherEditableOrInternal()
    {
        // The drift guard: a field added to the Profile allocation later must be consciously
        // classified — this test names it until someone does.
        var profileIds = ParticipantFieldEntryMap.Entries
            .Where(e => e.Phase == ParticipantFieldEntryPhase.Profile)
            .Select(e => e.FieldId).ToHashSet();
        var editable = CaregiverFieldPolicy.EditableFieldIds().ToHashSet();
        var unclassified = profileIds
            .Where(id => !editable.Contains(id) && !CaregiverFieldPolicy.IsInternalFieldId(id))
            .ToList();
        Assert.True(unclassified.Count == 0, "Profile fields neither editable nor internal: " + string.Join(", ", unclassified));
    }

    [Fact]
    public void NoEditableFieldIdMapsToAnInternalDtoProperty()
    {
        foreach (var id in CaregiverFieldPolicy.EditableFieldIds())
            Assert.False(CaregiverFieldPolicy.IsInternalFieldId(id), $"'{id}' is both editable and internal");
    }
}
```

- [ ] **Step 2: Run to confirm failure** — build error.

- [ ] **Step 3: Implement**

First, open `Odip.Application/DTOs/*` and find `ParticipantDetailDto`. Write down the **actual property names** for the fields the spec excludes. Then:

```csharp
using System.Text.Json;
using System.Text.Json.Nodes;
using Odip.Application.DTOs;

namespace Odip.Infrastructure.Services;

/// <summary>
/// What a caregiver may see and edit. See docs/specs/2026-09-03-caregiver-profile-form-design.md §2.
///
/// InternalFields are JSON property names on ParticipantDetailDto (camelCase). BuildProjection
/// works by SUBTRACTION from the full DTO so a field can only reach a caregiver if it is on the
/// DTO and not listed here — and CaregiverFieldPolicyTests fails the build if a listed name
/// stops existing on the DTO, so a rename cannot silently un-exclude anything.
/// </summary>
public static class CaregiverFieldPolicy
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Populate from ParticipantDetailDto's REAL property names for these groups — the test
    /// EveryInternalFieldExistsOnParticipantDetailDto will tell you any name that is wrong:
    ///   restrictive practices + the derived flag
    ///   behaviour risk rating, risk entries, risks/hazards summary + its notes
    ///   safety auto-notes
    ///   plan-management / funding admin (ndisPlan group; serviceProfile except serviceStreams)
    ///   preferred staff
    /// </summary>
    public static readonly IReadOnlySet<string> InternalFields = new HashSet<string>(StringComparer.Ordinal)
    {
        "hasRestrictivePracticeFlag",
        "behaviourRiskRating",
        "behaviourRiskSummary",
        "riskEntries",
        "preferredStaffId",
        "preferredStaffName",
        "planType",
        "ndisNumber",
        "planStartDate",
        "planEndDate",
        "fundingSource",
        "region",
        // add every remaining ndisPlan / serviceProfile member (except serviceStreams) after
        // reading ParticipantDetailDto; the test names any that don't exist.
    };

    /// <summary>Allocation-contract field ids whose mapped DTO property is internal.</summary>
    public static bool IsInternalFieldId(string fieldId)
    {
        var entry = ParticipantDocumentFieldMap.Entries.FirstOrDefault(e => e.FieldId == fieldId);
        if (entry?.ParticipantPropertyName is null) return false;
        return InternalFields.Contains(JsonNamingPolicy.CamelCase.ConvertName(entry.ParticipantPropertyName));
    }

    public static IReadOnlyList<string> EditableFieldIds() =>
        ParticipantFieldEntryMap.Entries
            .Where(e => e.Phase == ParticipantFieldEntryPhase.Profile)
            .Select(e => e.FieldId)
            .Where(id => !IsInternalFieldId(id))
            .ToList();

    public static JsonObject BuildProjection(ParticipantDetailDto detail)
    {
        var node = JsonSerializer.SerializeToNode(detail, Web) as JsonObject ?? new JsonObject();
        foreach (var key in InternalFields) node.Remove(key);
        return node;
    }
}
```

If `ParticipantDocumentFieldMap.Entries` lacks a `ParticipantPropertyName` for some Profile field ids (the `IsTable` rows), treat them as internal only if the table's DTO property name is in `InternalFields`; otherwise editable. Make `IsInternalFieldId` handle a null property name by returning `false`, as above.

- [ ] **Step 4: Iterate until the drift guards pass**

Run: `dotnet test --filter "FullyQualifiedName~CaregiverFieldPolicyTests"`
The first failure will list DTO names that don't exist — fix `InternalFields` to real names. The `EveryProfileFieldIsEitherEditableOrInternal` test will pass once every Profile field is accounted for. Do **not** weaken either test.

- [ ] **Step 5: Commit**

```bash
git add Odip.Infrastructure/Services/CaregiverFieldPolicy.cs Odip.Tests/Caregiver/CaregiverFieldPolicyTests.cs
git commit -m "feat(caregiver): CaregiverFieldPolicy — internal-field exclusion and projection with drift guards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 11: Wire the projection into both controllers

**Files:**
- Modify: `Odip.Api/Controllers/CaregiverController.cs` (replace the two stubs)
- Modify: `Odip.Api/Controllers/CaregiverSubmissionsController.cs` (replace `BuildProjection` stub)
- Test: add to `CaregiverControllerTests.cs`

**Interfaces:**
- Consumes: `CaregiverFieldPolicy.BuildProjection`, `EditableFieldIds`, and whatever `ParticipantsController` uses to build a `ParticipantDetailDto` from a `Participant` (find `ToDetailDto` or the equivalent; if it is a private method on `ParticipantsController`, move it to `internal static` on a small `ParticipantDetailMapper` in `Odip.Infrastructure/Services/` — behaviour-preserving, all existing tests must pass).

- [ ] **Step 1: Failing test**

```csharp
[Fact]
public async Task Get_ProjectionOmitsInternalFields_AndListsEditable()
{
    using var db = CreateDb();
    var (p, _, raw) = Seed(db);
    var result = await MakeController(db).Get(raw, CancellationToken.None);
    var body = Assert.IsType<ApiResponse<CaregiverFormDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
    Assert.Equal("Sophie", body.Data!.Current["firstName"]!.GetValue<string>());
    foreach (var f in CaregiverFieldPolicy.InternalFields)
        Assert.False(body.Data.Current.ContainsKey(f), $"leaked '{f}'");
    Assert.NotEmpty(body.Data.Editable);
}
```

- [ ] **Step 2: Implement** — in both controllers replace the stubs:

```csharp
    private static JsonObject BuildProjection(Participant p) =>
        CaregiverFieldPolicy.BuildProjection(ParticipantDetailMapper.ToDetailDto(p));
    private static IReadOnlyList<string> EditableFields() => CaregiverFieldPolicy.EditableFieldIds();
```

`ToDetailDto` may need related collections loaded (`Include`s). Match whatever `ParticipantsController.GetById` includes; add those `Include`s to `ResolveLiveAsync`'s participant query and to the admin `Get`.

- [ ] **Step 3: Tests + commit**

Run: `dotnet test` → `Failed: 0`.

```bash
git add Odip.Api/Controllers/ Odip.Infrastructure/Services/ Odip.Tests/Caregiver/
git commit -m "feat(caregiver): serve the caregiver projection from both controllers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
```

---

## Task 12: Payload sanitiser on accept

**Files:**
- Modify: `Odip.Infrastructure/Services/CaregiverFieldPolicy.cs` (add `Sanitise`)
- Modify: `Odip.Api/Controllers/CaregiverSubmissionsController.cs` (call it)
- Test: add to `CaregiverFieldPolicyTests.cs` and `CaregiverSubmissionsControllerTests.cs`

**Interfaces:**
- Produces: `public static PatchParticipantDto Sanitise(PatchParticipantDto payload, Participant current)`.

**The trap this closes.** PATCH is all-or-nothing at the group level. Nulling an internal *scalar* inside an otherwise-caregiver-editable group would **clear** it. So: internal *groups* are set to `null` (absent = untouched); internal *scalars inside editable groups* are **overwritten with the participant's current value**, so accept can never change them.

- [ ] **Step 1: Failing tests**

```csharp
// CaregiverFieldPolicyTests
[Fact]
public void Sanitise_NullsInternalGroups()
{
    var p = new Participant { Id = Guid.NewGuid(), FirstName = "S", LastName = "B" };
    var dirty = new PatchParticipantDto
    {
        PreferredStaff = new PatchPreferredStaffDto { PreferredStaffId = Guid.NewGuid() },
        NdisPlan = new PatchNdisPlanDto { NdisNumber = "430000000" },
        ServiceProfile = new PatchServiceProfileDto(),
        RisksHazardsSummary = new PatchRisksHazardsSummaryDto { BehaviourRiskSummary = "x" },
        AboutMe = new PatchAboutMeDto { PersonalInterests = "Gardening" },
    };
    var clean = CaregiverFieldPolicy.Sanitise(dirty, p);
    Assert.Null(clean.PreferredStaff);
    Assert.Null(clean.NdisPlan);
    Assert.Null(clean.ServiceProfile);
    Assert.Null(clean.RisksHazardsSummary);
    Assert.Equal("Gardening", clean.AboutMe!.PersonalInterests);
}

[Fact]
public void Sanitise_OverwritesInternalScalarInsideEditableGroupWithCurrentValue()
{
    var p = new Participant { Id = Guid.NewGuid(), FirstName = "S", LastName = "B", BehaviourRiskRating = RiskRatingLevel.Low };
    var dirty = new PatchParticipantDto
    {
        BehaviourCommunication = new PatchBehaviourCommunicationDto { BehaviourRiskRating = RiskRatingLevel.Critical, Memory = MemoryLevel.Good },
    };
    var clean = CaregiverFieldPolicy.Sanitise(dirty, p);
    Assert.Equal(RiskRatingLevel.Low, clean.BehaviourCommunication!.BehaviourRiskRating);   // preserved, not cleared
    Assert.Equal(MemoryLevel.Good, clean.BehaviourCommunication.Memory);                       // caregiver edit kept
}

// CaregiverSubmissionsControllerTests
[Fact]
public async Task Accept_CraftedPayloadCannotChangeInternalField()
{
    var (db, tenantId) = CreateTenantDb();
    var p = SeedParticipant(db, tenantId);
    p.BehaviourRiskRating = RiskRatingLevel.Low;
    p.PreferredStaffId = null;
    await db.SaveChangesAsync();
    var crafted = new PatchParticipantDto
    {
        BehaviourCommunication = new PatchBehaviourCommunicationDto { BehaviourRiskRating = RiskRatingLevel.Critical },
        PreferredStaff = new PatchPreferredStaffDto { PreferredStaffId = Guid.NewGuid() },
    };
    var s = SeedSubmission(db, tenantId, p.Id, CaregiverSubmissionStatus.Submitted, crafted);
    var result = await MakeController(db, tenantId, Guid.NewGuid()).Accept(s.Id, CancellationToken.None);
    Assert.IsType<NoContentResult>(result);
    var reloaded = await db.Participants.IgnoreQueryFilters().SingleAsync(x => x.Id == p.Id);
    Assert.Equal(RiskRatingLevel.Low, reloaded.BehaviourRiskRating);
    Assert.Null(reloaded.PreferredStaffId);
}
```

Adjust member and enum names to the real ones in `ParticipantPatchDTOs.cs` / `Participant.cs`; the intent of each assertion must not change.

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Implement**

```csharp
    /// <summary>
    /// Make a caregiver payload safe to apply. Internal GROUPS become null (absent = untouched by
    /// PATCH). Internal SCALARS that live inside caregiver-editable groups are overwritten with
    /// the participant's current value — nulling them would CLEAR them under PATCH's group-level
    /// atomicity. The mapper reads only known keys, so a crafted payload cannot smuggle a field.
    /// </summary>
    public static PatchParticipantDto Sanitise(PatchParticipantDto payload, Participant current)
    {
        var clean = payload with
        {
            PreferredStaff = null,
            NdisPlan = null,
            ServiceProfile = null,
            RisksHazardsSummary = null,
        };
        if (clean.BehaviourCommunication is { } bc)
            clean = clean with { BehaviourCommunication = bc with { BehaviourRiskRating = current.BehaviourRiskRating } };
        // Repeat the `with { X = current.X }` pattern for every other internal scalar that sits
        // inside an editable group — derive the list from InternalFields ∩ (members of the 12
        // editable Patch*Dto groups). Document each one with the group it lives in.
        return clean;
    }
```

Replace the identity stub in `CaregiverSubmissionsController.Accept` with `CaregiverFieldPolicy.Sanitise(payload, s.Participant)`.

- [ ] **Step 4: Tests, full suite, commit, PR**

Run: `dotnet test` → `Failed: 0`.

```bash
git add Odip.Infrastructure/Services/CaregiverFieldPolicy.cs Odip.Api/Controllers/CaregiverSubmissionsController.cs Odip.Tests/Caregiver/
git commit -m "feat(caregiver): sanitise accepted payloads — internal groups nulled, internal scalars preserved

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Xh5mYhd3BUrih1drycbmcV"
git diff HEAD --stat     # must be empty
git push -u origin feat/cg02-caregiver-projection
gh pr create --base feat/cg01-submission-backend --title "feat(caregiver): field policy, projection and accept sanitiser (cg02)" --body-file <body covering the drift guards, the projection-by-subtraction design, and the group-null / scalar-preserve sanitiser rule with the crafted-payload test>
```

cg02's PR targets cg01. **Retarget to `main` once cg01 merges** — a PR whose base merges first goes to a dead end (this happened to #66).

---

## Self-review against the spec

- §1 data model → Task 2 (entity, partial index, reject semantics in Task 8). ✅
- §2 public API: three routes, `[AllowAnonymous]`-equivalent (no class `[Authorize]`), `"public"` policy, tenant from token row, 404 matrix, token hashing, projection-by-subtraction, drift guards, audit actor → Tasks 3, 4, 5, 7, 10, 11. ✅
- §3 admin API: six routes, role gate, accept via extracted applier, sanitiser, reject reopens same token → Tasks 1, 8, 12. ✅
- §7 backend tests: token round-trip ✅ (T3); every 404 case ✅ (T7 — includes cross-tenant via `Participant.TenantId` mismatch in `ResolveLiveAsync`; add one explicit test seeding a submission whose `TenantId` ≠ participant's if not already covered); name gate ✅; 409 after submit ✅; reject reopens ✅; partial unique index — **add a test in Task 2 or 8 that inserting a second Draft row for the same participant throws** (EF InMemory does not enforce unique indexes; assert instead that `CreateLink` revokes the prior active row, which Task 8's first test does — note this limitation in the test's comment); crafted payload leaves internal field untouched ✅ (T12); rate-limit policy — verify by reflection that `CaregiverController` carries `[EnableRateLimiting("public")]` (add to T7 tests); audit rows ✅ (T4).
- Docker constraint: no test reads outside `backend/`. ✅ (drift guards use `ParticipantFieldEntryMap.Entries`, not `documentMapping.ts`).
- Type consistency: `CaregiverFormDto.Current` is `JsonObject` in T6, T7, T10, T11 ✅; `EditableFieldIds()` name consistent T10/T11 ✅; `Sanitise(payload, participant)` signature consistent T8/T12 ✅.
