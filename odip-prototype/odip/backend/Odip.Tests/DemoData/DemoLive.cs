using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>One live shift (plan 2.1) with everything the top-up scripted on it, read back from the database.</summary>
internal sealed record LiveDay(
    LiveStory Story, DateOnly Date, Shift Shift, User Worker, ShiftCompletion? Completion, List<MedicationAdministration> Doses,
    List<ShiftBreak> Breaks, List<ShiftNote> Notes, List<ShiftRoutineCheck> Ticks, List<HandoverAcknowledgement> Acks)
{
    /// <summary>The record of one scheduled slot of a medication, at a wall-clock time of the shift's day.</summary>
    public MedicationAdministration? Slot(Guid medicationId, int hour, int minute) =>
        Doses.SingleOrDefault(d => d.ParticipantMedicationId == medicationId && d.ScheduledAt == Date.ToDateTime(new TimeOnly(hour, minute), DateTimeKind.Unspecified));
}

/// <summary>Helpers shared by the live-set tests: run the production pack list at a clock, read a story's day back, and say what a stored instant means on the wall.</summary>
internal static class DemoLive
{
    /// <summary>Fri 2 Oct 2026, 10:30 AEST (00:30Z): the plan's worked example, the moment its "state at 10:30" tables describe.</summary>
    public static readonly DateTimeOffset Friday1030 = new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);

    public static readonly DateOnly Friday = new(2026, 10, 2);

    public static TimeZoneInfo Zone(string state = "NSW") => ProviderTimeZoneResolver.FromState(state).Zone;

    /// <summary>A fresh database (the fixture people, the old seed's rows unless told not to, the provider's state) ticked once, in production's pack order, at <paramref name="utc"/>.</summary>
    public static async Task<DemoTestEnv> TickAsync(DateTimeOffset utc, string state = "NSW", bool oldSeed = true)
    {
        var env = new DemoTestEnv(utc);
        await DemoFixture.SeedPeopleAsync(env, oldSeed);
        await env.SetProviderStateAsync(state);
        await RunAsync(env, utc);
        return env;
    }

    /// <summary>One more tick at <paramref name="utc"/>, which must run clean.</summary>
    public static async Task<DemoTickResult> RunAsync(DemoTestEnv env, DateTimeOffset utc)
    {
        env.Clock.Set(utc);
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.True(result.Failures.Count == 0, string.Join("; ", result.Failures.Select(f => f.Pack + ": " + f.Message)));
        return result;
    }

    /// <summary>The wall-clock time an instant is on the provider's clock (Kind Unspecified, as the app stores local times).</summary>
    public static DateTime Local(DateTime utc, string state = "NSW") => ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(utc), Zone(state));

    public static DateTime? Local(DateTime? utc, string state = "NSW") => utc is null ? null : Local(utc.Value, state);

    public static DateTime At(DateOnly date, int hour, int minute) => date.ToDateTime(new TimeOnly(hour, minute), DateTimeKind.Unspecified);

    /// <summary>The live shift of <paramref name="story"/> on <paramref name="date"/> with its rows, or null when it was never made.</summary>
    public static async Task<LiveDay?> DayAsync(DemoTestEnv env, LiveStory story, DateOnly date, string state = "NSW")
    {
        await using var db = env.AdminDb();
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == LiveSetCatalog.ShiftId(story, date));
        if (shift is null) return null;

        var worker = await db.Users.FirstAsync(u => u.Id == shift.UserId);
        var completion = await db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive);
        var completionId = completion?.Id;

        // The records the live set wrote for this shift: the participant's doses inside its window (a scheduled slot, or an as-needed dose given then).
        // The medication history writes the rest of the day's slots, by whoever was recorded, and those are not this shift's.
        var windowStart = At(date, story.Start.Hour, story.Start.Minute);
        var windowEnd = At(date, story.End.Hour, story.End.Minute);
        bool InWindow(MedicationAdministration a) => a.ScheduledAt is { } slot
            ? slot >= windowStart && slot < windowEnd
            : Local(a.AdministeredAt, state) is { } given && given >= windowStart && given < windowEnd;
        var doses = (await db.MedicationAdministrations.Where(a => a.ParticipantId == shift.ParticipantId).ToListAsync())
            .Where(a => a.IdempotencyKey != null && a.IdempotencyKey.StartsWith("demo-v1:") && InWindow(a))
            .OrderBy(a => a.CreatedAt).ToList();
        var breaks = await db.ShiftBreaks.Where(b => b.ShiftCompletionId == completionId).OrderBy(b => b.StartedAt).ToListAsync();
        var notes = await db.ShiftNotes.Where(n => n.ShiftId == shift.Id).OrderBy(n => n.CreatedAt).ToListAsync();
        var ticks = await db.ShiftRoutineChecks.Where(t => t.ShiftCompletionId == completionId).ToListAsync();
        var acks = await db.HandoverAcknowledgements.Where(a => a.ShiftId == shift.Id).ToListAsync();
        return new LiveDay(story, date, shift, worker, completion, doses, breaks, notes, ticks, acks);
    }

    /// <summary>The live day, which must exist.</summary>
    public static async Task<LiveDay> RequireDayAsync(DemoTestEnv env, LiveStory story, DateOnly date, string state = "NSW") =>
        await DayAsync(env, story, date, state) ?? throw new Xunit.Sdk.XunitException($"no {story.Key} shift on {date:yyyy-MM-dd}");
}
