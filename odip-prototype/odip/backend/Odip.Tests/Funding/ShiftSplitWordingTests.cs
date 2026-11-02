using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// Shift billing PR4, the parts a split shift carries and the words they are shown in: the estimate's parts, "1 night" for a sleepover, the weekday night day type, and the unit on the claim detail (read
/// only for the organisation's own claim). Fixtures as <see cref="ShiftSplitBudgetTests"/>, plus the flat sleepover item at $150 a night (personal care, category 1). Clock: 4 Oct 2026.
/// </summary>
public class ShiftSplitWordingTests : IDisposable
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Wed = new(2026, 10, 7), Thu = new(2026, 10, 8);
    private const string SleepoverCode = "01_010_0107_1_1";

    private readonly LedgerKit _kit = Arrange(LedgerKit.Create());

    public void Dispose() => _kit.Dispose();

    private static LedgerKit Arrange(LedgerKit kit)
    {
        kit.SeedProvider("VIC");
        kit.EnsureCommunityAccessCatalogue();
        if (kit.Db.SupportCatalogueItems.Any(i => i.ItemNumber == SleepoverCode)) return kit;
        Row(kit, "GRP_PERSONAL_CARE", "PC_Night", ClaimDayType.WeekdayNight, 60m, "H");
        Row(kit, "GRP_SLEEPOVER", SleepoverCode, ClaimDayType.Weekday, 150m, "E");
        return kit;
    }

    private static void Row(LedgerKit kit, string group, string number, ClaimDayType dayType, decimal price, string unit)
    {
        kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = kit.SeedGroup(group, group, 1).Id, ItemNumber = number, Description = number, DayType = dayType, IsIntensive = false, Unit = unit,
            PriceLimit_VIC = price, PriceLimit_NSW = price, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true, PaceSupportCategoryNumber = 1, SupportCategoryNumber = 1,
        });
        kit.Db.SaveChanges();
    }

    private static ClaimsController ControllerOf(LedgerKit kit) =>
        new(kit.Db, new ClaimGenerationService(kit.Db), new ShiftClaimGenerationService(kit.Db), new BprCsvService(kit.Db), new InvoiceService(kit.Db), kit.Ledger, kit.Tenant!);

    private static Participant WithSleepoverAndDayShift(LedgerKit kit)
    {
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(2, 100000m)));
        var night = kit.SeedShift(person, Wed, ShiftStatus.Completed, 22, 8, endsNextDay: true);
        night.NightType = SleepoverType.Sleepover;
        kit.SeedShift(person, Thu, ShiftStatus.Completed, 9, 17);
        kit.Db.SaveChanges();
        return person;
    }

    [Fact]
    public void AWeekdayNightIsDescribedAsOne()
    {
        Assert.Equal("weekday night", BudgetLedgerService.DescribeDayType(ClaimDayType.WeekdayNight));
    }

    [Theory]
    [InlineData(1, true, "1 night")]
    [InlineData(2, true, "2 nights")]
    [InlineData(7.5, false, "7.5 h")]
    [InlineData(8, false, "8 h")]
    public void AQuantityReadsInNightsForASleepoverAndHoursOtherwise(double hours, bool sleepover, string expected)
    {
        Assert.Equal(expected, ClaimPricing.Quantity((decimal)hours, sleepover));
    }

    [Fact]
    public async Task TheEstimateOfAnEveningIntoANight_HasOnePartForEachDateAndCategory_WithItsHours()
    {
        var person = _kit.SeedParticipant();
        var spec = new ShiftSpec(Wed, new TimeOnly(18, 0), new TimeOnly(2, 0), true, SupportRatio.OneToOne, SleepoverType.None);

        var estimate = Assert.IsType<ShiftCostEstimate.Priced>(Assert.Single(await new LedgerShiftCostSource(_kit.Db, _kit.Ledger).EstimateAsync(_kit.TenantId, person.Id, new[] { spec }, Ct)));

        Assert.Equal(new[] { new ShiftCostPart(Wed, 4, 320m, 6m), new ShiftCostPart(Thu, 1, 120m, 2m) }, estimate.Parts);
        Assert.Equal(440m, estimate.Amount);
    }

    [Fact]
    public async Task ASleepoverClaimLine_IsAnEachItem_AndTheLedgerSaysOneNightWhereAnHourlyLineSaysHours()
    {
        var person = WithSleepoverAndDayShift(_kit);
        var claim = (await new ShiftClaimGenerationService(_kit.Db).GenerateAsync(person.Id, Wed, Thu, Ct)).Claim;

        var result = await ControllerOf(_kit).GetClaim(claim.Id, Ct);
        var lines = Assert.IsType<ApiResponse<TripClaimDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.LineItems;
        var rows = (await _kit.Ledger.ComputeAsync(_kit.TenantId, new[] { person.Id }, Ct))[person.Id].Items.Where(i => i.Kind == LedgerRowKind.ClaimLine).ToList();

        Assert.Equal("E", Assert.Single(lines, l => l.SupportItemCode == SleepoverCode).Unit);
        Assert.Equal("H", Assert.Single(lines, l => l.SupportItemCode != SleepoverCode).Unit);
        Assert.EndsWith($"{SleepoverCode} · 1 night", Assert.Single(rows, r => r.Description.Contains(SleepoverCode)).Description);
        Assert.EndsWith("· 8 h", Assert.Single(rows, r => !r.Description.Contains(SleepoverCode)).Description);
    }

    [Fact]
    public async Task ASplitShiftsLedgerRows_SayWhatEachPartHolds_AndASleepoverSaysOneNight()
    {
        var person = _kit.SeedParticipant();
        _kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(2, 100000m)));
        var split = _kit.SeedShift(person, Wed, ShiftStatus.Published, 18, 2, endsNextDay: true);
        var night = _kit.SeedShift(person, Thu, ShiftStatus.Published, 22, 8, endsNextDay: true);
        night.NightType = SleepoverType.Sleepover;
        _kit.Db.SaveChanges();

        var items = (await _kit.Ledger.ComputeAsync(_kit.TenantId, new[] { person.Id }, Ct))[person.Id].Items;

        Assert.Equal(new[] { "Shift 18:00–02:00 · 6 h", "Shift 18:00–02:00 · 2 h" }, items.Where(i => i.ShiftId == split.Id).Select(i => i.Description));
        Assert.Equal("Shift 22:00–08:00 · 1 night", Assert.Single(items, i => i.ShiftId == night.Id).Description);
    }

    [Fact]
    public async Task AnotherOrganisationsClaim_IsNotFound_AndThisOrganisationsOwnCarriesItsUnits()
    {
        var database = Guid.NewGuid().ToString();
        var mine = Arrange(LedgerKit.Create(database: database));
        var theirs = LedgerKit.Create(LedgerKit.TenantB, database);
        var person = WithSleepoverAndDayShift(mine);
        var claim = (await new ShiftClaimGenerationService(mine.Db).GenerateAsync(person.Id, Wed, Thu, Ct)).Claim;

        var theirView = await ControllerOf(theirs).GetClaim(claim.Id, Ct);
        var myView = await ControllerOf(mine).GetClaim(claim.Id, Ct);

        Assert.IsType<NotFoundObjectResult>(theirView.Result);
        var lines = Assert.IsType<ApiResponse<TripClaimDetailDto>>(Assert.IsType<OkObjectResult>(myView.Result).Value).Data!.LineItems;
        Assert.Contains(lines, l => l.Unit == "E");
    }
}
