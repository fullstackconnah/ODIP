using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// The manual (one-off) claim: the money guards, the tenant check and the shape of what it saves. The kit's "today" is 4 Oct 2026 and its catalogue rows are valid from 1 Jul 2026.
/// </summary>
public class ManualClaimServiceTests
{
    private static readonly DateOnly Day = new(2026, 10, 1);

    private static ManualClaimService Service(LedgerKit kit) => new(kit.Db, kit.Ledger, kit.Clock);

    /// <summary>An hourly item of PACE category 15 with a national price, so a cap applies: VIC $100 an hour, NSW $120.</summary>
    private static SupportCatalogueItem Capped(LedgerKit kit, string code = "15_100", decimal vic = 100m, decimal nsw = 120m)
    {
        var item = kit.SeedItem(code, 15, price: vic);
        item.PriceNational = vic;
        item.PriceLimit_NSW = nsw;
        kit.Db.SaveChanges();
        return item;
    }

    private static ManualClaimRequestDto Req(Participant p, string code, decimal qty, decimal price, DateOnly? date = null, string? notes = null) => new()
    {
        ParticipantId = p.Id,
        Lines = [new ManualClaimLineRequestDto { SupportItemCode = code, ServiceDate = date ?? Day, Quantity = qty, UnitPrice = price }],
        Notes = notes,
    };

    private static async Task<string> Refusal(Func<Task> act) => (await Assert.ThrowsAsync<InvalidOperationException>(act)).Message;

    [Fact]
    public async Task TheCap_IsTheParticipantsStateLimit_NotTheOrganisations()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var nsw = kit.SeedParticipant(addressState: "NSW");
        var noAddress = kit.SeedParticipant();
        var service = Service(kit);

        // $110 is over the organisation's VIC limit of $100 but under the participant's NSW limit of $120.
        Assert.Equal(110m, Assert.Single((await service.PreviewAsync(kit.TenantId, Req(nsw, item.ItemNumber, 1m, 110m))).Lines).UnitPrice);
        Assert.Equal("The price $130.00 is over the NSW limit of $120.00.", await Refusal(() => service.PreviewAsync(kit.TenantId, Req(nsw, item.ItemNumber, 1m, 130m))));
        // A participant with no address falls back to the organisation's state, as the send gate does.
        Assert.Equal("The price $110.00 is over the VIC limit of $100.00.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(noAddress, item.ItemNumber, 1m, 110m))));
        Assert.Empty(kit.Db.TripClaims);
    }

    [Fact]
    public async Task TheCap_IsTheSameRuleAsTheSendGates()
    {
        using var kit = LedgerKit.Create();
        var item = Capped(kit);

        Assert.True(ClaimBatchChecks.OverPriceLimit(item, "VIC", 100.01m, out var limit));
        Assert.Equal(100m, limit);
        Assert.False(ClaimBatchChecks.OverPriceLimit(item, "VIC", 100m, out _));
        item.PriceNational = null;
        Assert.False(ClaimBatchChecks.OverPriceLimit(item, "VIC", 5000m, out _));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task AnItemWithNoPriceLimit_IsAllowed_WithAWarning()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var quote = kit.SeedItem("15_QUOTE", 15, price: 0m);
        var person = kit.SeedParticipant();
        kit.SeedPlan(person);

        var preview = await Service(kit).PreviewAsync(kit.TenantId, Req(person, quote.ItemNumber, 1m, 4000m));

        Assert.Null(Assert.Single(preview.Lines).Limit);
        Assert.Contains("15_QUOTE has no price guide limit, so the price isn't checked.", preview.Warnings);
    }

    [Fact]
    public async Task ADateOutsideEveryPlan_IsRefused_AndWithNoPlanItIsAllowedWithANote()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var planned = kit.SeedParticipant(first: "Sophie");
        kit.SeedPlan(planned, new DateOnly(2026, 10, 2), new DateOnly(2027, 6, 30));
        var unplanned = kit.SeedParticipant(first: "Alex");
        var service = Service(kit);

        Assert.Equal("1 Oct 2026 is outside Sophie Brown's plan dates.", await Refusal(() => service.PreviewAsync(kit.TenantId, Req(planned, item.ItemNumber, 1m, 50m))));
        Assert.Equal("1 Oct 2026 is outside Sophie Brown's plan dates.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(planned, item.ItemNumber, 1m, 50m))));

        var covered = await service.PreviewAsync(kit.TenantId, Req(planned, item.ItemNumber, 1m, 50m, new DateOnly(2026, 10, 2)));
        Assert.Equal(new DateOnly(2027, 6, 30), covered.Plan!.End);
        Assert.DoesNotContain(covered.Warnings, w => w.StartsWith("No plan on file"));

        var none = await service.PreviewAsync(kit.TenantId, Req(unplanned, item.ItemNumber, 1m, 50m));
        Assert.Null(none.Plan);
        Assert.Contains("No plan on file, so the budget isn't checked.", none.Warnings);
    }

