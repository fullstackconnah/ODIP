# Per-Tenant Provider Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ProviderSettings` tenant-scoped so each tenant has independent provider identity (ABN, registration number, bank account details, invoice footer).

**Architecture:** Follow the established `ITenantEntity` pattern used by `AppSettings` — add `TenantId` + `Tenant?` to the entity, add the FK relationship and query filter to DbContext, and generate an EF migration that backfills the existing row to the Demo tenant before enforcing NOT NULL.

**Tech Stack:** .NET 9, ASP.NET Core, EF Core 8, PostgreSQL 16

---

## Files

| Action | File |
|--------|------|
| Modify | `backend/Odip.Domain/Entities/ProviderSettings.cs` |
| Modify | `backend/Odip.Infrastructure/Data/OdipDbContext.cs` |
| Create | `backend/Odip.Infrastructure/Migrations/<timestamp>_MakeProviderSettingsPerTenant.cs` (generated, then edited) |
| Create | `backend/Odip.Infrastructure/Migrations/<timestamp>_MakeProviderSettingsPerTenant.Designer.cs` (generated, do not edit) |

---

### Task 1: Add ITenantEntity to ProviderSettings entity

**Files:**
- Modify: `backend/Odip.Domain/Entities/ProviderSettings.cs`

- [ ] **Step 1: Replace the file contents**

Current file has no `using` directives. Replace the entire file:

```csharp
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

public class ProviderSettings : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string RegistrationNumber { get; set; } = string.Empty;
    public string ABN { get; set; } = string.Empty;
    public string OrganisationName { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string State { get; set; } = "VIC";
    public bool GSTRegistered { get; set; }
    public bool IsPaceProvider { get; set; }

    public string? BankAccountName { get; set; }
    public string? BSB { get; set; }
    public string? AccountNumber { get; set; }
    public string? InvoiceFooterNotes { get; set; }
}
```

- [ ] **Step 2: Build the Domain project to verify no compile errors**

```bash
dotnet build backend/Odip.Domain
```
Expected output ends with: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Domain/Entities/ProviderSettings.cs
git commit -m "feat: ProviderSettings implements ITenantEntity"
```

---

### Task 2: Update DbContext — FK relationship and query filter

**Files:**
- Modify: `backend/Odip.Infrastructure/Data/OdipDbContext.cs`

**Change 1 — Add FK relationship inside the ProviderSettings entity config block.**

Find this block (around `// ── ProviderSettings ──────────────────────────────────────────`):

```csharp
        // ── ProviderSettings ──────────────────────────────────────────
        modelBuilder.Entity<ProviderSettings>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RegistrationNumber).HasMaxLength(20);
            entity.Property(e => e.ABN).HasMaxLength(20);
            entity.Property(e => e.OrganisationName).HasMaxLength(200);
            entity.Property(e => e.Address).HasMaxLength(500);
            entity.Property(e => e.BankAccountName).HasMaxLength(200);
            entity.Property(e => e.BSB).HasMaxLength(10);
            entity.Property(e => e.AccountNumber).HasMaxLength(20);
            entity.Property(e => e.InvoiceFooterNotes).HasMaxLength(2000);
        });
```

Replace it with:

```csharp
        // ── ProviderSettings ──────────────────────────────────────────
        modelBuilder.Entity<ProviderSettings>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RegistrationNumber).HasMaxLength(20);
            entity.Property(e => e.ABN).HasMaxLength(20);
            entity.Property(e => e.OrganisationName).HasMaxLength(200);
            entity.Property(e => e.Address).HasMaxLength(500);
            entity.Property(e => e.BankAccountName).HasMaxLength(200);
            entity.Property(e => e.BSB).HasMaxLength(10);
            entity.Property(e => e.AccountNumber).HasMaxLength(20);
            entity.Property(e => e.InvoiceFooterNotes).HasMaxLength(2000);

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });
```

**Change 2 — Add query filter and index in the Multi-Tenancy section.**

Find this block at the end of the Multi-Tenancy Query Filters section:

```csharp
        modelBuilder.Entity<AppSettings>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<AppSettings>()
            .HasIndex(e => e.TenantId);

        // Tenants table — unique index on EmailDomain
```

Replace it with:

```csharp
        modelBuilder.Entity<AppSettings>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<AppSettings>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ProviderSettings>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ProviderSettings>()
            .HasIndex(e => e.TenantId);

        // Tenants table — unique index on EmailDomain
```

- [ ] **Step 1: Apply both changes above**

- [ ] **Step 2: Build the Infrastructure project**

```bash
dotnet build backend/Odip.Infrastructure
```
Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Infrastructure/Data/OdipDbContext.cs
git commit -m "feat: add tenant FK, query filter, and index for ProviderSettings in DbContext"
```

---

### Task 3: Generate the EF migration

- [ ] **Step 1: Generate the migration**

Run from the repo root:

```bash
dotnet ef migrations add MakeProviderSettingsPerTenant \
  --project backend/Odip.Infrastructure \
  --startup-project backend/Odip.Api
