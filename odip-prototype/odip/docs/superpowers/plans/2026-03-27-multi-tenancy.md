# Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict SaaS multi-tenancy to Odip — separate NDIS organisations each get fully isolated data within a shared PostgreSQL database, enforced by EF Core Global Query Filters.

**Architecture:** A new `Tenant` entity stores organisation name and email domain. Eight root aggregate entities gain a `TenantId` FK. `OdipDbContext` injects a scoped `ICurrentTenant` service (populated from the JWT `tenant_id` claim) and applies `HasQueryFilter` to every root entity so all queries are automatically scoped. Login resolves the tenant from the user's stored email domain and embeds `tenant_id` in the JWT.

**Tech Stack:** .NET 9, ASP.NET Core, EF Core 9, PostgreSQL 16, xUnit, Moq, React 19 / TypeScript

**Spec:** `docs/superpowers/specs/2026-03-27-multi-tenancy-design.md`

**Constants used throughout:**
- Default tenant Guid: `00000000-0000-0000-0000-000000000001`
- All `dotnet ef` commands run from repo root: `F:/Projects/personal/Trip Planner`

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `backend/Odip.Domain/Entities/Tenant.cs` | Tenant entity |
| `backend/Odip.Domain/Interfaces/ITenantEntity.cs` | Marker interface for auto-TenantId |
| `backend/Odip.Application/Services/ICurrentTenant.cs` | Tenant context abstraction |
| `backend/Odip.Infrastructure/Services/CurrentTenant.cs` | JWT-backed implementation |
| `backend/Odip.Api/Controllers/TenantsController.cs` | SuperAdmin CRUD endpoints |
| `backend/Odip.Tests/Odip.Tests.csproj` | Test project |
| `backend/Odip.Tests/CurrentTenantTests.cs` | Unit tests |

### Modified Files
| File | Change |
|------|--------|
| `backend/Odip.Domain/Enums/Enums.cs` | Add `SuperAdmin` to `UserRole` |
| `backend/Odip.Domain/Entities/User.cs` | Add `TenantId`, `Tenant?`, implement `ITenantEntity` |
| `backend/Odip.Domain/Entities/Participant.cs` | Same |
| `backend/Odip.Domain/Entities/Staff.cs` | Same |
| `backend/Odip.Domain/Entities/Vehicle.cs` | Same |
| `backend/Odip.Domain/Entities/AccommodationProperty.cs` | Same |
| `backend/Odip.Domain/Entities/EventTemplate.cs` | Same |
| `backend/Odip.Domain/Entities/TripInstance.cs` | Same |
| `backend/Odip.Domain/Entities/AppSettings.cs` | Change `int Id` → `Guid Id`, add `TenantId` |
| `backend/Odip.Application/DTOs/DTOs.cs` | Add `TenantName` to `AuthResponseDto`; add Tenant DTOs |
| `backend/Odip.Infrastructure/Data/OdipDbContext.cs` | Inject `ICurrentTenant`, add `Tenants` DbSet, query filters, `SaveChangesAsync` override |
| `backend/Odip.Api/Controllers/AuthController.cs` | Tenant resolution at login |
| `backend/Odip.Api/Controllers/SettingsController.cs` | Remove `Id = 1` hardcode |
| `backend/Odip.Api/Program.cs` | Register `ICurrentTenant`, remove AppSettings raw SQL |
| `frontend/src/api/hooks.ts` (or login handler) | Store `tenantName` in localStorage |
| `frontend/src/components/layout/AppLayout.tsx` | Show org name pill in navbar |

### New Migrations
| Migration | Purpose |
|-----------|---------|
| `AddTenants` | Create `Tenants` table, seed Default tenant |
| `AddTenantIdToRoots` | Add nullable TenantId to 7 entities, backfill, make required, FK + indexes |
| `FixAppSettings` | Drop old AppSettings (raw-SQL managed), create new with Guid Id + TenantId, seed |

---

## Task 1: Set Up Test Project

**Files:**
- Create: `backend/Odip.Tests/Odip.Tests.csproj`

- [ ] **Create the xUnit test project**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet new xunit --name Odip.Tests --output backend/Odip.Tests
```

- [ ] **Add to solution**

```bash
dotnet sln add backend/Odip.Tests/Odip.Tests.csproj
```

- [ ] **Add package references** — edit `backend/Odip.Tests/Odip.Tests.csproj` to match:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="Moq" Version="4.20.72" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\Odip.Infrastructure\Odip.Infrastructure.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Restore packages**

```bash
dotnet restore backend/Odip.Tests/Odip.Tests.csproj
```

Expected: packages restored, no errors.

- [ ] **Delete the generated placeholder test**

Delete `backend/Odip.Tests/UnitTest1.cs`.

- [ ] **Verify build**

```bash
dotnet build "F:/Projects/personal/Trip Planner/backend/Odip.sln"
```

Expected: `Build succeeded`.

- [ ] **Commit**

```bash
git add backend/Odip.Tests/
git commit -m "chore: add Odip.Tests xUnit project"
```

---

## Task 2: Domain — Tenant Entity and ITenantEntity Interface

**Files:**
- Create: `backend/Odip.Domain/Entities/Tenant.cs`
- Create: `backend/Odip.Domain/Interfaces/ITenantEntity.cs`

- [ ] **Create the ITenantEntity marker interface**

Create `backend/Odip.Domain/Interfaces/ITenantEntity.cs`:

```csharp
namespace Odip.Domain.Interfaces;

