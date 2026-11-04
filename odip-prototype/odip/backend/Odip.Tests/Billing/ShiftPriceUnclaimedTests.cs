using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// W9 PR B: a shift claim covers the rostered window minus the breaks the worker took on their own. The pure rule (<see cref="ShiftBreakRules.UnclaimedSpans"/>), the price
/// (<see cref="ShiftPriceEstimator.Price"/>) and the claim that reads the breaks of the ACTIVE completion (run, claim again). Weekday $60 an hour, evening $66, NSW, with the test catalogue.
/// </summary>
public class ShiftPriceUnclaimedTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Wednesday = new(2026, 10, 7);
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");

    private static TimeOnly T(int h, int m = 0) => new(h, m);

    private static ShiftPriceOutcome PriceOf(int startHour, int endHour, params (int From, int To)[] spans) =>
        ShiftPriceEstimator.Price(Rows(), null, Wednesday, T(startHour), T(endHour), false, SupportRatio.OneToOne, SleepoverType.None, false, "NSW", new HashSet<DateOnly>(), TimeZoneInfo.Utc, spans);

    private static ShiftRateRows Rows(params SupportCatalogueItem[] sleepover)
    {
        using var kit = LedgerKit.Create();
        kit.SeedCommunityAccessCatalogue();
        return new ShiftRateRows(kit.Db.SupportCatalogueItems.ToList(), Array.Empty<SupportCatalogueItem>(), sleepover);
    }

    // ── Price ───────────────────────────────────────────────────────────────

    [Fact]
    public void D_AnAloneBreakInsideAShiftComesOffItsHours()
    {
        var line = PriceOf(9, 13, (120, 150)).Lines.Single();   // 11:00-11:30 of 09:00-13:00

        Assert.Equal(3.5m, line.Hours);
        Assert.Equal(ClaimPricing.LineAmount(3.5m, line.UnitPrice), line.TotalAmount);
    }

    [Fact]
    public void D_NoSpansLeaveTheShiftAsItWas()
    {
        Assert.Equal(4m, PriceOf(9, 13).Lines.Single().Hours);
        Assert.Equal(4m, PriceOf(9, 13, Array.Empty<(int, int)>()).Lines.Single().Hours);
    }

    [Fact]
    public void D_ABreakAcrossTwoBandsComesOffBoth()
    {
        var lines = PriceOf(18, 22, (90, 150)).Lines;   // 19:30-20:30; the evening band starts at 20:00

        Assert.Equal(new[] { (ClaimDayType.Weekday, 1.5m), (ClaimDayType.WeekdayEvening, 1.5m) }, lines.Select(l => (l.DayType, l.Hours)));
    }

    [Fact]
    public void D_MinutesComeOffBeforeTheLineIsRounded()
    {
        var line = PriceOf(9, 12, (60, 80)).Lines.Single();   // 180 - 20 = 160 min

        Assert.Equal(2.67m, line.Hours);   // 160 / 60 rounded once
        Assert.Equal(ClaimPricing.LineAmount(2.67m, line.UnitPrice), line.TotalAmount);
        Assert.Equal(1.17m, PriceOf(9, 11, (60, 110)).Lines.Single().Hours);   // 120 - 50 = 70 min = 1.1667 h
    }

    [Fact]
    public void ASpanCoveringEveryHourlyPartGivesNoPrice_AllBreaks()
    {
        var outcome = PriceOf(9, 13, (0, 240));

        Assert.False(outcome.IsPriced);
        Assert.Equal(ShiftPriceEstimator.AllBreaksBecause, outcome.NotPricedBecause);
        Assert.Equal(new[] { ShiftPriceEstimator.AllBreaksKind }, outcome.NotPricedKinds);
    }

    [Fact]
    public void S6_APassiveNightOf9Hours_KeepsItsFlatSleepoverItem_ABreakInsideTheSleepoverWindowDeductsNothing()
    {
        var sleepover = new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ItemNumber = CatalogueGroups.SleepoverItemNumber, DayType = ClaimDayType.Weekday, PriceLimit_NSW = 150m, CatalogueVersion = "2026-27",
            EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        ShiftPriceOutcome Night(params (int From, int To)[] spans) =>
            ShiftPriceEstimator.Price(Rows(sleepover), null, Wednesday, T(22), T(7), true, SupportRatio.OneToOne, SleepoverType.PassiveNight, false, "NSW", new HashSet<DateOnly>(), TimeZoneInfo.Utc, spans);

        var without = Night();
        var withBreak = Night((60, 90));   // 23:00-23:30

        Assert.True(withBreak.IsPriced);
        Assert.Equal(without.Total, withBreak.Total);
        Assert.Equal(without.Lines.Select(l => (l.CatalogueItem.ItemNumber, l.Hours, l.TotalAmount)), withBreak.Lines.Select(l => (l.CatalogueItem.ItemNumber, l.Hours, l.TotalAmount)));
    }

    // ── UnclaimedSpans ──────────────────────────────────────────────────────

    private static IReadOnlyList<(int From, int To)> Spans(IEnumerable<(DateTime From, DateTime To)> breaks, SleepoverType night = SleepoverType.None) =>
        ShiftBreakRules.UnclaimedSpans(Wednesday, T(9), T(13), false, night, breaks, TimeZoneInfo.Utc);

    private static DateTime At(int h, int m = 0) => Wednesday.ToDateTime(T(h, m), DateTimeKind.Utc);

    [Fact]
    public void ABreakBeforeTheRosteredStartOrAfterItsEnd_GivesNoSpan_AndOneThatOverlapsIsClamped()
    {
        Assert.Empty(Spans(new[] { (At(7), At(8)), (At(14), At(15)) }));
        Assert.Equal((0, 30), Assert.Single(Spans(new[] { (At(8, 30), At(9, 30)) })));
        Assert.Equal((210, 240), Assert.Single(Spans(new[] { (At(12, 30), At(14)) })));
    }

    [Fact]
    public void ASleepoverNightTypeGivesNoSpans_BecauseTheItemIsFlat()
    {
        Assert.Empty(Spans(new[] { (At(10), At(11)) }, SleepoverType.Sleepover));
    }

    [Fact]
    public void OnTheDayTheClocksChange_TheOffsetsAreElapsedMinutes()
    {
        // Sunday 4 Oct 2026: 02:00 AEST becomes 03:00 AEDT. 00:00-06:00 is 5 elapsed hours; a break at 04:00-04:30 local is 3 h after the start, not 4.
        var breakStart = ProviderLocalTime.LocalToUtc(new DateTime(2026, 10, 4, 4, 0, 0), Sydney);
        var spans = ShiftBreakRules.UnclaimedSpans(new DateOnly(2026, 10, 4), T(0), T(6), false, SleepoverType.None, new[] { (breakStart, breakStart.AddMinutes(30)) }, Sydney);

        Assert.Equal((180, 210), Assert.Single(spans));
    }

    // ── The claim ───────────────────────────────────────────────────────────

    private static readonly DateOnly Tuesday = new(2026, 10, 20);

    private static (LedgerKit Kit, Participant Person, Shift Shift, ShiftCompletion Completion) Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.SeedCommunityAccessCatalogue();
        kit.Db.SaveChanges();
        var person = kit.SeedParticipant();
        var shift = kit.SeedShift(person, Tuesday, ShiftStatus.Completed);   // 09:00-17:00
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = kit.TenantId, ShiftId = shift.Id, TimeZoneId = "Australia/Sydney", IsActive = true, SubmittedByUserId = Guid.NewGuid(),
            ActualStart = Local(9), ActualEnd = Local(17),
        };
        kit.Db.ShiftCompletions.Add(completion);
        kit.Db.SaveChanges();
        return (kit, person, shift, completion);
    }

    private static DateTime Local(int h, int m = 0) => ProviderLocalTime.LocalToUtc(Tuesday.ToDateTime(T(h, m)), Sydney);

    private static void Break(LedgerKit kit, ShiftCompletion c, int fromH, int fromM, int toH, int toM, bool withParticipant = false)
    {
        kit.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), TenantId = c.TenantId, ShiftCompletionId = c.Id, CreatedByUserId = Guid.NewGuid(), StartedAt = Local(fromH, fromM), EndedAt = Local(toH, toM), WithParticipant = withParticipant,
        });
        kit.Db.SaveChanges();
    }

    private static ShiftClaimGenerationService Engine(LedgerKit kit) => new(kit.Db, kit.Ledger, kit.Tenant);

    [Fact]
    public async Task D_ACompletedShiftWithAnAlone30MinuteBreakClaims3Point5Hours_PreviewAndRunAgree()
    {
        var (kit, person, _, completion) = Arrange();
        using var _ = kit;
        Break(kit, completion, 11, 0, 11, 30);

        var preview = await Engine(kit).PreviewAsync(person.Id, Tuesday, Tuesday, Ct);
        var made = await Engine(kit).GenerateAsync(person.Id, Tuesday, Tuesday, Ct);

        var line = await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(Ct);
        Assert.Equal(7.5m, line.Hours);
        Assert.Equal(450m, line.TotalAmount);
        Assert.Equal(made.Claim.TotalAmount, preview.TotalAmount);
    }

    [Fact]
    public async Task D_ABreakAtAPerthPlaceOfASydneyOrganisation_IsPlacedInPerthTime_InTheClaim()
    {
        var (kit, person, shift, completion) = Arrange();
        using var _ = kit;
        var perth = TimeZoneInfo.FindSystemTimeZoneById("Australia/Perth");
        DateTime PerthAt(int h, int m = 0) => ProviderLocalTime.LocalToUtc(Tuesday.ToDateTime(T(h, m)), perth);
        var place = new ServiceLocation { Id = Guid.NewGuid(), TenantId = kit.TenantId, Name = "Perth house", Latitude = -31.95m, Longitude = 115.86m, RadiusMetres = 200, TimeZoneId = "Australia/Perth", IsActive = true };
        kit.Db.ServiceLocations.Add(place);
        shift.ServiceLocationId = place.Id;
        completion.TimeZoneId = "Australia/Perth";
        // 15:00-15:30 Perth (minutes 360-390 of the 09:00-17:00 shift) is 18:00 in Sydney (UTC+11 in October): outside the shift, so the Sydney count would take nothing off.
        kit.Db.ShiftBreaks.Add(new ShiftBreak { Id = Guid.NewGuid(), TenantId = kit.TenantId, ShiftCompletionId = completion.Id, CreatedByUserId = Guid.NewGuid(), StartedAt = PerthAt(15), EndedAt = PerthAt(15, 30) });
        kit.Db.SaveChanges();

        await Engine(kit).GenerateAsync(person.Id, Tuesday, Tuesday, Ct);

        var line = await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(Ct);
        Assert.Equal(7.5m, line.Hours);
        Assert.Equal(450m, line.TotalAmount);
    }

    [Fact]
    public async Task D_TheSameBreakWithTheParticipantIsStillClaimed()
    {
        var (kit, person, _, completion) = Arrange();
        using var _ = kit;
        Break(kit, completion, 11, 0, 11, 30, withParticipant: true);

        await Engine(kit).GenerateAsync(person.Id, Tuesday, Tuesday, Ct);

        Assert.Equal(8m, (await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(Ct)).Hours);
    }

    [Fact]
    public async Task TheBreaksOfAnArchivedCompletionAreIgnored()
    {
        var (kit, person, _, completion) = Arrange();
        using var _ = kit;
        Break(kit, completion, 11, 0, 11, 30);
        completion.IsActive = false;
        kit.Db.SaveChanges();

        await Engine(kit).GenerateAsync(person.Id, Tuesday, Tuesday, Ct);

        Assert.Equal(8m, (await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(Ct)).Hours);
    }

    [Fact]
    public async Task ClaimingAgainAfterARejectReadsTheSameBreaks()
    {
        var (kit, person, _, completion) = Arrange();
        using var _ = kit;
        Break(kit, completion, 11, 0, 11, 30);
        var old = (await Engine(kit).GenerateAsync(person.Id, Tuesday, Tuesday, Ct)).Claim;
        old.Status = TripClaimStatus.Rejected;
        foreach (var l in kit.Db.ClaimLineItems.Where(l => l.TripClaimId == old.Id)) l.Status = ClaimLineItemStatus.Submitted;
        kit.Db.SaveChanges();

        var made = await Engine(kit).ClaimAgainAsync(old.Id, kit.TenantId, new DateOnly(2026, 10, 30), Ct);

        Assert.Equal(7.5m, (await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.TripClaimId == made.Claim.Id, Ct)).Hours);
    }
}
