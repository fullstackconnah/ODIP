# NDIS Claiming Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build end-to-end NDIS claiming from completed trip → BPR CSV / PDF invoices, with full claim lifecycle tracking.

**Architecture:** New entities (TripClaim, ClaimLineItem, SupportActivityGroup, SupportCatalogueItem, ProviderSettings, PublicHoliday) extend five existing entities. A ClaimGenerationService handles business logic; BprCsvService and InvoiceService handle file output. Controllers expose 14 endpoints. Auto-task fires when trip moves to Completed.

**Tech Stack:** .NET 9, EF Core 8, PostgreSQL 16, QuestPDF 2024.12.2 (already in Infrastructure.csproj)

---

## File Map

### New files — Domain
| File | Responsibility |
|---|---|
| `backend/Odip.Domain/Entities/TripClaim.cs` | Claim aggregate per trip |
| `backend/Odip.Domain/Entities/ClaimLineItem.cs` | One row per participant per day-type |
| `backend/Odip.Domain/Entities/SupportActivityGroup.cs` | Groups related day-type item codes |
| `backend/Odip.Domain/Entities/SupportCatalogueItem.cs` | Item code + price limits per day type |
| `backend/Odip.Domain/Entities/ProviderSettings.cs` | Org-level NDIS registration |
| `backend/Odip.Domain/Entities/PublicHoliday.cs` | Public holiday table |

### Modified files — Domain
| File | Change |
|---|---|
| `backend/Odip.Domain/Enums/Enums.cs` | +7 new enums, +GenerateNdisClaims to TaskType |
| `backend/Odip.Domain/Entities/TripInstance.cs` | +DefaultActivityGroupId, +ActiveHoursPerDay |
| `backend/Odip.Domain/Entities/TripDay.cs` | +IsPublicHoliday, +OvernightType, +OvernightHours |
| `backend/Odip.Domain/Entities/Participant.cs` | +PlanStartDate, +PlanEndDate, +PlanManagerContactId |
| `backend/Odip.Domain/Entities/ParticipantBooking.cs` | +ClaimStatus, +CancellationNoticeDate |
| `backend/Odip.Domain/Entities/Contact.cs` | +ContactType |

### New files — Infrastructure / Application
| File | Responsibility |
|---|---|
| `backend/Odip.Application/DTOs/ClaimDTOs.cs` | All claim-related request/response records |
| `backend/Odip.Infrastructure/Services/ClaimGenerationService.cs` | Draft generation logic |
| `backend/Odip.Infrastructure/Services/BprCsvService.cs` | BPR CSV formatter |
| `backend/Odip.Infrastructure/Services/InvoiceService.cs` | QuestPDF invoice renderer |

### Modified files — Infrastructure
| File | Change |
|---|---|
| `backend/Odip.Infrastructure/Data/OdipDbContext.cs` | +6 DbSets + fluent config |

### New files — API
| File | Responsibility |
|---|---|
| `backend/Odip.Api/Controllers/ClaimsController.cs` | Claim CRUD + file downloads |
| `backend/Odip.Api/Controllers/ProviderSettingsController.cs` | GET/PUT provider config |
| `backend/Odip.Api/Controllers/SupportCatalogueController.cs` | Catalogue read + import |
| `backend/Odip.Api/Controllers/PublicHolidaysController.cs` | Holiday admin |

### Modified files — API
| File | Change |
|---|---|
| `backend/Odip.Api/Controllers/TripsController.cs` | Add Completed gate → auto-task |
| `backend/Odip.Api/Program.cs` | Register services + Program.cs migration block |

---

## Task 1: Add new enums to Enums.cs

**Files:**
- Modify: `backend/Odip.Domain/Enums/Enums.cs`

- [ ] **Step 1: Append 7 new enums and extend TaskType**

Open `backend/Odip.Domain/Enums/Enums.cs` and append after the `PaymentStatus` enum (line 250):

```csharp
public enum ContactType
{
    General = 0,
    Guardian = 1,
    EmergencyContact = 2,
    PlanManager = 3,
    SupportCoordinator = 4,
    Other = 5
}

public enum TripClaimStatus
{
    Draft = 0,
    Ready = 1,
    Submitted = 2,
    Paid = 3,
    PartiallyPaid = 4,
    Rejected = 5
}

public enum ClaimLineItemStatus
{
    Draft = 0,
    Submitted = 1,
    Paid = 2,
    Rejected = 3
}

public enum ClaimDayType
{
    Weekday = 0,
    Saturday = 1,
    Sunday = 2,
    PublicHoliday = 3
}

public enum ClaimType
{
    Standard = 0,
    Cancellation = 1
}

public enum GSTCode
{
    P1 = 0,
    P2 = 1,
    P5 = 2
}

public enum ClaimStatus
{
    NotClaimed = 0,
    InClaim = 1,
    Submitted = 2,
    Paid = 3,
    Rejected = 4
}

public enum OvernightSupportType
{
    None = 0,
    ActiveNight = 1,
    Sleepover = 2
}
```

Also add `GenerateNdisClaims` to the existing `TaskType` enum — insert after `InsuranceConfirmation`:

```csharp
    InsuranceConfirmation,
    GenerateNdisClaims,
    Other
```

(Remove the existing `Other` from after `InsuranceConfirmation` and re-add it after `GenerateNdisClaims`.)

- [ ] **Step 2: Build to verify no errors**

```bash
cd "F:/Projects/personal/Trip Planner/backend"
dotnet build Odip.Domain/Odip.Domain.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Domain/Enums/Enums.cs
git commit -m "feat(ndis): add claiming enums and GenerateNdisClaims task type"
```

---

## Task 2: Create 6 new domain entities

**Files:**
- Create: `backend/Odip.Domain/Entities/TripClaim.cs`
- Create: `backend/Odip.Domain/Entities/ClaimLineItem.cs`
- Create: `backend/Odip.Domain/Entities/SupportActivityGroup.cs`
- Create: `backend/Odip.Domain/Entities/SupportCatalogueItem.cs`
- Create: `backend/Odip.Domain/Entities/ProviderSettings.cs`
- Create: `backend/Odip.Domain/Entities/PublicHoliday.cs`

- [ ] **Step 1: Create TripClaim.cs**

```csharp
using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class TripClaim
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;

    public TripClaimStatus Status { get; set; } = TripClaimStatus.Draft;
    public string ClaimReference { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public decimal TotalApprovedAmount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SubmittedDate { get; set; }
    public DateTime? PaidDate { get; set; }

    public Guid? AuthorisedByStaffId { get; set; }
    public Staff? AuthorisedByStaff { get; set; }

    public string? Notes { get; set; }

    public ICollection<ClaimLineItem> LineItems { get; set; } = new List<ClaimLineItem>();
}
```

- [ ] **Step 2: Create ClaimLineItem.cs**

```csharp
using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class ClaimLineItem
{
    public Guid Id { get; set; }
    public Guid TripClaimId { get; set; }
    public TripClaim TripClaim { get; set; } = null!;
    public Guid ParticipantBookingId { get; set; }
    public ParticipantBooking ParticipantBooking { get; set; } = null!;

    public string SupportItemCode { get; set; } = string.Empty;
    public ClaimDayType DayType { get; set; }
    public DateOnly SupportsDeliveredFrom { get; set; }
    public DateOnly SupportsDeliveredTo { get; set; }

    public decimal Hours { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalAmount { get; set; }

    public GSTCode GSTCode { get; set; }
    public ClaimType ClaimType { get; set; } = ClaimType.Standard;
    public bool ParticipantApproved { get; set; }

    public ClaimLineItemStatus Status { get; set; } = ClaimLineItemStatus.Draft;
    public string? RejectionReason { get; set; }
    public decimal? PaidAmount { get; set; }
}
```

- [ ] **Step 3: Create SupportActivityGroup.cs**

```csharp
namespace Odip.Domain.Entities;

public class SupportActivityGroup
{
    public Guid Id { get; set; }
    public string GroupCode { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int SupportCategory { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<SupportCatalogueItem> Items { get; set; } = new List<SupportCatalogueItem>();
}
```

- [ ] **Step 4: Create SupportCatalogueItem.cs**

```csharp
using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class SupportCatalogueItem
{
    public Guid Id { get; set; }
    public Guid ActivityGroupId { get; set; }
    public SupportActivityGroup ActivityGroup { get; set; } = null!;

    public string ItemNumber { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Unit { get; set; } = "H";
    public ClaimDayType DayType { get; set; }

    public decimal PriceLimit_Standard { get; set; }
    public decimal PriceLimit_1to2 { get; set; }
    public decimal PriceLimit_1to3 { get; set; }
    public decimal PriceLimit_1to4 { get; set; }
    public decimal PriceLimit_1to5 { get; set; }
    public decimal PriceLimit_Remote { get; set; }
    public decimal PriceLimit_VeryRemote { get; set; }

    public string CatalogueVersion { get; set; } = string.Empty;
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public bool IsActive { get; set; } = true;
}
```

- [ ] **Step 5: Create ProviderSettings.cs**

```csharp
namespace Odip.Domain.Entities;

public class ProviderSettings
{
    public Guid Id { get; set; }
    public string RegistrationNumber { get; set; } = string.Empty;
    public string ABN { get; set; } = string.Empty;
    public string OrganisationName { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public bool GSTRegistered { get; set; }
    public bool IsPaceProvider { get; set; }

    public string? BankAccountName { get; set; }
    public string? BSB { get; set; }
    public string? AccountNumber { get; set; }
    public string? InvoiceFooterNotes { get; set; }
}
```

- [ ] **Step 6: Create PublicHoliday.cs**

```csharp
namespace Odip.Domain.Entities;

public class PublicHoliday
{
    public Guid Id { get; set; }
    public DateOnly Date { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? State { get; set; }
}
```

- [ ] **Step 7: Build Domain project**