/// <summary>
/// Marks a root aggregate entity as tenant-scoped.
/// OdipDbContext.SaveChangesAsync auto-populates TenantId from ICurrentTenant.
/// </summary>
public interface ITenantEntity
{
    Guid TenantId { get; set; }
}
```

- [ ] **Create the Tenant entity**

Create `backend/Odip.Domain/Entities/Tenant.cs`:

```csharp
namespace Odip.Domain.Entities;

/// <summary>
/// Represents an NDIS service provider organisation.
/// Email domain is used to resolve the tenant at login.
/// </summary>
public class Tenant
{
    public Guid Id { get; set; }

    /// <summary>Display name, e.g. "Ability Options"</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Unique email domain, e.g. "abilityoptions.com.au"</summary>
    public string EmailDomain { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<User> Users { get; set; } = [];
}
```

- [ ] **Build to confirm no errors**

```bash
dotnet build backend/Odip.Domain/Odip.Domain.csproj
```

Expected: `Build succeeded`.

- [ ] **Commit**

```bash
git add backend/Odip.Domain/
git commit -m "feat: add Tenant entity and ITenantEntity interface"
```

---

## Task 3: Domain — Add TenantId to Root Entities

**Files:**
- Modify: `backend/Odip.Domain/Enums/Enums.cs`
- Modify: `backend/Odip.Domain/Entities/User.cs`
- Modify: `backend/Odip.Domain/Entities/Participant.cs`
- Modify: `backend/Odip.Domain/Entities/Staff.cs`
- Modify: `backend/Odip.Domain/Entities/Vehicle.cs`
- Modify: `backend/Odip.Domain/Entities/AccommodationProperty.cs`
- Modify: `backend/Odip.Domain/Entities/EventTemplate.cs`
- Modify: `backend/Odip.Domain/Entities/TripInstance.cs`
- Modify: `backend/Odip.Domain/Entities/AppSettings.cs`

- [ ] **Add SuperAdmin to UserRole**

In `backend/Odip.Domain/Enums/Enums.cs`, add `SuperAdmin` as the last value in the `UserRole` enum:

```csharp
public enum UserRole
{
    Admin,
    Coordinator,
    SupportWorker,
    ReadOnly,
    SuperAdmin   // Platform operator — TenantId is null, bypasses all query filters
}
```

- [ ] **Add TenantId to User**

In `backend/Odip.Domain/Entities/User.cs`:

1. Add the using: `using Odip.Domain.Interfaces;`
2. Change class declaration to: `public class User : ITenantEntity`
3. Add these two properties after `IsActive`:

```csharp
public Guid TenantId { get; set; }
public Tenant? Tenant { get; set; }
```

- [ ] **Add TenantId to Participant**

In `backend/Odip.Domain/Entities/Participant.cs`:

1. Add using: `using Odip.Domain.Interfaces;`
2. Change class declaration: `public class Participant : ITenantEntity`
3. Add after existing properties (before navigation properties):

```csharp
public Guid TenantId { get; set; }
public Tenant? Tenant { get; set; }
```

- [ ] **Repeat for the remaining 5 entities** — same pattern (add using, implement ITenantEntity, add TenantId + Tenant? nav):

- `backend/Odip.Domain/Entities/Staff.cs`
- `backend/Odip.Domain/Entities/Vehicle.cs`
- `backend/Odip.Domain/Entities/AccommodationProperty.cs`
- `backend/Odip.Domain/Entities/EventTemplate.cs`
- `backend/Odip.Domain/Entities/TripInstance.cs`

Each gets:
```csharp
// using Odip.Domain.Interfaces; (add at top)
// public class <Entity> : ITenantEntity (change declaration)

public Guid TenantId { get; set; }
public Tenant? Tenant { get; set; }
```

- [ ] **Update AppSettings — replace singleton with per-tenant entity**

Replace the entire content of `backend/Odip.Domain/Entities/AppSettings.cs`:

```csharp
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Per-tenant application settings. One row per tenant.
/// </summary>
public class AppSettings : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public int QualificationWarningDays { get; set; } = 30;
}
```

- [ ] **Build to confirm all entity changes compile**

```bash
dotnet build backend/Odip.Domain/Odip.Domain.csproj
```

Expected: `Build succeeded`. Fix any errors before proceeding.

- [ ] **Commit**

```bash
git add backend/Odip.Domain/
git commit -m "feat: add TenantId to root aggregate entities and update AppSettings"
```

---

## Task 4: Application — ICurrentTenant Interface and Updated DTOs

**Files:**
- Create: `backend/Odip.Application/Services/ICurrentTenant.cs`
- Modify: `backend/Odip.Application/DTOs/DTOs.cs`

- [ ] **Create ICurrentTenant interface**

Create directory `backend/Odip.Application/Services/` if it doesn't exist, then create `ICurrentTenant.cs`:

```csharp
namespace Odip.Application.Services;

