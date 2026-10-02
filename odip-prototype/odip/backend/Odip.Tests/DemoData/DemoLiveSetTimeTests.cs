using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The time rules of the live set (plan 2.0, 5.3), pinned with literal instants so a wrong offset cannot hide behind the code's own arithmetic.
/// Shift times, dose slots and every scripted event are provider-local wall-clock values; every stored instant is the conversion of one. The
/// clocks go forward on Sun 4 Oct 2026 (02:00 to 03:00 in NSW, and in SA at 02:00 ACST, which is 16:30Z on Sat) and back on Sun 4 Apr 2027
/// (03:00 to 02:00); Brisbane keeps no daylight saving. So the same 08:04 dose is 22:04Z the evening before in Sydney in standard time and 21:04Z
/// in daylight saving, and Saturday's 08:04 and Sunday's are 23 hours apart in UTC on the first of those days and 25 on the second.
/// </summary>
public class DemoLiveSetTimeTests
{
    private static DateTimeOffset Utc(string iso) => DateTimeOffset.Parse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static DateOnly Date(string iso) => DateOnly.ParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    // state, the tick (Sunday 10:30 on the provider's clock), the Sunday, Saturday's 08:04 dose, Sunday's, and Sunday 08:30 (when Saturday's insulin witness answers).
    public static IEnumerable<object[]> ClockChanges() => new[]
    {
        new object[] { "NSW", "2026-10-03T23:30:00Z", "2026-10-04", "2026-10-02T22:04:00Z", "2026-10-03T21:04:00Z", "2026-10-03T21:30:00Z" },    // forward: AEST +10, then AEDT +11
        new object[] { "QLD", "2026-10-04T00:30:00Z", "2026-10-04", "2026-10-02T22:04:00Z", "2026-10-03T22:04:00Z", "2026-10-03T22:30:00Z" },    // no change: +10 both days
        new object[] { "SA", "2026-10-04T00:00:00Z", "2026-10-04", "2026-10-02T22:34:00Z", "2026-10-03T21:34:00Z", "2026-10-03T22:00:00Z" },     // forward: ACST +9:30, then ACDT +10:30
        new object[] { "NSW", "2027-04-04T00:30:00Z", "2027-04-04", "2027-04-02T21:04:00Z", "2027-04-03T22:04:00Z", "2027-04-03T22:30:00Z" },    // back: AEDT +11, then AEST +10
        new object[] { "QLD", "2027-04-04T00:30:00Z", "2027-04-04", "2027-04-02T22:04:00Z", "2027-04-03T22:04:00Z", "2027-04-03T22:30:00Z" },
        new object[] { "SA", "2027-04-04T01:00:00Z", "2027-04-04", "2027-04-02T21:34:00Z", "2027-04-03T22:34:00Z", "2027-04-03T23:00:00Z" },     // back: ACDT +10:30, then ACST +9:30
    };

    [Theory]
    [MemberData(nameof(ClockChanges))]
    public async Task OnTheDayTheClocksChange_EveryScriptedInstant_IsTheSameWallClockTimeAsOnAnyOtherDay(
        string state, string tick, string sunday, string saturdayLevetiracetam, string sundayLevetiracetam, string sundayWitnessAnswer)
    {
        var env = await TickAsync(Utc(tick), state);
        var d0 = Date(sunday);
        var zoneId = ProviderTimeZoneResolver.FromState(state).Id;

        foreach (var (date, levetiracetam) in new[] { (d0.AddDays(-1), Utc(saturdayLevetiracetam).UtcDateTime), (d0, Utc(sundayLevetiracetam).UtcDateTime) })
        {
            var day = await RequireDayAsync(env, LiveSetCatalog.Morning, date, state);

            // The 08:00 slot is a wall-clock value, the given time an instant: 08:04 local, whatever the offset that day.
            var dose = day.Slot(MedicationCatalog.Levetiracetam, 8, 0)!;
            Assert.Equal(At(date, 8, 0), dose.ScheduledAt);
            Assert.Equal(levetiracetam, dose.AdministeredAt);
            Assert.Equal(zoneId, dose.AdministeredAtTimeZone);
            Assert.Equal(levetiracetam.AddMinutes(1), dose.CreatedAt);                                  // recorded at 08:05

            // The rest of the morning is the same wall-clock distance from it (nothing crosses the change, which is at 02:00).
            Assert.Equal(levetiracetam.AddMinutes(-66), day.Completion!.ActualStart);                   // started 06:58
            Assert.Equal(levetiracetam.AddMinutes(86), day.Breaks.Single().StartedAt);                  // break 09:30
            Assert.Equal(levetiracetam.AddMinutes(101), day.Breaks.Single().EndedAt);                   // to 09:45
            Assert.Equal(levetiracetam.AddMinutes(136), day.Doses.Single(d => d.ParticipantMedicationId == MedicationCatalog.Paracetamol).AdministeredAt);    // PRN 10:20
            Assert.Equal(zoneId, day.Completion.TimeZoneId);

            // And the audit trail says the same instant, by the worker.
            await using var db = env.AdminDb();
            var audit = await db.AuditLogs.SingleAsync(l => l.EntityId == dose.Id && l.Action == AuditAction.Created);
            Assert.Equal(new DateTimeOffset(levetiracetam.AddMinutes(1), TimeSpan.Zero), audit.ChangedAt);
            Assert.Equal(day.Worker.FullName, audit.ChangedByName);
        }

        // Saturday's witness answers at 08:30 on Sunday's clock: 21:30Z in Sydney that day, not 22:30Z.
        var insulin = (await RequireDayAsync(env, LiveSetCatalog.Insulin, d0.AddDays(-1), state)).Slot(MedicationCatalog.InsulinGlargine, 8, 0)!;
        Assert.Equal(WitnessStatus.Approved, insulin.WitnessStatus);
        Assert.Equal(Utc(sundayWitnessAnswer).UtcDateTime, insulin.WitnessRespondedAt);
    }

