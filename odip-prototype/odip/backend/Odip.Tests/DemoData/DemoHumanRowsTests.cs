using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// A person's own row beside the script's (PR 2 review finding H1). The app has unique indexes on natural keys (one acknowledgement per reader and handover,
/// one running break per completion, one tick per completion, routine and occurrence), and a row a person makes in the portal has a random id where the
/// script's has a deterministic one, so a pack that decides "already written?" by its own id alone inserts a second row for the key, the database refuses it,
/// the whole pack rolls back, and the next tick does the same for good. EF InMemory does not refuse it by itself; <see cref="UniqueIndexEmulator"/> does, so
/// each test here is the scenario on the real path: the presenter acts, a later tick comes due, and nothing fails, the pack goes on, and the key has one row,
/// the presenter's.
/// </summary>
public class DemoHumanRowsTests
{
    private static readonly Guid MorningRoutine = Guid.Parse("74000000-0000-0000-0000-000000000002");           // the old seed's routine for Sophie's mornings (07:00)

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static DateTime LocalToUtc(DateTime local) => ProviderLocalTime.LocalToUtc(local, Zone());

    // ── the live set ──

    [Fact]
    public async Task APresenterWhoReadsTodaysEveningHandoverBeforeTheScript_LeavesOneAcknowledgement_AndTheLiveSetGoesOn()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                  // Fri 06:30: today's three shifts are cast, nobody has started
        var shiftId = LiveSetCatalog.ShiftId(LiveSetCatalog.Evening, Friday);
        Guid worker;
        await using (var db = env.DemoTenantDb())                                                 // a portal request: tenant-scoped, so the row is the Demo tenant's
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == shiftId);
            worker = shift.UserId!.Value;
            // The Evening worker opens the portal and marks yesterday's handover read, the app's own way (plan L3: the demo leaves it unread for them).
            Assert.Equal(HandoverAckOutcome.Ok, await new ShiftHandoverService(db, env.Clock).AcknowledgeAsync(shift, worker, null, CancellationToken.None));
        }

        await RunAsync(env, Utc("2026-10-02T05:30:00Z"));                                         // Fri 15:30: the script's own acknowledgement (15:20) has come due

        await using var check = env.AdminDb();
        var ack = Assert.Single(await check.HandoverAcknowledgements.Where(a => a.ShiftId == shiftId).ToListAsync());
        Assert.Equal(worker, ack.UserId);
        Assert.NotEqual(DemoIds.For("handover-ack", ack.SourceCompletionId, worker), ack.Id);                                // the presenter's row stays the one row
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Assert.NotNull(morning.Completion!.SubmittedAt);                                                                      // and the rest of the day was still worked
    }

    [Fact]
    public async Task APresenterWhoStartsTheShiftThemselves_LeavesOneActiveCompletion_AndTheScriptWorksTheShiftOnIt()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                  // Fri 06:30: Sophie's shift (06:58) has not started
        var shiftId = LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, Friday);
        var started = LocalToUtc(new DateTime(2026, 10, 2, 6, 50, 0, DateTimeKind.Unspecified));
        Guid completionId;
        await using (var db = env.AdminDb())
        {
            // The worker taps Start in the portal at 06:50: a completion with a random id, and the shift is InProgress, as the app leaves them.
            var shift = await db.Shifts.SingleAsync(s => s.Id == shiftId);
            var completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = started, TimeZoneId = Zone().Id, GeolocationDeclined = true, StartWasManual = false,
                SubmittedByUserId = shift.UserId!.Value, StartedAt = started, VarianceMinutesStart = -8, IsActive = true, CreatedAt = started, UpdatedAt = started,
            };
            completionId = completion.Id;
            db.ShiftCompletions.Add(completion);
            shift.Status = ShiftStatus.InProgress;
            shift.UpdatedAt = started;
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Utc("2026-10-01T22:00:00Z"));                                         // Fri 08:00: the script's acknowledgement (07:12) and tick (07:40) have come due

        await using var check = env.AdminDb();
        var completions = await check.ShiftCompletions.Where(c => c.ShiftId == shiftId).ToListAsync();
        Assert.Equal(completionId, Assert.Single(completions).Id);                                                            // the presenter's start is the one start
        Assert.NotEmpty(await check.ShiftRoutineChecks.Where(t => t.ShiftCompletionId == completionId).ToListAsync());        // and the script ticked the routine on it
        Assert.Equal(ShiftStatus.InProgress, (await check.Shifts.SingleAsync(s => s.Id == shiftId)).Status);
    }

    [Fact]
    public async Task APresenterWhoStartsABreakBeforeTheScript_LeavesOneRunningBreak_WhichTheShiftsEndThenEnds()
    {
        var env = await TickAsync(Utc("2026-10-01T23:00:00Z"));                                  // Fri 09:00: Harrison has been on shift since 08:12
        var started = new DateTime(2026, 10, 2, 9, 30, 0, DateTimeKind.Unspecified);
        Guid completionId;
        Guid presenterBreak;
        await using (var db = env.AdminDb())
        {
            var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == LiveSetCatalog.ShiftId(LiveSetCatalog.Insulin, Friday) && c.IsActive);
            completionId = completion.Id;
            var row = new ShiftBreak { Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftCompletionId = completion.Id, StartedAt = LocalToUtc(started), CreatedByUserId = completion.SubmittedByUserId };
            presenterBreak = row.Id;
            db.ShiftBreaks.Add(row);
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Utc("2026-10-02T00:30:00Z"));                                         // Fri 10:30: the script's running break (10:15) has come due
        await using (var mid = env.AdminDb())
            Assert.Equal(presenterBreak, Assert.Single(await mid.ShiftBreaks.Where(b => b.ShiftCompletionId == completionId && b.EndedAt == null).ToListAsync()).Id);

        await RunAsync(env, Utc("2026-10-02T04:30:00Z"));                                         // Fri 14:30: the shift has been finished

        await using var check = env.AdminDb();
        var breaks = await check.ShiftBreaks.Where(b => b.ShiftCompletionId == completionId).ToListAsync();
        var only = Assert.Single(breaks);
        Assert.Equal(presenterBreak, only.Id);
        Assert.NotNull(only.EndedAt);                                                                                         // the Finish blocker is gone: the running break was ended
    }

    [Fact]
    public async Task APresenterWhoTicksTheMorningRoutineBeforeTheScript_LeavesOneTick_AndTheLiveSetGoesOn()
    {
        var env = await TickAsync(Utc("2026-10-01T21:20:00Z"));                                  // Fri 07:20: Sophie has been on shift since 06:58
        var occurrence = new DateTime(2026, 10, 2, 7, 0, 0, DateTimeKind.Unspecified);
        Guid completionId;
        await using (var db = env.AdminDb())
        {
            var completion = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, Friday) && c.IsActive);
            completionId = completion.Id;
            db.ShiftRoutineChecks.Add(new ShiftRoutineCheck
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftCompletionId = completion.Id, ParticipantRoutineId = MorningRoutine, ScheduledAt = occurrence,
                RoutineTitle = "Morning routine", CheckedByUserId = completion.SubmittedByUserId, CheckedAt = LocalToUtc(occurrence.AddMinutes(30)),
            });
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Utc("2026-10-01T22:00:00Z"));                                         // Fri 08:00: the script's tick (07:40) has come due

        await using var check = env.AdminDb();
        var tick = Assert.Single(await check.ShiftRoutineChecks.Where(t => t.ShiftCompletionId == completionId).ToListAsync());
        Assert.Equal(occurrence, tick.ScheduledAt);
        Assert.NotEqual(DemoIds.For("shift-routine-check", completionId, MorningRoutine), tick.Id);                          // the presenter's
        Assert.NotEmpty(await check.HandoverAcknowledgements.Where(a => a.ShiftId == LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, Friday)).ToListAsync());     // and the rest of the morning was written
    }
}
