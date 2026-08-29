using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>
/// Fixed-date coverage for <see cref="MedicationScheduleCalculator"/> — the single source of
/// truth for whether a Regular medication is due on a given day, across all three
/// <see cref="MedicationFrequency"/> patterns, including month-boundary cases.
/// </summary>
public class MedicationScheduleCalculatorTests
{
    // ── Daily ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData(2026, 1, 31)]
    [InlineData(2026, 2, 1)]
    [InlineData(2026, 2, 28)]
    [InlineData(2026, 3, 1)]
    public void Daily_IsAlwaysDue(int year, int month, int day)
    {
        var date = new DateOnly(year, month, day);
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.Daily, null, null, null, date));
    }

    // ── SpecificDays ───────────────────────────────────────────────────

    [Fact]
    public void SpecificDays_MondayWednesdayFriday_DueOnlyOnThoseWeekdays()
    {
        var mask = Weekdays.Monday | Weekdays.Wednesday | Weekdays.Friday;

        // 2026-01-26 is a Monday, 2026-01-27 Tuesday, 2026-01-28 Wednesday, 2026-01-30 Friday, 2026-01-31 Saturday.
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 1, 26)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 1, 27)));
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 1, 28)));
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 1, 30)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 1, 31)));
    }

    [Fact]
    public void SpecificDays_SpansMonthBoundary_StillMatchesCorrectWeekdays()
    {
        var mask = Weekdays.Sunday;
        // 2026-02-01 is a Sunday (month boundary from Jan into Feb).
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 2, 1)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, mask, null, null, new DateOnly(2026, 1, 31)));
    }

    [Fact]
    public void SpecificDays_NullOrNoneMask_NeverDue()
    {
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, null, null, null, new DateOnly(2026, 1, 26)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.SpecificDays, Weekdays.None, null, null, new DateOnly(2026, 1, 26)));
    }

    // ── EveryNDays ─────────────────────────────────────────────────────

    [Fact]
    public void EveryNDays_OnAnchorDate_IsDue()
    {
        var anchor = new DateOnly(2026, 1, 15);
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 3, anchor, anchor));
    }

    [Fact]
    public void EveryNDays_EveryThirdDay_MatchesOnlyMultiplesOfInterval()
    {
        var anchor = new DateOnly(2026, 1, 15);
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 3, anchor, new DateOnly(2026, 1, 18)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 3, anchor, new DateOnly(2026, 1, 17)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 3, anchor, new DateOnly(2026, 1, 19)));
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 3, anchor, new DateOnly(2026, 1, 21)));
    }

    [Fact]
    public void EveryNDays_SpansMonthBoundary_StillMatchesInterval()
    {
        // Anchor Jan 30, interval 2 -> due Jan 30, Feb 1, Feb 3, ... (crosses Jan/Feb boundary).
        var anchor = new DateOnly(2026, 1, 30);
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 2, anchor, new DateOnly(2026, 2, 1)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 2, anchor, new DateOnly(2026, 1, 31)));
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 2, anchor, new DateOnly(2026, 2, 3)));
    }

    [Fact]
    public void EveryNDays_DateBeforeAnchor_StillComputesCorrectPhase()
    {
        // Anchor Jan 15, interval 4. Jan 11 is exactly one interval before the anchor -> due.
        // Jan 13 is 2 days before -> not due. Negative-modulo normalisation is what's under test here.
        var anchor = new DateOnly(2026, 1, 15);
        Assert.True(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 4, anchor, new DateOnly(2026, 1, 11)));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 4, anchor, new DateOnly(2026, 1, 13)));
    }

    [Fact]
    public void EveryNDays_MissingAnchorOrInterval_NeverDue()
    {
        var anchor = new DateOnly(2026, 1, 15);
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, null, anchor, anchor));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 3, null, anchor));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, 0, anchor, anchor));
        Assert.False(MedicationScheduleCalculator.IsDue(MedicationFrequency.EveryNDays, null, -1, anchor, anchor));
    }
}