/// <summary>
/// Provides the tenant context for the current HTTP request.
/// Resolved from the JWT "tenant_id" claim.
/// SuperAdmin users have TenantId = null and IsSuperAdmin = true.
/// </summary>
public interface ICurrentTenant
{
    /// <summary>The current tenant's Guid, or null for SuperAdmin users.</summary>
    Guid? TenantId { get; }

    /// <summary>True when the authenticated user has the SuperAdmin role.</summary>
    bool IsSuperAdmin { get; }
}
```

- [ ] **Add TenantName to AuthResponseDto**

In `backend/Odip.Application/DTOs/DTOs.cs`, find the `AuthResponseDto` class and add the `TenantName` property:

```csharp
// Find AuthResponseDto and add TenantName:
public string? TenantName { get; set; }  // null for SuperAdmin users
```

- [ ] **Add Tenant DTOs** — append these records to `DTOs.cs`:

```csharp
// ── Tenant DTOs ─────────────────────────────────────────────────────────────

public record TenantDto(
    Guid Id,
    string Name,
    string EmailDomain,
    bool IsActive,
    DateTime CreatedAt);

public record CreateTenantDto(
    string Name,
    string EmailDomain);

public record UpdateTenantDto(
    string Name,
    string EmailDomain,
    bool IsActive);
```

- [ ] **Build Application layer**

```bash
dotnet build backend/Odip.Application/Odip.Application.csproj
```

Expected: `Build succeeded`.

- [ ] **Commit**

```bash
git add backend/Odip.Application/
git commit -m "feat: add ICurrentTenant interface and Tenant DTOs"
```

---

## Task 5: Infrastructure — CurrentTenant Implementation

**Files:**
- Create: `backend/Odip.Infrastructure/Services/CurrentTenant.cs`

- [ ] **Create CurrentTenant implementation**

Create directory `backend/Odip.Infrastructure/Services/` if it doesn't exist, then create `CurrentTenant.cs`:

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Odip.Application.Services;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Reads the current tenant from the JWT "tenant_id" claim via IHttpContextAccessor.
/// Registered as Scoped in DI — one instance per HTTP request.
/// </summary>
public sealed class CurrentTenant : ICurrentTenant
{
    public Guid? TenantId { get; }
    public bool IsSuperAdmin { get; }

    public CurrentTenant(IHttpContextAccessor accessor)
    {
        var user = accessor.HttpContext?.User;
        var claim = user?.FindFirst("tenant_id")?.Value;
        TenantId = claim is not null ? Guid.Parse(claim) : null;
        IsSuperAdmin = user?.IsInRole("SuperAdmin") ?? false;
    }
}
```

- [ ] **Build Infrastructure layer**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded`.

- [ ] **Commit**

```bash
git add backend/Odip.Infrastructure/Services/
git commit -m "feat: add CurrentTenant scoped service implementation"
```

---

## Task 6: Infrastructure — DbContext Query Filters

**Files:**
- Modify: `backend/Odip.Infrastructure/Data/OdipDbContext.cs`

This is the core of tenant isolation. Read the current DbContext before making changes.

- [ ] **Add ICurrentTenant field and update constructor**

In `OdipDbContext.cs`, add a field and update the constructor to accept `ICurrentTenant`:

```csharp
// Add this using at the top:
using Odip.Application.Services;
using Odip.Domain.Interfaces;

// Add this private field to the class:
private readonly ICurrentTenant _tenant;

// Update the constructor (preserve existing parameters, add ICurrentTenant):
public OdipDbContext(DbContextOptions<OdipDbContext> options, ICurrentTenant tenant)
    : base(options)
{
    _tenant = tenant;
}
```

- [ ] **Add Tenants DbSet**

In the DbSet properties section of `OdipDbContext`, add:

```csharp
public DbSet<Tenant> Tenants { get; set; }
```

- [ ] **Add query filters to OnModelCreating**

At the END of the existing `OnModelCreating` method (after all existing configuration), add one filter per root entity. All 8 follow the same pattern — `IsSuperAdmin` bypasses the filter entirely:

```csharp
// ── Multi-Tenancy Query Filters ─────────────────────────────────────────────
// Applied to all root aggregate entities. SuperAdmin bypasses all filters.
// Child entities (ParticipantBooking, BookingTask, etc.) are filtered
// transitively through their parent FKs.

modelBuilder.Entity<User>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<Participant>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<Staff>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<Vehicle>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<AccommodationProperty>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<EventTemplate>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<TripInstance>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

modelBuilder.Entity<AppSettings>()
    .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

// Tenants table — unique index on EmailDomain
modelBuilder.Entity<Tenant>()
    .HasIndex(t => t.EmailDomain).IsUnique();
```

- [ ] **Override SaveChangesAsync to auto-populate TenantId**

Add this override to `OdipDbContext` — it auto-sets `TenantId` on any new `ITenantEntity` before saving, so controllers don't have to do it manually:

```csharp
public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
{
    // Auto-populate TenantId on new tenant-scoped entities
    if (_tenant.TenantId.HasValue)
    {
        foreach (var entry in ChangeTracker.Entries<ITenantEntity>()
            .Where(e => e.State == EntityState.Added))
        {
            entry.Entity.TenantId = _tenant.TenantId.Value;
        }
    }

    return await base.SaveChangesAsync(cancellationToken);
}
```

- [ ] **Build Infrastructure**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded`. The build will now have compilation errors in the API layer (because DbContext constructor signature changed). Those are fixed in Task 11.

