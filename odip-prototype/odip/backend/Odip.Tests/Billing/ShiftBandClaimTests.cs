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
    private static Participant SeedParticipant(OdipDbContext db, Guid tenantId, bool intensive = false)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Doe", NdisNumber = "43100001234",
            IsIntensiveSupport = intensive, PlanType = PlanType.AgencyManaged,
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
        SleepoverType night = SleepoverType.None, string? group = null)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, ServiceDate = date, StartTime = start, EndTime = end, EndsNextDay = endsNextDay,
            Ratio = SupportRatio.OneToOne, NightType = night, Status = ShiftStatus.Completed, SupportGroupCode = group,
        };
        db.Shifts.Add(shift);
        return shift;
    }

    private static string Serialise(IEnumerable<ClaimLineItem> lines) =>
        string.Join("\n", lines.OrderBy(l => l.SupportsDeliveredFrom).ThenBy(l => l.SupportItemCode).Select(l => string.Create(CultureInfo.InvariantCulture,
            $"{l.SupportItemCode}|{l.DayType}|{l.Hours}|{l.UnitPrice}|{l.TotalAmount}|{l.SupportsDeliveredFrom:yyyy-MM-dd}|{l.SupportsDeliveredTo:yyyy-MM-dd}")));

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

    private static async Task<List<ClaimLineItem>> ClaimAsync(OdipDbContext db, Guid participantId, DateOnly from, DateOnly to)
    {
        await new ShiftClaimGenerationService(db).GenerateAsync(participantId, from, to);
        return await db.ClaimLineItems.ToListAsync();
    }

    /// <summary>G1: a shift wholly inside one band claims exactly as it did before the split (captured on fbde06abf, before any PR3 code).</summary>
    [Fact]
    public async Task WholeBandShift_IsByteIdentical()
    {
        var tenant = Guid.NewGuid();
        using var db = NewDb(tenant);
        SeedCommunityAccess(db);
        var p = SeedParticipant(db, tenant);
        var day = new DateOnly(2026, 10, 7); // Wednesday
        SeedShift(db, tenant, p.Id, day, new TimeOnly(9, 0), new TimeOnly(17, 0));
        await db.SaveChangesAsync();

        var lines = await ClaimAsync(db, p.Id, day, day);

        Assert.Equal("CA_Weekday|Weekday|8|40|320|2026-10-07|2026-10-07", Serialise(lines));
    }
}