```
Expected output: `Build succeeded.` then `Done.`

The generated file will be at:
`backend/Odip.Infrastructure/Migrations/<timestamp>_MakeProviderSettingsPerTenant.cs`

- [ ] **Step 2: Open the generated migration file**

The EF-generated `Up()` will add `TenantId` as non-nullable immediately, which will fail if the table has existing rows. You need to modify it to:
1. Add as nullable
2. Backfill
3. Make non-nullable
4. Add FK
5. Add index

- [ ] **Step 3: Replace the entire `Up()` and `Down()` methods with the following**

(Keep the class declaration, namespace, and `[DbContext]` / `[Migration]` attributes as EF generated them — only replace the method bodies.)

```csharp
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Add TenantId as nullable first so existing rows can be backfilled
        migrationBuilder.AddColumn<Guid>(
            name: "TenantId",
            table: "ProviderSettings",
            type: "uuid",
            nullable: true);

        // Assign the existing row to the Demo tenant
        migrationBuilder.Sql("""
            UPDATE "ProviderSettings"
            SET "TenantId" = (SELECT "Id" FROM "Tenants" WHERE "Name" = 'Demo')
            WHERE "TenantId" IS NULL;
            """);

        // Now enforce NOT NULL — will fail loudly if Demo tenant does not exist
        migrationBuilder.AlterColumn<Guid>(
            name: "TenantId",
            table: "ProviderSettings",
            type: "uuid",
            nullable: false,
            oldClrType: typeof(Guid),
            oldType: "uuid",
            oldNullable: true);

        // FK to Tenants
        migrationBuilder.AddForeignKey(
            name: "FK_ProviderSettings_Tenants_TenantId",
            table: "ProviderSettings",
            column: "TenantId",
            principalTable: "Tenants",
            principalColumn: "Id",
            onDelete: ReferentialAction.Cascade);

        // Index for query filter performance
        migrationBuilder.CreateIndex(
            name: "IX_ProviderSettings_TenantId",
            table: "ProviderSettings",
            column: "TenantId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_ProviderSettings_Tenants_TenantId",
            table: "ProviderSettings");

        migrationBuilder.DropIndex(
            name: "IX_ProviderSettings_TenantId",
            table: "ProviderSettings");

        migrationBuilder.DropColumn(
            name: "TenantId",
            table: "ProviderSettings");
    }
```

- [ ] **Step 4: Build to verify the edited migration compiles**

```bash
dotnet build backend/Odip.Infrastructure
```
Expected: `Build succeeded.`

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat: migration MakeProviderSettingsPerTenant — backfills Demo tenant"
```

---

### Task 4: Apply the migration and verify

- [ ] **Step 1: Apply the migration**

```bash
dotnet ef database update \
  --project backend/Odip.Infrastructure \
  --startup-project backend/Odip.Api
```
Expected: each migration logs `Applying migration '...'` then `Done.`

**If it fails** with a NOT NULL constraint violation: the tenant name doesn't match.
Check the actual name: run `SELECT "Name" FROM "Tenants";` against the DB, then update the SQL in the migration file to use that name, run `dotnet ef database update` again.

- [ ] **Step 2: Build and start the API**

```bash
dotnet run --project backend/Odip.Api
```
Expected: API starts on `http://localhost:5000` with no errors.

- [ ] **Step 3: GET provider settings as the Demo tenant**

Obtain a JWT for the Demo tenant (log in via `POST /api/v1/auth/login` with a Demo tenant user).

```bash
curl -s http://localhost:5000/api/v1/provider-settings \
  -H "Authorization: Bearer <demo-jwt>" | jq
```
Expected: the existing provider settings JSON (ABN, org name, etc.) — this is the backfilled row.

- [ ] **Step 4: Verify a different tenant gets no data**

Obtain a JWT for a second tenant (create one via SuperAdmin if needed).

```bash
curl -s http://localhost:5000/api/v1/provider-settings \
  -H "Authorization: Bearer <other-tenant-jwt>" | jq
```
Expected: empty/null body or `204 No Content` — the other tenant's row does not exist yet.

- [ ] **Step 5: PUT creates isolated settings for the second tenant**

```bash
curl -s -X PUT http://localhost:5000/api/v1/provider-settings \
  -H "Authorization: Bearer <other-tenant-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "registrationNumber": "REG002",
    "abn": "98765432109",
    "organisationName": "Second Org",
    "address": "2 Test St, Sydney",
    "state": "NSW",
    "gstRegistered": true,
    "isPaceProvider": false
  }' | jq
```
Expected: `200 OK` with the saved data.

- [ ] **Step 6: Confirm Demo tenant data is unchanged**

```bash
curl -s http://localhost:5000/api/v1/provider-settings \
  -H "Authorization: Bearer <demo-jwt>" | jq
```
Expected: still shows the original Demo tenant values (not the second tenant's data).

- [ ] **Step 7: Stop the API and commit if verification passed**

No code changes needed in this task. The feature is complete once all curl checks pass.

```bash
git tag "per-tenant-provider-settings-complete"
```

---

## Done when

- [x] `ProviderSettings` entity implements `ITenantEntity`
- [x] DbContext has FK relationship, query filter, and index for `ProviderSettings`
- [x] Migration applied successfully — existing row assigned to Demo tenant
- [x] GET returns only the requesting tenant's provider settings
- [x] PUT upserts only within the requesting tenant's scope
- [x] No frontend or DTO changes required