- [ ] **Commit**

```bash
git add backend/Odip.Infrastructure/Data/OdipDbContext.cs
git commit -m "feat: add Tenants DbSet, query filters, and auto-TenantId SaveChanges to DbContext"
```

---

## Task 7: Tests — CurrentTenant Unit Tests

**Files:**
- Create: `backend/Odip.Tests/CurrentTenantTests.cs`

- [ ] **Write the failing tests**

Create `backend/Odip.Tests/CurrentTenantTests.cs`:

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Moq;
using Odip.Infrastructure.Services;

namespace Odip.Tests;

public class CurrentTenantTests
{
    private static CurrentTenant Create(IEnumerable<Claim>? claims = null)
    {
        var identity = claims is not null
            ? new ClaimsIdentity(claims, "Bearer")
            : new ClaimsIdentity();
        var principal = new ClaimsPrincipal(identity);

        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(x => x.HttpContext!.User).Returns(principal);

        return new CurrentTenant(accessor.Object);
    }

    [Fact]
    public void TenantId_IsNull_WhenNoTenantIdClaim()
    {
        var sut = Create();
        Assert.Null(sut.TenantId);
    }

    [Fact]
    public void TenantId_IsPopulated_WhenClaimPresent()
    {
        var id = Guid.NewGuid();
        var sut = Create([new Claim("tenant_id", id.ToString())]);
        Assert.Equal(id, sut.TenantId);
    }

    [Fact]
    public void IsSuperAdmin_IsFalse_WhenNoRoleClaim()
    {
        var sut = Create();
        Assert.False(sut.IsSuperAdmin);
    }

    [Fact]
    public void IsSuperAdmin_IsTrue_WhenRoleIsSuperAdmin()
    {
        var sut = Create([new Claim(ClaimTypes.Role, "SuperAdmin")]);
        Assert.True(sut.IsSuperAdmin);
    }

    [Fact]
    public void IsSuperAdmin_IsFalse_WhenRoleIsAdmin()
    {
        var sut = Create([new Claim(ClaimTypes.Role, "Admin")]);
        Assert.False(sut.IsSuperAdmin);
    }

    [Fact]
    public void NullHttpContext_ReturnsNullTenantAndNotSuperAdmin()
    {
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(x => x.HttpContext).Returns((HttpContext?)null);

        var sut = new CurrentTenant(accessor.Object);

        Assert.Null(sut.TenantId);
        Assert.False(sut.IsSuperAdmin);
    }
}
```

- [ ] **Run tests to verify they fail (expected — CurrentTenant not yet wired up)**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj --no-build 2>&1 || true
```

Actually, the tests should PASS now because `CurrentTenant` was already written in Task 5. Run:

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj -v normal
```

Expected: `6 passed, 0 failed`.

- [ ] **Commit**

```bash
git add backend/Odip.Tests/CurrentTenantTests.cs
git commit -m "test: add CurrentTenant unit tests"
```

---

## Task 8: Migration 1 — AddTenants

This migration creates the `Tenants` table and seeds the Default tenant that all existing data will be assigned to.

**Before running:** Update the `Name` and `EmailDomain` values below to match the current organisation using this system.

- [ ] **Generate the migration**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet ef migrations add AddTenants --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: new file created in `backend/Odip.Infrastructure/Migrations/`.

- [ ] **Edit the generated migration** — replace the `Up` and `Down` methods with:

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.CreateTable(
        name: "Tenants",
        columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false),
            Name = table.Column<string>(type: "text", nullable: false),
            EmailDomain = table.Column<string>(type: "text", nullable: false),
            IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
            CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
        },
        constraints: table =>
        {
            table.PrimaryKey("PK_Tenants", x => x.Id);
        });

    migrationBuilder.CreateIndex(
        name: "IX_Tenants_EmailDomain",
        table: "Tenants",
        column: "EmailDomain",
        unique: true);

    // Seed the Default tenant — UPDATE Name and EmailDomain before deploying
    migrationBuilder.Sql(@"
        INSERT INTO ""Tenants"" (""Id"", ""Name"", ""EmailDomain"", ""IsActive"", ""CreatedAt"")
        VALUES (
            '00000000-0000-0000-0000-000000000001',
            'Default Organisation',
            'yourdomain.com.au',
            true,
            NOW()
        )
        ON CONFLICT DO NOTHING;
    ");
}

protected override void Down(MigrationBuilder migrationBuilder)
{
    migrationBuilder.DropTable(name: "Tenants");
}
```

- [ ] **Apply the migration locally**

```bash
dotnet ef database update --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: migration applied, `Tenants` table exists with one row.

- [ ] **Verify**

Connect to local PostgreSQL and confirm:
```sql
SELECT * FROM "Tenants";
-- Should return: 1 row with Id=00000000-0000-0000-0000-000000000001
```

- [ ] **Commit**

```bash
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat: migration AddTenants — create Tenants table and seed Default tenant"
```

---

## Task 9: Migration 2 — AddTenantIdToRoots

This migration adds `TenantId` to the 7 root entities (AppSettings handled separately in Task 10), backfills all existing rows with the Default tenant Guid, makes the column NOT NULL, and adds FK constraints + indexes.

- [ ] **Generate the migration**

```bash
dotnet ef migrations add AddTenantIdToRoots --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

