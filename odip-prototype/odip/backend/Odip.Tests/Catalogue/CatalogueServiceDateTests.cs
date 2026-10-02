using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// Both claim engines and the agreement draft price a service by the catalogue row valid on the SERVICE date, not by the "current" flag. NDIA has said
/// the 2026-27 prices will be updated later this year: a December price set imported on 10 December must not reprice a shift, a trip or an agreement
/// that happened before it and has not been claimed yet. A superseded row keeps its window (the import end-dates it the day before the new row starts),
/// and the engines now read that window.
/// </summary>
public class CatalogueServiceDateTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly December1 = new(2026, 12, 1);

    // The 2026-27 community access prices, and the same codes in a December price set one dollar higher.
    private const decimal WeekdayJuly = 73.58m, WeekdayDecember = 74.58m, SaturdayJuly = 103.54m;

    /// <summary>
    /// The 2026-27 catalogue imported on 2 Oct 2026, then a December price set imported on 10 Dec 2026: a complete catalogue in which the ten community
    /// access rows start on 1 Dec at one dollar more and every other row keeps its 1 July start (so it is Unchanged), as NDIA republishes.
    /// </summary>
    private static async Task<OdipDbContext> WithDecemberPriceSetAsync()
    {
        var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var rows = (await PreviewAsync(db, CatalogueFixtures.File2026_27)).Rows
            .Select(r => r.GroupCode == "GRP_COMMUNITY_ACCESS" ? Raised(r) : r)
            .ToList();
        var result = await NewImporter(db, ClockOn(2026, 12, 10)).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27 (2026-12-01)", Rows = rows });
        Assert.Equal(new CatalogueImportResultDto(10, 0, 1007, 10), result);   // the setup itself: ten new rows, ten end-dated, the rest untouched
        return db;
    }

    private static CatalogueImportRowDto Raised(CatalogueImportRowDto r)
    {
        var price = r.PriceNational!.Value + 1m;
        return r with
        {
            EffectiveFrom = December1, PriceNational = price,
            PriceLimit_ACT = price, PriceLimit_NSW = price, PriceLimit_NT = price, PriceLimit_QLD = price,
            PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_VIC = price, PriceLimit_WA = price,
        };
    }

    private static Participant AddParticipant(OdipDbContext db, bool intensive = false)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234",
            DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true, IsIntensiveSupport = intensive,
            PlanType = PlanType.AgencyManaged, SupportRatio = SupportRatio.OneToOne,
        };
        db.Participants.Add(participant);
        return participant;
    }

    private static void AddProviderSettings(OdipDbContext db) =>
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = "VIC", GSTRegistered = false });

    private static void AddCompletedShift(OdipDbContext db, Guid participantId, DateOnly date) =>
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participantId, ServiceDate = date, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        });

    private static TripInstance AddCompletedTrip(OdipDbContext db, Participant participant, DateOnly start, int days)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TenantId = TenantId, TripName = "Service-date trip", TripCode = "SD1", StartDate = start, DurationDays = days,
            Status = TripStatus.Completed, ActiveHoursPerDay = 8m, DepartureTime = new TimeOnly(8, 0), ReturnTime = new TimeOnly(18, 0),
        };
        db.TripInstances.Add(trip);
        for (var i = 0; i < days; i++)
            db.TripDays.Add(new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = i + 1, Date = start.AddDays(i) });
        db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, Participant = participant, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 10, 1) });
        return trip;
    }

    // ── The importer keeps each superseded row's window ───────────────────────────

    [Fact]
    public async Task The_setup_leaves_the_july_rows_valid_until_30_November_and_the_december_rows_from_1_December()
    {
        await using var db = await WithDecemberPriceSetAsync();

        var july = (await RowsAsync(db)).Single(r => r.ItemNumber == "04_104_0125_6_1" && r.EffectiveFrom == new DateOnly(2026, 7, 1));
        var december = (await RowsAsync(db)).Single(r => r.ItemNumber == "04_104_0125_6_1" && r.EffectiveFrom == December1);

        Assert.Equal((new DateOnly(2026, 11, 30), false, WeekdayJuly), (july.EffectiveTo, july.IsActive, july.PriceNational));
        Assert.Equal(((DateOnly?)null, true, WeekdayDecember), (december.EffectiveTo, december.IsActive, december.PriceNational));
    }

    // ── Shift claims ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_shift_before_the_december_price_set_keeps_the_price_of_its_own_date_after_the_set_is_imported()
    {
        await using var db = await WithDecemberPriceSetAsync();
        AddProviderSettings(db);
        var participant = AddParticipant(db);
        AddCompletedShift(db, participant.Id, new DateOnly(2026, 11, 10));   // Tuesday, weekday
        AddCompletedShift(db, participant.Id, new DateOnly(2026, 11, 14));   // Saturday
        AddCompletedShift(db, participant.Id, new DateOnly(2026, 12, 8));    // Tuesday, after the price set starts
        await db.SaveChangesAsync();

        var preview = await new ShiftClaimGenerationService(db).PreviewAsync(participant.Id, new DateOnly(2026, 11, 1), new DateOnly(2026, 12, 31));

        var lines = preview.LineItems.OrderBy(l => l.ServiceDate).Select(l => (l.ServiceDate, l.DayType, l.SupportItemCode, l.UnitPrice)).ToList();
        Assert.Equal(new[]
        {
            (new DateOnly(2026, 11, 10), ClaimDayType.Weekday, "04_104_0125_6_1", WeekdayJuly),
            (new DateOnly(2026, 11, 14), ClaimDayType.Saturday, "04_105_0125_6_1", SaturdayJuly),
            (new DateOnly(2026, 12, 8), ClaimDayType.Weekday, "04_104_0125_6_1", WeekdayDecember),
        }, lines);
    }

    [Fact]
    public async Task A_shift_before_any_catalogue_row_starts_is_not_priced_from_the_current_one()
    {
        await using var db = await WithDecemberPriceSetAsync();
        AddProviderSettings(db);
        var participant = AddParticipant(db);
        AddCompletedShift(db, participant.Id, new DateOnly(2026, 6, 16));   // before the 2026-27 catalogue: no row is valid that day
        await db.SaveChangesAsync();

        // The line is left out, as a day type with no catalogue item always was, rather than priced at a price that did not apply: with no other
        // shift in range there is nothing to claim.
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new ShiftClaimGenerationService(db).PreviewAsync(participant.Id, new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 30)));
    }

    // ── Trip claims ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_trip_before_the_december_price_set_keeps_the_price_of_its_own_dates_after_the_set_is_imported()
    {
        await using var db = await WithDecemberPriceSetAsync();
        AddProviderSettings(db);
        var participant = AddParticipant(db);
        var trip = AddCompletedTrip(db, participant, new DateOnly(2026, 11, 23), 3);   // Mon 23 to Wed 25 November
        await db.SaveChangesAsync();

        var preview = await new ClaimGenerationService(db).PreviewClaimAsync(trip.Id, null);

        var line = Assert.Single(preview.LineItems);
        Assert.Equal(("04_104_0125_6_1", WeekdayJuly, 24m), (line.SupportItemCode, line.UnitPrice, line.Hours));
    }

    [Fact]
    public async Task A_trip_that_crosses_the_price_change_is_priced_by_each_days_own_row()
    {
        await using var db = await WithDecemberPriceSetAsync();
        AddProviderSettings(db);
        var participant = AddParticipant(db);
        var trip = AddCompletedTrip(db, participant, new DateOnly(2026, 11, 30), 2);   // Mon 30 November (old price), Tue 1 December (new price)
        await db.SaveChangesAsync();

        var preview = await new ClaimGenerationService(db).PreviewClaimAsync(trip.Id, null);

        var lines = preview.LineItems.OrderBy(l => l.SupportsDeliveredFrom).Select(l => (l.SupportsDeliveredFrom, l.SupportsDeliveredTo, l.UnitPrice, l.Hours)).ToList();
        Assert.Equal(new[]
        {
            (new DateOnly(2026, 11, 30), new DateOnly(2026, 11, 30), WeekdayJuly, 8m),
            (December1, December1, WeekdayDecember, 8m),
        }, lines);
        Assert.Equal(8m * WeekdayJuly + 8m * WeekdayDecember, preview.TotalAmount);
    }

    [Fact]
    public async Task A_trip_after_the_price_change_is_priced_at_the_december_price()
    {
        await using var db = await WithDecemberPriceSetAsync();
        AddProviderSettings(db);
        var participant = AddParticipant(db);
        var trip = AddCompletedTrip(db, participant, new DateOnly(2026, 12, 14), 2);   // Mon 14 and Tue 15 December
        await db.SaveChangesAsync();

        var preview = await new ClaimGenerationService(db).PreviewClaimAsync(trip.Id, null);

        var line = Assert.Single(preview.LineItems);
        Assert.Equal((WeekdayDecember, 16m), (line.UnitPrice, line.Hours));
    }

    // ── Agreement drafts ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData("2026-11-10", 73.58, "2026-27")]                 // before the price set: the July row, which the import end-dated on 30 Nov
    [InlineData("2026-12-08", 74.58, "2026-27 (2026-12-01)")]
    public async Task A_draft_is_priced_by_the_row_valid_on_the_agreement_start_date(string start, double price, string version)
    {
        await using var db = await WithDecemberPriceSetAsync();
        var participant = AddParticipant(db);
        await db.SaveChangesAsync();
        var request = new CreateServiceAgreementDraftDto
        {
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
            AgreementStartDate = DateOnly.Parse(start), AgreementEndDate = new DateOnly(2027, 6, 30),
            State = "VIC", ServiceTypes = ["Community access"], Representative = "Representative",
            Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "Community access", ItemCode = "04_104_0125_6_1", Hours = 2m }],
        };

        var (draft, error) = await new ServiceAgreementDraftService(db).CreateAsync(TenantId, participant.Id, request, "actor", CancellationToken.None);

        Assert.Null(error);
        var line = Assert.Single(draft!.Lines);
        Assert.Equal(((decimal)price, version), (line.UnitPrice, line.CatalogueVersion));
    }

    // ── A row withdrawn by hand is used by nothing ────────────────────────────────

    [Fact]
    public async Task A_row_that_is_inactive_and_has_no_end_date_was_withdrawn_by_hand_and_prices_nothing()
    {
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        db.SupportCatalogueItems.Add(LegacyRow(group.Id, "04_WITHDRAWN", ClaimDayType.Weekday, 99m, new DateOnly(2024, 7, 1), active: false));   // an import always end-dates what it deactivates
        db.SupportCatalogueItems.Add(LegacyRow(group.Id, "04_CURRENT", ClaimDayType.Weekday, 60m, new DateOnly(2024, 7, 1)));
        AddProviderSettings(db);
        var participant = AddParticipant(db);
        AddCompletedShift(db, participant.Id, new DateOnly(2026, 11, 10));
        await db.SaveChangesAsync();

        var preview = await new ShiftClaimGenerationService(db).PreviewAsync(participant.Id, new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30));

        var line = Assert.Single(preview.LineItems);
        Assert.Equal(("04_CURRENT", 60m), (line.SupportItemCode, line.UnitPrice));
    }

    [Fact]
    public void The_validity_rule_is_one_definition_for_the_lookup_the_engines_and_the_queries()
    {
        var days = new[] { new DateOnly(2024, 6, 30), new DateOnly(2024, 7, 1), new DateOnly(2025, 1, 1), new DateOnly(2025, 6, 30), new DateOnly(2025, 7, 1), new DateOnly(2030, 1, 1) };
        foreach (var active in new[] { true, false })
            foreach (var to in new DateOnly?[] { null, new DateOnly(2025, 6, 30) })
                foreach (var date in days)
                {
                    var item = new SupportCatalogueItem { ItemNumber = "X", EffectiveFrom = new DateOnly(2024, 7, 1), EffectiveTo = to, IsActive = active };
                    var expected = item.EffectiveFrom <= date && (to is null || to >= date) && (active || to is not null);

                    Assert.Equal(expected, EffectiveCatalogueResolver.IsValidOn(item, date));
                    Assert.Equal(expected, EffectiveCatalogueResolver.ValidOn(date).Compile()(item));
                }
    }
}