```bash
dotnet build backend/Odip.Domain/Odip.Domain.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 8: Commit**

```bash
git add backend/Odip.Domain/Entities/TripClaim.cs backend/Odip.Domain/Entities/ClaimLineItem.cs backend/Odip.Domain/Entities/SupportActivityGroup.cs backend/Odip.Domain/Entities/SupportCatalogueItem.cs backend/Odip.Domain/Entities/ProviderSettings.cs backend/Odip.Domain/Entities/PublicHoliday.cs
git commit -m "feat(ndis): add TripClaim, ClaimLineItem, SupportCatalogueItem, ProviderSettings, PublicHoliday entities"
```

---

## Task 3: Modify 5 existing entities

**Files:**
- Modify: `backend/Odip.Domain/Entities/TripInstance.cs`
- Modify: `backend/Odip.Domain/Entities/TripDay.cs`
- Modify: `backend/Odip.Domain/Entities/Participant.cs`
- Modify: `backend/Odip.Domain/Entities/ParticipantBooking.cs`
- Modify: `backend/Odip.Domain/Entities/Contact.cs`

- [ ] **Step 1: Add 2 fields to TripInstance.cs**

After `public string? Notes { get; set; }` (before `public DateTime CreatedAt`), insert:

```csharp
    public Guid? DefaultActivityGroupId { get; set; }
    public SupportActivityGroup? DefaultActivityGroup { get; set; }
    public decimal ActiveHoursPerDay { get; set; } = 8;
```

Also add `TripClaims` nav prop after the `IncidentReports` collection:

```csharp
    public ICollection<TripClaim> TripClaims { get; set; } = new List<TripClaim>();
```

- [ ] **Step 2: Add 3 fields to TripDay.cs**

After `public string? DayNotes { get; set; }`, insert:

```csharp
    public bool IsPublicHoliday { get; set; }
    public OvernightSupportType OvernightType { get; set; } = OvernightSupportType.None;
    public decimal OvernightHours { get; set; }
```

Also add the using at the top: `using Odip.Domain.Enums;`

- [ ] **Step 3: Add 3 fields to Participant.cs**

After `public string? Notes { get; set; }`, insert:

```csharp
    public DateOnly? PlanStartDate { get; set; }
    public DateOnly? PlanEndDate { get; set; }
    public Guid? PlanManagerContactId { get; set; }
    public Contact? PlanManagerContact { get; set; }
```

- [ ] **Step 4: Add 2 fields to ParticipantBooking.cs**

After `public InsuranceStatus InsuranceStatus { get; set; } = InsuranceStatus.None;`, insert:

```csharp
    public ClaimStatus ClaimStatus { get; set; } = ClaimStatus.NotClaimed;
    public DateOnly? CancellationNoticeDate { get; set; }
```

- [ ] **Step 5: Add ContactType field to Contact.cs**

The `Contact.cs` currently has no `ContactType` field. Add after `public PreferredContactMethod PreferredContactMethod { get; set; }`:

```csharp
    public ContactType ContactType { get; set; }
```

- [ ] **Step 6: Build to verify**

```bash
dotnet build backend/Odip.Domain/Odip.Domain.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 7: Commit**

```bash
git add backend/Odip.Domain/Entities/TripInstance.cs backend/Odip.Domain/Entities/TripDay.cs backend/Odip.Domain/Entities/Participant.cs backend/Odip.Domain/Entities/ParticipantBooking.cs backend/Odip.Domain/Entities/Contact.cs
git commit -m "feat(ndis): extend TripInstance, TripDay, Participant, ParticipantBooking, Contact for claiming"
```

---

## Task 4: Update OdipDbContext

**Files:**
- Modify: `backend/Odip.Infrastructure/Data/OdipDbContext.cs`

- [ ] **Step 1: Add 6 new DbSets**

After `public DbSet<AppSettings> AppSettings => Set<AppSettings>();` (line 36), add:

```csharp
    public DbSet<TripClaim> TripClaims => Set<TripClaim>();
    public DbSet<ClaimLineItem> ClaimLineItems => Set<ClaimLineItem>();
    public DbSet<SupportActivityGroup> SupportActivityGroups => Set<SupportActivityGroup>();
    public DbSet<SupportCatalogueItem> SupportCatalogueItems => Set<SupportCatalogueItem>();
    public DbSet<ProviderSettings> ProviderSettings => Set<ProviderSettings>();
    public DbSet<PublicHoliday> PublicHolidays => Set<PublicHoliday>();
```

- [ ] **Step 2: Add fluent config for new entities**

At the end of `OnModelCreating`, before the closing `}`, add:

```csharp
        // ── TripClaim ─────────────────────────────────────────────
        modelBuilder.Entity<TripClaim>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ClaimReference).HasMaxLength(50).IsRequired();
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.Property(e => e.TotalApprovedAmount).HasPrecision(18, 2);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.TripClaims)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.AuthorisedByStaff)
                .WithMany()
                .HasForeignKey(e => e.AuthorisedByStaffId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.ClaimReference).IsUnique();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.TripInstanceId);
        });

        // ── ClaimLineItem ─────────────────────────────────────────
        modelBuilder.Entity<ClaimLineItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SupportItemCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(18, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(18, 2);
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.Property(e => e.PaidAmount).HasPrecision(18, 2);
            entity.Property(e => e.RejectionReason).HasMaxLength(1000);

            entity.HasOne(e => e.TripClaim)
                .WithMany(c => c.LineItems)
                .HasForeignKey(e => e.TripClaimId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.ParticipantBooking)
                .WithMany()
                .HasForeignKey(e => e.ParticipantBookingId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.TripClaimId);
            entity.HasIndex(e => e.ParticipantBookingId);
            entity.HasIndex(e => e.Status);
        });

        // ── SupportActivityGroup ──────────────────────────────────
        modelBuilder.Entity<SupportActivityGroup>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.GroupCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(200).IsRequired();

            entity.HasIndex(e => e.GroupCode).IsUnique();
            entity.HasIndex(e => e.IsActive);
        });

        // ── SupportCatalogueItem ──────────────────────────────────
        modelBuilder.Entity<SupportCatalogueItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ItemNumber).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Unit).HasMaxLength(10);
            entity.Property(e => e.CatalogueVersion).HasMaxLength(20);
            entity.Property(e => e.PriceLimit_Standard).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_1to2).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_1to3).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_1to4).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_1to5).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_Remote).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_VeryRemote).HasPrecision(18, 2);

            entity.HasOne(e => e.ActivityGroup)
                .WithMany(g => g.Items)
                .HasForeignKey(e => e.ActivityGroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => new { e.ItemNumber, e.CatalogueVersion });
            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.DayType);
        });

        // ── ProviderSettings ──────────────────────────────────────
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

        // ── PublicHoliday ─────────────────────────────────────────
        modelBuilder.Entity<PublicHoliday>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.State).HasMaxLength(10);

            entity.HasIndex(e => e.Date);
            entity.HasIndex(e => new { e.Date, e.State });
        });

        // ── TripInstance — new FK to SupportActivityGroup ─────────
        modelBuilder.Entity<TripInstance>()
            .HasOne(t => t.DefaultActivityGroup)
            .WithMany()
            .HasForeignKey(t => t.DefaultActivityGroupId)
            .OnDelete(DeleteBehavior.SetNull);

        // ── Participant — new FK to Contact (PlanManager) ─────────
        modelBuilder.Entity<Participant>()
            .HasOne(p => p.PlanManagerContact)
            .WithMany()
            .HasForeignKey(p => p.PlanManagerContactId)
            .OnDelete(DeleteBehavior.SetNull);
```

- [ ] **Step 3: Build Infrastructure project**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/Data/OdipDbContext.cs
git commit -m "feat(ndis): add DbSets and fluent config for claiming entities"
```

---

## Task 5: Run EF Core migrations

**Files:**
- New migration files generated under `backend/Odip.Infrastructure/Migrations/`

- [ ] **Step 1: Create migration for new tables**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet ef migrations add AddNdisClaiming --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: `Done. To undo this action, use 'ef migrations remove'`

- [ ] **Step 2: Create migration for existing entity changes**

```bash
dotnet ef migrations add AddClaimingFieldsToExistingEntities --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: `Done.`

- [ ] **Step 3: Apply migrations**