EF Core will auto-detect the TenantId property additions. However, since TenantId is required (`Guid`, not `Guid?`) and existing rows can't satisfy NOT NULL on creation, **you must edit the generated migration** to add backfill SQL before the NOT NULL constraint.

- [ ] **Edit the generated migration Up method**

Replace the EF-generated `Up` method with this (preserving any EF-generated AlterColumn/AddColumn calls, but restructuring the order):

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    // Step 1: Add TenantId as nullable to all 7 tables
    var tables = new[]
    {
        "Users", "Participants", "Staff", "Vehicles",
        "AccommodationProperties", "EventTemplates", "TripInstances"
    };

    foreach (var table in tables)
    {
        migrationBuilder.AddColumn<Guid>(
            name: "TenantId",
            table: table,
            type: "uuid",
            nullable: true);
    }

    // Step 2: Backfill all existing rows with the Default tenant
    migrationBuilder.Sql(@"
        UPDATE ""Users""                SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
        UPDATE ""Participants""         SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
        UPDATE ""Staff""               SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
        UPDATE ""Vehicles""            SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
        UPDATE ""AccommodationProperties"" SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
        UPDATE ""EventTemplates""      SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
        UPDATE ""TripInstances""       SET ""TenantId"" = '00000000-0000-0000-0000-000000000001';
    ");

    // Step 3: Make NOT NULL + add FK constraints + indexes
    foreach (var table in tables)
    {
        migrationBuilder.AlterColumn<Guid>(
            name: "TenantId",
            table: table,
            type: "uuid",
            nullable: false,
            oldClrType: typeof(Guid),
            oldType: "uuid",
            oldNullable: true);

        migrationBuilder.AddForeignKey(
            name: $"FK_{table}_Tenants_TenantId",
            table: table,
            column: "TenantId",
            principalTable: "Tenants",
            principalColumn: "Id",
            onDelete: ReferentialAction.Restrict);

        migrationBuilder.CreateIndex(
            name: $"IX_{table}_TenantId",
            table: table,
            column: "TenantId");
    }
}

protected override void Down(MigrationBuilder migrationBuilder)
{
    var tables = new[]
    {
        "Users", "Participants", "Staff", "Vehicles",
        "AccommodationProperties", "EventTemplates", "TripInstances"
    };

    foreach (var table in tables)
    {
        migrationBuilder.DropForeignKey(name: $"FK_{table}_Tenants_TenantId", table: table);
        migrationBuilder.DropIndex(name: $"IX_{table}_TenantId", table: table);
        migrationBuilder.DropColumn(name: "TenantId", table: table);
    }
}
```

**Note on table names:** Verify the exact PostgreSQL table names by running `\dt` in psql. EF Core typically pluralises entity names. Adjust if your tables differ (e.g., `AccommodationProperty` → `AccommodationProperties`).

- [ ] **Apply the migration**

```bash
dotnet ef database update --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: migration applied without errors. All 7 tables now have TenantId = Default tenant Guid for every row.

- [ ] **Verify**

```sql
SELECT COUNT(*) FROM "Participants" WHERE "TenantId" IS NULL;
-- Should return: 0
SELECT COUNT(*) FROM "Participants" WHERE "TenantId" = '00000000-0000-0000-0000-000000000001';
-- Should return: total row count
```

- [ ] **Commit**

```bash
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat: migration AddTenantIdToRoots — add, backfill, and enforce TenantId on 7 root entities"
```

---

## Task 10: Migration 3 — FixAppSettings

AppSettings was created via raw SQL in `Program.cs` (not via EF migrations), so it can't be altered with `AlterColumn`. This migration drops the old table and creates the new EF-managed version.

- [ ] **Generate the migration**

```bash
dotnet ef migrations add FixAppSettings --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

EF will detect the AppSettings entity changes (new Guid Id, added TenantId). The generated migration may be incorrect — replace it entirely.

- [ ] **Replace the generated Up and Down methods**

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    // Drop the old raw-SQL managed table (int Id, no TenantId)
    migrationBuilder.Sql(@"DROP TABLE IF EXISTS ""AppSettings"";");

    // Create the new EF-managed table (Guid Id, TenantId FK)
    migrationBuilder.CreateTable(
        name: "AppSettings",
        columns: table => new
        {
            Id = table.Column<Guid>(type: "uuid", nullable: false),
            TenantId = table.Column<Guid>(type: "uuid", nullable: false),
            QualificationWarningDays = table.Column<int>(
                type: "integer", nullable: false, defaultValue: 30)
        },
        constraints: table =>
        {
            table.PrimaryKey("PK_AppSettings", x => x.Id);
            table.ForeignKey(
                name: "FK_AppSettings_Tenants_TenantId",
                column: x => x.TenantId,
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        });

    migrationBuilder.CreateIndex(
        name: "IX_AppSettings_TenantId",
        table: "AppSettings",
        column: "TenantId",
        unique: true);

    // Seed one row for the Default tenant
    migrationBuilder.Sql(@"
        INSERT INTO ""AppSettings"" (""Id"", ""TenantId"", ""QualificationWarningDays"")
        VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 30);
    ");
}

protected override void Down(MigrationBuilder migrationBuilder)
{
    migrationBuilder.DropTable(name: "AppSettings");

    // Restore old raw-SQL format
    migrationBuilder.Sql(@"
        CREATE TABLE ""AppSettings"" (
            ""Id"" integer NOT NULL,
            ""QualificationWarningDays"" integer NOT NULL DEFAULT 30,
            CONSTRAINT ""PK_AppSettings"" PRIMARY KEY (""Id"")
        );
        INSERT INTO ""AppSettings"" (""Id"", ""QualificationWarningDays"")
        VALUES (1, 30) ON CONFLICT DO NOTHING;
    ");
}
```