    /// <summary>
    /// The literals in this file, checked against the time-zone database rather than against the pack: each one is the wall-clock time it is
    /// labelled with, and Saturday's 08:04 and Sunday's are 23, 24 or 25 hours apart. A typo in a pin would otherwise pass a wrong offset.
    /// </summary>
    [Fact]
    public void TheLiteralInstants_AreTheWallClockTimesTheyAreLabelledWith()
    {
        static TimeOnly Wall(string state, string utc) => TimeOnly.FromDateTime(Odip.Domain.Rostering.ProviderLocalTime.UtcToLocal(Utc(utc).UtcDateTime, Zone(state)));
        foreach (var row in ClockChanges())
        {
            var (state, tick, saturday, sunday, answer) = ((string)row[0], (string)row[1], (string)row[3], (string)row[4], (string)row[5]);
            Assert.Equal(new TimeOnly(10, 30), Wall(state, tick));
            Assert.Equal(new TimeOnly(8, 4), Wall(state, saturday));
            Assert.Equal(new TimeOnly(8, 4), Wall(state, sunday));
            Assert.Equal(new TimeOnly(8, 30), Wall(state, answer));
        }
        Assert.Equal(new[] { 23.0, 24.0, 23.0, 25.0, 24.0, 25.0 }, ClockChanges().Select(r => (Utc((string)r[4]) - Utc((string)r[3])).TotalHours).ToArray());

        foreach (var row in LiveHoursEdges())
        {
            var wall = Wall((string)row[0], (string)row[1]);
            Assert.Contains(wall, new[] { new TimeOnly(5, 59), new TimeOnly(6, 0), new TimeOnly(22, 59), new TimeOnly(23, 0) });
            Assert.Equal(wall.Hour is >= 6 and < 23, (bool)row[2]);
        }
        foreach (var row in DoseBoundaries())
        {
            Assert.Equal(new TimeOnly(8, 6, 59), Wall((string)row[0], (string)row[2]));
            Assert.Equal(new TimeOnly(8, 7, 0), Wall((string)row[0], (string)row[3]));
        }
    }

    // ── 06:00 to 23:00 is the provider's clock, not a fixed offset ──

    public static IEnumerable<object[]> LiveHoursEdges() => new[]
    {
        new object[] { "NSW", "2026-10-01T19:59:00Z", false },     // Fri 2 Oct 05:59 AEST
        new object[] { "NSW", "2026-10-01T20:00:00Z", true },      // 06:00
        new object[] { "NSW", "2026-10-03T18:59:00Z", false },     // Sun 4 Oct 05:59 AEDT: an hour earlier in UTC than a +10 offset would say
        new object[] { "NSW", "2026-10-03T19:00:00Z", true },      // 06:00 AEDT
        new object[] { "NSW", "2026-10-04T11:59:00Z", true },      // 22:59 AEDT
        new object[] { "NSW", "2026-10-04T12:00:00Z", false },     // 23:00 AEDT
        new object[] { "QLD", "2026-10-03T19:59:00Z", false },     // Brisbane has no change: 06:00 is 20:00Z on both sides
        new object[] { "QLD", "2026-10-03T20:00:00Z", true },
        new object[] { "QLD", "2026-10-04T12:59:00Z", true },
        new object[] { "QLD", "2026-10-04T13:00:00Z", false },
        new object[] { "SA", "2026-10-03T19:29:00Z", false },      // 05:59 ACDT (+10:30)
        new object[] { "SA", "2026-10-03T19:30:00Z", true },
        new object[] { "SA", "2026-10-04T12:29:00Z", true },
        new object[] { "SA", "2026-10-04T12:30:00Z", false },
        new object[] { "NSW", "2027-04-03T19:59:00Z", false },     // Sun 4 Apr 2027 05:59 AEST: an hour LATER than a +11 offset would say
        new object[] { "NSW", "2027-04-03T20:00:00Z", true },
        new object[] { "NSW", "2027-04-04T12:59:00Z", true },
        new object[] { "NSW", "2027-04-04T13:00:00Z", false },
        new object[] { "SA", "2027-04-03T20:29:00Z", false },      // 05:59 ACST (+9:30)
        new object[] { "SA", "2027-04-03T20:30:00Z", true },
    };

