using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// PR 2 review L3: the handover a reader is shown is the app's, not the story's. <c>ShiftHandoverService.GetAsync</c> takes the latest handover from the most
/// recent shift of the participant that started before the reader's, across ALL the participant's shifts; the top-up used to pair a live shift with the same
/// story's day before and a closed shift with the pack's own previous one, so a night shift that came in between made the portal show the night's handover as
/// unread while the top-up said the morning's had been read. These tests hold both packs to the app's own answer.
/// </summary>
public class DemoHandoverSourceTests
{
    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    [Fact]
    public async Task TheRule_GivesTheAppsAnswer_ForEveryShiftTheTopUpHasWritten()
    {
        var env = await TickAsync(Friday1030);
        for (var week = 1; week <= 2; week++) await RunAsync(env, Friday1030.AddDays(7 * week));
        await using var db = env.AdminDb();
        var service = new ShiftHandoverService(db, env.Clock);
        var shifts = await db.Shifts.ToListAsync();
        var sources = await DemoQueries.HandoverSourcesOf(db, shifts.Select(s => s.ParticipantId).Distinct().ToList(), DateOnly.MinValue).ToListAsync();

        var withHandover = 0;
        foreach (var shift in shifts)
        {
            var theApps = (await service.GetAsync(shift, Guid.NewGuid(), CancellationToken.None)).Latest?.CompletionId;
            var ours = HandoverSourceRule.LatestBefore(sources, shift.ParticipantId, shift.Id, shift.ServiceDate, shift.StartTime)?.CompletionId;
            Assert.Equal(theApps, ours);
            if (ours is not null) withHandover++;
        }
        Assert.True(withHandover > 100, $"only {withHandover} of {shifts.Count} shifts had a handover to compare");
    }

    /// <summary>
    /// A read names the handover the portal showed at the moment of the read (the app's rule over the completions submitted by then), and the portal agrees with it now
    /// wherever nothing was submitted since: a shift that started earlier but was submitted after the read (a roster shift closed late) is what the portal shows now,
    /// which is the reader's next handover to read, not a different read.
    /// </summary>
    [Fact]
    public async Task EveryHandoverReadTheTopUpWrites_IsTheOneThePortalShowedThatReaderAtTheTime_AndTheOneItShowsNowUnlessALaterSubmissionChangedIt()
    {
        var env = await TickAsync(Friday1030);
        for (var week = 1; week <= 2; week++) await RunAsync(env, Friday1030.AddDays(7 * week));
        await using var db = env.AdminDb();
        var service = new ShiftHandoverService(db, env.Clock);
        var shifts = await db.Shifts.ToDictionaryAsync(s => s.Id);
        var acks = await db.HandoverAcknowledgements.ToListAsync();
        var sources = await DemoQueries.HandoverSourcesOf(db, shifts.Values.Select(s => s.ParticipantId).Distinct().ToList(), DateOnly.MinValue).ToListAsync();

        Assert.True(acks.Count > 20, $"only {acks.Count} reads to look at");
        var agreeNow = 0;
        foreach (var ack in acks)
        {
            var shift = shifts[ack.ShiftId];
            var atTheTime = HandoverSourceRule.LatestBefore(sources.Where(s => s.SubmittedAt < ack.AcknowledgedAt), shift.ParticipantId, shift.Id, shift.ServiceDate, shift.StartTime);
            Assert.Equal(atTheTime?.CompletionId, ack.SourceCompletionId);                                                   // what the portal showed when it was read

            var shown = (await service.GetAsync(shift, ack.UserId, CancellationToken.None)).Latest;
            Assert.NotNull(shown);
            if (shown!.CompletionId == ack.SourceCompletionId)
            {
                Assert.True(shown.IsRead, $"the portal does not show the read of {ack.UserId} on {shift.ServiceDate:yyyy-MM-dd}");
                agreeNow++;
            }
            else
            {
                Assert.True(sources.Single(s => s.CompletionId == shown.CompletionId).SubmittedAt >= ack.AcknowledgedAt, "the portal shows another handover now, and it was not submitted after the read");
            }
        }
        Assert.True(agreeNow * 10 >= acks.Count * 9, $"the portal agrees with only {agreeNow} of {acks.Count} reads");
    }