- [ ] **Apply the migration**

```bash
dotnet ef database update --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: old AppSettings table dropped, new one created with one row for Default tenant.

- [ ] **Verify**

```sql
SELECT * FROM "AppSettings";
-- Should return: 1 row with TenantId = 00000000-0000-0000-0000-000000000001
```

- [ ] **Commit**

```bash
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat: migration FixAppSettings — drop singleton table, create per-tenant AppSettings"
```

---

## Task 11: Program.cs and SettingsController

**Files:**
- Modify: `backend/Odip.Api/Program.cs`
- Modify: `backend/Odip.Api/Controllers/SettingsController.cs`

- [ ] **Remove the AppSettings raw SQL block from Program.cs**

In `backend/Odip.Api/Program.cs`, find and delete the block that creates and seeds AppSettings:

```csharp
// DELETE this entire block:
await db.Database.ExecuteSqlRawAsync(
    """
    CREATE TABLE IF NOT EXISTS "AppSettings" (
        "Id" integer NOT NULL,
        "QualificationWarningDays" integer NOT NULL DEFAULT 30,
        CONSTRAINT "PK_AppSettings" PRIMARY KEY ("Id")
    );
    INSERT INTO "AppSettings" ("Id", "QualificationWarningDays")
    VALUES (1, 30)
    ON CONFLICT ("Id") DO NOTHING;
    """);
```

- [ ] **Register ICurrentTenant in DI**

In `Program.cs`, add these two lines in the DI services section (near the other `builder.Services.Add*` calls, before `var app = builder.Build()`):

```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<Odip.Application.Services.ICurrentTenant,
                            Odip.Infrastructure.Services.CurrentTenant>();
```

Also add the required usings at the top of Program.cs if they are not already present:

```csharp
using Odip.Application.Services;
using Odip.Infrastructure.Services;
```

- [ ] **Fix SettingsController — remove Id = 1 hardcode**

In `backend/Odip.Api/Controllers/SettingsController.cs`, update the `Update` method. Replace the `if (s == null)` block:

```csharp
// BEFORE:
if (s == null)
{
    s = new AppSettings { Id = 1, QualificationWarningDays = dto.QualificationWarningDays };
    _db.AppSettings.Add(s);
}

