using ClosedXML.Excel;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// Claims must not change (phase A item 5). The trip engine prices from the group's first item for a day type; the shift engine used to take
/// the first active item over ALL groups. After a full 2026-27 import the catalogue also holds personal care, sleepover, STA, travel and a
/// thousand other items, so both engines must still pick exactly the items they pick today: the RG 0125 standard items and, for a participant
/// who needs intensive support, the ICBS ones. "Today" is a database holding only those ten items, as the previous importer left it.
/// </summary>
public class CatalogueClaimsRegressionTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    // The prefixes the previous importer mapped, and the only rows it kept: category 04, registration group 0125.
    private static readonly Dictionary<string, ClaimDayType> PreviousImporterPrefixes = new()
    {
        ["04_104_"] = ClaimDayType.Weekday, ["04_103_"] = ClaimDayType.WeekdayEvening, ["04_105_"] = ClaimDayType.Saturday,
        ["04_106_"] = ClaimDayType.Sunday, ["04_102_"] = ClaimDayType.PublicHoliday,
        ["04_450_"] = ClaimDayType.Weekday, ["04_451_"] = ClaimDayType.WeekdayEvening, ["04_452_"] = ClaimDayType.Saturday,
        ["04_453_"] = ClaimDayType.Sunday, ["04_454_"] = ClaimDayType.PublicHoliday,
    };

    // 2026-27 national prices (NDIS-CODES 4.2 and the ICBS rows of the file); the provider state is VIC, whose column an import fills with the National price.
    private static readonly Dictionary<(string Who, ClaimDayType Day), (string Code, decimal Price)> Expected = new()
    {
        [("standard", ClaimDayType.Weekday)] = ("04_104_0125_6_1", 73.58m),
        [("standard", ClaimDayType.WeekdayEvening)] = ("04_103_0125_6_1", 81.07m),
        [("standard", ClaimDayType.Saturday)] = ("04_105_0125_6_1", 103.54m),
        [("standard", ClaimDayType.Sunday)] = ("04_106_0125_6_1", 133.50m),
        [("standard", ClaimDayType.PublicHoliday)] = ("04_102_0125_6_1", 163.46m),
        [("intensive", ClaimDayType.Weekday)] = ("04_450_0125_1_1", 79.60m),
        [("intensive", ClaimDayType.WeekdayEvening)] = ("04_451_0125_1_1", 87.70m),
        [("intensive", ClaimDayType.Saturday)] = ("04_452_0125_1_1", 112.01m),
        [("intensive", ClaimDayType.Sunday)] = ("04_453_0125_1_1", 144.42m),
        [("intensive", ClaimDayType.PublicHoliday)] = ("04_454_0125_1_1", 176.84m),
    };

    private sealed record Pick(string Who, ClaimDayType Day, string Code, decimal UnitPrice);

    /// <summary>The community access items the previous importer would have left from this very file, in file order, as it wrote them.</summary>
    private static async Task SeedWhatThePreviousImporterLeftAsync(OdipDbContext db)
    {
        var group = await SeedCommunityAccessGroupAsync(db);
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27));
        foreach (var row in wb.Worksheet("Current Support Items").RowsUsed().Skip(1))
        {
            var code = row.Cell(1).GetString().Trim();
            if (!code.Contains("_0125_") || !PreviousImporterPrefixes.TryGetValue(code[..7], out var day)) continue;
            var national = (decimal)row.Cell(13).GetDouble();
            var item = LegacyRow(group.Id, code, day, national, new DateOnly(2026, 10, 2), version: "2026-27");
            item.PriceLimit_Remote = (decimal)row.Cell(14).GetDouble();
            item.PriceLimit_VeryRemote = (decimal)row.Cell(15).GetDouble();
            item.IsIntensive = code.StartsWith("04_45", StringComparison.Ordinal);
            db.SupportCatalogueItems.Add(item);
        }
        await db.SaveChangesAsync();
    }

    private static Participant NewParticipant(string first, bool intensive) => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = first, LastName = "Test", NdisNumber = intensive ? "43100009999" : "43100001234",
        IsIntensiveSupport = intensive, PlanType = PlanType.AgencyManaged, SupportRatio = SupportRatio.OneToOne,
    };

    /// <summary>
    /// The same inputs for every database: a completed 5-day trip (Fri to Tue, Monday a public holiday, leaving 14:00 and returning 21:00 so
    /// both weekday groups have an evening part) with a standard and an intensive participant; and one completed shift per day type for each.
    /// </summary>
    private static async Task<(List<Pick> Trip, List<Pick> Shift)> PicksAsync(OdipDbContext db)
    {
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = "VIC", GSTRegistered = false });
        var standard = NewParticipant("Standard", intensive: false);
        var intensive = NewParticipant("Intensive", intensive: true);
        db.Participants.AddRange(standard, intensive);

        var monday = new DateOnly(2026, 10, 19);
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = monday, Name = "Test holiday", State = null });

        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TenantId = TenantId, TripName = "Regression trip", TripCode = "REG1", StartDate = new DateOnly(2026, 10, 16), DurationDays = 5,
            Status = TripStatus.Completed, ActiveHoursPerDay = 8m, DepartureTime = new TimeOnly(14, 0), ReturnTime = new TimeOnly(21, 0),
        };
        db.TripInstances.Add(trip);
        for (var i = 0; i < 5; i++)
            db.TripDays.Add(new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = i + 1, Date = trip.StartDate.AddDays(i), IsPublicHoliday = trip.StartDate.AddDays(i) == monday });
        foreach (var p in new[] { standard, intensive })
            db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = p.Id, Participant = p, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 10, 1) });

        // Tue 13 Oct (weekday), Sat 17, Sun 18, Mon 19 (public holiday)
        foreach (var p in new[] { standard, intensive })
            foreach (var date in new[] { new DateOnly(2026, 10, 13), new DateOnly(2026, 10, 17), new DateOnly(2026, 10, 18), monday })
                db.Shifts.Add(new Shift
                {
                    Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, ServiceDate = date, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
                    Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
                });
        await db.SaveChangesAsync();

        string Who(Guid participantId) => participantId == standard.Id ? "standard" : "intensive";

        var preview = await new ClaimGenerationService(db).PreviewClaimAsync(trip.Id, null);
        var tripPicks = preview.LineItems
            .Select(l => new Pick(l.NdisNumber == standard.NdisNumber ? "standard" : "intensive", l.DayType, l.SupportItemCode, l.UnitPrice))
            .Distinct().OrderBy(p => p.Who).ThenBy(p => p.Day).ToList();

        var shiftPicks = new List<Pick>();
        foreach (var p in new[] { standard, intensive })
        {
            var shifts = await new ShiftClaimGenerationService(db).PreviewAsync(p.Id, new DateOnly(2026, 10, 13), monday);
            shiftPicks.AddRange(shifts.LineItems.Select(l => new Pick(Who(p.Id), l.DayType, l.SupportItemCode, l.UnitPrice)));
        }
        return (tripPicks, shiftPicks.Distinct().OrderBy(p => p.Who).ThenBy(p => p.Day).ToList());
    }

    private static void AssertPicks(List<Pick> picks, params ClaimDayType[] days)
    {
        Assert.Equal(days.Length * 2, picks.Count);
        foreach (var p in picks)
            Assert.Equal(Expected[(p.Who, p.Day)], (p.Code, p.UnitPrice));
        foreach (var who in new[] { "standard", "intensive" })
            Assert.Equal(days.OrderBy(d => d), picks.Where(p => p.Who == who).Select(p => p.Day).OrderBy(d => d));
    }

    [Fact]
    public async Task After_a_full_2026_27_import_the_shift_claims_pick_the_same_community_access_item_per_day_type()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var (_, shift) = await PicksAsync(db);

        AssertPicks(shift, ClaimDayType.Weekday, ClaimDayType.Saturday, ClaimDayType.Sunday, ClaimDayType.PublicHoliday);
    }

    [Fact]
    public async Task After_a_full_2026_27_import_the_trip_claims_pick_the_same_community_access_item_per_day_type()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var (trip, _) = await PicksAsync(db);

        AssertPicks(trip, ClaimDayType.Weekday, ClaimDayType.WeekdayEvening, ClaimDayType.Saturday, ClaimDayType.Sunday, ClaimDayType.PublicHoliday);
    }

    [Fact]
    public async Task Both_engines_pick_exactly_what_they_pick_from_the_ten_items_the_previous_importer_left()
    {
        await using var before = CreateDb();
        await SeedWhatThePreviousImporterLeftAsync(before);
        var today = await PicksAsync(before);

        await using var after = CreateDb();
        await SeedCommunityAccessGroupAsync(after);
        await ImportAsync(after, CatalogueFixtures.File2026_27);
        var afterImport = await PicksAsync(after);

        Assert.Equal(today.Trip, afterImport.Trip);
        Assert.Equal(today.Shift, afterImport.Shift);
        AssertPicks(today.Shift, ClaimDayType.Weekday, ClaimDayType.Saturday, ClaimDayType.Sunday, ClaimDayType.PublicHoliday);   // the baseline itself is what the table says
    }

    [Fact]
    public async Task The_picks_do_not_change_after_a_second_import_of_a_newer_version_either()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var (trip, shift) = await PicksAsync(db);

        AssertPicks(trip, ClaimDayType.Weekday, ClaimDayType.WeekdayEvening, ClaimDayType.Saturday, ClaimDayType.Sunday, ClaimDayType.PublicHoliday);
        AssertPicks(shift, ClaimDayType.Weekday, ClaimDayType.Saturday, ClaimDayType.Sunday, ClaimDayType.PublicHoliday);
    }
}
