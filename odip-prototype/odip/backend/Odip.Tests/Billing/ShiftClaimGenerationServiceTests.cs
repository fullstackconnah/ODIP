using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
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
    public async Task GenerateShiftClaim_ByAnUnscopedSuperAdmin_StampsTheParticipantsOrganisation_OnTheClaimAndEveryLine()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 8));
        await db.SaveChangesAsync();

        var claim = await new ShiftClaimGenerationService(db)
            .GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 8));

        Assert.Equal(participant.TenantId, claim.TenantId);
        var lines = await db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.Equal(2, lines.Count);
        Assert.All(lines, l => Assert.Equal(participant.TenantId, l.TenantId));
    }

    // Most NDIS supports are GST-free, and the catalogue carries no GST flag, so every new line is P2 whether or not the provider is GST-registered.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task GenerateDraftClaimAsync_SetsP2GSTCode_WhateverTheRegistration(bool gstRegistered)
    {
        using var db = CreateDb();
        SeedProviderSettings(db, gstRegistered: gstRegistered);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        await db.SaveChangesAsync();

        var claim = await new ShiftClaimGenerationService(db).GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        var line = await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(GSTCode.P2, line.GSTCode);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_A20MinuteShift_StoresHoursTo2dp_AndTheAmountOfThoseHours()
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 60m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7), start: new TimeOnly(9, 0), end: new TimeOnly(9, 20));
        await db.SaveChangesAsync();

        var claim = await new ShiftClaimGenerationService(db).GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        var line = await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(0.33m, line.Hours);
        Assert.Equal(19.80m, line.TotalAmount);   // the NDIA's 0.33 x 60; unrounded hours would give 20.00
        Assert.Equal(19.80m, claim.TotalAmount);
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
            TenantId = participant.TenantId,
            Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id,
            PeriodFrom = new DateOnly(2026, 9, 7), PeriodTo = new DateOnly(2026, 9, 7),
            ClaimReference = "TC-PRIOR-20260101",
        };
        db.TripClaims.Add(priorClaim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            TenantId = priorClaim.TenantId,
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

    // A participant whose services began before their profile was complete may have no NDIS number. Like trip claims, no line is built without one, and the
    // shifts are not dropped silently: they are left out and the refusal names the participant and the reason (LIFE fix round 1, V10).
    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public async Task GenerateAndPreview_WithoutAnNdisNumber_LeaveEveryShiftOut_AndSaySo(string? ndisNumber)
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        participant.NdisNumber = ndisNumber;
        participant.FundingSource = ParticipantFundingSource.Ndis;
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        await db.SaveChangesAsync();
        var service = new ShiftClaimGenerationService(db);

        var generate = await Assert.ThrowsAsync<InvalidOperationException>(() => service.GenerateAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7)));
        var preview = await Assert.ThrowsAsync<InvalidOperationException>(() => service.PreviewAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7)));

        foreach (var message in new[] { generate.Message, preview.Message })
        {
            Assert.Contains("Jane Doe", message);
            Assert.Contains("NDIS number missing", message);
        }
        Assert.Empty(db.TripClaims);
    }

    // A participant funded another way is never claimed to the NDIS, with or without an NDIS number still on file: every shift is left out and the refusal says to invoice them.
    [Theory]
    [InlineData(null)]
    [InlineData("430000007")]
    public async Task Generate_AndPreview_ForAnOtherFundedParticipant_LeaveEveryShiftOut(string? ndisNumber)
    {
        using var db = CreateDb();
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        participant.NdisNumber = ndisNumber;
        participant.FundingSource = ParticipantFundingSource.Other;
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 40m);
        SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        await db.SaveChangesAsync();
        var service = new ShiftClaimGenerationService(db);

        var generate = await Assert.ThrowsAsync<InvalidOperationException>(() => service.GenerateAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7)));
        var preview = await Assert.ThrowsAsync<InvalidOperationException>(() => service.PreviewAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7)));

        foreach (var message in new[] { generate.Message, preview.Message })
        {
            Assert.Contains("Invoice them directly", message);
            Assert.DoesNotContain("NDIS number missing", message);
        }
        Assert.Empty(db.TripClaims);
        Assert.Empty(db.ClaimLineItems);
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

    // ── Rejected and cancelled claims give their shifts back ──────────

    private static async Task<(Guid ParticipantId, Shift Shift)> ArrangeShiftWithClaimLine(OdipDbContext db, TripClaimStatus claimStatus, ClaimLineItemStatus lineStatus)
    {
        SeedProviderSettings(db);
        var participant = SeedParticipant(db);
        SeedCatalogueItem(db, ClaimDayType.Weekday, false, vicPrice: 10m);
        var shift = SeedShift(db, participant.Id, new DateOnly(2026, 9, 7));
        var claim = new TripClaim { TenantId = participant.TenantId, Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = claimStatus, ClaimReference = "TC-OLD", TotalAmount = 80m };
        db.TripClaims.Add(claim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            TenantId = claim.TenantId,
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "04_Weekday_STD", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate, Hours = 8m, UnitPrice = 10m, TotalAmount = 80m, Status = lineStatus,
        });
        await db.SaveChangesAsync();
        return (participant.Id, shift);
    }

    [Theory]
    [InlineData(TripClaimStatus.Rejected, ClaimLineItemStatus.Rejected)]
    [InlineData(TripClaimStatus.Cancelled, ClaimLineItemStatus.Draft)]
    [InlineData(TripClaimStatus.Draft, ClaimLineItemStatus.Rejected)]
    public async Task GenerateDraftClaimAsync_ShiftWhoseClaimOrLineWasRejectedOrCancelled_IsClaimedAgain(TripClaimStatus claimStatus, ClaimLineItemStatus lineStatus)
    {
        using var db = CreateDb();
        var (participantId, shift) = await ArrangeShiftWithClaimLine(db, claimStatus, lineStatus);

        var claim = await new ShiftClaimGenerationService(db).GenerateDraftClaimAsync(participantId, shift.ServiceDate, shift.ServiceDate);

        Assert.Equal(shift.Id, (await db.ClaimLineItems.SingleAsync(l => l.TripClaimId == claim.Id)).ShiftId);
        Assert.Equal(2, await db.TripClaims.CountAsync()); // the old claim stays as the record
    }

    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Approved)]
    [InlineData(TripClaimStatus.Paid)]
    public async Task GenerateDraftClaimAsync_ShiftOnALiveClaim_IsNotClaimedTwice(TripClaimStatus claimStatus)
    {
        using var db = CreateDb();
        var (participantId, shift) = await ArrangeShiftWithClaimLine(db, claimStatus, ClaimLineItemStatus.Draft);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new ShiftClaimGenerationService(db).GenerateDraftClaimAsync(participantId, shift.ServiceDate, shift.ServiceDate));
    }
}
