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

/// <summary>Shift claims by support type (shift billing PR2). The null path must stay what it was before the support type existed.</summary>
public class ShiftClaimSupportTypeTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static Participant SeedParticipant(OdipDbContext db, string first, bool intensive = false)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = first, LastName = "Doe", NdisNumber = "43100001234",
            IsIntensiveSupport = intensive, PlanType = PlanType.AgencyManaged,
        };
        db.Participants.Add(p);
        return p;
    }

    private static SupportActivityGroup Group(OdipDbContext db, string code) =>
        db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == code)
        ?? db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = code, DisplayName = code, SupportCategory = 4 }).Entity;

    private static SupportCatalogueItem Item(OdipDbContext db, string groupCode, ClaimDayType dayType, bool intensive, decimal price, string? number = null) =>
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = Group(db, groupCode).Id,
            ItemNumber = number ?? $"{groupCode}_{dayType}_{(intensive ? "INT" : "STD")}", Description = $"Test {dayType}",
            DayType = dayType, IsIntensive = intensive,
            PriceLimit_VIC = price, PriceLimit_NSW = price, PriceLimit_ACT = price, PriceLimit_NT = price, PriceLimit_QLD = price,
            PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_WA = price, PriceLimit_Remote = price, PriceLimit_VeryRemote = price,
            CatalogueVersion = "2024-25", EffectiveFrom = new DateOnly(2024, 7, 1), IsActive = true,
        }).Entity;

    private static Shift SeedShift(OdipDbContext db, Guid participantId, DateOnly date, decimal hours = 8)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participantId, ServiceDate = date,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(9, 0).AddHours((double)hours),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(shift);
        return shift;
    }

    private static string Serialise(IEnumerable<ClaimLineItem> lines) =>
        string.Join("\n", lines.OrderBy(l => l.SupportsDeliveredFrom).ThenBy(l => l.SupportItemCode).Select(l => string.Create(CultureInfo.InvariantCulture,
            $"{l.SupportItemCode}|{l.DayType}|{l.Hours}|{l.UnitPrice}|{l.TotalAmount}|{l.GSTCode}|{l.ClaimType}|{l.Status}|{l.SupportsDeliveredFrom:yyyy-MM-dd}|{l.SupportsDeliveredTo:yyyy-MM-dd}")));

    /// <summary>Captured on 64887cc5e, before any support type code existed, so a green run proves the null path claims byte for byte as it did.</summary>
    private const string NullPathGolden = "04_Weekday_INT|Weekday|6.5|50|325.0|P2|Standard|Draft|2026-09-07|2026-09-07
04_Weekday_STD|Weekday|8|40|320|P2|Standard|Draft|2026-09-07|2026-09-07
04_PublicHoliday_INT|PublicHoliday|6.5|100.25|651.63|P2|Standard|Draft|2026-09-09|2026-09-09
04_PublicHoliday_STD|PublicHoliday|8|90.25|722.00|P2|Standard|Draft|2026-09-09|2026-09-09
04_Saturday_INT|Saturday|6.5|65.5|425.75|P2|Standard|Draft|2026-09-12|2026-09-12
04_Saturday_STD|Saturday|8|55.5|444.0|P2|Standard|Draft|2026-09-12|2026-09-12";

    [Fact]
    public async Task NullSupportType_ClaimLinesMatchTodayExactly()
    {
        using var db = TestDb.Create();
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test", Address = "1 Test St", State = "VIC" });
        var std = SeedParticipant(db, "Std");
        var intensive = SeedParticipant(db, "Int", intensive: true);
        foreach (var (dayType, price) in new[] { (ClaimDayType.Weekday, 40m), (ClaimDayType.Saturday, 55.5m), (ClaimDayType.PublicHoliday, 90.25m) })
        {
            Item(db, "GRP_COMMUNITY_ACCESS", dayType, false, price, $"04_{dayType}_STD");
            Item(db, "GRP_COMMUNITY_ACCESS", dayType, true, price + 10m, $"04_{dayType}_INT");
        }
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 9, 9), Name = "Test Holiday", State = "VIC" });
        var days = new[] { new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 9), new DateOnly(2026, 9, 12) }; // Monday, public holiday, Saturday
        foreach (var d in days) { SeedShift(db, std.Id, d); SeedShift(db, intensive.Id, d, hours: 6.5m); }
        await db.SaveChangesAsync();

        var service = new ShiftClaimGenerationService(db);
        var from = new DateOnly(2026, 9, 7); var to = new DateOnly(2026, 9, 12);
        await service.GenerateAsync(std.Id, from, to);
        await service.GenerateAsync(intensive.Id, from, to);

        var lines = await db.ClaimLineItems.ToListAsync();
        Assert.Equal(6, lines.Count);
        Assert.Equal(NullPathGolden, Serialise(lines));
    }
}
