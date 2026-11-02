using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>Shift claims split by rate band, sleepovers and passive nights (shift billing PR3). Expected values are hard-coded; the catalogue has a different price for every band so a wrong band shows.</summary>
public class ShiftBandClaimTests
{
    private static Participant SeedParticipant(OdipDbContext db, Guid tenantId, bool intensive = false, string? addressState = null)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Doe", NdisNumber = "43100001234",
            IsIntensiveSupport = intensive, PlanType = PlanType.AgencyManaged, AddressState = addressState,
        };
        db.Participants.Add(p);
        return p;
    }

    private static SupportActivityGroup Group(OdipDbContext db, string code) =>
        db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == code)
        ?? db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = code, DisplayName = code, SupportCategory = 4 }).Entity;

    private static SupportCatalogueItem Item(OdipDbContext db, string groupCode, ClaimDayType dayType, bool intensive, decimal price, string number, string unit = "H", DateOnly? from = null) =>
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = Group(db, groupCode).Id, ItemNumber = number, Description = $"Test {number}", Unit = unit,
            DayType = dayType, IsIntensive = intensive,
            PriceLimit_VIC = price, PriceLimit_NSW = price, PriceLimit_ACT = price, PriceLimit_NT = price, PriceLimit_QLD = price,
            PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_WA = price, PriceLimit_Remote = price, PriceLimit_VeryRemote = price,
            CatalogueVersion = "2026-27", EffectiveFrom = from ?? new DateOnly(2024, 7, 1), IsActive = true,
        }).Entity;

    private static Shift SeedShift(OdipDbContext db, Guid tenantId, Guid participantId, DateOnly date, TimeOnly start, TimeOnly end, bool endsNextDay = false,
        SleepoverType night = SleepoverType.None, string? group = null, SupportRatio ratio = SupportRatio.OneToOne)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, ServiceDate = date, StartTime = start, EndTime = end, EndsNextDay = endsNextDay,
            Ratio = ratio, NightType = night, Status = ShiftStatus.Completed, SupportGroupCode = group,
        };
        db.Shifts.Add(shift);
        return shift;
    }

    private static string Serialise(IEnumerable<ClaimLineItem> lines) =>
        string.Join("\n", lines.OrderBy(l => l.SupportsDeliveredFrom).ThenBy(l => l.SupportItemCode, StringComparer.Ordinal).Select(l => string.Create(CultureInfo.InvariantCulture,
            $"{l.SupportItemCode}|{l.DayType}|{l.Hours:0.##}|{l.UnitPrice:0.##}|{l.TotalAmount:0.##}|{l.SupportsDeliveredFrom:yyyy-MM-dd}|{l.SupportsDeliveredTo:yyyy-MM-dd}")));

    private static OdipDbContext NewDb(Guid tenantId, string state = "NSW")
    {
        var db = TestDb.Create();
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test", Address = "1 Test St", State = state });
        return db;
    }

    /// <summary>Community access rows for every band the live catalogue has (no weekday night row), each with its own price.</summary>
    private static void SeedCommunityAccess(OdipDbContext db)
    {
        const string g = "GRP_COMMUNITY_ACCESS";
        Item(db, g, ClaimDayType.Weekday, false, 40m, "CA_Weekday");
        Item(db, g, ClaimDayType.Saturday, false, 60m, "CA_Saturday");
        Item(db, g, ClaimDayType.Sunday, false, 80m, "CA_Sunday");
        Item(db, g, ClaimDayType.PublicHoliday, false, 100m, "CA_PublicHoliday");
        Item(db, g, ClaimDayType.WeekdayEvening, false, 50m, "CA_Evening");
    }

    private static void SeedCommunityNight(OdipDbContext db) => Item(db, "GRP_COMMUNITY_ACCESS", ClaimDayType.WeekdayNight, false, 45m, "CA_Night");

    /// <summary>The flat sleepover items: the personal care one and the short-term accommodation one, at different prices.</summary>
    private static void SeedSleepovers(OdipDbContext db)
    {
        Item(db, "GRP_SLEEPOVER", ClaimDayType.Weekday, false, 150m, "01_010_0107_1_1", unit: "E");
        Item(db, "GRP_SLEEPOVER", ClaimDayType.Weekday, false, 250m, "01_206_0115_1_1", unit: "E");
    }

    /// <summary>A support type X with its own weekday and evening rows and no night row, and personal care night rows (standard and intensive) to fall back to.</summary>
    private static void SeedGroupXWithPersonalCareNight(OdipDbContext db) => SeedGroupX(db, ownNight: false);

    private static void SeedGroupX(OdipDbContext db, bool ownNight)
    {
        Item(db, "GRP_X", ClaimDayType.Weekday, false, 70m, "X_Weekday");
        Item(db, "GRP_X", ClaimDayType.Weekday, true, 71m, "X_WeekdayInt");
        Item(db, "GRP_X", ClaimDayType.WeekdayEvening, false, 90m, "X_Evening");
        if (ownNight) Item(db, "GRP_X", ClaimDayType.WeekdayNight, false, 100m, "X_Night");
        Item(db, "GRP_PERSONAL_CARE", ClaimDayType.WeekdayNight, false, 120m, "PC_Night");
        Item(db, "GRP_PERSONAL_CARE", ClaimDayType.WeekdayNight, true, 150m, "PC_NightInt");
    }

    private static async Task<List<ClaimLineItem>> ClaimAsync(OdipDbContext db, Guid participantId, DateOnly from, DateOnly to)
    {
        await new ShiftClaimGenerationService(db).GenerateAsync(participantId, from, to);
        return await db.ClaimLineItems.ToListAsync();
    }

    private static async Task<string> LeftOutReasonAsync(OdipDbContext db, Guid participantId, DateOnly from, DateOnly to)
    {
        var ex = await Assert.ThrowsAsync<NothingClaimableException>(() => new ShiftClaimGenerationService(db).GenerateAsync(participantId, from, to));
        return Assert.Single(ex.LeftOut).Reason;
    }

    private static readonly DateOnly Wed = new(2026, 10, 7);
    private static readonly DateOnly Fri = new(2026, 10, 9);

    /// <summary>One shift, one claim run for its date, the lines it made.</summary>
    private static async Task<List<ClaimLineItem>> OneShiftAsync(Action<OdipDbContext> catalogue, DateOnly date, TimeOnly start, TimeOnly end, bool endsNextDay = false,
        SleepoverType night = SleepoverType.None, string? group = null, string state = "NSW", bool intensive = false, string? addressState = null, DateOnly? to = null)
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant, state);
        catalogue(db);
        var p = SeedParticipant(db, tenant, intensive, addressState);
        SeedShift(db, tenant, p.Id, date, start, end, endsNextDay, night, group);
        await db.SaveChangesAsync();
        return await ClaimAsync(db, p.Id, date, to ?? date);
    }

    private static TimeOnly T(int h, int m = 0) => new(h, m);

    /// <summary>G1: a shift wholly inside one band claims exactly as it did before the split (captured on fbde06abf, before any PR3 code).</summary>
    [Fact]
    public async Task WholeBandShift_IsByteIdentical()
    {
        var lines = await OneShiftAsync(SeedCommunityAccess, Wed, T(9), T(17));

        Assert.Equal("CA_Weekday|Weekday|8|40|320|2026-10-07|2026-10-07", Serialise(lines));
        Assert.Equal(0, Assert.Single(lines).ShiftPart);
    }

    [Fact]
    public async Task WeekdayIntoEvening_TwoLines()
    {
        var lines = await OneShiftAsync(SeedCommunityAccess, Wed, T(15), T(23));

        Assert.Equal("CA_Evening|WeekdayEvening|3|50|150|2026-10-07|2026-10-07\nCA_Weekday|Weekday|5|40|200|2026-10-07|2026-10-07", Serialise(lines));
        Assert.Equal(new[] { "CA_Weekday", "CA_Evening" }, lines.OrderBy(l => l.ShiftPart).Select(l => l.SupportItemCode));   // parts 0 and 1, in time order
        Assert.Equal(new[] { 0, 1 }, lines.Select(l => l.ShiftPart).OrderBy(x => x));
    }

    [Fact]
    public async Task WeekdayEveningOnly_ChangesItem()
    {
        var lines = await OneShiftAsync(SeedCommunityAccess, Wed, T(20), T(23));

        Assert.Equal("CA_Evening|WeekdayEvening|3|50|150|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task EveningIntoNightAcrossMidnight()
    {
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); SeedCommunityNight(db); }, Wed, T(22), T(2), endsNextDay: true);

        Assert.Equal("CA_Evening|WeekdayEvening|2|50|100|2026-10-07|2026-10-07\nCA_Night|WeekdayNight|2|45|90|2026-10-08|2026-10-08", Serialise(lines));
    }

    [Fact]
    public async Task ANightLineAfterMidnightOnTheLastDay_ExtendsTheClaimPeriodToItsDate()   // OPEN-3
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db); SeedCommunityNight(db);
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(22), T(2), endsNextDay: true);
        await db.SaveChangesAsync();

        await ClaimAsync(db, p.Id, Wed, Wed);

        var claim = await db.TripClaims.SingleAsync();
        Assert.Equal((Wed, Wed.AddDays(1)), (claim.PeriodFrom, claim.PeriodTo));
    }

    [Fact]
    public async Task FridayNightIntoSaturday_UsesSaturdaysRow()
    {
        // A new Saturday price takes effect on the 10th: the Saturday part is priced by the row valid on ITS date, not the shift's.
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); Item(db, "GRP_COMMUNITY_ACCESS", ClaimDayType.Saturday, false, 70m, "CA_Saturday_New", from: new DateOnly(2026, 10, 10)); },
            Fri, T(22), T(4), endsNextDay: true);

        Assert.Equal("CA_Evening|WeekdayEvening|2|50|100|2026-10-09|2026-10-09\nCA_Saturday_New|Saturday|4|70|280|2026-10-10|2026-10-10", Serialise(lines));
    }

    [Fact]
    public async Task SaturdayIntoSunday()
    {
        var lines = await OneShiftAsync(SeedCommunityAccess, new DateOnly(2026, 10, 10), T(20), T(2), endsNextDay: true);

        Assert.Equal("CA_Saturday|Saturday|4|60|240|2026-10-10|2026-10-10\nCA_Sunday|Sunday|2|80|160|2026-10-11|2026-10-11", Serialise(lines));
    }

    private static void NswPublicHoliday(OdipDbContext db, DateOnly date) =>
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = date, Name = "Test holiday", State = "NSW" });

    [Fact]
    public async Task PublicHolidayAfterMidnight_AtRangeEnd()
    {
        // Sunday 4 Oct 20:00 to Monday 5 Oct 02:00, the Monday a NSW holiday; the run range ends on the Sunday.
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); SeedCommunityNight(db); NswPublicHoliday(db, new DateOnly(2026, 10, 5)); },
            new DateOnly(2026, 10, 4), T(20), T(2), endsNextDay: true);

        Assert.Equal("CA_Sunday|Sunday|4|80|320|2026-10-04|2026-10-04\nCA_PublicHoliday|PublicHoliday|2|100|200|2026-10-05|2026-10-05", Serialise(lines));
    }

    [Fact]
    public async Task PublicHolidayAfterMidnight_ForAVicParticipant_IsAnOrdinaryNight()
    {
        // NSW's holiday does not apply to a participant in VIC, whose night hours are priced as a plain weekday night.
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); SeedCommunityNight(db); NswPublicHoliday(db, new DateOnly(2026, 10, 5)); },
            new DateOnly(2026, 10, 4), T(20), T(2), endsNextDay: true, addressState: "VIC");

        Assert.Equal("CA_Sunday|Sunday|4|80|320|2026-10-04|2026-10-04\nCA_Night|WeekdayNight|2|45|90|2026-10-05|2026-10-05", Serialise(lines));
    }

    [Fact]
    public async Task DstStartNight_CountsElapsedTime_InTheOrganisationsZone()
    {
        // Sydney's clocks went forward at 02:00 on Sunday 4 Oct 2026: 22:00 to 06:00 is 7 elapsed hours, 5 of them on the Sunday.
        var sydney = await OneShiftAsync(SeedCommunityAccess, new DateOnly(2026, 10, 3), T(22), T(6), endsNextDay: true);
        var brisbane = await OneShiftAsync(SeedCommunityAccess, new DateOnly(2026, 10, 3), T(22), T(6), endsNextDay: true, state: "QLD");

        Assert.Equal("CA_Saturday|Saturday|2|60|120|2026-10-03|2026-10-03\nCA_Sunday|Sunday|5|80|400|2026-10-04|2026-10-04", Serialise(sydney));
        Assert.Equal("CA_Saturday|Saturday|2|60|120|2026-10-03|2026-10-03\nCA_Sunday|Sunday|6|80|480|2026-10-04|2026-10-04", Serialise(brisbane));   // Brisbane has no daylight saving
    }

    [Fact]
    public async Task DstEndNight_CountsElapsedTime()
    {
        // Sydney's clocks went back at 03:00 on Sunday 4 Apr 2027: 22:00 to 06:00 is 9 elapsed hours, 7 of them on the Sunday.
        var lines = await OneShiftAsync(SeedCommunityAccess, new DateOnly(2027, 4, 3), T(22), T(6), endsNextDay: true);

        Assert.Equal("CA_Saturday|Saturday|2|60|120|2027-04-03|2027-04-03\nCA_Sunday|Sunday|7|80|560|2027-04-04|2027-04-04", Serialise(lines));
    }

    [Fact]
    public async Task Sleepover_OneFlatItem()
    {
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); SeedSleepovers(db); }, Wed, T(22), T(8), endsNextDay: true, night: SleepoverType.Sleepover);

        Assert.Equal("01_010_0107_1_1|Weekday|1|150|150|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task APassiveNight_IsClaimedExactlyLikeASleepover()
    {
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); SeedSleepovers(db); }, Wed, T(22), T(8), endsNextDay: true, night: SleepoverType.PassiveNight);

        Assert.Equal("01_010_0107_1_1|Weekday|1|150|150|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Theory]
    [InlineData(null, "01_010_0107_1_1", 150)]
    [InlineData("GRP_COMMUNITY_ACCESS", "01_010_0107_1_1", 150)]
    [InlineData("GRP_STA_STANDARD", "01_206_0115_1_1", 250)]
    public async Task TheSleepoverItemFollowsTheSupportType(string? group, string expectedItem, int price)
    {
        var lines = await OneShiftAsync(db => { SeedCommunityAccess(db); SeedSleepovers(db); }, Wed, T(22), T(8), endsNextDay: true, night: SleepoverType.Sleepover, group: group);

        Assert.Equal($"{expectedItem}|Weekday|1|{price}|{price}|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Theory]
    [InlineData(SleepoverType.Sleepover)]
    [InlineData(SleepoverType.PassiveNight)]
    public async Task ASleepoverUnder8Hours_IsLeftOutWithTheReason(SleepoverType night)
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db); SeedSleepovers(db);
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(22), T(5), endsNextDay: true, night: night);   // 7 hours
        await db.SaveChangesAsync();

        var reason = await LeftOutReasonAsync(db, p.Id, Wed, Wed);

        Assert.Equal($"It is {(night == SleepoverType.Sleepover ? "a sleepover" : "a passive night")} but is not 8 hours or more across midnight.", reason);
        Assert.Empty(db.ClaimLineItems);
    }

    [Fact]
    public async Task AGroupShift_StaysRefusedWithUnchangedText()
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db);
        var p = SeedParticipant(db, tenant);
        var shift = SeedShift(db, tenant, p.Id, Wed, T(9), T(17), ratio: SupportRatio.OneToThree);
        await db.SaveChangesAsync();

        var reason = await LeftOutReasonAsync(db, p.Id, Wed, Wed);

        Assert.Equal("It is a 1:3 group shift, which shift claims do not price yet.", reason);
        Assert.Equal(SupportRatio.OneToThree, shift.Ratio);
    }

    [Fact]
    public async Task SupportType_PricesEachBandFromItsGroup()
    {
        var lines = await OneShiftAsync(SeedGroupXWithPersonalCareNight, Wed, T(15), T(23), group: "GRP_X");

        Assert.Equal("X_Evening|WeekdayEvening|3|90|270|2026-10-07|2026-10-07\nX_Weekday|Weekday|5|70|350|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task ASupportTypeWithNoEveningRow_LeavesTheWholeShiftOutAndNamesTheBand()
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        Item(db, "GRP_Y", ClaimDayType.Weekday, false, 70m, "Y_Weekday");
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(15), T(23), group: "GRP_Y");
        await db.SaveChangesAsync();

        var reason = await LeftOutReasonAsync(db, p.Id, Wed, Wed);

        Assert.Equal("No catalogue rate covers its Weekday Evening hours on 7 Oct 2026.", reason);
        Assert.Empty(db.ClaimLineItems);   // no partial line
    }

    [Fact]
    public async Task NightHoursOfAGroupWithNoNightRow_TakeThePersonalCareNightRow()   // M1
    {
        var lines = await OneShiftAsync(SeedGroupXWithPersonalCareNight, Wed, T(22), T(2), endsNextDay: true, group: "GRP_X");

        Assert.Equal("X_Evening|WeekdayEvening|2|90|180|2026-10-07|2026-10-07\nPC_Night|WeekdayNight|2|120|240|2026-10-08|2026-10-08", Serialise(lines));
    }

    [Fact]
    public async Task EarlyMorningNightHours_TakeThePersonalCareRow_AndTheRestOfTheShiftItsOwn()
    {
        var lines = await OneShiftAsync(SeedGroupXWithPersonalCareNight, Wed, T(4), T(10), group: "GRP_X");

        Assert.Equal("PC_Night|WeekdayNight|2|120|240|2026-10-07|2026-10-07\nX_Weekday|Weekday|4|70|280|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task AnIntensiveParticipantsNightHours_TakeTheIntensivePersonalCareRow()
    {
        var lines = await OneShiftAsync(SeedGroupXWithPersonalCareNight, Wed, T(0), T(2), group: "GRP_X", intensive: true);

        Assert.Equal("PC_NightInt|WeekdayNight|2|150|300|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task NightHoursWithNeitherAGroupNorAPersonalCareNightRow_LeaveTheShiftOut_NeverTheDayRate()
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db);
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(22), T(2), endsNextDay: true);
        await db.SaveChangesAsync();

        var reason = await LeftOutReasonAsync(db, p.Id, Wed, Wed);

        Assert.Equal("No catalogue rate covers its Weekday Night hours on 8 Oct 2026.", reason);
    }

    [Fact]
    public async Task AGroupsOwnNightRow_IsUsedInPreferenceToPersonalCare_AndTheMorningStaysOneLine()   // S4
    {
        var lines = await OneShiftAsync(db => SeedGroupX(db, ownNight: true), Wed, T(5), T(13), group: "GRP_X");

        Assert.Equal("X_Night|WeekdayNight|1|100|100|2026-10-07|2026-10-07\nX_Weekday|Weekday|7|70|490|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task WithoutAGroupNightRow_TheMorningHourIsPersonalCares_AndTheRestOneWeekdayLine()   // S4
    {
        var lines = await OneShiftAsync(SeedGroupXWithPersonalCareNight, Wed, T(5), T(13), group: "GRP_X");

        Assert.Equal("PC_Night|WeekdayNight|1|120|120|2026-10-07|2026-10-07\nX_Weekday|Weekday|7|70|490|2026-10-07|2026-10-07", Serialise(lines));
    }

    [Fact]
    public async Task TwoOrganisations_EachUsesItsOwnZoneAndHolidays()   // N1
    {
        var sydneyOrg = Guid.NewGuid();
        var brisbaneOrg = Guid.NewGuid();
        using var db = NewDb(sydneyOrg, "NSW");
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = brisbaneOrg, RegistrationNumber = "PR002", ABN = "12345678902", OrganisationName = "Other", Address = "2 Test St", State = "QLD" });
        SeedCommunityAccess(db);
        var a = SeedParticipant(db, sydneyOrg);
        var b = SeedParticipant(db, brisbaneOrg);
        var day = new DateOnly(2026, 10, 3);
        SeedShift(db, sydneyOrg, a.Id, day, T(22), T(6), endsNextDay: true);
        SeedShift(db, brisbaneOrg, b.Id, day, T(22), T(6), endsNextDay: true);
        await db.SaveChangesAsync();

        // Sydney first, then Brisbane, then Sydney's own again: a pricer or zone kept from the first call would show.
        await new ShiftClaimGenerationService(db).GenerateAsync(a.Id, day, day);
        await new ShiftClaimGenerationService(db).GenerateAsync(b.Id, day, day);

        var all = await db.ClaimLineItems.Include(l => l.TripClaim).ToListAsync();
        Assert.Equal(a.Id, Assert.Single(all.Select(l => l.TripClaim.ParticipantId).Distinct().Where(id => id == a.Id)));
        Assert.Equal("CA_Saturday|Saturday|2|60|120|2026-10-03|2026-10-03\nCA_Sunday|Sunday|5|80|400|2026-10-04|2026-10-04", Serialise(all.Where(l => l.TripClaim.ParticipantId == a.Id)));
        Assert.Equal("CA_Saturday|Saturday|2|60|120|2026-10-03|2026-10-03\nCA_Sunday|Sunday|6|80|480|2026-10-04|2026-10-04", Serialise(all.Where(l => l.TripClaim.ParticipantId == b.Id)));
    }

    [Fact]
    public async Task ASplitShift_CountsAsOneShift_InTheClaimRun()
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db);
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(15), T(23));
        await db.SaveChangesAsync();

        var made = await new ShiftClaimGenerationService(db).GenerateAsync(p.Id, Wed, Wed);

        Assert.Equal((2, 1, 8m), (made.LineCount, made.ShiftCount, made.Hours));
    }

    [Fact]
    public async Task AnActiveNightShift_IsTwoLines_EveningThenAPersonalCareNightDatedTheNextDay()   // S-3
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db); SeedGroupXWithPersonalCareNight(db);
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(22), T(6), endsNextDay: true, night: SleepoverType.ActiveNight);
        await db.SaveChangesAsync();

        var made = await new ShiftClaimGenerationService(db).GenerateAsync(p.Id, Wed, Wed);
        var lines = await db.ClaimLineItems.ToListAsync();

        Assert.Equal("CA_Evening|WeekdayEvening|2|50|100|2026-10-07|2026-10-07\nPC_Night|WeekdayNight|6|120|720|2026-10-08|2026-10-08", Serialise(lines));
        Assert.Empty(made.Flagged);
    }

    [Fact]
    public async Task ADaytimeStretchWithNoRow_IsNamedWeekday_NotWeekdayDaytime()   // N1
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        Item(db, "GRP_Y", ClaimDayType.WeekdayEvening, false, 70m, "Y_Evening");
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(15), T(23), group: "GRP_Y");
        await db.SaveChangesAsync();

        Assert.Equal("No catalogue rate covers its Weekday hours on 7 Oct 2026.", await LeftOutReasonAsync(db, p.Id, Wed, Wed));
    }

    [Fact]
    public async Task ASleepoverLine_AddsNoHoursToTheRun()
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db); SeedSleepovers(db);
        var p = SeedParticipant(db, tenant);
        SeedShift(db, tenant, p.Id, Wed, T(22), T(8), endsNextDay: true, night: SleepoverType.Sleepover);
        await db.SaveChangesAsync();

        var made = await new ShiftClaimGenerationService(db).GenerateAsync(p.Id, Wed, Wed);

        Assert.Equal((1, 1, 0m), (made.LineCount, made.ShiftCount, made.Hours));   // the one line is a night, not an hour
    }
}