    [Fact]
    public async Task AFutureDate_IsRefused_TodayPasses_AndAnItemNotInThePriceGuideThatDayIsRefused()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var person = kit.SeedParticipant();
        var service = Service(kit);
        var today = LedgerKit.Today;

        Assert.Equal("You can't claim for a day that hasn't happened yet.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m, today.AddDays(1)))));
        Assert.Equal(today, Assert.Single((await service.PreviewAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m, today))).Lines).Date);
        // The row is valid from 1 Jul 2026.
        Assert.Equal("Support item 15_100 isn't in the price guide on 30 Jun 2026.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m, new DateOnly(2026, 6, 30)))));
        Assert.Equal("Support item NOPE isn't in the price guide on 1 Oct 2026.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(person, "NOPE", 1m, 50m))));
        Assert.Empty(kit.Db.TripClaims);
    }

    [Fact]
    public async Task TheTotal_IsWorkedOutOnTheServer_AndTheRequestHasNoTotalField()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit, vic: 200m, nsw: 200m);
        var person = kit.SeedParticipant();

        var made = await Service(kit).MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 2.5m, 101.13m));

        var expected = ClaimPricing.LineAmount(2.5m, 101.13m);
        Assert.Equal(252.83m, expected);
        var line = Assert.Single(kit.Db.ClaimLineItems);
        Assert.Equal(expected, line.TotalAmount);
        Assert.Equal(expected, made.Claim.TotalAmount);
        Assert.Equal(expected, kit.Db.TripClaims.Single().TotalAmount);
        Assert.Equal(ClaimPricing.LineHours(2.5m), line.Hours);
        Assert.DoesNotContain(typeof(ManualClaimRequestDto).GetProperties().Concat(typeof(ManualClaimLineRequestDto).GetProperties()), p => p.Name.Contains("Total", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("0", "10", "Quantity and unit price must be more than 0.")]
    [InlineData("-1", "10", "Quantity and unit price must be more than 0.")]
    [InlineData("1", "0", "Quantity and unit price must be more than 0.")]
    [InlineData("1", "10.005", "Quantity and unit price can have at most 2 decimal places.")]
    [InlineData("1.005", "10", "Quantity and unit price can have at most 2 decimal places.")]
    [InlineData("1001", "1", "Quantity can be at most 1000.")]
    [InlineData("25", "10", "A line is one day, so at most 24 hours.")]
    [InlineData("1", "100001", "The unit price can be at most $100,000.")]
    [InlineData("24", "5000", "The total can be at most $100,000.")]
    public async Task TheBounds_AreRefusedWithTheirMessage(string quantity, string price, string message)
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit, vic: 200_000m, nsw: 200_000m);
        var person = kit.SeedParticipant();

        var said = await Refusal(() => Service(kit).MakeAsync(kit.TenantId, Req(person, item.ItemNumber, decimal.Parse(quantity, System.Globalization.CultureInfo.InvariantCulture), decimal.Parse(price, System.Globalization.CultureInfo.InvariantCulture))));

        Assert.Equal(message, said);
        Assert.Empty(kit.Db.TripClaims);
        Assert.Empty(kit.Db.ClaimLineItems);
    }

    [Fact]
    public async Task AParticipantOfAnotherOrganisation_IsNotFound_AndNothingIsWritten()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var other = kit.SeedParticipant(tenantId: LedgerKit.TenantB);
        var own = kit.SeedParticipant();
        var service = Service(kit);

        Assert.Equal(ManualClaimService.ParticipantNotFound, (await Assert.ThrowsAsync<KeyNotFoundException>(() => service.MakeAsync(kit.TenantId, Req(other, item.ItemNumber, 1m, 50m)))).Message);
        Assert.Equal(ManualClaimService.ParticipantNotFound, (await Assert.ThrowsAsync<KeyNotFoundException>(() => service.PreviewAsync(kit.TenantId, Req(other, item.ItemNumber, 1m, 50m)))).Message);
        Assert.Empty(kit.Db.TripClaims);

        // The claim is saved under the organisation the caller names.
        var made = await service.MakeAsync(kit.TenantId, Req(own, item.ItemNumber, 1m, 50m));
        Assert.Equal(own.TenantId, made.Claim.TenantId);
        Assert.Equal(own.TenantId, kit.Db.ClaimLineItems.Single().TenantId);
    }

    [Fact]
    public async Task AParticipantFundedAnotherWay_IsRefusedAtCreate_AsTheShiftEngineDoes()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var person = kit.SeedParticipant();
        person.FundingSource = ParticipantFundingSource.Other;
        kit.Db.SaveChanges();
        var service = Service(kit);

        Assert.Equal($"{person.FullName}: Funded another way, so not claimed to the NDIS. Invoice them directly.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m))));
        Assert.Empty(kit.Db.TripClaims);
    }

    [Fact]
    public async Task ADoubleClaim_WarnsInThePreview_AndNeverBlocksTheMake_ARejectedClaimDoesNotWarn()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var person = kit.SeedParticipant();
        var service = Service(kit);

        var first = await service.MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m));
        var second = await service.PreviewAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m));
        Assert.Contains($"{first.Claim.ClaimReference} already claims 15_100 for Sophie Brown on 1 Oct 2026.", second.Warnings);

        await service.MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m));
        Assert.Equal(2, kit.Db.TripClaims.Count());

        // A different item, a different day or a different participant is not a double claim.
        var elsewhere = Capped(kit, "15_200");
        Assert.DoesNotContain(second.Warnings, w => w.Contains("15_200"));
        Assert.DoesNotContain((await service.PreviewAsync(kit.TenantId, Req(person, elsewhere.ItemNumber, 1m, 50m))).Warnings, w => w.Contains("already claims"));
        Assert.DoesNotContain((await service.PreviewAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m, Day.AddDays(1)))).Warnings, w => w.Contains("already claims"));
        Assert.DoesNotContain((await service.PreviewAsync(kit.TenantId, Req(kit.SeedParticipant(), item.ItemNumber, 1m, 50m))).Warnings, w => w.Contains("already claims"));

        foreach (var claim in kit.Db.TripClaims) claim.Status = TripClaimStatus.Rejected;
        kit.Db.SaveChanges();
        Assert.DoesNotContain((await service.PreviewAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m))).Warnings, w => w.Contains("already claims"));
    }

    [Fact]
    public async Task AShiftLineOfTheSameParticipantItemAndDate_IsADoubleClaimToo()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var shift = kit.SeedShift(person, Day, ShiftStatus.Completed);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 400m, shift, reference: "TC-SHIFT-1");
        var code = kit.Item(ClaimDayType.Weekday).ItemNumber;
        kit.Db.SupportCatalogueItems.Single(i => i.ItemNumber == code).PriceNational = 50m;
        kit.Db.SaveChanges();

        var preview = await Service(kit).PreviewAsync(kit.TenantId, Req(person, code, 1m, 50m));

        Assert.Contains($"{claim.ClaimReference} already claims {code} for Sophie Brown on 1 Oct 2026.", preview.Warnings);
    }

    [Fact]
    public async Task TheMadeClaim_IsAManualDraft_WithALineThatHasNoParent_AndGstP2()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var person = kit.SeedParticipant();

        var made = await Service(kit).MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 2m, 60m, notes: "  Taxi home after the outing  "));

        var claim = kit.Db.TripClaims.Single();
        Assert.Equal(made.Claim.Id, claim.Id);
        Assert.Equal(ClaimKind.Manual, claim.Kind);
        Assert.Equal(TripClaimStatus.Draft, claim.Status);
        Assert.Equal(person.Id, claim.ParticipantId);
        Assert.Null(claim.TripInstanceId);
        Assert.Equal(Day, claim.PeriodFrom);
        Assert.Equal(Day, claim.PeriodTo);
        Assert.Equal("Taxi home after the outing", claim.Notes);
        Assert.Equal(120m, claim.TotalAmount);
        Assert.StartsWith("TC-", claim.ClaimReference);

        var line = Assert.Single(kit.Db.ClaimLineItems);
        Assert.Null(line.ShiftId);
        Assert.Null(line.ParticipantBookingId);
        Assert.Equal(0, line.ShiftPart);
        Assert.Equal(GSTCode.P2, line.GSTCode);
        Assert.Equal(ClaimType.Standard, line.ClaimType);
        Assert.Equal(ClaimLineItemStatus.Draft, line.Status);
        Assert.Equal(("15_100", Day, Day, 2m, 60m), (line.SupportItemCode, line.SupportsDeliveredFrom, line.SupportsDeliveredTo, line.Hours, line.UnitPrice));
    }

    [Fact]
    public async Task ANoteOver500Characters_AndAClaimWithoutExactlyOneLine_AreRefused()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var person = kit.SeedParticipant();
        var service = Service(kit);

        Assert.Equal("The note can be at most 500 characters.", await Refusal(() => service.MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m, notes: new string('x', 501)))));
        Assert.Equal("A one-off claim has exactly one line.", await Refusal(() => service.MakeAsync(kit.TenantId, new ManualClaimRequestDto { ParticipantId = person.Id })));
        var two = Req(person, item.ItemNumber, 1m, 50m);
        Assert.Equal("A one-off claim has exactly one line.", await Refusal(() => service.MakeAsync(kit.TenantId, two with { Lines = [two.Lines[0], two.Lines[0]] })));
        Assert.Empty(kit.Db.TripClaims);
    }

    [Fact]
    public async Task APublicHoliday_IsTheLinesDayType()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = Capped(kit);
        var person = kit.SeedParticipant(addressState: "NSW");
        kit.SeedHoliday(Day, "NSW");

        var made = await Service(kit).MakeAsync(kit.TenantId, Req(person, item.ItemNumber, 1m, 50m));

        Assert.Equal(ClaimDayType.PublicHoliday, kit.Db.ClaimLineItems.Single().DayType);
        Assert.Equal(made.Claim.Id, kit.Db.TripClaims.Single().Id);
    }
}