    /// <summary>
    /// Independent review S1: the handover a read names is the one the portal showed AT the read, and the rows the top-up writes must be the same whatever the ticks
    /// were. Charlotte has a roster shift on Friday 9 October (14:00 to 22:00, the "leave pending" story of the pack week), which the roster pack closes at the first
    /// tick after 22:45 with a submit time of about 22:00, after the live evening reads at 15:20. With hourly ticks the read names Thursday evening's handover, the one
    /// the portal showed. With no tick between Thursday night and Saturday morning the roster shift is closed just before the live set runs, is the latest shift by the
    /// app's rule, and was not yet submitted at the read: choosing the latest first and then asking whether it was submitted wrote no read at all.
    /// </summary>
    [Fact]
    public async Task TheReadsOfAFriday_AreTheSame_WhetherTheTicksWereHourlyOrTheHostWasDownUntilSaturdayMorning()
    {
        var friday = new DateOnly(2026, 10, 9);
        var untilThursdayNight = Enumerable.Range(1, 6).Select(d => Friday1030.AddDays(d)).Append(Utc("2026-10-08T12:00:00Z")).ToList();       // daily to Thu 8 Oct 11:30, then Thu 23:00
        var fridayTicks = new[] { "2026-10-08T19:30:00Z", "2026-10-09T04:30:00Z", "2026-10-09T12:00:00Z" };                                      // Fri 06:30, 15:30, 23:00 (AEDT)
        var saturdayMorning = Utc("2026-10-09T21:00:00Z");                                           // Sat 10 Oct 08:00 AEDT

        var hourly = await TickAsync(Friday1030);
        foreach (var tick in untilThursdayNight.Concat(fridayTicks.Select(Utc)).Append(saturdayMorning)) await RunAsync(hourly, tick);
        var gap = await TickAsync(Friday1030);
        foreach (var tick in untilThursdayNight.Append(saturdayMorning)) await RunAsync(gap, tick);                                          // the host was down all Friday

        // The handover each live shift of the Friday read (null: it read nothing). Who works a shift cast after the fact can differ, so the reader is not compared.
        async Task<Dictionary<string, Guid?>> FridayReadsAsync(DemoTestEnv env)
        {
            await using var db = env.AdminDb();
            var acks = await db.HandoverAcknowledgements.ToListAsync();
            return LiveSetCatalog.Stories.ToDictionary(s => s.Key, s => acks.SingleOrDefault(a => a.ShiftId == LiveSetCatalog.ShiftId(s, friday))?.SourceCompletionId);
        }

        var withHourlyTicks = await FridayReadsAsync(hourly);
        Assert.True(withHourlyTicks.Values.Count(source => source is not null) >= 2, "fewer than two reads on the Friday to compare");
        Assert.Equal(withHourlyTicks, await FridayReadsAsync(gap));
    }

