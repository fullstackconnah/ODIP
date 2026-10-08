using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The interim guard of the 2026-10-08 review (L3-02) seen from the claim and from the budget. A shift the shift claim cannot price (a sleepover, a passive night, a group or shared shift) is
/// LEFT OUT of the claim, and it is never dropped silently: the preview and the generated claim list it and say why, a refusal because nothing could be claimed says shifts were left out, and the
/// shift stays completed and unclaimed. The budget ledger prices the same shifts with the same estimator, so it counts them as $0 with the same reason instead of overstating them as plain
/// community access hours. Two-to-one is still priced; an active night is priced and flagged. The organisation is in NSW: an eight-hour weekday is $480.
/// </summary>
public class ShiftClaimLeftOutTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 31);

    private static (LedgerKit Kit, Participant Person) Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        return (kit, person);
    }

    private static Shift Completed(LedgerKit kit, Participant person, DateOnly date, SupportRatio ratio = SupportRatio.OneToOne, SleepoverType night = SleepoverType.None, int start = 9, int end = 17, bool overnight = false)
    {
        var shift = kit.SeedShift(person, date, ShiftStatus.Completed, start, end, overnight);
        shift.Ratio = ratio;
        shift.NightType = night;
        kit.Db.SaveChanges();
        return shift;
    }

    private static ShiftClaimGenerationService Engine(LedgerKit kit) => new(kit.Db, kit.Ledger, kit.Tenant);

    /// <summary>One plain shift, a sleepover, a 1:3 group shift, a two-to-one shift and an overnight active night, on five days of October 2026.</summary>
    private static (Shift Plain, Shift Sleepover, Shift Group, Shift TwoToOne, Shift ActiveNight) FiveShifts(LedgerKit kit, Participant person) => (
        Completed(kit, person, new DateOnly(2026, 10, 1)),                                                                                  // Thu: $480
        Completed(kit, person, new DateOnly(2026, 10, 2), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true),              // Fri night: a sleepover
        Completed(kit, person, new DateOnly(2026, 10, 3), ratio: SupportRatio.OneToThree, start: 9, end: 15),                               // Sat: a 1:3 group shift
        Completed(kit, person, new DateOnly(2026, 10, 5), ratio: SupportRatio.TwoToOne),                                                    // Mon: two-to-one, $480
        Completed(kit, person, new DateOnly(2026, 10, 6), night: SleepoverType.ActiveNight, start: 18, end: 2, overnight: true));          // Tue evening into Wed: an active night, $480

    [Fact]
    public async Task APreviewPricesWhatItCanAndListsEachShiftItLeavesOutWithTheReason()
    {
        var (kit, person) = Arrange();
        var (plain, sleepover, group, twoToOne, activeNight) = FiveShifts(kit, person);

        var preview = await Engine(kit).PreviewAsync(person.Id, From, To, Ct);

        Assert.Equal(new[] { plain.Id, twoToOne.Id, activeNight.Id }, preview.LineItems.Select(l => l.ShiftId));
        Assert.Equal(1440m, preview.TotalAmount);                                   // three shifts at $480: not five, and not the sleepover or the group shift at the one-to-one rate
        Assert.Equal(new[] { sleepover.Id, group.Id }, preview.LeftOut.Select(l => l.ShiftId));
        Assert.Equal(
            new[] { "It is a sleepover, which shift claims do not price yet.", "It is a 1:3 group shift, which shift claims do not price yet." },
            preview.LeftOut.Select(l => l.Reason));
        Assert.Equal(new[] { new DateOnly(2026, 10, 2), new DateOnly(2026, 10, 3) }, preview.LeftOut.Select(l => l.ServiceDate));
        Assert.Equal(new[] { "Shift 22:00–06:00 · 8 h", "Shift 09:00–15:00 · 6 h" }, preview.LeftOut.Select(l => l.Description));
    }

    [Fact]
    public async Task APreviewFlagsAnActiveNightLineButNotThePlainOnes()
    {
        var (kit, person) = Arrange();
        var (plain, _, _, twoToOne, activeNight) = FiveShifts(kit, person);

        var preview = await Engine(kit).PreviewAsync(person.Id, From, To, Ct);

        Assert.Equal("Evening and night rates are not applied yet.", preview.LineItems.Single(l => l.ShiftId == activeNight.Id).Note);
        Assert.Null(preview.LineItems.Single(l => l.ShiftId == plain.Id).Note);
        Assert.Null(preview.LineItems.Single(l => l.ShiftId == twoToOne.Id).Note);
    }

    [Fact]
    public async Task TheGeneratedClaimListsThemToo_AndTheShiftsItLeftOutStayCompletedAndUnclaimed()
    {
        var (kit, person) = Arrange();
        var (plain, sleepover, group, twoToOne, activeNight) = FiveShifts(kit, person);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var lines = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == generated.Claim.Id).ToListAsync(Ct);
        Assert.Equal(new[] { plain.Id, twoToOne.Id, activeNight.Id }.OrderBy(id => id), lines.Select(l => l.ShiftId!.Value).OrderBy(id => id));
        Assert.Equal(1440m, generated.Claim.TotalAmount);
        Assert.Equal(new[] { sleepover.Id, group.Id }, generated.LeftOut.Select(l => l.ShiftId));
        Assert.All(generated.LeftOut, l => Assert.Contains("which shift claims do not price yet", l.Reason));
        foreach (var left in new[] { sleepover, group })
        {
            Assert.Equal(ShiftStatus.Completed, kit.Db.Shifts.Single(s => s.Id == left.Id).Status);
            Assert.False(kit.Db.ClaimLineItems.Any(l => l.ShiftId == left.Id));   // not claimed, so they are still waiting
        }
    }

    // ── The caveat does not live on the claim line, so the generate response echoes it (round 1b, review F2) ──

    [Fact]
    public async Task TheGeneratedClaimEchoesTheShiftsItPricedWithACaveat_BecauseTheLineHasNowhereToKeepIt()
    {
        var (kit, person) = Arrange();
        var (plain, _, _, twoToOne, activeNight) = FiveShifts(kit, person);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        var flagged = Assert.Single(generated.Flagged);                                       // the active night, and only it: the plain and two-to-one lines carry no caveat
        Assert.Equal(activeNight.Id, flagged.ShiftId);
        Assert.Equal(new DateOnly(2026, 10, 6), flagged.ServiceDate);
        Assert.Equal("Shift 18:00–02:00 · 8 h", flagged.Description);
        Assert.Equal("Evening and night rates are not applied yet.", flagged.Caveat);
        Assert.DoesNotContain(generated.Flagged, f => f.ShiftId == plain.Id || f.ShiftId == twoToOne.Id);
        Assert.True(kit.Db.ClaimLineItems.Any(l => l.ShiftId == activeNight.Id));            // it IS in the claim, priced; the flag is about the price
    }

    [Fact]
    public async Task AShiftLeftOutIsNotAlsoFlagged_AndAClaimWithNoCaveatsFlagsNothing()
    {
        var (kit, person) = Arrange();
        Completed(kit, person, new DateOnly(2026, 10, 1));
        Completed(kit, person, new DateOnly(2026, 10, 2), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);

        var generated = await Engine(kit).GenerateAsync(person.Id, From, To, Ct);

        Assert.Empty(generated.Flagged);
        Assert.Single(generated.LeftOut);
    }

    [Fact]
    public async Task GenerateDraftClaimAsyncMakesTheSameClaim()
    {
        var (kit, person) = Arrange();
        FiveShifts(kit, person);

        var claim = await Engine(kit).GenerateDraftClaimAsync(person.Id, From, To, Ct);

        Assert.Equal(1440m, claim.TotalAmount);
        Assert.Equal(3, kit.Db.ClaimLineItems.Count(l => l.TripClaimId == claim.Id));
    }

    [Fact]
    public async Task AShiftNoCatalogueRateCoversIsListedAsLeftOutToo_WhereItWasDroppedSilentlyBefore()
    {
        var (kit, person) = Arrange();
        var plain = Completed(kit, person, new DateOnly(2026, 10, 1));
        var saturday = Completed(kit, person, new DateOnly(2026, 10, 3));
        kit.Db.SupportCatalogueItems.RemoveRange(kit.Db.SupportCatalogueItems.Where(i => i.DayType == ClaimDayType.Saturday).ToList());
        kit.Db.SaveChanges();

        var preview = await Engine(kit).PreviewAsync(person.Id, From, To, Ct);

        Assert.Equal(plain.Id, Assert.Single(preview.LineItems).ShiftId);
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(saturday.Id, left.ShiftId);
        Assert.Equal("No catalogue rate covers this date.", left.Reason);
    }

    [Fact]
    public async Task WhenEveryShiftIsLeftOutTheRefusalSaysShiftsWereLeftOutAndWhy_NotThatNoneWereFound()
    {
        var (kit, person) = Arrange();
        Completed(kit, person, new DateOnly(2026, 10, 2), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);

        var preview = await Assert.ThrowsAsync<InvalidOperationException>(() => Engine(kit).PreviewAsync(person.Id, From, To, Ct));
        var generate = await Assert.ThrowsAsync<InvalidOperationException>(() => Engine(kit).GenerateAsync(person.Id, From, To, Ct));

        const string expected = "Nothing in this date range could be claimed: 1 completed, unclaimed shift was left out. It is a sleepover, which shift claims do not price yet.";
        Assert.Equal(expected, preview.Message);
        Assert.Equal(expected, generate.Message);
        Assert.Empty(kit.Db.TripClaims);   // nothing was saved
    }

    [Fact]
    public async Task TheRefusalGroupsSeveralShiftsByReason()
    {
        var (kit, person) = Arrange();
        Completed(kit, person, new DateOnly(2026, 10, 2), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);
        Completed(kit, person, new DateOnly(2026, 10, 3), ratio: SupportRatio.OneToThree, start: 9, end: 15);
        Completed(kit, person, new DateOnly(2026, 10, 4), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);

        var refusal = await Assert.ThrowsAsync<InvalidOperationException>(() => Engine(kit).PreviewAsync(person.Id, From, To, Ct));

        Assert.Equal(
            "Nothing in this date range could be claimed: 3 completed, unclaimed shifts were left out. "
            + "It is a sleepover, which shift claims do not price yet (2 shifts). It is a 1:3 group shift, which shift claims do not price yet (1 shift).",
            refusal.Message);
    }

    [Fact]
    public async Task WithNoCompletedUnclaimedShiftsAtAllTheRefusalIsUnchanged()
    {
        var (kit, person) = Arrange();

        var refusal = await Assert.ThrowsAsync<InvalidOperationException>(() => Engine(kit).PreviewAsync(person.Id, From, To, Ct));

        Assert.Equal("No completed, unclaimed shifts found in this date range.", refusal.Message);
    }

    // ── The budget, which prices the same shifts with the same estimator ────

    private static async Task<PeriodLedger> Q2Of(LedgerKit kit, Participant person)
    {
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        return all[person.Id].Ledger!.Pools[0].Periods[1];
    }

    [Fact]
    public async Task TheLedgerCountsTheLeftOutShiftsAsZeroWithTheReason_SoTheBudgetNoLongerOverstatesThem()
    {
        var (kit, person) = Arrange();
        var (plain, sleepover, group, twoToOne, activeNight) = FiveShifts(kit, person);

        var q2 = await Q2Of(kit, person);

        Assert.Equal(1440m, q2.Pending);   // the three shifts the claim prices; it was 5 shifts' worth at the one-to-one rate
        var byShift = q2.Items.ToDictionary(i => i.ShiftId!.Value);
        Assert.Equal(0m, byShift[sleepover.Id].Amount);
        Assert.Equal("It is a sleepover, which shift claims do not price yet, so it is counted as $0.", byShift[sleepover.Id].Note);
        Assert.Equal(0m, byShift[group.Id].Amount);
        Assert.Equal("It is a 1:3 group shift, which shift claims do not price yet, so it is counted as $0.", byShift[group.Id].Note);
        Assert.Equal(480m, byShift[twoToOne.Id].Amount);
        Assert.Null(byShift[twoToOne.Id].Note);
        Assert.Equal(480m, byShift[plain.Id].Amount);
        Assert.Equal(480m, byShift[activeNight.Id].Amount);
        Assert.Equal("Evening and night rates are not applied yet.", byShift[activeNight.Id].Note);
    }

    [Fact]
    public async Task ARosteredShiftTheClaimCannotPriceIsCountedAsZeroBookedAheadToo()
    {
        var (kit, person) = Arrange();
        var future = kit.SeedShift(person, new DateOnly(2026, 10, 20), ShiftStatus.Published);
        future.Ratio = SupportRatio.OneToTwo;
        kit.Db.SaveChanges();

        var q2 = await Q2Of(kit, person);

        var item = Assert.Single(q2.Items);
        Assert.Equal(LedgerRowKind.FutureShift, item.Kind);
        Assert.Equal(0m, item.Amount);
        Assert.Equal(0m, q2.BookedAhead);
        Assert.Equal("It is a 1:2 group shift, which shift claims do not price yet, so it is counted as $0.", item.Note);
    }

    [Fact]
    public async Task TheLedgersPendingTotalIsTheClaimPreviewsTotalForTheSameShifts()
    {
        var (kit, person) = Arrange();
        FiveShifts(kit, person);

        var q2 = await Q2Of(kit, person);
        var preview = await Engine(kit).PreviewAsync(person.Id, From, To, Ct);

        Assert.Equal(preview.TotalAmount, q2.Pending);   // one estimator: the estimate and the claim made from it are the same figure
    }
}