```bash
dotnet ef database update --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: `Done.`

- [ ] **Step 4: Commit migration files**

```bash
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat(ndis): add EF migrations for claiming tables and entity changes"
```

---

## Task 6: Seed catalogue data and public holidays

**Files:**
- Modify: `backend/Odip.Infrastructure/Data/DbSeeder.cs`
- Modify: `backend/Odip.Api/Program.cs`

The seed data adds:
- 1 `SupportActivityGroup` for Group Community Access (Category 04)
- 4 `SupportCatalogueItem` rows (Weekday / Saturday / Sunday / PublicHoliday)
- National public holidays + VIC-specific holidays for 2025 and 2026

- [ ] **Step 1: Add a new static seed method for catalogue data**

In `DbSeeder.cs`, add a new public method `SeedNdisDataAsync` after `SeedAsync`:

```csharp
public static async Task SeedNdisDataAsync(OdipDbContext context, CancellationToken ct = default)
{
    if (await context.SupportActivityGroups.AnyAsync(ct))
        return;

    var groupId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    var group = new SupportActivityGroup
    {
        Id = groupId,
        GroupCode = "GRP_COMMUNITY_ACCESS",
        DisplayName = "Group Community Access",
        SupportCategory = 4,
        IsActive = true
    };
    context.SupportActivityGroups.Add(group);

    // 2024-25 NDIS Support Catalogue prices — Category 04, Registration Group 0125
    // Ratios: Standard (1:1), 1:2, 1:3, 1:4, 1:5
    var items = new List<SupportCatalogueItem>
    {
        new()
        {
            Id = Guid.Parse("d0000000-0000-0000-0000-000000000001"),
            ActivityGroupId = groupId,
            ItemNumber = "04_210_0125_6_1",
            Description = "Group Activities - Standard - Weekday Daytime - TTP",
            Unit = "H",
            DayType = ClaimDayType.Weekday,
            PriceLimit_Standard = 67.56m,
            PriceLimit_1to2 = 40.32m,
            PriceLimit_1to3 = 29.97m,
            PriceLimit_1to4 = 24.81m,
            PriceLimit_1to5 = 21.72m,
            PriceLimit_Remote = 94.58m,
            PriceLimit_VeryRemote = 101.34m,
            CatalogueVersion = "2024-25",
            EffectiveFrom = new DateOnly(2024, 7, 1),
            IsActive = true
        },
        new()
        {
            Id = Guid.Parse("d0000000-0000-0000-0000-000000000002"),
            ActivityGroupId = groupId,
            ItemNumber = "04_212_0125_6_1",
            Description = "Group Activities - Standard - Saturday - TTP",
            Unit = "H",
            DayType = ClaimDayType.Saturday,
            PriceLimit_Standard = 94.91m,
            PriceLimit_1to2 = 56.18m,
            PriceLimit_1to3 = 41.54m,
            PriceLimit_1to4 = 34.21m,
            PriceLimit_1to5 = 29.81m,
            PriceLimit_Remote = 132.87m,
            PriceLimit_VeryRemote = 142.37m,
            CatalogueVersion = "2024-25",
            EffectiveFrom = new DateOnly(2024, 7, 1),
            IsActive = true
        },
        new()
        {
            Id = Guid.Parse("d0000000-0000-0000-0000-000000000003"),
            ActivityGroupId = groupId,
            ItemNumber = "04_213_0125_6_1",
            Description = "Group Activities - Standard - Sunday - TTP",
            Unit = "H",
            DayType = ClaimDayType.Sunday,
            PriceLimit_Standard = 122.25m,
            PriceLimit_1to2 = 71.88m,
            PriceLimit_1to3 = 53.10m,
            PriceLimit_1to4 = 43.72m,
            PriceLimit_1to5 = 37.91m,
            PriceLimit_Remote = 171.15m,
            PriceLimit_VeryRemote = 183.38m,
            CatalogueVersion = "2024-25",
            EffectiveFrom = new DateOnly(2024, 7, 1),
            IsActive = true
        },
        new()
        {
            Id = Guid.Parse("d0000000-0000-0000-0000-000000000004"),
            ActivityGroupId = groupId,
            ItemNumber = "04_214_0125_6_1",
            Description = "Group Activities - Standard - Public Holiday - TTP",
            Unit = "H",
            DayType = ClaimDayType.PublicHoliday,
            PriceLimit_Standard = 149.60m,
            PriceLimit_1to2 = 87.58m,
            PriceLimit_1to3 = 64.65m,
            PriceLimit_1to4 = 53.21m,
            PriceLimit_1to5 = 46.07m,
            PriceLimit_Remote = 209.44m,
            PriceLimit_VeryRemote = 224.40m,
            CatalogueVersion = "2024-25",
            EffectiveFrom = new DateOnly(2024, 7, 1),
            IsActive = true
        }
    };
    context.SupportCatalogueItems.AddRange(items);

    // Public Holidays — National + VIC 2025 and 2026
    if (!await context.PublicHolidays.AnyAsync(ct))
    {
        var holidays = new List<PublicHoliday>
        {
            // National 2025
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 1, 1),  Name = "New Year's Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 1, 27), Name = "Australia Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 4, 18), Name = "Good Friday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 4, 19), Name = "Easter Saturday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 4, 20), Name = "Easter Sunday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 4, 21), Name = "Easter Monday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 4, 25), Name = "ANZAC Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 12, 25), Name = "Christmas Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 12, 26), Name = "Boxing Day" },
            // VIC-specific 2025
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 6, 9),  Name = "King's Birthday", State = "VIC" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2025, 11, 4),  Name = "Melbourne Cup Day", State = "VIC" },
            // National 2026
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 1, 1),  Name = "New Year's Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 1, 26), Name = "Australia Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 4, 3),  Name = "Good Friday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 4, 4),  Name = "Easter Saturday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 4, 5),  Name = "Easter Sunday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 4, 6),  Name = "Easter Monday" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 4, 25), Name = "ANZAC Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 12, 25), Name = "Christmas Day" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 12, 26), Name = "Boxing Day" },
            // VIC-specific 2026
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 6, 8),  Name = "King's Birthday", State = "VIC" },
            new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 11, 3),  Name = "Melbourne Cup Day", State = "VIC" },
        };
        context.PublicHolidays.AddRange(holidays);
    }

    await context.SaveChangesAsync(ct);
}
```

- [ ] **Step 2: Call SeedNdisDataAsync from Program.cs**

In `backend/Odip.Api/Program.cs`, after `await DbSeeder.SeedAsync(db);` (line 217), add:

```csharp
    await DbSeeder.SeedNdisDataAsync(db);
```

- [ ] **Step 3: Build the full solution**

```bash
dotnet build "backend/Odip.sln"
```

Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/Data/DbSeeder.cs backend/Odip.Api/Program.cs
git commit -m "feat(ndis): seed support catalogue and VIC public holidays"
```

---

## Task 7: Create ClaimDTOs.cs

**Files:**
- Create: `backend/Odip.Application/DTOs/ClaimDTOs.cs`

- [ ] **Step 1: Create the file**

```csharp
using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// TRIP CLAIM DTOs
// ══════════════════════════════════════════════════════════════

public record TripClaimListDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string TripName { get; init; } = string.Empty;
    public TripClaimStatus Status { get; init; }
    public string ClaimReference { get; init; } = string.Empty;
    public decimal TotalAmount { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? SubmittedDate { get; init; }
}

public record TripClaimDetailDto : TripClaimListDto
{
    public decimal TotalApprovedAmount { get; init; }
    public Guid? AuthorisedByStaffId { get; init; }
    public string? AuthorisedByStaffName { get; init; }
    public DateTime? PaidDate { get; init; }
    public string? Notes { get; init; }
    public List<ClaimLineItemDto> LineItems { get; init; } = new();
}

public record ClaimLineItemDto
{
    public Guid Id { get; init; }
    public Guid TripClaimId { get; init; }
    public Guid ParticipantBookingId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string NdisNumber { get; init; } = string.Empty;
    public PlanType PlanType { get; init; }
    public string SupportItemCode { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public DateOnly SupportsDeliveredFrom { get; init; }
    public DateOnly SupportsDeliveredTo { get; init; }
    public decimal Hours { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal TotalAmount { get; init; }
    public GSTCode GSTCode { get; init; }
    public ClaimType ClaimType { get; init; }
    public bool ParticipantApproved { get; init; }
    public ClaimLineItemStatus Status { get; init; }
    public string? RejectionReason { get; init; }
    public decimal? PaidAmount { get; init; }
}

public record UpdateClaimDto
{
    public Guid? AuthorisedByStaffId { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
    public TripClaimStatus? Status { get; init; }
}

public record UpdateClaimLineItemDto
{
    public decimal? Hours { get; init; }
    public decimal? UnitPrice { get; init; }
    [StringLength(50)]
    public string? SupportItemCode { get; init; }
    public ClaimType? ClaimType { get; init; }
    public bool? ParticipantApproved { get; init; }
    public ClaimLineItemStatus? Status { get; init; }
    [StringLength(1000)]
    public string? RejectionReason { get; init; }
    public decimal? PaidAmount { get; init; }
}

// ══════════════════════════════════════════════════════════════
// PROVIDER SETTINGS DTOs
// ══════════════════════════════════════════════════════════════

public record ProviderSettingsDto
{
    public Guid Id { get; init; }
    public string RegistrationNumber { get; init; } = string.Empty;
    public string ABN { get; init; } = string.Empty;
    public string OrganisationName { get; init; } = string.Empty;
    public string Address { get; init; } = string.Empty;
    public bool GSTRegistered { get; init; }
    public bool IsPaceProvider { get; init; }
    public string? BankAccountName { get; init; }
    public string? BSB { get; init; }
    public string? AccountNumber { get; init; }
    public string? InvoiceFooterNotes { get; init; }
}

public record UpsertProviderSettingsDto
{
    [Required, StringLength(20)]
    public string RegistrationNumber { get; init; } = string.Empty;
    [Required, StringLength(20)]
    public string ABN { get; init; } = string.Empty;
    [Required, StringLength(200)]
    public string OrganisationName { get; init; } = string.Empty;
    [Required, StringLength(500)]
    public string Address { get; init; } = string.Empty;
    public bool GSTRegistered { get; init; }
    public bool IsPaceProvider { get; init; }
    [StringLength(200)]
    public string? BankAccountName { get; init; }
    [StringLength(10)]
    public string? BSB { get; init; }
    [StringLength(20)]
    public string? AccountNumber { get; init; }
    [StringLength(2000)]
    public string? InvoiceFooterNotes { get; init; }
}

// ══════════════════════════════════════════════════════════════
// SUPPORT CATALOGUE DTOs
// ══════════════════════════════════════════════════════════════

public record SupportActivityGroupDto
{
    public Guid Id { get; init; }
    public string GroupCode { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public int SupportCategory { get; init; }
    public bool IsActive { get; init; }
    public List<SupportCatalogueItemDto> Items { get; init; } = new();
}

public record SupportCatalogueItemDto
{
    public Guid Id { get; init; }
    public string ItemNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Unit { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public decimal PriceLimit_Standard { get; init; }
    public decimal PriceLimit_1to2 { get; init; }
    public decimal PriceLimit_1to3 { get; init; }
    public decimal PriceLimit_1to4 { get; init; }
    public decimal PriceLimit_1to5 { get; init; }
    public string CatalogueVersion { get; init; } = string.Empty;
    public DateOnly EffectiveFrom { get; init; }
    public bool IsActive { get; init; }
}

// ══════════════════════════════════════════════════════════════
// PUBLIC HOLIDAY DTOs
// ══════════════════════════════════════════════════════════════

public record PublicHolidayDto
{
    public Guid Id { get; init; }
    public DateOnly Date { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? State { get; init; }
}

public record CreatePublicHolidayDto
{
    [Required]
    public DateOnly Date { get; init; }
    [Required, StringLength(100)]
    public string Name { get; init; } = string.Empty;
    [StringLength(10)]
    public string? State { get; init; }
}
```

- [ ] **Step 2: Build Application project**

```bash
dotnet build backend/Odip.Application/Odip.Application.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Application/DTOs/ClaimDTOs.cs
git commit -m "feat(ndis): add claim, provider settings, catalogue, and public holiday DTOs"
```

---

## Task 8: Create ClaimGenerationService

**Files:**
- Create: `backend/Odip.Infrastructure/Services/ClaimGenerationService.cs`

This service contains the core business logic for generating a draft claim from a completed trip. It reads TripDays, groups them by day type, looks up catalogue items, and creates ClaimLineItem records.

- [ ] **Step 1: Create the service**