    /// <summary>
    /// Second independent review X3: the live set starts, scripts and finishes shifts only between 06:00 and 23:00, while the history closes readers at any hour. A tick
    /// outside the live hours that follows a gap computes the history's read against sources the live set has not finished yet; at the first tick after 06:00 the live set
    /// finishes the shift with its scripted submit time, the choice moves, and the history wrote a second read for the same reader (a different handover, so a new id).
    /// A reader is held back while a live shift of their participant that started before theirs is not finished.
    /// </summary>
    [Fact]
    public async Task AHistoryReadIsTheSame_WhetherTheLiveShiftBeforeItFinishedByHourlyTicksOrAtTheFirstTickAfterSix()
    {
        var fridayMorning = Utc("2026-10-01T20:30:00Z");                                           // Fri 06:30 AEST: Thursday's shifts are finished, Friday's are cast
        var zone = Zone();

        // Harrison's shift of Friday afternoon (15:00 to 19:00), closed with a handover: its reader is a coordinator the live insulin shift (08:00 to 14:00) does not use, and
        // reads after that shift was submitted. The id is one whose read is not among the one in eight the history leaves unread.
        var shiftId = Enumerable.Range(0, 400).Select(i => DemoIds.For("fixture", "harrison-afternoon", i)).First(id => DemoIds.Pick(DemoIds.For("shift-completion", id), "unread", 0, 99) >= 12);
        void AddAfternoonShift(Microsoft.EntityFrameworkCore.DbContext db)
        {
            var start = ProviderLocalTime.LocalToUtc(At(Friday, 15, 2), zone);
            var end = ProviderLocalTime.LocalToUtc(At(Friday, 19, 3), zone);
            db.Add(new Odip.Domain.Rostering.Shift
            {
                Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("harrison"), UserId = DemoFixture.StaffId("sarah"), ServiceDate = Friday,
                StartTime = new TimeOnly(15, 0), EndTime = new TimeOnly(19, 0), Status = Odip.Domain.Rostering.ShiftStatus.Completed,
                CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
            });
            db.Add(new Odip.Domain.Rostering.ShiftCompletion
            {
                Id = DemoIds.For("shift-completion", shiftId), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start,
                SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id, SubmittedByUserId = DemoFixture.StaffId("sarah"), NothingToNoteConfirmed = true, IsActive = true,
                CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddMinutes(6),
            });
        }

        // Hourly ticks: the live insulin shift is finished by 14:35, and the afternoon shift is closed and read at 20:00.
        var hourly = await TickAsync(fridayMorning);
        await RunAsync(hourly, Utc("2026-10-02T04:35:00Z"));                                         // Fri 14:35
        await using (var db = hourly.AdminDb()) { AddAfternoonShift(db); await db.SaveChangesAsync(); }
        await RunAsync(hourly, Utc("2026-10-02T10:00:00Z"));                                         // Fri 20:00

        // The host was down all day: the first tick back is at 23:30 (outside the live hours), the next at 06:30.
        var gap = await TickAsync(fridayMorning);
        await using (var db = gap.AdminDb()) { AddAfternoonShift(db); await db.SaveChangesAsync(); }
        await RunAsync(gap, Utc("2026-10-02T13:30:00Z"));                                            // Fri 23:30 (UTC+10), after the live hours
        await RunAsync(gap, Utc("2026-10-02T20:30:00Z"));                                            // Sat 06:30

        async Task<List<(Guid Source, Guid Reader)>> ReadsOfTheAfternoonAsync(DemoTestEnv env)
        {
            await using var db = env.AdminDb();
            return (await db.HandoverAcknowledgements.Where(a => a.ShiftId == shiftId).ToListAsync()).Select(a => (a.SourceCompletionId, a.UserId)).OrderBy(a => a.SourceCompletionId).ToList();
        }

        var withHourlyTicks = await ReadsOfTheAfternoonAsync(hourly);
        Assert.Single(withHourlyTicks);                                                              // the live insulin shift's handover, which the portal showed at the read
        Assert.Equal(withHourlyTicks, await ReadsOfTheAfternoonAsync(gap));
    }

    [Fact]
    public async Task AMondayMorningWorker_ReadsTheNightShiftsHandover_NotLastSundaysMorning()
    {
        // Mon 5 Oct 2026 08:00 AEDT (the clocks went forward on Sunday). Sophie had a Sunday night shift (22:00 to 06:45) whose worker handed over at 06:53:
        // for Monday's 07:00 shift that is the latest handover, later than Sunday's own morning shift.
        var monday = Utc("2026-10-04T21:00:00Z");
        var env = new DemoTestEnv(monday);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var zone = Zone();
        var shiftId = DemoIds.For("fixture", "sunday-night");
        var start = ProviderLocalTime.LocalToUtc(At(new DateOnly(2026, 10, 4), 22, 2), zone);
        var end = ProviderLocalTime.LocalToUtc(At(new DateOnly(2026, 10, 5), 6, 47), zone);
        var night = DemoIds.For("shift-completion", shiftId);
        await using (var db = env.AdminDb())
        {
            db.Shifts.Add(new Shift
            {
                Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), UserId = DemoFixture.StaffId("rachel"), ServiceDate = new DateOnly(2026, 10, 4),
                StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 45), EndsNextDay = true, Status = ShiftStatus.PendingReview,
                CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = end,
            });
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = night, TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start, SubmittedAt = end.AddMinutes(6), TimeZoneId = zone.Id,
                SubmittedByUserId = DemoFixture.StaffId("rachel"), HandoverText = "Slept through. Please check the front door lock when you arrive.", NothingToHandOver = false,
                NothingToNoteConfirmed = true, IsActive = true, CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddMinutes(6),
            });
            await db.SaveChangesAsync();
        }

        await RunAsync(env, monday);

        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, new DateOnly(2026, 10, 5));
        var ack = Assert.Single(morning.Acks);
        Assert.Equal(night, ack.SourceCompletionId);                                                       // the night's handover, not Sunday's live morning
        Assert.Equal(morning.Worker.Id, ack.UserId);
        await using var check = env.AdminDb();
        var shown = (await new ShiftHandoverService(check, env.Clock).GetAsync(morning.Shift, morning.Worker.Id, CancellationToken.None)).Latest!;
        Assert.Equal(night, shown.CompletionId);
        Assert.True(shown.IsRead, "and the portal agrees that the morning worker has read it");
    }
}