// AFTER:
if (s == null)
{
    s = new AppSettings { QualificationWarningDays = dto.QualificationWarningDays };
    // TenantId is auto-set by OdipDbContext.SaveChangesAsync
    _db.AppSettings.Add(s);
}
```

- [ ] **Build the full solution**

```bash
dotnet build "F:/Projects/personal/Trip Planner/backend/Odip.sln"
```

Expected: `Build succeeded`. Fix any remaining compilation errors before proceeding.

- [ ] **Run the API and verify it starts**

```bash
dotnet run --project backend/Odip.Api
```

Expected: API starts on port 5000. Check for no startup exceptions in the console. `Ctrl+C` to stop.

- [ ] **Commit**

```bash
git add backend/Odip.Api/Program.cs backend/Odip.Api/Controllers/SettingsController.cs
git commit -m "feat: register ICurrentTenant in DI, remove AppSettings raw SQL seed, fix SettingsController"
```

---

## Task 12: AuthController — Tenant Resolution at Login

**Files:**
- Modify: `backend/Odip.Api/Controllers/AuthController.cs`

- [ ] **Update the Login method**

Replace the current `Login` method body with:

```csharp
[HttpPost("login")]
[EnableRateLimiting("login")]
public async Task<ActionResult<ApiResponse<AuthResponseDto>>> Login([FromBody] LoginDto dto, CancellationToken ct)
{
    // Must use IgnoreQueryFilters — ICurrentTenant.TenantId is null pre-auth
    var user = await _db.Users.IgnoreQueryFilters()
        .Include(u => u.Staff)
        .FirstOrDefaultAsync(u => u.Username == dto.Username && u.IsActive, ct);

    if (user == null || !VerifyPassword(dto.Password, user.PasswordHash))
    {
        _logger.LogWarning("Failed login attempt for username: {Username}", dto.Username);
        return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid username or password"));
    }

    // SuperAdmin bypasses tenant resolution — they have no tenant
    Domain.Entities.Tenant? tenant = null;
    if (user.Role != Domain.Enums.UserRole.SuperAdmin)
    {
        var domain = user.Email.Split('@').Last().ToLower();
        tenant = await _db.Tenants
            .FirstOrDefaultAsync(t => t.EmailDomain == domain && t.IsActive, ct);

        if (tenant == null)
        {
            _logger.LogWarning("No active tenant for email domain: {Domain}", domain);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("No active organisation configured for this account"));
        }

        if (user.TenantId != tenant.Id)
        {
            _logger.LogWarning("User {Username} TenantId mismatch", dto.Username);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Account does not belong to the resolved tenant"));
        }
    }

    user.LastLoginAt = DateTime.UtcNow;
    await _db.SaveChangesAsync(ct);

    var token = GenerateJwtToken(user, tenant);
    var response = new AuthResponseDto
    {
        Token = token,
        ExpiresAt = DateTime.UtcNow.AddHours(8),
        Username = user.Username,
        FullName = $"{user.FirstName} {user.LastName}",
        Role = user.Role.ToString(),
        TenantName = tenant?.Name
    };

    return Ok(ApiResponse<AuthResponseDto>.Ok(response));
}
```

- [ ] **Update GenerateJwtToken signature and add tenant_id claim**

Replace the `GenerateJwtToken` method:

```csharp
private string GenerateJwtToken(Domain.Entities.User user, Domain.Entities.Tenant? tenant)
{
    var secret = _config["Jwt:Secret"];
    if (string.IsNullOrWhiteSpace(secret) || secret.StartsWith("CHANGE-ME"))
        secret = Environment.GetEnvironmentVariable("JWT_SECRET");
    if (string.IsNullOrWhiteSpace(secret) || secret.StartsWith("CHANGE-ME"))
        secret = "Odip-Dev-Only-Secret-Min32Characters!!";

    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

    var claims = new List<Claim>
    {
        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new Claim(ClaimTypes.Name, user.Username),
        new Claim(ClaimTypes.Email, user.Email),
        new Claim(ClaimTypes.Role, user.Role.ToString()),
        new Claim("fullName", $"{user.FirstName} {user.LastName}")
    };

    // Non-SuperAdmin users get a tenant_id claim
    if (tenant is not null)
        claims.Add(new Claim("tenant_id", tenant.Id.ToString()));

    var token = new JwtSecurityToken(
        issuer: "Odip",
        audience: "Odip",
        claims: claims,
        expires: DateTime.UtcNow.AddHours(8),
        signingCredentials: creds
    );

    return new JwtSecurityTokenHandler().WriteToken(token);
}
```

- [ ] **Build and verify**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded`.

- [ ] **Smoke test login via curl**

Start the API (`dotnet run --project backend/Odip.Api`), then in a separate terminal:

```bash
curl -s -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<existing-username>","password":"<password>"}' | jq .
```

Expected response includes `tenantName` field and `token`. Decode the token at jwt.io and verify `tenant_id` claim is present.

- [ ] **Commit**

```bash
git add backend/Odip.Api/Controllers/AuthController.cs
git commit -m "feat: tenant resolution at login — email domain → Tenant → JWT tenant_id claim"
```

---

## Task 13: TenantsController — SuperAdmin CRUD

**Files:**
- Create: `backend/Odip.Api/Controllers/TenantsController.cs`

- [ ] **Create the controller**

Create `backend/Odip.Api/Controllers/TenantsController.cs`:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Platform-level tenant management. SuperAdmin only.
/// All queries use IgnoreQueryFilters() — SuperAdmin sees across all tenants.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin")]
[Route("api/v1/admin/tenants")]
public class TenantsController : ControllerBase
{
    private readonly OdipDbContext _db;

    public TenantsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<TenantDto>>>> GetAll(CancellationToken ct)
    {
        var tenants = await _db.Tenants
            .OrderBy(t => t.Name)
            .Select(t => new TenantDto(t.Id, t.Name, t.EmailDomain, t.IsActive, t.CreatedAt))
            .ToListAsync(ct);

        return Ok(ApiResponse<List<TenantDto>>.Ok(tenants));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<TenantDto>>> GetById(Guid id, CancellationToken ct)
    {
        var t = await _db.Tenants.FindAsync([id], ct);
        if (t is null) return NotFound(ApiResponse<TenantDto>.Fail("Tenant not found"));

        return Ok(ApiResponse<TenantDto>.Ok(new TenantDto(t.Id, t.Name, t.EmailDomain, t.IsActive, t.CreatedAt)));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<TenantDto>>> Create(
        [FromBody] CreateTenantDto dto, CancellationToken ct)
    {
        var domain = dto.EmailDomain.ToLower().Trim();
        if (await _db.Tenants.AnyAsync(t => t.EmailDomain == domain, ct))
            return Conflict(ApiResponse<TenantDto>.Fail("A tenant with this email domain already exists"));

        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = dto.Name.Trim(),
            EmailDomain = domain,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Tenants.Add(tenant);

        // Seed default AppSettings for the new tenant
        _db.AppSettings.Add(new AppSettings
        {
            Id = Guid.NewGuid(),
            TenantId = tenant.Id,
            QualificationWarningDays = 30
        });

        await _db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetById), new { id = tenant.Id },
            ApiResponse<TenantDto>.Ok(new TenantDto(tenant.Id, tenant.Name, tenant.EmailDomain, tenant.IsActive, tenant.CreatedAt)));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ApiResponse<TenantDto>>> Update(
        Guid id, [FromBody] UpdateTenantDto dto, CancellationToken ct)
    {
        var tenant = await _db.Tenants.FindAsync([id], ct);
        if (tenant is null) return NotFound(ApiResponse<TenantDto>.Fail("Tenant not found"));

        var domain = dto.EmailDomain.ToLower().Trim();
        if (await _db.Tenants.AnyAsync(t => t.EmailDomain == domain && t.Id != id, ct))
            return Conflict(ApiResponse<TenantDto>.Fail("Email domain already used by another tenant"));

        tenant.Name = dto.Name.Trim();
        tenant.EmailDomain = domain;
        tenant.IsActive = dto.IsActive;

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<TenantDto>.Ok(new TenantDto(tenant.Id, tenant.Name, tenant.EmailDomain, tenant.IsActive, tenant.CreatedAt)));
    }