    [Theory]
    [MemberData(nameof(LiveHoursEdges))]
    public async Task NothingIsRosteredOrScripted_BeforeSixOrFromTwentyThree_OnTheProvidersClock(string state, string utc, bool live)
    {
        var env = new DemoTestEnv(Utc(utc));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync(state);

        var result = await RunAsync(env, Utc(utc));

        Assert.Equal(live, result.RowsAdded.Keys.Any(k => k.StartsWith("live-set/", StringComparison.Ordinal)));
    }

    // ── a dose is written once its time is two minutes past, on the instant, in every zone ──

    public static IEnumerable<object[]> DoseBoundaries() => new[]
    {
        new object[] { "NSW", "2026-10-02", "2026-10-01T22:06:59Z", "2026-10-01T22:07:00Z" },     // an ordinary day, AEST
        new object[] { "NSW", "2026-10-04", "2026-10-03T21:06:59Z", "2026-10-03T21:07:00Z" },     // the day the clocks go forward: 08:07 AEDT
        new object[] { "QLD", "2026-10-04", "2026-10-03T22:06:59Z", "2026-10-03T22:07:00Z" },
        new object[] { "SA", "2026-10-04", "2026-10-03T21:36:59Z", "2026-10-03T21:37:00Z" },
        new object[] { "NSW", "2027-04-04", "2027-04-03T22:06:59Z", "2027-04-03T22:07:00Z" },     // the day they go back: 08:07 AEST
        new object[] { "SA", "2027-04-04", "2027-04-03T22:36:59Z", "2027-04-03T22:37:00Z" },
    };

    [Theory]
    [MemberData(nameof(DoseBoundaries))]
    public async Task ADoseIsWritten_AtTwoMinutesPastItsScriptedTime_NotASecondBefore(string state, string day, string before, string at)
    {
        var env = await TickAsync(Utc(before), state);
        var date = Date(day);

        var early = await RequireDayAsync(env, LiveSetCatalog.Morning, date, state);
        Assert.Null(early.Slot(MedicationCatalog.Levetiracetam, 8, 0));                                 // recorded 08:05, due 08:07:00
        Assert.NotNull(early.Completion);                                                                // but she has started, at 06:58

        await RunAsync(env, Utc(at));

        var on = await RequireDayAsync(env, LiveSetCatalog.Morning, date, state);
        Assert.NotNull(on.Slot(MedicationCatalog.Levetiracetam, 8, 0));
    }

    // ── approval by provider days, across the later change too ──

    [Theory]
    [InlineData("NSW", "2027-04-02T11:55:00Z", "2027-04-02", "2027-04-04T13:59:00Z", "2027-04-04T14:00:00Z")]       // Fri 22:55 AEDT; Sun 23:59 and Mon 00:00 AEST
    [InlineData("SA", "2027-04-02T12:25:00Z", "2027-04-02", "2027-04-04T14:29:00Z", "2027-04-04T14:30:00Z")]        // Fri 22:55 ACDT; Sun 23:59 and Mon 00:00 ACST
    [InlineData("QLD", "2027-04-02T12:55:00Z", "2027-04-02", "2027-04-04T13:59:00Z", "2027-04-04T14:00:00Z")]       // Brisbane: +10 throughout
    public async Task ApprovalTurnsOverAtTheProvidersMidnight_WhenTheClocksGoBack(string state, string fridayEvening, string friday, string sundayLate, string mondayStart)
    {
        var env = await TickAsync(Utc(fridayEvening), state);
        var date = Date(friday);
        async Task<List<ShiftStatus>> StatusesAsync()
        {
            await using var db = env.AdminDb();
            var ids = LiveSetCatalog.ShiftIds(new[] { date }).ToList();
            return (await db.Shifts.Where(s => ids.Contains(s.Id)).ToListAsync()).Select(s => s.Status).ToList();
        }
        Assert.All(await StatusesAsync(), s => Assert.Equal(ShiftStatus.PendingReview, s));

        await RunAsync(env, Utc(sundayLate));
        Assert.All(await StatusesAsync(), s => Assert.Equal(ShiftStatus.PendingReview, s));            // still two provider days back

        await RunAsync(env, Utc(mondayStart));
        Assert.All(await StatusesAsync(), s => Assert.Equal(ShiftStatus.Completed, s));                // three
    }
}