```csharp
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class ClaimGenerationService
{
    private readonly OdipDbContext _db;

    public ClaimGenerationService(OdipDbContext db) => _db = db;

    /// <summary>
    /// Generates a Draft TripClaim for a completed trip.
    /// Returns the new claim ID, or throws InvalidOperationException with a user-facing message.
    /// </summary>
    public async Task<TripClaim> GenerateDraftClaimAsync(Guid tripInstanceId, CancellationToken ct = default)
    {
        var trip = await _db.TripInstances
            .Include(t => t.TripDays)
            .Include(t => t.Bookings).ThenInclude(b => b.Participant)
            .FirstOrDefaultAsync(t => t.Id == tripInstanceId, ct)
            ?? throw new InvalidOperationException("Trip not found.");

        if (trip.Status != TripStatus.Completed)
            throw new InvalidOperationException("Claims can only be generated for completed trips.");

        if (await _db.TripClaims.AnyAsync(c => c.TripInstanceId == tripInstanceId && c.Status != TripClaimStatus.Rejected, ct))
            throw new InvalidOperationException("An active claim already exists for this trip.");

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings are not configured. Please configure them in Settings before generating claims.");

        if (trip.DefaultActivityGroupId == null)
            throw new InvalidOperationException("Trip has no default activity group set. Please set one before generating claims.");

        var confirmedBookings = trip.Bookings
            .Where(b => b.BookingStatus == BookingStatus.Confirmed)
            .ToList();

        if (!confirmedBookings.Any())
            throw new InvalidOperationException("No confirmed bookings found on this trip.");

        // Load public holidays that overlap trip dates
        var tripEnd = trip.StartDate.AddDays(trip.DurationDays - 1);
        var publicHolidays = await _db.PublicHolidays
            .Where(h => h.Date >= trip.StartDate && h.Date <= tripEnd && (h.State == null || h.State == "VIC"))
            .Select(h => h.Date)
            .ToHashSetAsync(ct);

        // Load active catalogue items for this activity group
        var catalogueItems = await _db.SupportCatalogueItems
            .Where(i => i.ActivityGroupId == trip.DefaultActivityGroupId && i.IsActive)
            .ToListAsync(ct);

        var claimReference = BuildClaimReference(trip);
        var claim = new TripClaim
        {
            Id = Guid.NewGuid(),
            TripInstanceId = tripInstanceId,
            Status = TripClaimStatus.Draft,
            ClaimReference = claimReference,
            CreatedAt = DateTime.UtcNow
        };
        _db.TripClaims.Add(claim);

        var lineItems = new List<ClaimLineItem>();

        foreach (var booking in confirmedBookings)
        {
            if (string.IsNullOrWhiteSpace(booking.Participant.NdisNumber))
                continue; // Skip participants without NDIS number — coordinator should fix before submitting

            var ratio = booking.SupportRatioOverride ?? booking.Participant.SupportRatio;
            var planType = booking.PlanTypeOverride ?? booking.Participant.PlanType;
            var gstCode = settings.GSTRegistered ? GSTCode.P1 : GSTCode.P2;

            // Group trip days by day type, get date ranges
            var dayGroups = GroupDaysByType(trip.TripDays.OrderBy(d => d.Date).ToList(), publicHolidays);

            foreach (var group in dayGroups)
            {
                var catalogueItem = catalogueItems.FirstOrDefault(i => i.DayType == group.DayType);
                if (catalogueItem == null)
                    continue;

                var unitPrice = GetPriceForRatio(catalogueItem, ratio);
                var hours = group.DayCount * trip.ActiveHoursPerDay;
                var total = hours * unitPrice;

                var lineItem = new ClaimLineItem
                {
                    Id = Guid.NewGuid(),
                    TripClaimId = claim.Id,
                    ParticipantBookingId = booking.Id,
                    SupportItemCode = catalogueItem.ItemNumber,
                    DayType = group.DayType,
                    SupportsDeliveredFrom = group.From,
                    SupportsDeliveredTo = group.To,
                    Hours = hours,
                    UnitPrice = unitPrice,
                    TotalAmount = total,
                    GSTCode = gstCode,
                    ClaimType = ClaimType.Standard,
                    Status = ClaimLineItemStatus.Draft
                };
                lineItems.Add(lineItem);
            }

            booking.ClaimStatus = ClaimStatus.InClaim;
        }

        _db.ClaimLineItems.AddRange(lineItems);
        claim.TotalAmount = lineItems.Sum(l => l.TotalAmount);

        await _db.SaveChangesAsync(ct);
        return claim;
    }

    private static string BuildClaimReference(TripInstance trip)
    {
        var code = trip.TripCode ?? trip.Id.ToString("N")[..8].ToUpper();
        var date = DateTime.UtcNow.ToString("yyyyMMdd");
        var raw = $"TC-{code}-{date}";
        return raw.Length > 50 ? raw[..50] : raw;
    }

    private static List<DayGroup> GroupDaysByType(List<TripDay> days, HashSet<DateOnly> publicHolidays)
    {
        var result = new List<DayGroup>();
        DayGroup? current = null;

        foreach (var day in days)
        {
            var dayType = ResolveDayType(day.Date, day.IsPublicHoliday || publicHolidays.Contains(day.Date));

            if (current == null || current.DayType != dayType || current.To.AddDays(1) != day.Date)
            {
                current = new DayGroup { DayType = dayType, From = day.Date, To = day.Date, DayCount = 1 };
                result.Add(current);
            }
            else
            {
                current.To = day.Date;
                current.DayCount++;
            }
        }

        return result;
    }

    private static ClaimDayType ResolveDayType(DateOnly date, bool isPublicHoliday)
    {
        if (isPublicHoliday) return ClaimDayType.PublicHoliday;
        return date.DayOfWeek switch
        {
            DayOfWeek.Saturday => ClaimDayType.Saturday,
            DayOfWeek.Sunday => ClaimDayType.Sunday,
            _ => ClaimDayType.Weekday
        };
    }

    private static decimal GetPriceForRatio(SupportCatalogueItem item, SupportRatio ratio)
    {
        return ratio switch
        {
            SupportRatio.OneToTwo => item.PriceLimit_1to2,
            SupportRatio.OneToThree => item.PriceLimit_1to3,
            SupportRatio.OneToFour => item.PriceLimit_1to4,
            SupportRatio.OneToFive => item.PriceLimit_1to5,
            _ => item.PriceLimit_Standard
        };
    }

    private class DayGroup
    {
        public ClaimDayType DayType { get; set; }
        public DateOnly From { get; set; }
        public DateOnly To { get; set; }
        public int DayCount { get; set; }
    }
}
```

