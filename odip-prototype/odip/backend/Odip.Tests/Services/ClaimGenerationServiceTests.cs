using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

public class ClaimGenerationServiceTests
{
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

    // ── Seed helpers ──────────────────────────────────────────────

    private static readonly Guid TenantId = Guid.NewGuid();

    private static SupportActivityGroup SeedActivityGroup(OdipDbContext db)
    {
        var group = new SupportActivityGroup
        {
            Id = Guid.NewGuid(),
            GroupCode = "GRP_COMMUNITY_ACCESS",
            DisplayName = "Community Access",
            SupportCategory = 4,
            IsActive = true
        };
        db.SupportActivityGroups.Add(group);
        return group;
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
            GSTRegistered = gstRegistered
        };
        db.ProviderSettings.Add(settings);
        return settings;
    }

    private static SupportCatalogueItem SeedCatalogueItem(
        OdipDbContext db, Guid activityGroupId, ClaimDayType dayType, bool isIntensive,
        decimal vicPrice = 50m, decimal nswPrice = 55m)
    {
        var item = new SupportCatalogueItem
        {
            Id = Guid.NewGuid(),
            ActivityGroupId = activityGroupId,
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
            IsActive = true
        };
        db.SupportCatalogueItems.Add(item);
        return item;
    }

    private static Participant CreateParticipant(bool isIntensive = false)
    {
        return new Participant
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            FirstName = "Jane",
            LastName = "Doe",
            NdisNumber = "43100001234",
            IsIntensiveSupport = isIntensive,
            PlanType = PlanType.AgencyManaged,
            SupportRatio = SupportRatio.SharedSupport
        };
    }

    /// <summary>
    /// Creates a completed trip starting on the given Monday with the given number of weekday-only days.
    /// </summary>
    private static TripInstance SeedCompletedTrip(
        OdipDbContext db, DateOnly startDate, int durationDays,
        Participant participant, Guid? activityGroupId = null,
        decimal activeHoursPerDay = 8m,
        TimeOnly? departureTime = null, TimeOnly? returnTime = null)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            TripName = "Test Trip",
            TripCode = "T001",
            StartDate = startDate,
            DurationDays = durationDays,
            Status = TripStatus.Completed,
            DefaultActivityGroupId = activityGroupId,
            ActiveHoursPerDay = activeHoursPerDay,
            DepartureTime = departureTime,
            ReturnTime = returnTime
        };
        db.TripInstances.Add(trip);

        // Create trip days
        for (int i = 0; i < durationDays; i++)
        {
            db.TripDays.Add(new TripDay
            {
                Id = Guid.NewGuid(),
                TripInstanceId = trip.Id,
                DayNumber = i + 1,
                Date = startDate.AddDays(i)
            });
        }

        // Create confirmed booking
        db.ParticipantBookings.Add(new ParticipantBooking
        {
            Id = Guid.NewGuid(),
            TripInstanceId = trip.Id,
            ParticipantId = participant.Id,
            Participant = participant,
            BookingStatus = BookingStatus.Confirmed,
            BookingDate = DateOnly.FromDateTime(DateTime.UtcNow)
        });

        return trip;
    }

    // ── PreviewClaimAsync Tests ───────────────────────────────────

    [Fact]
    public async Task PreviewClaimAsync_WeekdaysOnly_CalculatesCorrectHoursAndAmount()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        var weekdayItem = SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 60m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Monday 2026-01-05 to Wednesday 2026-01-07 = 3 weekdays
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 3, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        Assert.Equal(1, result.ConfirmedParticipantCount);
        Assert.Equal("VIC", result.State);
        Assert.Equal(8m, result.ActiveHoursPerDay);

        // 3 weekdays * 8 hours/day = 24 hours * $60 = $1440
        var weekdayLines = result.LineItems.Where(l => l.DayType == ClaimDayType.Weekday).ToList();
        Assert.Single(weekdayLines);
        Assert.Equal(24m, weekdayLines[0].Hours);
        Assert.Equal(60m, weekdayLines[0].UnitPrice);
        Assert.Equal(1440m, weekdayLines[0].TotalAmount);
        Assert.Equal(1440m, result.TotalAmount);
    }

    [Fact]
    public async Task PreviewClaimAsync_TripNotFound_ThrowsInvalidOperation()
    {
        using var db = CreateDb();
        var service = new ClaimGenerationService(db);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.PreviewClaimAsync(Guid.NewGuid(), null));
    }

    [Fact]
    public async Task PreviewClaimAsync_NoProviderSettings_ThrowsInvalidOperation()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        // No provider settings seeded
        var participant = CreateParticipant();
        db.Participants.Add(participant);
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant, activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.PreviewClaimAsync(trip.Id, null));
    }

    [Fact]
    public async Task PreviewClaimAsync_NoConfirmedBookings_ThrowsInvalidOperation()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false);

        // Create trip with no bookings
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(),
            TenantId = TenantId,
            TripName = "Empty Trip",
            StartDate = new DateOnly(2026, 1, 5),
            DurationDays = 1,
            Status = TripStatus.Completed,
            DefaultActivityGroupId = group.Id,
            ActiveHoursPerDay = 8m
        };
        db.TripInstances.Add(trip);
        db.TripDays.Add(new TripDay
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = 1,
            Date = new DateOnly(2026, 1, 5)
        });
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.PreviewClaimAsync(trip.Id, null));
    }

    [Fact]
    public async Task PreviewClaimAsync_OverridesApplied_UsesOverrideValues()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // 1 weekday with default 8 hours
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var overrides = new ClaimPreviewRequestDto
        {
            ActiveHoursPerDay = 6m,
            DepartureTime = new TimeOnly(9, 0),
            ReturnTime = new TimeOnly(17, 0)
        };

        var result = await service.PreviewClaimAsync(trip.Id, overrides);

        Assert.Equal(6m, result.ActiveHoursPerDay);
        Assert.Equal(new TimeOnly(9, 0), result.DepartureTime);
        // 1 day * 6 hours = 6 hours
        Assert.Equal(6m, result.LineItems.Sum(l => l.Hours));
    }

    [Fact]
    public async Task PreviewClaimAsync_SaturdayTrip_UsesSaturdayRate()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Saturday, false, vicPrice: 70m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Saturday 2026-01-10
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 10), 1, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        Assert.Single(result.LineItems);
        Assert.Equal(ClaimDayType.Saturday, result.LineItems[0].DayType);
        Assert.Equal(70m, result.LineItems[0].UnitPrice);
    }

    [Fact]
    public async Task PreviewClaimAsync_PublicHoliday_UsesHolidayRate()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.PublicHoliday, false, vicPrice: 100m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Monday 2026-01-05 flagged as a public holiday in the DB
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        db.PublicHolidays.Add(new PublicHoliday
        {
            Id = Guid.NewGuid(),
            Date = new DateOnly(2026, 1, 5),
            Name = "Test Holiday",
            State = "VIC"
        });
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        Assert.Single(result.LineItems);
        Assert.Equal(ClaimDayType.PublicHoliday, result.LineItems[0].DayType);
        Assert.Equal(100m, result.LineItems[0].UnitPrice);
    }

    [Fact]
    public async Task PreviewClaimAsync_IntensiveParticipant_MatchesIntensiveCatalogueItem()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, isIntensive: false, vicPrice: 50m);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, isIntensive: true, vicPrice: 80m);
        var participant = CreateParticipant(isIntensive: true);
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        // Should pick the intensive rate
        Assert.Equal(80m, result.LineItems[0].UnitPrice);
    }

    [Fact]
    public async Task PreviewClaimAsync_StatePricing_UsesCorrectStatePrice()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db, state: "NSW");
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m, nswPrice: 65m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        Assert.Equal(65m, result.LineItems[0].UnitPrice);
        Assert.Equal("NSW", result.State);
    }

    [Fact]
    public async Task PreviewClaimAsync_EveningDeparture_SplitsWeekdayAndEveningHours()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        SeedCatalogueItem(db, group.Id, ClaimDayType.WeekdayEvening, false, vicPrice: 55m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Depart at 18:00, 8 active hours means activity extends to 02:00 next day.
        // Evening threshold is 20:00: 18:00-20:00 is 2 daytime (weekday) hours,
        // 20:00-02:00 (crossing midnight) is 6 evening hours.
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m,
            departureTime: new TimeOnly(18, 0));
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        var weekdayLine = result.LineItems.FirstOrDefault(l => l.DayType == ClaimDayType.Weekday);
        var eveningLine = result.LineItems.FirstOrDefault(l => l.DayType == ClaimDayType.WeekdayEvening);

        Assert.NotNull(weekdayLine);
        Assert.NotNull(eveningLine);
        // Daytime: 2 hours, Evening: 6 hours
        Assert.Equal(2m, weekdayLine!.Hours);
        Assert.Equal(6m, eveningLine!.Hours);
    }

    // ── GenerateDraftClaimAsync Tests ─────────────────────────────

    [Fact]
    public async Task GenerateDraftClaimAsync_CompletedTrip_PersistsClaimAndLineItems()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 2, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(trip.Id);

        Assert.Equal(TripClaimStatus.Draft, claim.Status);
        Assert.Equal(trip.Id, claim.TripInstanceId);
        Assert.True(claim.ClaimReference.StartsWith("TC-T001-"));
        Assert.Equal(800m, claim.TotalAmount); // 2 days * 8 hours * $50

        var persistedLineItems = await db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.Single(persistedLineItems);
        Assert.Equal(16m, persistedLineItems[0].Hours);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_NonCompletedTrip_ThrowsInvalidOperation()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Create a trip that is NOT completed
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        trip.Status = TripStatus.InProgress;
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.GenerateDraftClaimAsync(trip.Id));
        Assert.Contains("completed", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_ExistingActiveClaim_ThrowsInvalidOperation()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);

        // Pre-existing active (Draft) claim
        db.TripClaims.Add(new TripClaim
        {
            Id = Guid.NewGuid(),
            TripInstanceId = trip.Id,
            Status = TripClaimStatus.Draft,
            ClaimReference = "TC-EXISTING",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.GenerateDraftClaimAsync(trip.Id));
        Assert.Contains("active claim already exists", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_RejectedClaimExists_AllowsNewClaim()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);

        // Pre-existing rejected claim -- should not block new claim
        db.TripClaims.Add(new TripClaim
        {
            Id = Guid.NewGuid(),
            TripInstanceId = trip.Id,
            Status = TripClaimStatus.Rejected,
            ClaimReference = "TC-OLD",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(trip.Id);

        Assert.NotNull(claim);
        Assert.Equal(TripClaimStatus.Draft, claim.Status);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_SetsBookingClaimStatusToInClaim()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        await service.GenerateDraftClaimAsync(trip.Id);

        var booking = await db.ParticipantBookings
            .FirstAsync(b => b.TripInstanceId == trip.Id);
        Assert.Equal(ClaimStatus.InClaim, booking.ClaimStatus);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_WithOverrides_PersistsTimesOnTrip()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var overrides = new GenerateClaimRequestDto
        {
            DepartureTime = new TimeOnly(9, 30),
            ReturnTime = new TimeOnly(16, 30),
            ActiveHoursPerDay = 7m
        };

        await service.GenerateDraftClaimAsync(trip.Id, overrides);

        var updatedTrip = await db.TripInstances.FindAsync(trip.Id);
        Assert.Equal(new TimeOnly(9, 30), updatedTrip!.DepartureTime);
        Assert.Equal(new TimeOnly(16, 30), updatedTrip.ReturnTime);
        Assert.Equal(7m, updatedTrip.ActiveHoursPerDay);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_GSTRegistered_SetsP1GSTCode()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db, gstRegistered: true);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(trip.Id);

        var lineItem = await db.ClaimLineItems.FirstAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(GSTCode.P1, lineItem.GSTCode);
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_NotGSTRegistered_SetsP2GSTCode()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db, gstRegistered: false);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(trip.Id);

        var lineItem = await db.ClaimLineItems.FirstAsync(l => l.TripClaimId == claim.Id);
        Assert.Equal(GSTCode.P2, lineItem.GSTCode);
    }

    [Fact]
    public async Task PreviewClaimAsync_MixedWeekdayAndWeekend_GroupsDayTypes()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Saturday, false, vicPrice: 70m);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Sunday, false, vicPrice: 75m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Fri 2026-01-09, Sat 2026-01-10, Sun 2026-01-11 = 3 days
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 9), 3, participant,
            activityGroupId: group.Id, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        var dayTypes = result.LineItems.Select(l => l.DayType).ToHashSet();
        Assert.Contains(ClaimDayType.Weekday, dayTypes);
        Assert.Contains(ClaimDayType.Saturday, dayTypes);
        Assert.Contains(ClaimDayType.Sunday, dayTypes);

        var satLine = result.LineItems.First(l => l.DayType == ClaimDayType.Saturday);
        Assert.Equal(70m, satLine.UnitPrice);
        Assert.Equal(8m, satLine.Hours); // 1 day

        var sunLine = result.LineItems.First(l => l.DayType == ClaimDayType.Sunday);
        Assert.Equal(75m, sunLine.UnitPrice);
    }

    [Fact]
    public async Task PreviewClaimAsync_ParticipantWithNoNdisNumber_SkippedInLineItems()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);

        var participant = CreateParticipant();
        participant.NdisNumber = null; // No NDIS number
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        Assert.Empty(result.LineItems);
        Assert.Equal(0m, result.TotalAmount);
    }

    // ── A claim with no lines is never saved: generating says why instead ──────────────────────
    // The preview keeps returning an empty list (the test above pins it): it is a look at what the engine would do. Generating must not save a Draft claim with
    // no lines and a total of 0, because the "an active claim already exists" check would then block the trip until someone rejected that claim.

    private static async Task AssertGenerateRefusesAndSavesNothingAsync(OdipDbContext db, TripInstance trip, string expectedMessage)
    {
        var service = new ClaimGenerationService(db);

        var first = await Assert.ThrowsAsync<InvalidOperationException>(() => service.GenerateDraftClaimAsync(trip.Id));
        var second = await Assert.ThrowsAsync<InvalidOperationException>(() => service.GenerateDraftClaimAsync(trip.Id));

        Assert.Equal(expectedMessage, first.Message);
        Assert.Equal(expectedMessage, second.Message);   // not "An active claim already exists for this trip": there is no empty draft to block it
        Assert.Empty(db.TripClaims);
        Assert.Empty(db.ClaimLineItems);
        Assert.All(db.ParticipantBookings, b => Assert.NotEqual(ClaimStatus.InClaim, b.ClaimStatus));
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_NoConfirmedParticipantHasAnNdisNumber_RefusesWithThatReasonAndSavesNothing()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        participant.NdisNumber = null;
        db.Participants.Add(participant);
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant, activityGroupId: group.Id);
        await db.SaveChangesAsync();

        await AssertGenerateRefusesAndSavesNothingAsync(db, trip,
            "None of the trip's confirmed participants has an NDIS number, so no claim lines could be built. Add the NDIS number to each participant, then generate the claim again.");
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_TheCatalogueHasNoItemForTheTripsDayType_RefusesWithThatReasonAndSavesNothing()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);   // rows are valid on the trip's date, but none is a Saturday item
        var participant = CreateParticipant();
        db.Participants.Add(participant);
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 10), 1, participant, activityGroupId: group.Id);   // Saturday 10 January
        await db.SaveChangesAsync();

        await AssertGenerateRefusesAndSavesNothingAsync(db, trip,
            "No catalogue item prices this trip's Saturday days (10/01/2026 to 10/01/2026), so no claim lines could be built. Import the catalogue for that period first.");
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_TripWithNoDays_RefusesWithThatReasonAndSavesNothing()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 3, participant, activityGroupId: group.Id);
        db.TripDays.RemoveRange(db.TripDays.Local.ToList());   // a Completed trip whose day rows are missing
        await db.SaveChangesAsync();

        await AssertGenerateRefusesAndSavesNothingAsync(db, trip,
            "This trip has no days recorded, so there is nothing to claim. Check the trip's dates, then generate the claim again.");
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_NothingLeftToPrice_RefusesInsteadOfSavingAnEmptyClaim()
    {
        // No active hours: every weekday group has 0 hours, so no line is built although the participant, the days and the catalogue are all fine.
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 3, participant, activityGroupId: group.Id, activeHoursPerDay: 0m);
        await db.SaveChangesAsync();

        await AssertGenerateRefusesAndSavesNothingAsync(db, trip,
            "No claim lines could be built for this trip. Check its active hours per day and its departure and return times, then generate the claim again.");
    }

    [Fact]
    public async Task GenerateDraftClaimAsync_ClaimReferenceFormat_ContainsTripCodeAndDate()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db);
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: group.Id);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var claim = await service.GenerateDraftClaimAsync(trip.Id);

        Assert.StartsWith("TC-T001-", claim.ClaimReference);
        // Should contain today's date in yyyyMMdd format
        Assert.Contains(DateTime.UtcNow.ToString("yyyyMMdd"), claim.ClaimReference);
    }

    [Fact]
    public async Task PreviewClaimAsync_DefaultActivityGroup_UsedWhenTripHasNone()
    {
        using var db = CreateDb();
        var group = SeedActivityGroup(db); // GroupCode = "GRP_COMMUNITY_ACCESS" (the default)
        SeedProviderSettings(db);
        SeedCatalogueItem(db, group.Id, ClaimDayType.Weekday, false, vicPrice: 50m);
        var participant = CreateParticipant();
        db.Participants.Add(participant);

        // Trip has no DefaultActivityGroupId set
        var trip = SeedCompletedTrip(db, new DateOnly(2026, 1, 5), 1, participant,
            activityGroupId: null, activeHoursPerDay: 8m);
        await db.SaveChangesAsync();

        var service = new ClaimGenerationService(db);
        var result = await service.PreviewClaimAsync(trip.Id, null);

        // Should still work by falling back to GRP_COMMUNITY_ACCESS
        Assert.Single(result.LineItems);
        Assert.Equal(50m, result.LineItems[0].UnitPrice);
    }
}