    [HttpGet("{id:guid}/users")]
    public async Task<ActionResult<ApiResponse<List<object>>>> GetUsers(Guid id, CancellationToken ct)
    {
        var users = await _db.Users.IgnoreQueryFilters()
            .Where(u => u.TenantId == id)
            .OrderBy(u => u.LastName)
            .Select(u => new
            {
                u.Id,
                u.Username,
                u.Email,
                u.FullName,
                Role = u.Role.ToString(),
                u.IsActive,
                u.CreatedAt
            })
            .ToListAsync(ct);

        return Ok(ApiResponse<List<object>>.Ok(users.Cast<object>().ToList()));
    }
}
```

- [ ] **Build the API**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded`.

- [ ] **Run all tests**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj -v normal
```

Expected: `6 passed, 0 failed`.

- [ ] **Commit**

```bash
git add backend/Odip.Api/Controllers/TenantsController.cs
git commit -m "feat: add TenantsController for SuperAdmin tenant CRUD"
```

---

## Task 14: Frontend — tenantName in Login + Org Name in Navbar

**Files:**
- Modify: whichever file handles the login mutation response (likely `frontend/src/api/hooks.ts` or a login page file — read it first)
- Modify: `frontend/src/components/layout/AppLayout.tsx`

- [ ] **Find the login handler**

Read `frontend/src/api/hooks.ts`. Search for `odip_user` to find where the login API response is handled and stored in localStorage. It will look something like:

```typescript
localStorage.setItem('odip_user', JSON.stringify({ username, fullName, role }))
```

- [ ] **Add tenantName to localStorage on login**

In the login mutation handler, add `tenantName` to the object stored under `odip_user`:

```typescript
// Before:
localStorage.setItem('odip_user', JSON.stringify({
  username: data.data.username,
  fullName: data.data.fullName,
  role: data.data.role,
}))

// After (add tenantName):
localStorage.setItem('odip_user', JSON.stringify({
  username: data.data.username,
  fullName: data.data.fullName,
  role: data.data.role,
  tenantName: data.data.tenantName ?? null,
}))
```

- [ ] **Read AppLayout.tsx** to understand the current navbar structure before editing it.

- [ ] **Add the org name pill to the navbar**

In `frontend/src/components/layout/AppLayout.tsx`, read `tenantName` from localStorage and display it next to the app name. Add this wherever the brand/logo text is rendered:

```tsx
// Near the top of the component (or inside the component function):
const storedUser = JSON.parse(localStorage.getItem('odip_user') ?? '{}')
const tenantName: string | null = storedUser.tenantName ?? null

// In the JSX, next to the "Odip" brand name:
<span className="font-bold text-white">Odip</span>
{tenantName && (
  <span className="ml-3 text-xs bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-2.5 py-0.5 rounded-full">
    {tenantName}
  </span>
)}
```

Place this immediately after the existing brand/logo element, adjusting the exact JSX to match the surrounding structure you read in the previous step.

- [ ] **Build the frontend**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Start the frontend dev server and verify visually**

```bash
npm run dev
```

Open http://localhost:5173, log in, and verify:
1. The org name pill appears in the navbar
2. Logging out and back in refreshes it correctly
3. No console errors

- [ ] **Commit**

```bash
cd "F:/Projects/personal/Trip Planner"
git add frontend/src/
git commit -m "feat: display org name in navbar, store tenantName in localStorage on login"
```

---

## Final Verification

- [ ] **Run full build**

```bash
dotnet build "F:/Projects/personal/Trip Planner/backend/Odip.sln"
```

Expected: `Build succeeded, 0 Error(s)`.

- [ ] **Run all tests**

```bash
dotnet test backend/Odip.Tests/Odip.Tests.csproj -v normal
```

Expected: all pass.

- [ ] **Start the full stack and verify tenant isolation**

```bash
# Terminal 1 — API
dotnet run --project backend/Odip.Api

# Terminal 2 — Frontend
cd frontend && npm run dev
```

1. Log in with an existing user → verify org name appears in navbar
2. Try accessing `/api/v1/trips` with the JWT → verify only Default tenant's trips are returned
3. Verify `/api/v1/admin/tenants` returns 403 Forbidden for a non-SuperAdmin user

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: complete multi-tenancy — EF Core query filters, JWT tenant resolution, SuperAdmin endpoints"
```