- [ ] **Step 2: Build**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Infrastructure/Services/ClaimGenerationService.cs
git commit -m "feat(ndis): add ClaimGenerationService with day-type grouping logic"
```

---

## Task 9: Create BprCsvService

**Files:**
- Create: `backend/Odip.Infrastructure/Services/BprCsvService.cs`

Generates the 13-column (non-PACE) or 15-column (PACE) BPR CSV from a claim's agency-managed line items.

- [ ] **Step 1: Create the service**

```csharp
using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class BprCsvService
{
    private readonly OdipDbContext _db;

    public BprCsvService(OdipDbContext db) => _db = db;

    /// <summary>
    /// Generates a BPR CSV byte array for all agency-managed line items in the given claim.
    /// Columns: 13 (non-PACE) or 15 (PACE, adds ClaimType + ABN columns).
    /// </summary>
    public async Task<(byte[] Content, string FileName)> GenerateBprCsvAsync(Guid claimId, CancellationToken ct = default)
    {
        var claim = await _db.TripClaims
            .Include(c => c.TripInstance)
            .Include(c => c.AuthorisedByStaff)
            .Include(c => c.LineItems)
                .ThenInclude(l => l.ParticipantBooking)
                    .ThenInclude(b => b.Participant)
            .FirstOrDefaultAsync(c => c.Id == claimId, ct)
            ?? throw new InvalidOperationException("Claim not found.");

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings not configured.");

        // Only agency-managed bookings go in the BPR
        var agencyItems = claim.LineItems
            .Where(l => (l.ParticipantBooking.PlanTypeOverride ?? l.ParticipantBooking.Participant.PlanType) == PlanType.AgencyManaged)
            .ToList();

        var authorisedBy = claim.AuthorisedByStaff != null
            ? $"{claim.AuthorisedByStaff.FirstName} {claim.AuthorisedByStaff.LastName}"
            : string.Empty;

        var sb = new StringBuilder();

        // Header row
        if (settings.IsPaceProvider)
            sb.AppendLine("RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,AuthorisedBy,ParticipantApproved,InKindFundingProgram,ClaimType,ABNofSupportProvider");
        else
            sb.AppendLine("RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,AuthorisedBy,ParticipantApproved,InKindFundingProgram");

        foreach (var item in agencyItems)
        {
            var participant = item.ParticipantBooking.Participant;
            var ndisNumber = participant.NdisNumber ?? string.Empty;
            var fromDate = item.SupportsDeliveredFrom.ToString("yyyy-MM-dd");
            var toDate = item.SupportsDeliveredTo.ToString("yyyy-MM-dd");
            var hours = FormatHours(item.Hours);
            var unitPrice = item.UnitPrice.ToString("F2");
            var gstCode = item.GSTCode switch { GSTCode.P1 => "P1", GSTCode.P2 => "P2", GSTCode.P5 => "P5", _ => "P2" };
            var approved = item.ParticipantApproved ? "Y" : "N";
            // ClaimReference per BPR row = short line item ID (max 50 chars)
            var rowRef = item.Id.ToString("N")[..20];
            var claimTypeBpr = item.ClaimType == ClaimType.Cancellation ? "CANC" : "STAN";

            if (settings.IsPaceProvider)
                sb.AppendLine($"{settings.RegistrationNumber},{ndisNumber},{fromDate},{toDate},{item.SupportItemCode},{rowRef},,{hours},{unitPrice},{gstCode},{CsvEscape(authorisedBy)},{approved},,{claimTypeBpr},{settings.ABN}");
            else
                sb.AppendLine($"{settings.RegistrationNumber},{ndisNumber},{fromDate},{toDate},{item.SupportItemCode},{rowRef},,{hours},{unitPrice},{gstCode},{CsvEscape(authorisedBy)},{approved},");
        }

        var bytes = Encoding.UTF8.GetBytes(sb.ToString());
        var fileName = $"BPR-{claim.ClaimReference}-{DateTime.UtcNow:yyyyMMdd}.csv";
        return (bytes, fileName);
    }

    // Format decimal hours as HHH:MM — e.g. 8.5 → "008:30"
    private static string FormatHours(decimal hours)
    {
        var totalMinutes = (int)Math.Round(hours * 60);
        var h = totalMinutes / 60;
        var m = totalMinutes % 60;
        return $"{h:D3}:{m:D2}";
    }

    private static string CsvEscape(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}
```

- [ ] **Step 2: Build**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Infrastructure/Services/BprCsvService.cs
git commit -m "feat(ndis): add BprCsvService for NDIA bulk payment request generation"
```

---

## Task 10: Create InvoiceService

**Files:**
- Create: `backend/Odip.Infrastructure/Services/InvoiceService.cs`

Generates a QuestPDF invoice for a single participant booking. Called once per plan-managed or self-managed participant.

- [ ] **Step 1: Create the service**

```csharp
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class InvoiceService
{
    private readonly OdipDbContext _db;

    public InvoiceService(OdipDbContext db)
    {
        _db = db;
        QuestPDF.Settings.License = LicenseType.Community;
    }

    /// <summary>
    /// Generates a PDF invoice for one participant booking within a claim.
    /// Returns the PDF bytes and a suggested filename.
    /// </summary>
    public async Task<(byte[] Content, string FileName)> GenerateInvoiceAsync(
        Guid claimId, Guid bookingId, CancellationToken ct = default)
    {
        var claim = await _db.TripClaims
            .Include(c => c.TripInstance)
            .Include(c => c.LineItems)
                .ThenInclude(l => l.ParticipantBooking)
                    .ThenInclude(b => b.Participant)
                        .ThenInclude(p => p.PlanManagerContact)
            .FirstOrDefaultAsync(c => c.Id == claimId, ct)
            ?? throw new InvalidOperationException("Claim not found.");

        var booking = claim.LineItems
            .Select(l => l.ParticipantBooking)
            .FirstOrDefault(b => b.Id == bookingId)
            ?? throw new InvalidOperationException("Booking not found in this claim.");

        var planType = booking.PlanTypeOverride ?? booking.Participant.PlanType;
        if (planType == PlanType.AgencyManaged)
            throw new InvalidOperationException("Agency-managed participants use the BPR CSV, not invoices.");

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings not configured.");

        var lineItems = claim.LineItems
            .Where(l => l.ParticipantBookingId == bookingId)
            .ToList();

        var participant = booking.Participant;
        var invoiceNumber = $"INV-{claim.ClaimReference}-{booking.Id.ToString("N")[..8].ToUpper()}";
        var invoiceDate = DateTime.UtcNow;

        // Bill-to details
        string billToName;
        string billToAddress;

        if (planType == PlanType.PlanManaged && participant.PlanManagerContact != null)
        {
            var pm = participant.PlanManagerContact;
            billToName = pm.Organisation != null ? $"{pm.FullName} — {pm.Organisation}" : pm.FullName;
            billToAddress = string.Join(", ", new[] { pm.Address, pm.Suburb, pm.State, pm.Postcode }
                .Where(s => !string.IsNullOrWhiteSpace(s)));
        }
        else
        {
            billToName = participant.FullName;
            billToAddress = string.Empty;
        }

        var subtotal = lineItems.Sum(l => l.TotalAmount);
        var gstAmount = settings.GSTRegistered ? subtotal * 0.1m : 0m;
        var total = subtotal + gstAmount;

        var pdfBytes = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.DefaultTextStyle(x => x.FontSize(10));

                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(settings.OrganisationName).Bold().FontSize(16);
                            c.Item().Text(settings.Address).FontSize(9);
                            c.Item().Text($"ABN: {settings.ABN}").FontSize(9);
                            c.Item().Text($"NDIS Registration: {settings.RegistrationNumber}").FontSize(9);
                        });
                        row.ConstantItem(120).AlignRight().Column(c =>
                        {
                            c.Item().Text("TAX INVOICE").Bold().FontSize(14);
                            c.Item().Text(invoiceNumber).FontSize(9);
                            c.Item().Text(invoiceDate.ToString("dd MMM yyyy")).FontSize(9);
                        });
                    });
                    col.Item().PaddingTop(8).LineHorizontal(1);
                });

                page.Content().PaddingTop(16).Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Bill To:").Bold();
                            c.Item().Text(billToName);
                            if (!string.IsNullOrWhiteSpace(billToAddress))
                                c.Item().Text(billToAddress);
                        });
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Participant:").Bold();
                            c.Item().Text(participant.FullName);
                            if (!string.IsNullOrWhiteSpace(participant.NdisNumber))
                                c.Item().Text($"NDIS: {participant.NdisNumber}");
                            c.Item().Text($"Trip: {claim.TripInstance.TripName}");
                        });
                    });

                    col.Item().PaddingTop(16).Table(table =>
                    {
                        table.ColumnsDefinition(cols =>
                        {
                            cols.RelativeColumn(3);
                            cols.RelativeColumn(2);
                            cols.RelativeColumn(1);
                            cols.RelativeColumn(1);
                            cols.RelativeColumn(1);
                        });

                        // Header
                        table.Header(header =>
                        {
                            header.Cell().Background("#e2e8f0").Padding(4).Text("Support Item").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).Text("Date Range").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Hours").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Rate").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Amount").Bold();
                        });

                        foreach (var item in lineItems)
                        {
                            var dateRange = item.SupportsDeliveredFrom == item.SupportsDeliveredTo
                                ? item.SupportsDeliveredFrom.ToString("dd/MM/yyyy")
                                : $"{item.SupportsDeliveredFrom:dd/MM/yyyy} – {item.SupportsDeliveredTo:dd/MM/yyyy}";

                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(item.SupportItemCode);
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(dateRange);
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text(item.Hours.ToString("F2"));
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text($"${item.UnitPrice:F2}");
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text($"${item.TotalAmount:F2}");
                        }
                    });

                    col.Item().PaddingTop(8).AlignRight().Column(c =>
                    {
                        c.Item().Text($"Subtotal: ${subtotal:F2}");
                        if (settings.GSTRegistered)
                            c.Item().Text($"GST (10%): ${gstAmount:F2}");
                        c.Item().Text($"Total: ${total:F2}").Bold().FontSize(12);
                    });

                    if (settings.BankAccountName != null || settings.BSB != null)
                    {
                        col.Item().PaddingTop(16).Column(c =>
                        {
                            c.Item().Text("Payment Details:").Bold();
                            if (settings.BankAccountName != null) c.Item().Text($"Account Name: {settings.BankAccountName}");
                            if (settings.BSB != null) c.Item().Text($"BSB: {settings.BSB}");
                            if (settings.AccountNumber != null) c.Item().Text($"Account: {settings.AccountNumber}");
                        });
                    }

                    if (!string.IsNullOrWhiteSpace(settings.InvoiceFooterNotes))
                        col.Item().PaddingTop(16).Text(settings.InvoiceFooterNotes).FontSize(8).Italic();
                });
            });
        }).GeneratePdf();

        var fileName = $"{invoiceNumber}.pdf";
        return (pdfBytes, fileName);
    }
}
```

- [ ] **Step 2: Build**

```bash
dotnet build backend/Odip.Infrastructure/Odip.Infrastructure.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Infrastructure/Services/InvoiceService.cs
git commit -m "feat(ndis): add QuestPDF InvoiceService for plan-managed and self-managed participants"
```

---

## Task 11: Register services in Program.cs

**Files:**
- Modify: `backend/Odip.Api/Program.cs`

- [ ] **Step 1: Add service registrations**

In `Program.cs`, after `builder.Services.AddAuthorization();` (after line 58), add:

```csharp
// ── NDIS Claiming Services ────────────────────────────────────
builder.Services.AddScoped<Odip.Infrastructure.Services.ClaimGenerationService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.BprCsvService>();
builder.Services.AddScoped<Odip.Infrastructure.Services.InvoiceService>();
```

- [ ] **Step 2: Build the full solution**

```bash
dotnet build "backend/Odip.sln"
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Api/Program.cs
git commit -m "feat(ndis): register ClaimGenerationService, BprCsvService, InvoiceService"
```

---

## Task 12: Create ClaimsController

**Files:**
- Create: `backend/Odip.Api/Controllers/ClaimsController.cs`

- [ ] **Step 1: Create the controller**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1")]
public class ClaimsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ClaimGenerationService _generator;
    private readonly BprCsvService _bprService;
    private readonly InvoiceService _invoiceService;

    public ClaimsController(OdipDbContext db, ClaimGenerationService generator,
        BprCsvService bprService, InvoiceService invoiceService)
    {
        _db = db;
        _generator = generator;
        _bprService = bprService;
        _invoiceService = invoiceService;
    }

    // POST /api/v1/trips/{tripId}/claims
    [HttpPost("trips/{tripId:guid}/claims")]
    [Authorize(Roles = "Admin,Coordinator")]
    public async Task<ActionResult<ApiResponse<TripClaimListDto>>> GenerateClaim(Guid tripId, CancellationToken ct)
    {
        try
        {
            var claim = await _generator.GenerateDraftClaimAsync(tripId, ct);
            return Ok(ApiResponse<TripClaimListDto>.Ok(new TripClaimListDto
            {
                Id = claim.Id, TripInstanceId = claim.TripInstanceId,
                Status = claim.Status, ClaimReference = claim.ClaimReference,
                TotalAmount = claim.TotalAmount, CreatedAt = claim.CreatedAt
            }));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<TripClaimListDto>.Fail(ex.Message));
        }
    }

    // GET /api/v1/trips/{tripId}/claims
    [HttpGet("trips/{tripId:guid}/claims")]
    public async Task<ActionResult<ApiResponse<List<TripClaimListDto>>>> GetClaimsForTrip(Guid tripId, CancellationToken ct)
    {
        var items = await _db.TripClaims
            .Include(c => c.TripInstance)
            .Where(c => c.TripInstanceId == tripId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new TripClaimListDto
            {
                Id = c.Id, TripInstanceId = c.TripInstanceId, TripName = c.TripInstance.TripName,
                Status = c.Status, ClaimReference = c.ClaimReference,
                TotalAmount = c.TotalAmount, CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TripClaimListDto>>.Ok(items));
    }

    // GET /api/v1/claims/{claimId}
    [HttpGet("claims/{claimId:guid}")]
    public async Task<ActionResult<ApiResponse<TripClaimDetailDto>>> GetClaim(Guid claimId, CancellationToken ct)
    {
        var c = await _db.TripClaims
            .Include(x => x.TripInstance)
            .Include(x => x.AuthorisedByStaff)
            .Include(x => x.LineItems)
                .ThenInclude(l => l.ParticipantBooking)
                    .ThenInclude(b => b.Participant)
            .FirstOrDefaultAsync(x => x.Id == claimId, ct);

        if (c == null) return NotFound(ApiResponse<TripClaimDetailDto>.Fail("Claim not found"));

        return Ok(ApiResponse<TripClaimDetailDto>.Ok(new TripClaimDetailDto
        {
            Id = c.Id, TripInstanceId = c.TripInstanceId, TripName = c.TripInstance.TripName,
            Status = c.Status, ClaimReference = c.ClaimReference,
            TotalAmount = c.TotalAmount, TotalApprovedAmount = c.TotalApprovedAmount,
            CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate, PaidDate = c.PaidDate,
            AuthorisedByStaffId = c.AuthorisedByStaffId,
            AuthorisedByStaffName = c.AuthorisedByStaff != null ? $"{c.AuthorisedByStaff.FirstName} {c.AuthorisedByStaff.LastName}" : null,
            Notes = c.Notes,
            LineItems = c.LineItems.Select(l => new ClaimLineItemDto
            {
                Id = l.Id, TripClaimId = l.TripClaimId, ParticipantBookingId = l.ParticipantBookingId,
                ParticipantName = l.ParticipantBooking.Participant.FullName,
                NdisNumber = l.ParticipantBooking.Participant.NdisNumber ?? string.Empty,
                PlanType = l.ParticipantBooking.PlanTypeOverride ?? l.ParticipantBooking.Participant.PlanType,
                SupportItemCode = l.SupportItemCode, DayType = l.DayType,
                SupportsDeliveredFrom = l.SupportsDeliveredFrom, SupportsDeliveredTo = l.SupportsDeliveredTo,
                Hours = l.Hours, UnitPrice = l.UnitPrice, TotalAmount = l.TotalAmount,
                GSTCode = l.GSTCode, ClaimType = l.ClaimType, ParticipantApproved = l.ParticipantApproved,
                Status = l.Status, RejectionReason = l.RejectionReason, PaidAmount = l.PaidAmount
            }).ToList()
        }));
    }

    // PUT /api/v1/claims/{claimId}
    [HttpPut("claims/{claimId:guid}")]
    [Authorize(Roles = "Admin,Coordinator")]
    public async Task<ActionResult<ApiResponse<bool>>> UpdateClaim(Guid claimId, [FromBody] UpdateClaimDto dto, CancellationToken ct)
    {
        var c = await _db.TripClaims.FirstOrDefaultAsync(x => x.Id == claimId, ct);
        if (c == null) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        if (dto.AuthorisedByStaffId.HasValue) c.AuthorisedByStaffId = dto.AuthorisedByStaffId;
        if (dto.Notes != null) c.Notes = dto.Notes;
        if (dto.Status.HasValue)
        {
            c.Status = dto.Status.Value;
            if (dto.Status.Value == TripClaimStatus.Submitted) c.SubmittedDate = DateTime.UtcNow;
            if (dto.Status.Value == TripClaimStatus.Paid) c.PaidDate = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    // PATCH /api/v1/claims/{claimId}/line-items/{id}
    [HttpPatch("claims/{claimId:guid}/line-items/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator")]
    public async Task<ActionResult<ApiResponse<bool>>> UpdateLineItem(Guid claimId, Guid id, [FromBody] UpdateClaimLineItemDto dto, CancellationToken ct)
    {
        var item = await _db.ClaimLineItems
            .Include(l => l.TripClaim)
            .FirstOrDefaultAsync(x => x.Id == id && x.TripClaimId == claimId, ct);
        if (item == null) return NotFound(ApiResponse<bool>.Fail("Line item not found"));

        if (dto.Hours.HasValue) { item.Hours = dto.Hours.Value; item.TotalAmount = item.Hours * item.UnitPrice; }
        if (dto.UnitPrice.HasValue) { item.UnitPrice = dto.UnitPrice.Value; item.TotalAmount = item.Hours * item.UnitPrice; }
        if (dto.SupportItemCode != null) item.SupportItemCode = dto.SupportItemCode;
        if (dto.ClaimType.HasValue) item.ClaimType = dto.ClaimType.Value;
        if (dto.ParticipantApproved.HasValue) item.ParticipantApproved = dto.ParticipantApproved.Value;
        if (dto.Status.HasValue)
        {
            item.Status = dto.Status.Value;
            if (dto.Status.Value == ClaimLineItemStatus.Paid) item.PaidAmount = dto.PaidAmount ?? item.TotalAmount;
            if (dto.Status.Value == ClaimLineItemStatus.Rejected) item.RejectionReason = dto.RejectionReason;
        }

        // Recalculate claim total
        var allItems = await _db.ClaimLineItems.Where(l => l.TripClaimId == claimId).ToListAsync(ct);
        item.TripClaim.TotalAmount = allItems.Sum(l => l.TotalAmount);

        // Auto-update claim status based on line item statuses
        var statuses = allItems.Select(l => l.Status).ToList();
        if (statuses.All(s => s == ClaimLineItemStatus.Paid))
            item.TripClaim.Status = TripClaimStatus.Paid;
        else if (statuses.All(s => s == ClaimLineItemStatus.Rejected))
            item.TripClaim.Status = TripClaimStatus.Rejected;
        else if (statuses.Any(s => s == ClaimLineItemStatus.Paid))
            item.TripClaim.Status = TripClaimStatus.PartiallyPaid;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    // GET /api/v1/claims/{claimId}/bpr-csv
    [HttpGet("claims/{claimId:guid}/bpr-csv")]
    public async Task<IActionResult> DownloadBprCsv(Guid claimId, CancellationToken ct)
    {
        try
        {
            var (bytes, fileName) = await _bprService.GenerateBprCsvAsync(claimId, ct);
            return File(bytes, "text/csv", fileName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }

    // GET /api/v1/claims/{claimId}/invoices/{bookingId}
    [HttpGet("claims/{claimId:guid}/invoices/{bookingId:guid}")]
    public async Task<IActionResult> DownloadInvoice(Guid claimId, Guid bookingId, CancellationToken ct)
    {
        try
        {
            var (bytes, fileName) = await _invoiceService.GenerateInvoiceAsync(claimId, bookingId, ct);
            return File(bytes, "application/pdf", fileName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }
}
```

- [ ] **Step 2: Build**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 3: Commit**

```bash
git add backend/Odip.Api/Controllers/ClaimsController.cs
git commit -m "feat(ndis): add ClaimsController with generate, detail, update, BPR CSV, and invoice endpoints"
```

---

## Task 13: Create ProviderSettingsController, SupportCatalogueController, PublicHolidaysController

**Files:**
- Create: `backend/Odip.Api/Controllers/ProviderSettingsController.cs`
- Create: `backend/Odip.Api/Controllers/SupportCatalogueController.cs`
- Create: `backend/Odip.Api/Controllers/PublicHolidaysController.cs`

- [ ] **Step 1: Create ProviderSettingsController.cs**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/provider-settings")]
public class ProviderSettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ProviderSettingsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<ProviderSettingsDto>>> Get(CancellationToken ct)
    {
        var s = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        if (s == null) return Ok(ApiResponse<ProviderSettingsDto>.Ok(null));

        return Ok(ApiResponse<ProviderSettingsDto>.Ok(new ProviderSettingsDto
        {
            Id = s.Id, RegistrationNumber = s.RegistrationNumber, ABN = s.ABN,
            OrganisationName = s.OrganisationName, Address = s.Address,
            GSTRegistered = s.GSTRegistered, IsPaceProvider = s.IsPaceProvider,
            BankAccountName = s.BankAccountName, BSB = s.BSB,
            AccountNumber = s.AccountNumber, InvoiceFooterNotes = s.InvoiceFooterNotes
        }));
    }

    [HttpPut]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> Upsert([FromBody] UpsertProviderSettingsDto dto, CancellationToken ct)
    {
        var s = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new ProviderSettings { Id = Guid.NewGuid() };
            _db.ProviderSettings.Add(s);
        }

        s.RegistrationNumber = dto.RegistrationNumber; s.ABN = dto.ABN;
        s.OrganisationName = dto.OrganisationName; s.Address = dto.Address;
        s.GSTRegistered = dto.GSTRegistered; s.IsPaceProvider = dto.IsPaceProvider;
        s.BankAccountName = dto.BankAccountName; s.BSB = dto.BSB;
        s.AccountNumber = dto.AccountNumber; s.InvoiceFooterNotes = dto.InvoiceFooterNotes;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
```

- [ ] **Step 2: Create SupportCatalogueController.cs**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/support-catalogue")]
public class SupportCatalogueController : ControllerBase
{
    private readonly OdipDbContext _db;
    public SupportCatalogueController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<SupportActivityGroupDto>>>> GetAll(CancellationToken ct)
    {
        var groups = await _db.SupportActivityGroups
            .Include(g => g.Items.Where(i => i.IsActive))
            .Where(g => g.IsActive)
            .OrderBy(g => g.DisplayName)
            .ToListAsync(ct);

        var result = groups.Select(g => new SupportActivityGroupDto
        {
            Id = g.Id, GroupCode = g.GroupCode, DisplayName = g.DisplayName,
            SupportCategory = g.SupportCategory, IsActive = g.IsActive,
            Items = g.Items.Select(i => new SupportCatalogueItemDto
            {
                Id = i.Id, ItemNumber = i.ItemNumber, Description = i.Description,
                Unit = i.Unit, DayType = i.DayType,
                PriceLimit_Standard = i.PriceLimit_Standard, PriceLimit_1to2 = i.PriceLimit_1to2,
                PriceLimit_1to3 = i.PriceLimit_1to3, PriceLimit_1to4 = i.PriceLimit_1to4,
                PriceLimit_1to5 = i.PriceLimit_1to5,
                CatalogueVersion = i.CatalogueVersion, EffectiveFrom = i.EffectiveFrom, IsActive = i.IsActive
            }).ToList()
        }).ToList();

        return Ok(ApiResponse<List<SupportActivityGroupDto>>.Ok(result));
    }
}
```

- [ ] **Step 3: Create PublicHolidaysController.cs**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/public-holidays")]
public class PublicHolidaysController : ControllerBase
{
    private readonly OdipDbContext _db;
    public PublicHolidaysController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<PublicHolidayDto>>>> GetAll([FromQuery] int? year, CancellationToken ct)
    {
        var query = _db.PublicHolidays.AsQueryable();
        if (year.HasValue) query = query.Where(h => h.Date.Year == year.Value);

        var items = await query.OrderBy(h => h.Date)
            .Select(h => new PublicHolidayDto { Id = h.Id, Date = h.Date, Name = h.Name, State = h.State })
            .ToListAsync(ct);

        return Ok(ApiResponse<List<PublicHolidayDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<PublicHolidayDto>>> Create([FromBody] CreatePublicHolidayDto dto, CancellationToken ct)
    {
        var holiday = new PublicHoliday { Id = Guid.NewGuid(), Date = dto.Date, Name = dto.Name, State = dto.State };
        _db.PublicHolidays.Add(holiday);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PublicHolidayDto>.Ok(new PublicHolidayDto { Id = holiday.Id, Date = holiday.Date, Name = holiday.Name, State = holiday.State }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var h = await _db.PublicHolidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h == null) return NotFound(ApiResponse<bool>.Fail("Holiday not found"));
        _db.PublicHolidays.Remove(h);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
```

- [ ] **Step 4: Build full solution**

```bash
dotnet build "backend/Odip.sln"
```

Expected: `Build succeeded.`

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Api/Controllers/ProviderSettingsController.cs backend/Odip.Api/Controllers/SupportCatalogueController.cs backend/Odip.Api/Controllers/PublicHolidaysController.cs
git commit -m "feat(ndis): add ProviderSettings, SupportCatalogue, and PublicHolidays controllers"
```

---

## Task 14: Add Completed gate → auto-task in TripsController

When a trip transitions to `Completed`, auto-create a `GenerateNdisClaims` task. This follows the exact same pattern as the `InsuranceConfirmation` auto-task in `BookingsAccommodationController`.

**Files:**
- Modify: `backend/Odip.Api/Controllers/TripsController.cs`

- [ ] **Step 1: Find the PATCH handler in TripsController**

The `Patch` method is around line 141. It currently has a gate check for `InProgress`. After the existing `InProgress` gate block (around line 164), add a Completed auto-task block:

```csharp
        // Auto-create GenerateNdisClaims task when trip moves to Completed
        if (dto.Status.HasValue && dto.Status.Value == TripStatus.Completed && t.Status != TripStatus.Completed)
        {
            var hasProviderSettings = await _db.ProviderSettings.AnyAsync(ct);
            var taskTitle = hasProviderSettings
                ? $"Generate NDIS claims for {t.TripName}"
                : $"Generate NDIS claims for {t.TripName} — configure Provider Settings first";

            var alreadyExists = await _db.BookingTasks.AnyAsync(bt =>
                bt.TripInstanceId == id && bt.TaskType == TaskType.GenerateNdisClaims, ct);

            if (!alreadyExists)
            {
                _db.BookingTasks.Add(new BookingTask
                {
                    Id = Guid.NewGuid(),
                    TripInstanceId = id,
                    TaskType = TaskType.GenerateNdisClaims,
                    Title = taskTitle,
                    Priority = TaskPriority.High,
                    Status = TaskItemStatus.NotStarted,
                    DueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(7)),
                    OwnerId = t.LeadCoordinatorId != null
                        ? await _db.Users.Where(u => u.StaffId == t.LeadCoordinatorId).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct)
                        : null
                });
            }
        }
```

Place this block **before** the `if (dto.Status.HasValue) t.Status = dto.Status.Value;` line.

- [ ] **Step 2: Add missing using if needed**

Ensure `Odip.Domain.Entities` is in the using block at the top of TripsController.cs (it should already be there from the insurance task pattern).

- [ ] **Step 3: Build**

```bash
dotnet build backend/Odip.Api/Odip.Api.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Api/Controllers/TripsController.cs
git commit -m "feat(ndis): auto-create GenerateNdisClaims task when trip moves to Completed"
```

---

## Task 15: Full solution build and smoke test

**Files:** No changes — verification only.

- [ ] **Step 1: Full build**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet build backend/Odip.sln
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 2: Start the API and verify migrations run**

```bash
dotnet run --project backend/Odip.Api
```

Watch startup output. Expected:
- `Applying migration 'AddNdisClaiming'`
- `Applying migration 'AddClaimingFieldsToExistingEntities'`
- Application starts on port 5000

- [ ] **Step 3: Smoke test Provider Settings endpoint**

```bash
curl -s -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!"}' | jq .token
```

Use the returned token for subsequent calls:

```bash
TOKEN="<paste-token-here>"

# GET provider settings (expect null body — not configured yet)
curl -s http://localhost:5000/api/v1/provider-settings \
  -H "Authorization: Bearer $TOKEN" | jq .

# GET support catalogue (expect GRP_COMMUNITY_ACCESS with 4 items)
curl -s http://localhost:5000/api/v1/support-catalogue \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].displayName, (.[0].items | length)'
# Expected: "Group Community Access" and 4

# GET public holidays (expect 22 records)
curl -s "http://localhost:5000/api/v1/public-holidays?year=2026" \
  -H "Authorization: Bearer $TOKEN" | jq length
# Expected: 12
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(ndis): complete NDIS claiming integration — entities, migrations, services, controllers"
```

---

## Task 16: XLSX support catalogue import

**Files:**
- Modify: `backend/Odip.Infrastructure/Odip.Infrastructure.csproj` — add ClosedXML
- Create: `backend/Odip.Infrastructure/Services/CatalogueImportService.cs`
- Modify: `backend/Odip.Application/DTOs/ClaimDTOs.cs` — add import DTOs
- Modify: `backend/Odip.Api/Controllers/SupportCatalogueController.cs` — add import endpoint

The NDIA publishes an updated support catalogue XLSX each July (sometimes mid-year). The import:
1. Parses Category 04 / Reg Group 0125 rows from the XLSX
2. Returns a **preview** — what will be added, what will be deactivated — without writing to DB
3. On confirm, deactivates old items and inserts new rows with the new `CatalogueVersion`

The NDIA catalogue XLSX has a header row with these column names (used for robust column-position-independent parsing):
`Support Item Number`, `Support Item Name`, `Unit`, then ratio price columns named like `1:1`, `1:2`, `1:3`, `1:4`, `1:5`, `Remote`, `Very Remote`.

- [ ] **Step 1: Add ClosedXML NuGet package**

```bash
cd "F:/Projects/personal/Trip Planner"
dotnet add backend/Odip.Infrastructure/Odip.Infrastructure.csproj package ClosedXML --version 0.102.3
```

Expected: Package added successfully.

- [ ] **Step 2: Add import DTOs to ClaimDTOs.cs**

Append to the end of `backend/Odip.Application/DTOs/ClaimDTOs.cs`:

```csharp
// ══════════════════════════════════════════════════════════════
// CATALOGUE IMPORT DTOs
// ══════════════════════════════════════════════════════════════

public record CatalogueImportPreviewDto
{
    public string DetectedVersion { get; init; } = string.Empty;
    public int ItemsToAdd { get; init; }
    public int ItemsToDeactivate { get; init; }
    public List<CatalogueImportRowDto> Rows { get; init; } = new();
    public List<string> Warnings { get; init; } = new();
}

public record CatalogueImportRowDto
{
    public string ItemNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public decimal PriceLimit_Standard { get; init; }
    public decimal PriceLimit_1to2 { get; init; }
    public decimal PriceLimit_1to3 { get; init; }
    public decimal PriceLimit_1to4 { get; init; }
    public decimal PriceLimit_1to5 { get; init; }
    public bool IsNew { get; init; }
    public bool PriceChanged { get; init; }
}

public record ConfirmCatalogueImportDto
{
    [Required, StringLength(20)]
    public string CatalogueVersion { get; init; } = string.Empty;
    public List<CatalogueImportRowDto> Rows { get; init; } = new();
}
```

- [ ] **Step 3: Create CatalogueImportService.cs**

```csharp
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class CatalogueImportService
{
    private readonly OdipDbContext _db;

    public CatalogueImportService(OdipDbContext db) => _db = db;

    // Item number suffixes that identify day type for Category 04 group access
    private static readonly Dictionary<string, ClaimDayType> ItemSuffixToDayType = new()
    {
        { "04_210_", ClaimDayType.Weekday },
        { "04_211_", ClaimDayType.Weekday },   // evening — treated as Weekday for trips
        { "04_212_", ClaimDayType.Saturday },
        { "04_213_", ClaimDayType.Sunday },
        { "04_214_", ClaimDayType.PublicHoliday }
    };

    /// <summary>
    /// Parses an NDIA support catalogue XLSX stream and returns a preview of what will change.
    /// Does NOT write to the database.
    /// </summary>
    public async Task<CatalogueImportPreviewDto> PreviewImportAsync(Stream xlsxStream, CancellationToken ct = default)
    {
        var rows = ParseXlsx(xlsxStream);
        if (!rows.Any())
            throw new InvalidOperationException("No Category 04 / Registration Group 0125 items found in the uploaded file. Ensure you are uploading the NDIS Support Catalogue XLSX.");

        var existingItems = await _db.SupportCatalogueItems
            .Where(i => i.IsActive)
            .ToListAsync(ct);

        var warnings = new List<string>();
        var previewRows = new List<CatalogueImportRowDto>();

        foreach (var row in rows)
        {
            var existing = existingItems.FirstOrDefault(i => i.ItemNumber == row.ItemNumber);
            var isNew = existing == null;
            var priceChanged = existing != null && (
                existing.PriceLimit_Standard != row.PriceLimit_Standard ||
                existing.PriceLimit_1to3 != row.PriceLimit_1to3);

            previewRows.Add(row with { IsNew = isNew, PriceChanged = priceChanged });
        }

        // Warn about items that will be deactivated but not replaced
        var incomingCodes = rows.Select(r => r.ItemNumber).ToHashSet();
        foreach (var existing in existingItems)
        {
            if (!incomingCodes.Contains(existing.ItemNumber))
                warnings.Add($"Existing item {existing.ItemNumber} is not in the new catalogue and will be deactivated.");
        }

        // Detect version from effective date — default to financial year format
        var financialYear = DateTime.UtcNow.Month >= 7
            ? $"{DateTime.UtcNow.Year}-{DateTime.UtcNow.Year + 1 - 2000:D2}"
            : $"{DateTime.UtcNow.Year - 1}-{DateTime.UtcNow.Year - 2000:D2}";

        return new CatalogueImportPreviewDto
        {
            DetectedVersion = financialYear,
            ItemsToAdd = previewRows.Count(r => r.IsNew),
            ItemsToDeactivate = existingItems.Count(e => !incomingCodes.Contains(e.ItemNumber)),
            Rows = previewRows,
            Warnings = warnings
        };
    }

    /// <summary>
    /// Commits the import: deactivates old items, inserts new ones.
    /// Call only after the user has reviewed the preview.
    /// </summary>
    public async Task CommitImportAsync(ConfirmCatalogueImportDto dto, CancellationToken ct = default)
    {
        var group = await _db.SupportActivityGroups
            .FirstOrDefaultAsync(g => g.GroupCode == "GRP_COMMUNITY_ACCESS", ct)
            ?? throw new InvalidOperationException("GRP_COMMUNITY_ACCESS activity group not found.");

        var now = DateOnly.FromDateTime(DateTime.UtcNow);

        // Deactivate all currently active items for this group
        var existing = await _db.SupportCatalogueItems
            .Where(i => i.ActivityGroupId == group.Id && i.IsActive)
            .ToListAsync(ct);

        foreach (var item in existing)
        {
            item.IsActive = false;
            item.EffectiveTo = now;
        }

        // Insert new items
        foreach (var row in dto.Rows)
        {
            _db.SupportCatalogueItems.Add(new SupportCatalogueItem
            {
                Id = Guid.NewGuid(),
                ActivityGroupId = group.Id,
                ItemNumber = row.ItemNumber,
                Description = row.Description,
                Unit = "H",
                DayType = row.DayType,
                PriceLimit_Standard = row.PriceLimit_Standard,
                PriceLimit_1to2 = row.PriceLimit_1to2,
                PriceLimit_1to3 = row.PriceLimit_1to3,
                PriceLimit_1to4 = row.PriceLimit_1to4,
                PriceLimit_1to5 = row.PriceLimit_1to5,
                PriceLimit_Remote = 0,    // updated from preview row if parsed
                PriceLimit_VeryRemote = 0,
                CatalogueVersion = dto.CatalogueVersion,
                EffectiveFrom = now,
                IsActive = true
            });
        }

        await _db.SaveChangesAsync(ct);
    }

    private static List<CatalogueImportRowDto> ParseXlsx(Stream stream)
    {
        var results = new List<CatalogueImportRowDto>();

        using var wb = new XLWorkbook(stream);

        // Find the worksheet — NDIA uses "Support Catalogue" or the first sheet
        var ws = wb.Worksheets.FirstOrDefault(s =>
            s.Name.Contains("Support", StringComparison.OrdinalIgnoreCase) ||
            s.Name.Contains("Catalogue", StringComparison.OrdinalIgnoreCase))
            ?? wb.Worksheets.First();

        // Find header row (scan first 10 rows for "Support Item Number")
        int headerRow = 0;
        for (int r = 1; r <= 10; r++)
        {
            if (ws.Cell(r, 1).GetString().Contains("Support Item Number", StringComparison.OrdinalIgnoreCase) ||
                ws.Cell(r, 1).GetString().Contains("SupportItemNumber", StringComparison.OrdinalIgnoreCase))
            {
                headerRow = r;
                break;
            }
        }

        if (headerRow == 0)
            return results; // No recognisable header found

        // Map column headers to indices
        var headers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 30;
        for (int c = 1; c <= lastCol; c++)
        {
            var header = ws.Cell(headerRow, c).GetString().Trim();
            if (!string.IsNullOrWhiteSpace(header) && !headers.ContainsKey(header))
                headers[header] = c;
        }

        // Required columns — try multiple name variants (NDIA renames headers occasionally)
        int ColIdx(params string[] names)
        {
            foreach (var n in names)
                if (headers.TryGetValue(n, out var idx)) return idx;
            return 0;
        }

        var colItemNumber = ColIdx("Support Item Number", "SupportItemNumber", "Item Number");
        var colDescription = ColIdx("Support Item Name", "SupportItemName", "Item Name", "Description");
        var col11 = ColIdx("1:1", "1 to 1", "OneToOne", "Standard");
        var col12 = ColIdx("1:2", "1 to 2", "OneToTwo");
        var col13 = ColIdx("1:3", "1 to 3", "OneToThree");
        var col14 = ColIdx("1:4", "1 to 4", "OneToFour");
        var col15 = ColIdx("1:5", "1 to 5", "OneToFive");

        if (colItemNumber == 0)
            return results;

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1000;

        for (int r = headerRow + 1; r <= lastRow; r++)
        {
            var itemNumber = ws.Cell(r, colItemNumber).GetString().Trim();

            // Only process Category 04 / Reg Group 0125 group support items
            if (!itemNumber.StartsWith("04_") || !itemNumber.Contains("_0125_"))
                continue;

            // Resolve day type from item number prefix
            var dayType = ItemSuffixToDayType
                .FirstOrDefault(kv => itemNumber.StartsWith(kv.Key)).Value;

            // Skip evening (04_211) — not a distinct day type in our model, treated same as weekday
            // but keep it if coordinator wants it; just map to Weekday
            if (itemNumber.StartsWith("04_211_"))
                continue;

            decimal Price(int col) => col > 0
                ? decimal.TryParse(ws.Cell(r, col).GetString().Replace("$", "").Trim(), out var v) ? v : 0m
                : 0m;

            results.Add(new CatalogueImportRowDto
            {
                ItemNumber = itemNumber,
                Description = colDescription > 0 ? ws.Cell(r, colDescription).GetString().Trim() : itemNumber,
                DayType = dayType,
                PriceLimit_Standard = Price(col11),
                PriceLimit_1to2 = Price(col12),
                PriceLimit_1to3 = Price(col13),
                PriceLimit_1to4 = Price(col14),
                PriceLimit_1to5 = Price(col15)
            });
        }

        return results;
    }
}
```

- [ ] **Step 4: Add import endpoints to SupportCatalogueController.cs**

Add these two endpoints to the existing `SupportCatalogueController` class, after the `GetAll` method:

```csharp
    // POST /api/v1/support-catalogue/import/preview
    // Upload XLSX, get back a diff of what will change — no DB writes
    [HttpPost("import/preview")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<CatalogueImportPreviewDto>>> PreviewImport(
        IFormFile file, [FromServices] CatalogueImportService importer, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
            return BadRequest(ApiResponse<CatalogueImportPreviewDto>.Fail("No file uploaded."));

        if (!file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            return BadRequest(ApiResponse<CatalogueImportPreviewDto>.Fail("File must be an .xlsx file."));

        try
        {
            await using var stream = file.OpenReadStream();
            var preview = await importer.PreviewImportAsync(stream, ct);
            return Ok(ApiResponse<CatalogueImportPreviewDto>.Ok(preview));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<CatalogueImportPreviewDto>.Fail(ex.Message));
        }
    }

    // POST /api/v1/support-catalogue/import/confirm
    // Commit a previewed import (admin confirms after reviewing the preview)
    [HttpPost("import/confirm")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> ConfirmImport(
        [FromBody] ConfirmCatalogueImportDto dto, [FromServices] CatalogueImportService importer, CancellationToken ct)
    {
        if (dto.Rows.Count == 0)
            return BadRequest(ApiResponse<bool>.Fail("No rows to import."));

        try
        {
            await importer.CommitImportAsync(dto, ct);
            return Ok(ApiResponse<bool>.Ok(true, $"Imported {dto.Rows.Count} items for catalogue version {dto.CatalogueVersion}."));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }
```

Also add to `Program.cs` service registrations (after the existing NDIS service registrations from Task 11):

```csharp
builder.Services.AddScoped<Odip.Infrastructure.Services.CatalogueImportService>();
```

- [ ] **Step 5: Build full solution**

```bash
dotnet build "backend/Odip.sln"
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 6: Smoke test the import endpoint**

Download the current NDIA Support Catalogue XLSX from ndis.gov.au (search "NDIS Support Catalogue"). Then:

```bash
TOKEN="<your-admin-token>"

# Preview — should detect Category 04 items and return a diff
curl -s -X POST http://localhost:5000/api/v1/support-catalogue/import/preview \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/ndis-support-catalogue-2025-26.xlsx" | jq '{version: .data.detectedVersion, toAdd: .data.itemsToAdd, toDeactivate: .data.itemsToDeactivate}'
```

Expected: `detectedVersion`, `itemsToAdd` ≥ 4, `itemsToDeactivate` ≥ 4

- [ ] **Step 7: Commit**

```bash
git add backend/Odip.Infrastructure/Odip.Infrastructure.csproj \
        backend/Odip.Infrastructure/Services/CatalogueImportService.cs \
        backend/Odip.Application/DTOs/ClaimDTOs.cs \
        backend/Odip.Api/Controllers/SupportCatalogueController.cs \
        backend/Odip.Api/Program.cs
git commit -m "feat(ndis): add XLSX support catalogue import with preview-then-confirm flow"
```

---

## Post-Implementation Notes

### Program.cs migration block
When deploying, add the new tables to the `INSERT INTO "__EFMigrationsHistory"` guard block (the same pattern already in `Program.cs` lines 154–169). Add these two migration IDs to the VALUES list:

```sql
('20260327XXXXXX_AddNdisClaiming', '8.0.11'),
('20260327XXXXXX_AddClaimingFieldsToExistingEntities', '8.0.11')
```

Replace the timestamp portions with the actual values from the generated migration files.

### Spec decisions applied
- **State:** Victoria — `SeedNdisDataAsync` seeds VIC public holidays
- **PDF library:** QuestPDF (already in `Odip.Infrastructure.csproj` at v2024.12.2)
- **PACE:** `IsPaceProvider = false` by default (not set in seed — admin configures via Provider Settings)
