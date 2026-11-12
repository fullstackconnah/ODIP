using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// The hour the clocks repeat (Sydney, Sun 4 Apr 2027: 03:00 AEDT goes back to 02:00 AEST) happens twice, and a wall time alone cannot say which pass a worked start or finish was in. A claim reads the stored UTC
/// instant, so a first-pass finish (15:30Z is 02:30 AEDT) bills the real elapsed time, not the second pass an hour later. 16:30Z is 02:30 AEST, the second pass.
/// </summary>
public class DstFirstPassBillingTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
    private static readonly DateOnly Sat = new(2027, 4, 3), Sun = new(2027, 4, 4);

    /// <summary>April is 2027 (the 2026-27 catalogue covers it); the September and October nights are 2026.</summary>
    private static int YearOf(int month) => month <= 6 ? 2027 : 2026;

    private static DateTime Z(int month, int day, int hour, int minute) => new(YearOf(month), month, day, hour, minute, 0, DateTimeKind.Utc);

    private static (LedgerKit Kit, ShiftClaimGenerationService Engine, Participant Person) NewKit(params PoolSpec[] pools)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("VIC").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        if (pools.Length > 0) kit.SeedPlan(person, new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), pools);
        return (kit, new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant), person);
    }

    /// <summary>A completed shift rostered start-end (the end the next day when it is not after the start) and, when <paramref name="actualEnd"/> is given, a finished completion with those instants.</summary>
    private static (Shift Shift, ShiftCompletion? Completion) Seed(LedgerKit kit, Participant person, DateOnly date, TimeOnly start, TimeOnly end, DateTime? actualStart, DateTime? actualEnd, ExtraTimeDecision? decision = null, int varStart = 0, int varEnd = 0)
    {
        var shift = kit.SeedShift(person, date, ShiftStatus.Completed);
        shift.StartTime = start;
        shift.EndTime = end;
        shift.EndsNextDay = end <= start;
        ShiftCompletion? completion = null;
        if (actualEnd is not null)
        {
            completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = kit.TenantId, ShiftId = shift.Id, ActualStart = actualStart!.Value, ActualEnd = actualEnd, VarianceMinutesStart = varStart, VarianceMinutesEnd = varEnd, ExtraTime = decision,
                TimeZoneId = "Australia/Sydney", SubmittedByUserId = Guid.NewGuid(), StartedAt = actualStart.Value, IsActive = true,
            };
            kit.Db.ShiftCompletions.Add(completion);
        }
        kit.Db.SaveChanges();
        return (shift, completion);
    }

    private static async Task<decimal> ClaimedHours(LedgerKit kit, ShiftClaimGenerationService engine, Participant person, DateOnly date)
    {
        var claim = (await engine.GenerateAsync(person.Id, date, date, Ct)).Claim;
        return kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToList().Sum(l => l.Hours);
    }

    // Row 1: rostered 22:00 to 02:30, worked to 02:30 in the first pass. The pass is lost on the way through a wall clock.
    [Theory]
    [InlineData(15, 30, 4.5)]   // first pass: 22:00 AEDT to 02:30 AEDT
    [InlineData(16, 30, 5.5)]   // row 2: second pass, as today
    public async Task AWorkedFinishInTheRepeatedHour_BillsTheElapsedTime(int hour, int minute, double hours)
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Seed(kit, person, Sat, new TimeOnly(22, 0), new TimeOnly(2, 30), Z(4, 3, 11, 0), Z(4, 3, hour, minute), varEnd: hour == 15 ? -60 : 0);

        Assert.Equal((decimal)hours, await ClaimedHours(kit, engine, person, Sat));
    }

    // Row 3: no completion, the rostered times stay on the default (second) pass.
    [Fact]
    public async Task ARosteredShiftWithNoCompletion_StaysAsToday()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Seed(kit, person, Sat, new TimeOnly(22, 0), new TimeOnly(2, 30), null, null);

        Assert.Equal(5.5m, await ClaimedHours(kit, engine, person, Sat));
    }

    // Rows 4 and 4b: rostered 02:30 to 06:00, the worker started in the first pass (an hour early by the clock).
    [Theory]
    [InlineData(ExtraTimeDecision.Approved, 4.5)]   // the approved window starts in the first pass
    [InlineData(ExtraTimeDecision.Pending, 3.5)]    // the early start is held at the rostered time
    [InlineData(null, 3.5)]
    public async Task AWorkedStartInTheRepeatedHour_IsBilledFromTheFirstPassOnlyOnceApproved(ExtraTimeDecision? decision, double hours)
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Seed(kit, person, Sun, new TimeOnly(2, 30), new TimeOnly(6, 0), Z(4, 3, 15, 30), Z(4, 3, 20, 0), decision, -60, 0);

        Assert.Equal((decimal)hours, await ClaimedHours(kit, engine, person, Sun));
    }

    // Row 5: the skipped hour in October is unchanged.
    [Fact]
    public async Task TheSkippedHour_IsUnchanged()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Seed(kit, person, new DateOnly(2026, 10, 3), new TimeOnly(22, 0), new TimeOnly(2, 30), null, null);

        Assert.Equal(4m, await ClaimedHours(kit, engine, person, new DateOnly(2026, 10, 3)));
    }

    // Row 6: an alone break 02:40 to 02:50 in the first pass, worked to 02:55. The 10 minutes come off 4 h 55 min.
    [Fact]
    public async Task AnAloneBreakInTheRepeatedHour_IsDeducted()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        var (_, completion) = Seed(kit, person, Sat, new TimeOnly(22, 0), new TimeOnly(2, 30), Z(4, 3, 11, 0), Z(4, 3, 15, 55), varEnd: -35);
        kit.Db.ShiftBreaks.Add(new ShiftBreak { Id = Guid.NewGuid(), TenantId = kit.TenantId, ShiftCompletionId = completion!.Id, CreatedByUserId = Guid.NewGuid(), StartedAt = Z(4, 3, 15, 40), EndedAt = Z(4, 3, 15, 50) });
        kit.Db.SaveChanges();

        Assert.Equal(4.75m, await ClaimedHours(kit, engine, person, Sat));
    }

    // The budget counts a first-pass start at its elapsed 4.5 h, like the claim (a one-part item, so the text carries the hours; row 1 spans a Saturday and a Sunday part).
    [Fact]
    public async Task TheLedgerCountsAFirstPassStartAtItsElapsedHours()
    {
        var (kit, _, person) = NewKit(LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(4, 10000m)));
        using var _ = kit;
        var (shift, _) = Seed(kit, person, Sun, new TimeOnly(2, 30), new TimeOnly(6, 0), Z(4, 3, 15, 30), Z(4, 3, 20, 0), ExtraTimeDecision.Approved, -60, 0);

        var items = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id].Items;

        Assert.Contains(items, i => i.ShiftId == shift.Id && i.Description.StartsWith("Shift 02:30–06:00 · 4.5 h"));
    }

    // The ClaimSpan round trip: the pass is flagged for a first-pass instant, not for the second pass or an ordinary 02:30.
    [Theory]
    [InlineData(4, 3, 15, 30, true)]
    [InlineData(4, 3, 16, 30, false)]
    [InlineData(9, 4, 16, 30, false)]   // 02:30 AEST on 5 Sep 2026, no clock change
    public void OnlyAFirstPassFinishIsFlagged(int month, int day, int hour, int minute, bool expected)
    {
        var date = new DateOnly(YearOf(month), month, day);
        var shift = new Shift { ServiceDate = date, StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(2, 30), EndsNextDay = true, NightType = SleepoverType.None };
        var completion = new ShiftCompletion { ActualStart = Z(month, day, 11, 0), ActualEnd = Z(month, day, hour, minute), VarianceMinutesEnd = 0, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney", IsActive = true };
        if (month == 9) { completion.ActualStart = Z(9, 4, 12, 0); completion.ActualEnd = Z(9, 4, 16, 30); }

        var window = ShiftClaimWindow.For(shift, completion, Sydney);

        Assert.Equal(expected, window.Priced.EndFirstPass);
        Assert.False(window.Priced.StartFirstPass);
        Assert.Equal(new TimeOnly(2, 30), window.Priced.End);
    }

    // Row 4: the note counts the first-pass start in real time: 02:30 AEDT is an hour before 02:30 AEST.
    [Fact]
    public void TheExtraTimeNote_CountsAFirstPassStartInElapsedMinutes()
    {
        var shift = new Shift { ServiceDate = Sun, StartTime = new TimeOnly(2, 30), EndTime = new TimeOnly(6, 0), NightType = SleepoverType.None };
        var completion = new ShiftCompletion { ActualStart = Z(4, 3, 15, 30), ActualEnd = Z(4, 3, 20, 0), VarianceMinutesStart = -60, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney", IsActive = true };

        var window = ShiftClaimWindow.For(shift, completion, Sydney);

        Assert.True(window.Priced.StartFirstPass);
        Assert.Equal("Extra time 02:30–02:30 (clocks went back) · 60 min", window.ExtraText);
        Assert.False(ShiftClaimWindow.For(shift, new ShiftCompletion { ActualStart = completion.ActualStart, ActualEnd = completion.ActualEnd, VarianceMinutesStart = -60, ExtraTime = ExtraTimeDecision.Pending, TimeZoneId = "Australia/Sydney", IsActive = true }, Sydney).Priced.StartFirstPass);
    }

    // Row 7: the October skipped hour. Held start 03:30, approved start 01:30 AEST: 120 minutes on the wall clock, 60 in real time.
    [Fact]
    public void TheExtraTimeNote_CountsAcrossTheSkippedHourInElapsedMinutes()
    {
        var shift = new Shift { ServiceDate = new DateOnly(2026, 10, 4), StartTime = new TimeOnly(3, 30), EndTime = new TimeOnly(7, 0), NightType = SleepoverType.None };
        var completion = new ShiftCompletion { ActualStart = Z(10, 3, 15, 30), ActualEnd = Z(10, 3, 20, 0), VarianceMinutesStart = -60, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney", IsActive = true };

        var window = ShiftClaimWindow.For(shift, completion, Sydney);

        Assert.Equal("Extra time 01:30–03:30 (clocks went forward) · 60 min", window.ExtraText);
    }

    // N1 (PR 851 deep review): a headcount cut inside the repeated hour. Billed minutes per part, at a block with a change at 02:10 (the engine reads each cut as the second pass unless the shift ends in the first).
    private static List<int> PartMinutes(TimeOnly start, TimeOnly end, TimeOnly cutAt, bool startFirstPass, bool endFirstPass)
    {
        var block = new PlanBlock
        {
            Id = "b", Days = new[] { Sun.DayOfWeek }, Start = start, End = end, Workers = 1, ParticipantsPresent = 4, Location = new PlanLocation { State = "NSW" },
            HeadcountChanges = new[] { new PlanHeadcountChange { From = cutAt, ParticipantsPresent = 3 } },
        };
        var pricer = new OccurrencePricer(new PlanPricingPolicy(), new PlanCatalogue(Array.Empty<SupportCatalogueItem>()), new HolidayCalendar(Array.Empty<HolidayEntry>()), _ => Sydney);
        var minutes = pricer.Parts(block, Sun, startFirstPass, endFirstPass).Select(p => p.Minutes).ToList();

        Assert.Equal(ShiftBands.ElapsedMinutes(Sun.ToDateTime(start), Sun.ToDateTime(end), Sydney, startFirstPass, endFirstPass), minutes.Sum());
        return minutes;
    }

    [Fact]
    public void AHeadcountCutInTheRepeatedHour_OfAShiftThatEndsInTheFirstPass_BillsTheElapsedTime() =>
        Assert.Equal(new[] { 130, 20 }, PartMinutes(new TimeOnly(0, 0), new TimeOnly(2, 30), new TimeOnly(2, 10), false, true));

    [Fact]
    public void AHeadcountCutBetweenAFirstPassStartAndFinish_BillsTheElapsedTime() =>
        Assert.Equal(new[] { 20, 20 }, PartMinutes(new TimeOnly(2, 10), new TimeOnly(2, 50), new TimeOnly(2, 30), true, true));

    // Found, not changed: a cut in the repeated hour of a shift that starts in the first pass and ends in the second cannot say which pass it lies in; it stays the second, and the total is still the 90 elapsed minutes.
    [Fact]
    public void AHeadcountCutInTheRepeatedHour_OfAShiftThatEndsInTheSecondPass_StaysTheSecondPass() =>
        Assert.Equal(new[] { 70, 20 }, PartMinutes(new TimeOnly(2, 10), new TimeOnly(2, 40), new TimeOnly(2, 20), true, false));

    // A sleepover that ends in the repeated hour: the finish is read as the first pass, so 18:30 to 02:20 is 470 elapsed minutes (under the 8 hours), not 530.
    private static ShiftBandSplit SleepoverSplit(DateOnly date, TimeOnly start, TimeOnly end, bool startFirstPass, bool endFirstPass) =>
        ShiftBands.Split(date, start, end, true, new HashSet<DateOnly>(), Sydney, startFirstPass, endFirstPass);

    [Fact]
    public void ASleepoverThatEndsInTheFirstPassOfTheRepeatedHour_IsTooShortAt470Minutes() =>
        Assert.False(SleepoverSplit(Sat, new TimeOnly(18, 30), new TimeOnly(2, 20), false, true).SleepoverQualified);

    [Fact]
    public void ASleepoverThatEndsInTheSecondPass_StillQualifiesAt530Minutes()
    {
        var split = SleepoverSplit(Sat, new TimeOnly(18, 30), new TimeOnly(2, 20), false, false);

        Assert.True(split.SleepoverQualified);
        Assert.Equal(530, split.Parts.Single(p => p.Sleepover).Minutes);
    }

    [Fact]
    public void ASleepoverThatEndsInTheFirstPass_CountsItsPartAtTheElapsedMinutes()
    {
        var split = SleepoverSplit(Sat, new TimeOnly(18, 0), new TimeOnly(2, 30), false, true);

        Assert.True(split.SleepoverQualified);
        Assert.Equal(510, split.Parts.Single(p => p.Sleepover).Minutes);
    }

    [Fact]
    public void ASleepoverThatStartsInTheFirstPass_CountsItsPartFromTheFirstPass()
    {
        var split = SleepoverSplit(Sun, new TimeOnly(2, 30), new TimeOnly(2, 0), true, false);

        Assert.Equal(ShiftBands.ElapsedMinutes(Sun.ToDateTime(new TimeOnly(2, 30)), Sun.AddDays(1).ToDateTime(new TimeOnly(2, 0)), Sydney, true, false), split.Parts.Single(p => p.Sleepover).Minutes);
        Assert.Equal(1470, split.Parts.Single(p => p.Sleepover).Minutes);
    }
}
