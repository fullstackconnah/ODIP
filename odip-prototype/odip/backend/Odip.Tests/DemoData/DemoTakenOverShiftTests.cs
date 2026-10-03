using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// Third independent review, R1 and R2: a live shift a person has taken over (started by hand, returned for correction, or moved to other times) is theirs, and "theirs"
/// has to mean one thing to every pack. The live set stopped working such a shift (second review X1) while the history went on waiting for it to be finished (X3) and
/// went on counting its window as the live set's: so a presenter who tapped Start on Charlotte's evening and moved on silenced the history's handover reads of her for
/// good, and left the evening's doses written by nobody. Each test is the presenter's action and what the demo's rows say afterwards.
/// </summary>
public class DemoTakenOverShiftTests
{
    private static readonly Guid Quetiapine = MedicationCatalog.IdOf("charlotte-quetiapine");

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static DateTime LocalToUtc(DateTime local) => ProviderLocalTime.LocalToUtc(local, Zone());

    /// <summary>The worker taps Start in the portal: a completion with a random id, and the shift InProgress, as the app leaves them.</summary>
    private static async Task StartByHandAsync(DemoTestEnv env, Guid shiftId, DateTime startLocal)
    {
        var started = LocalToUtc(startLocal);
        await using var db = env.AdminDb();
        var shift = await db.Shifts.SingleAsync(s => s.Id == shiftId);
        db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = started, TimeZoneId = Zone().Id, GeolocationDeclined = true, StartWasManual = false,
            SubmittedByUserId = shift.UserId!.Value, StartedAt = started, VarianceMinutesStart = -30, IsActive = true, CreatedAt = started, UpdatedAt = started,
        });
        shift.Status = ShiftStatus.InProgress;
        shift.UpdatedAt = started;
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// A closed shift of Charlotte, as the roster pack leaves one (the demo's completion id, submitted six minutes after its end) with a handover. The id is one whose read
    /// is not among the one in eight the history leaves unread.
    /// </summary>
    private static async Task<Guid> AddClosedShiftAsync(DemoTestEnv env, string key, string worker, DateTime startLocal, DateTime endLocal)
    {
        var shiftId = Enumerable.Range(0, 400).Select(i => DemoIds.For("fixture", key, i)).First(id => DemoIds.Pick(DemoIds.For("shift-completion", id), "unread", 0, 99) >= 12);
        var start = LocalToUtc(startLocal);
        var end = LocalToUtc(endLocal);
        var created = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
        await using var db = env.AdminDb();
        db.Shifts.Add(new Shift
        {
            Id = shiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("charlotte"), UserId = DemoFixture.StaffId(worker), ServiceDate = DateOnly.FromDateTime(startLocal),
            StartTime = TimeOnly.FromDateTime(startLocal), EndTime = TimeOnly.FromDateTime(endLocal), EndsNextDay = endLocal.Date > startLocal.Date, Status = ShiftStatus.Completed,
            CreatedAt = created, UpdatedAt = created,
        });
        db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = DemoIds.For("shift-completion", shiftId), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = start, ActualEnd = end, StartedAt = start, SubmittedAt = end.AddMinutes(6),
            TimeZoneId = Zone().Id, SubmittedByUserId = DemoFixture.StaffId(worker), HandoverText = $"Handover of {key}: settled evening, nothing outstanding.", NothingToHandOver = false,
            NothingToNoteConfirmed = true, IsActive = true, CreatedAt = end.AddMinutes(6), UpdatedAt = end.AddMinutes(6),
        });
        await db.SaveChangesAsync();
        return shiftId;
    }

    private static async Task<List<MedicationAdministration>> QuetiapineAtEightAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        return await db.MedicationAdministrations.Where(a => a.ParticipantMedicationId == Quetiapine && a.ScheduledAt == At(Friday, 20, 0)).ToListAsync();
    }

    private static async Task<List<HandoverAcknowledgement>> AcksOfAsync(DemoTestEnv env, Guid shiftId)
    {
        await using var db = env.AdminDb();
        return await db.HandoverAcknowledgements.Where(a => a.ShiftId == shiftId).ToListAsync();
    }

    [Fact]
    public void ARuleForEveryPack_ASmallTable()
    {
        var story = LiveSetCatalog.Evening;
        var id = LiveSetCatalog.ShiftId(story, Friday);
        bool Taken(DateOnly? serviceDate = null, TimeOnly? start = null, TimeOnly? end = null, bool nextDay = false, int returns = 0, Guid? completion = null) =>
            LiveSetCatalog.TakenOver(story, Friday, id, serviceDate ?? Friday, start ?? story.Start, end ?? story.End, nextDay, returns, completion);

        Assert.False(Taken());                                                                       // as the live set cast it
        Assert.False(Taken(completion: DemoIds.For("shift-completion", id)));                        // and as its own start left it
        Assert.True(Taken(completion: Guid.NewGuid()));                                              // a person's start
        Assert.True(Taken(returns: 1));                                                              // returned for correction
        Assert.True(Taken(start: story.Start.AddHours(-1)));                                         // moved by a coordinator
        Assert.True(Taken(end: story.End.AddHours(1)));
        Assert.True(Taken(serviceDate: Friday.AddDays(1)));
        Assert.True(Taken(nextDay: true));
    }

    [Fact]
    public async Task AEveningAPresenterStartedByHandAndNobodyFinished_DoesNotSilenceTheHistorysReadsOfCharlotte_AndItsDosesAreWrittenOnceItsWindowIsOver()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                      // Fri 06:30: Thursday's shifts are finished, Friday's are cast
        var thursday = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday.AddDays(-1));
        var evening = LiveSetCatalog.ShiftId(LiveSetCatalog.Evening, Friday);
        await StartByHandAsync(env, evening, At(Friday, 14, 30));                                    // an hour before the rostered start, as the portal allows, and never finished

        // A closed shift of Charlotte on Saturday, read by somebody other than the one whose handover it reads.
        var reader = new[] { "sarah", "marcus" }.First(key => DemoFixture.StaffId(key) != thursday.Worker.Id);
        var saturday = await AddClosedShiftAsync(env, "charlotte-saturday", reader, At(Friday.AddDays(1), 10, 0), At(Friday.AddDays(1), 14, 0));

        await RunAsync(env, Utc("2026-10-02T05:30:00Z"));                                            // Fri 15:30
        await RunAsync(env, Utc("2026-10-02T10:30:00Z"));                                            // Fri 20:30: the window is not over, and the person is working it
        Assert.Empty(await QuetiapineAtEightAsync(env));
        await RunAsync(env, Utc("2026-10-02T12:00:00Z"));                                            // Fri 22:00: it is over, and nobody recorded the evening dose
        var dose = Assert.Single(await QuetiapineAtEightAsync(env));
        Assert.Null(dose.SupersededByAdministrationId);

        await RunAsync(env, Utc("2026-10-03T10:00:00Z"));                                            // Sat 20:00
        var ack = Assert.Single(await AcksOfAsync(env, saturday));                                   // not silenced for good by the shift nobody finished
        Assert.Equal(thursday.Completion!.Id, ack.SourceCompletionId);                               // the handover the portal showed: Thursday's, the latest one submitted

        await RunAsync(env, Utc("2026-10-10T09:00:00Z"));                                            // a week later
        Assert.Single(await AcksOfAsync(env, saturday));
        Assert.Single(await QuetiapineAtEightAsync(env));

        await using var check = env.AdminDb();
        Assert.Equal(ShiftStatus.InProgress, (await check.Shifts.SingleAsync(s => s.Id == evening)).Status);                 // still theirs
        Assert.Null((await check.ShiftCompletions.SingleAsync(c => c.ShiftId == evening)).SubmittedAt);
    }

    [Fact]
    public async Task ALiveShiftTheLiveSetHasNotFinished_HoldsOnlyTheReadersBetweenItAndTheParticipantsNextSubmittedShift()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                      // Fri 06:30: Friday's evening is cast, and the host is then down
        var thursday = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday.AddDays(-1));
        var evening = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday);
        Assert.Equal(ShiftStatus.Published, evening.Shift.Status);

        // Two closed shifts of Charlotte after the evening shift, one submitted before the next starts: the first's reader waits for the evening shift (its handover is the
        // one the portal showed, once the live set has finished it); the second reads the first's, which is later than the evening shift, whatever becomes of that.
        var night = await AddClosedShiftAsync(env, "charlotte-night", "sarah", At(Friday, 22, 0), At(Friday.AddDays(1), 2, 0));
        var small = await AddClosedShiftAsync(env, "charlotte-small-hours", "marcus", At(Friday.AddDays(1), 2, 30), At(Friday.AddDays(1), 4, 30));

        await RunAsync(env, Utc("2026-10-02T19:30:00Z"));                                            // Sat 05:30: before the live hours, the live set has not caught up
        Assert.Empty(await AcksOfAsync(env, night));                                                 // waits for the live shift before it
        var read = Assert.Single(await AcksOfAsync(env, small));                                     // nothing unfinished lies between the night shift and this one
        Assert.Equal(DemoIds.For("shift-completion", night), read.SourceCompletionId);

        await RunAsync(env, Utc("2026-10-02T20:30:00Z"));                                            // Sat 06:30: the live set finishes Friday's evening, and the history reads it
        var late = Assert.Single(await AcksOfAsync(env, night));
        var finished = await RequireDayAsync(env, LiveSetCatalog.Evening, Friday);
        Assert.NotNull(finished.Completion!.SubmittedAt);
        Assert.Equal(finished.Completion.Id, late.SourceCompletionId);
        Assert.Equal(thursday.Shift.Id, LiveSetCatalog.ShiftId(LiveSetCatalog.Evening, Friday.AddDays(-1)));
    }

    [Fact]
    public async Task AnEveningACoordinatorMovedAnHourEarlier_IsTheirs_TheScriptDoesNotWorkItAtTheStoryTimes_AndItsEveningDoseIsStillRecorded()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                      // Fri 06:30: Friday's evening (15:00 to 21:00) is cast
        var evening = LiveSetCatalog.ShiftId(LiveSetCatalog.Evening, Friday);
        await using (var db = env.AdminDb())                                                         // the board's edit: allowed while the shift is Published
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == evening);
            shift.StartTime = new TimeOnly(14, 0);
            shift.EndTime = new TimeOnly(20, 0);
            shift.UpdatedAt = LocalToUtc(At(Friday, 6, 45));
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Utc("2026-10-02T04:30:00Z"));                                            // Fri 14:30
        await RunAsync(env, Utc("2026-10-02T09:30:00Z"));                                            // Fri 19:30
        await RunAsync(env, Utc("2026-10-02T11:30:00Z"));                                            // Fri 21:30: the story's window (to 21:00) is not over for 15 more minutes
        Assert.Empty(await QuetiapineAtEightAsync(env));
        await RunAsync(env, Utc("2026-10-02T12:00:00Z"));                                            // Fri 22:00

        Assert.Single(await QuetiapineAtEightAsync(env));                                            // written by the history: the moved window would have left 20:00 to nobody
        await using var check = env.AdminDb();
        Assert.Equal(ShiftStatus.Published, (await check.Shifts.SingleAsync(s => s.Id == evening)).Status);   // never started, at the story's times or any
        Assert.Empty(await check.ShiftCompletions.Where(c => c.ShiftId == evening).ToListAsync());
        Assert.Empty(await check.ShiftNotes.Where(n => n.ShiftId == evening).ToListAsync());
        Assert.Empty(await check.HandoverAcknowledgements.Where(a => a.ShiftId == evening).ToListAsync());
    }
}
