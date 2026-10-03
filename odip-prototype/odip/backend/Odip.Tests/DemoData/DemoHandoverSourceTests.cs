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

    [Fact]
    public async Task EveryHandoverReadTheTopUpWrites_IsTheOneThePortalShowsThatReader_AndShowsAsRead()
    {
        var env = await TickAsync(Friday1030);
        for (var week = 1; week <= 2; week++) await RunAsync(env, Friday1030.AddDays(7 * week));
        await using var db = env.AdminDb();
        var service = new ShiftHandoverService(db, env.Clock);
        var shifts = await db.Shifts.ToDictionaryAsync(s => s.Id);
        var acks = await db.HandoverAcknowledgements.ToListAsync();

        Assert.True(acks.Count > 20, $"only {acks.Count} reads to look at");
        foreach (var ack in acks)
        {
            var shown = (await service.GetAsync(shifts[ack.ShiftId], ack.UserId, CancellationToken.None)).Latest;
            Assert.NotNull(shown);
            Assert.Equal(ack.SourceCompletionId, shown!.CompletionId);
            Assert.True(shown.IsRead, $"the portal does not show the read of {ack.UserId} on {shifts[ack.ShiftId].ServiceDate:yyyy-MM-dd}");
        }
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
