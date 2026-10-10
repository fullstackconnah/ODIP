using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Migrations;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Billing;

/// <summary>
/// ShiftClaimGenerationService (shift-completion design spec §3, delivery PR 3): day-type/
/// holiday resolution, price selection by Participant.AddressState (incl. null fallback to
/// ProviderSettings.State), Completed-and-unclaimed filtering, empty-range 400 (surfaced by the
/// controller as BadRequest on InvalidOperationException — this file asserts the exception
/// itself), and the ClaimLineItem exactly-one-parent DB check constraint.
/// </summary>
public class ShiftClaimGenerationServiceTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static OdipDbContext CreateDb() => TestDb.Create();

    private static Participant SeedParticipant(OdipDbContext db, bool isIntensive = false, string? addressState = null)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            FirstName = "Jane",
            LastName = "Doe",
            NdisNumber = "43100001234",
            IsIntensiveSupport = isIntensive,
            AddressState = addressState,
            PlanType = PlanType.AgencyManaged,
        };
        db.Participants.Add(participant);
        return participant;
    }

    private static ProviderSettings SeedProviderSettings(OdipDbContext db, string state = "VIC", bool gstRegistered = false)
    {
        var settings = new ProviderSettings
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            RegistrationNumber = "PR001",
            ABN = "12345678901",
            OrganisationName = "Test Provider",
            Address = "1 Test St",
            State = state,
            GSTRegistered = gstRegistered,
        };
        db.ProviderSettings.Add(settings);
        return settings;
    }

    /// <summary>
    /// The shift engine prices from the community access group (the catalogue now holds other families too), so its items live in a real one: an item
    /// always has a group in production, the FK just isn't enforced by InMemory.
    /// </summary>
    private static SupportActivityGroup CommunityAccessGroup(OdipDbContext db) =>
        db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == "GRP_COMMUNITY_ACCESS")
        ?? db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 }).Entity;

    private static SupportCatalogueItem SeedCatalogueItem(
        OdipDbContext db, ClaimDayType dayType, bool isIntensive,
        decimal vicPrice = 50m, decimal nswPrice = 55m)
    {
        var item = new SupportCatalogueItem
        {
            Id = Guid.NewGuid(),
            ActivityGroupId = CommunityAccessGroup(db).Id,
            ItemNumber = $"04_{dayType}_{(isIntensive ? "INT" : "STD")}",
            Description = $"Test item {dayType}",
            DayType = dayType,
            IsIntensive = isIntensive,
            PriceLimit_VIC = vicPrice,
            PriceLimit_NSW = nswPrice,
            PriceLimit_ACT = vicPrice,
            PriceLimit_NT = vicPrice,
            PriceLimit_QLD = vicPrice,
            PriceLimit_SA = vicPrice,
            PriceLimit_TAS = vicPrice,
            PriceLimit_WA = vicPrice,
            PriceLimit_Remote = vicPrice,
            PriceLimit_VeryRemote = vicPrice,
            CatalogueVersion = "2024-25",
            EffectiveFrom = new DateOnly(2024, 7, 1),
            IsActive = true,
        };
        db.SupportCatalogueItems.Add(item);
        return item;
    }

    private static Shift SeedShift(
        OdipDbContext db, Guid participantId, DateOnly serviceDate, ShiftStatus status = ShiftStatus.Completed,
        TimeOnly? start = null, TimeOnly? end = null)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            ParticipantId = participantId,
            ServiceDate = serviceDate,
            StartTime = start ?? new TimeOnly(9, 0),
            EndTime = end ?? new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None,
            Status = status,
        };
        db.Shifts.Add(shift);
        return shift;
    }

    // ── GenerateDraftClaimAsync ───────────────────────────────────────

    [Fact]
    public async Task GenerateDraftClaimAsync_CompletedUnclaimedShifts_CreatesOneShiftKindClaimWithLinePerShift()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        var shift1 = SeedShift(db, participant.Id, new DateOnly(2026, 9, 7)); // Monday
        var shift2 = SeedShift(db, participant.Id, new DateOnly(2026, 9, 8)); // Tuesday
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8));

        Assert.Equal(ClaimKind.Shift, claim.Kind);
        Assert.Equal(participant.Id, claim.ParticipantId);
        Assert.Null(claim.TripInstanceId);
        Assert.Equal(new DateOnly(2026, 9, 7), claim.PeriodFrom);
        Assert.Equal(new DateOnly(2026, 9, 8), claim.PeriodTo);
        Assert.StartsWith("TC-43100001234-", claim.ClaimReference);

        var lines = await db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.Equal(2, lines.Count);
        Assert.All(lines, l => Assert.Null(l.ParticipantBookingId));
        Assert.Contains(lines, l => l.ShiftId == shift1.Id);
        Assert.Contains(lines, l => l.ShiftId == shift2.Id);
        // 8 rostered hours * $40 = $320 per shift
        Assert.All(lines, l => Assert.Equal(320m, l.TotalAmount));
        Assert.Equal(640m, claim.TotalAmount);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_UsesRosteredHours_NotClockedTimes()
    {
        // Billing is against rostered hours (Shift.DurationHours), not ShiftCompletion's actual
        // clocked times — the office already accepted any variance at Approve time.
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 10m);
        var shift = SeedShift(db, participant.Id, new DateOnly(2026, 9, 7),
            start: new TimeOnly(9, 0), end: new TimeOnly(17, 0)); // 8 rostered hours
        db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id,
            ActualStart = new DateTime(2026, 9, 7, 9, 30, 0, DateTimeKind.Utc),
            ActualEnd = new DateTime(2026, 9, 7, 18, 0, 0, DateTimeKind.Utc), // 8.5 clocked hours
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = Guid.NewGuid(),
            StartedAt = new DateTime(2026, 9, 7, 9, 30, 0, DateTimeKind.Utc), IsActive = true,
        });
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        var line = await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(8m, line.Hours); // rostered, not the 8.5 clocked hours
        Assert.Equal(80m, line.TotalAmount);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_PublicHoliday_UsesPublicHolidayDayTypeAndPrice()
    {
        using var db = CreateDb();
        SeedProviderSettings(db, state: "VIC");
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedCatalogueItem(db, ClaimDayType.PublicHoliday, false, vicPrice: 90m);
        var holidayDate = new DateOnly(2026, 9, 7); // Monday, made a holiday below
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = holidayDate, Name = "Test Holiday", State = "VIC" });
        var shift = SeedShift(db, participant.Id, holidayDate);
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, holidayDate, holidayDate);

        var line = await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(ClaimDayType.PublicHoliday, line.DayType);
        Assert.Equal(720m, line.TotalAmount); // 8h * $90
        Assert.Equal(shift.Id, line.ShiftId);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_ParticipantAddressState_DrivesPriceOverProviderState()
    {
        using var db = CreateDb();
        SeedProviderSettings(db, state: "VIC");
        var participant = SeedParticipant(db, addressState: "NSW");
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m, nswPrice: 70m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        var line = await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(560m, line.TotalAmount); // 8h * $70 NSW price, not the $40 VIC price
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_ParticipantAddressStateNull_FallsBackToProviderSettingsState()
    {
        using var db = CreateDb();
        SeedProviderSettings(db, state: "NSW");
        var participant = SeedParticipant(db, addressState: null);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m, nswPrice: 70m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        var line = await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(560m, line.TotalAmount); // provider settings' NSW state used as fallback
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_ExcludesNonCompletedShifts()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7), status: ShiftStatus.PendingReview);
        var completed = SeedShift(db, participant.Id, new DateOnly(2026, 9, 8), status: ShiftStatus.Completed);
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8));

        var line = Assert.Single(await db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync());
        Assert.Equal(completed.Id, line.ShiftId);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_ExcludesAlreadyClaimedShifts()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        var alreadyClaimed = SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        var unclaimed = SeedShift(db, participant.Id, new DateOnly(2026, 9, 8));
        await db.SaveChangesAsync();

        // Simulate a prior claim against the first shift.
        var priorClaim = new TripClaim
        {
            Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id,
            PeriodFrom = new DateOnly(2026, 9, 7), PeriodTo = new DateOnly(2026, 9, 7),
            ClaimReference = "TC-PRIOR-20260101",
        };
        db.TripClaims.Add(priorClaim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = priorClaim.Id, ShiftId = alreadyClaimed.Id,
            SupportItemCode = "04_X", SupportsDeliveredFrom = alreadyClaimed.ServiceDate,
            SupportsDeliveredTo = alreadyClaimed.ServiceDate, Hours = 8, UnitPrice = 40, TotalAmount = 320,
        });
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8));

        var line = Assert.Single(await db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync());
        Assert.Equal(unclaimed.Id, line.ShiftId);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_NoCompletedUnclaimedShiftsInRange_ThrowsInvalidOperationException()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8)));

        Assert.Equal("No completed, unclaimed shifts found in this date range.", ex.Message);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_UnknownParticipant_ThrowsInvalidOperationException()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.GenerateDraftClaimAsync(Guid.NewGuid(), new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8)));
    }

    // ── PreviewAsync ──────────────────────────────────────────────────

    [Fact]
    public async Task PreviewAsync_DoesNotPersist_ReturnsCorrectTotals()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        var shift = SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var preview = await service.PreviewAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        Assert.Equal(320m, preview.TotalAmount);
        var line = Assert.Single(preview.LineItems);
        Assert.Equal(shift.Id, line.ShiftId);
        Assert.Equal(shift.ServiceDate, line.ServiceDate);
        Assert.Equal(ClaimDayType.Weekday, line.DayType);

        Assert.Empty(await db.TripClaims.ToListAsync());
        Assert.Empty(await db.ClaimLineItems.ToListAsync());
    }

    [Fact]
    public async Task PreviewAsync_EmptyRange_ThrowsInvalidOperationException()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.PreviewAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8)));
    }

    // ── Check constraint ──────────────────────────────────────────────
    //
    // The exactly-one-parent rule (design spec §1) is enforced by a Postgres CHECK constraint
    // (CK_ClaimLineItem_ExactlyOneParent), which the InMemory provider used everywhere else in
    // this file cannot execute — CHECK constraints are a relational-database feature with no
    // InMemory equivalent, and this sandbox's outbound network access is too unreliable to add
    // a new relational test-provider package (Sqlite) as a dependency. The assertion below
    // instead verifies the AddShiftClaims migration's Up() actually emits the constraint with
    // the exact name/SQL the entity config declares (Migration.UpOperations replays Up() against
    // an in-memory MigrationBuilder — no database connection involved), and the Generate tests
    // above already prove the one writer of shift-kind lines never produces a line violating it
    // (Assert.Null(l.ParticipantBookingId) / the both-or-neither assertion below).

    [Fact]
    public void AddShiftClaims_Migration_AddsExactlyOneParentCheckConstraint()
    {
        var migration = new AddShiftClaims();

        var addOp = migration.UpOperations.OfType<AddCheckConstraintOperation>()
            .FirstOrDefault(o => o.Name == "CK_ClaimLineItem_ExactlyOneParent");
        Assert.NotNull(addOp);
        Assert.Equal("ClaimLineItems", addOp!.Table);
        Assert.Equal(
            "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) = 1",
            addOp.Sql);

        var dropOp = migration.DownOperations.OfType<DropCheckConstraintOperation>()
            .FirstOrDefault(o => o.Name == "CK_ClaimLineItem_ExactlyOneParent");
        Assert.NotNull(dropOp);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_NeverProducesALineWithBothOrNeitherParentSet()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 8));
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8));

        var lines = await db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.NotEmpty(lines);
        Assert.All(lines, l => Assert.True(l.ShiftId.HasValue ^ l.ParticipantBookingId.HasValue));
    }
}
