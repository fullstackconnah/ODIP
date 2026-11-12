using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;

namespace Odip.Infrastructure.Services;

/// <summary>
/// A stretch of provider-local wall-clock time on a shift's service date, in the form the shift price estimator takes. <see cref="StartFirstPass"/> / <see cref="EndFirstPass"/> say a worked edge fell in the
/// first pass of the hour the clocks repeat (a wall time alone cannot); only <see cref="ShiftClaimWindow"/> sets them, from the stored instant.
/// </summary>
public sealed record ClaimSpan(DateTime StartLocal, DateTime EndLocal, bool StartFirstPass = false, bool EndFirstPass = false)
{
    public TimeOnly Start => TimeOnly.FromDateTime(StartLocal);
    public TimeOnly End => TimeOnly.FromDateTime(EndLocal);
    public bool EndsNextDay => EndLocal.Date > StartLocal.Date;
}

/// <summary>
/// What a shift claim prices: <see cref="Priced"/>. When approved extra time is in it, <see cref="WithoutExtra"/> is the window the claim falls back to if the extra time must be left out (the pay rule's
/// hold, <c>PaidWindow</c> with a Pending decision) and <see cref="ExtraText"/> names it; <see cref="CannotClaimExtraBecause"/> says why approved extra time could not be put in a window the estimator takes.
/// </summary>
public sealed record ClaimWindow(ClaimSpan Priced, ClaimSpan? WithoutExtra = null, string? ExtraText = null, string? CannotClaimExtraBecause = null);

/// <summary>
/// The window a shift is claimed on (W2 PR3): the hours worked, the same window Employment Hero is paid on (<c>EmploymentHeroTimesheets.PaidWindow</c>), with extra time over 5 minutes claimed only once approved.
/// Sleepovers and passive nights, and a shift without a finished completion, stay at their rostered times. Pure apart from <see cref="LoadAsync"/>.
/// </summary>
public static class ShiftClaimWindow
{
    public static ClaimSpan Rostered(Shift s) => new(s.ServiceDate.ToDateTime(s.StartTime), s.ServiceDate.AddDays(s.EndsNextDay ? 1 : 0).ToDateTime(s.EndTime));

    /// <summary>The active, finished completions of the shifts, by shift id. Read through the tenant-filtered set, so another organisation's shift id returns nothing.</summary>
    public static async Task<Dictionary<Guid, ShiftCompletion>> LoadAsync(OdipDbContext db, IReadOnlyCollection<Guid> shiftIds, CancellationToken ct)
    {
        if (shiftIds.Count == 0) return new();
        var rows = await db.ShiftCompletions.AsNoTracking().Where(c => c.IsActive && c.ActualEnd != null && shiftIds.Contains(c.ShiftId)).ToListAsync(ct);
        return rows.GroupBy(c => c.ShiftId).ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.StartedAt).First());
    }

    /// <summary>The window to claim <paramref name="s"/> on, in <paramref name="zone"/> (the zone the estimator prices the shift in). A null decision counts as Pending, like a worker's time not yet reviewed.</summary>
    public static ClaimWindow For(Shift s, ShiftCompletion? c, TimeZoneInfo zone)
    {
        var rostered = Rostered(s);
        if (c?.ActualEnd is null || s.NightType is SleepoverType.Sleepover or SleepoverType.PassiveNight) return new(rostered);
        var held = Express(s, c, EmploymentHeroTimesheets.PaidWindow(s, c, zone, ExtraTimeDecision.Pending), zone) ?? rostered;
        if (c.ExtraTime != ExtraTimeDecision.Approved || !ShiftTimeRules.HasExtraTime(c.VarianceMinutesStart, c.VarianceMinutesEnd)) return new(held);
        var approved = Express(s, c, EmploymentHeroTimesheets.PaidWindow(s, c, zone, ExtraTimeDecision.Approved), zone);
        if (approved is null) return new(held, null, null, "The extra time runs outside the shift's own date, which a shift claim cannot price");
        if (approved == held) return new(held);
        var text = ExtraTextOf(held, approved, zone);
        return text is null ? new(held) : new(approved, held, text);
    }

    /// <summary>"Extra time 08:40–09:00, 17:00–17:20 · 40 min": the minutes the approved window adds to the held one.</summary>
    private static string? ExtraTextOf(ClaimSpan held, ClaimSpan approved, TimeZoneInfo zone)
    {
        var parts = new List<string>();
        var minutes = 0;
        // Elapsed minutes, not wall-clock: a stretch is added when it has length in real time, and it is an hour out across the clock change.
        var before = ShiftBands.ElapsedMinutes(approved.StartLocal, held.StartLocal, zone, approved.StartFirstPass, held.StartFirstPass);
        var after = ShiftBands.ElapsedMinutes(held.EndLocal, approved.EndLocal, zone, held.EndFirstPass, approved.EndFirstPass);
        if (before > 0) { parts.Add(Stretch(approved.StartLocal, held.StartLocal, before)); minutes += before; }
        if (after > 0) { parts.Add(Stretch(held.EndLocal, approved.EndLocal, after)); minutes += after; }
        if (parts.Count == 0) return null;   // no added stretch has length in real time
        return string.Create(CultureInfo.InvariantCulture, $"Extra time {string.Join(", ", parts)} · {minutes:0} min");
    }

    /// <summary>"02:30–02:30 (clocks went back)": a stretch's printed range, marked when its real minutes differ from the wall-clock minutes between the printed times (modulo a day).</summary>
    private static string Stretch(DateTime from, DateTime to, int elapsed)
    {
        var wall = (int)(((to.TimeOfDay - from.TimeOfDay).TotalMinutes % 1440 + 1440) % 1440);
        return $"{from:HH:mm}–{to:HH:mm}{(elapsed > wall ? " (clocks went back)" : elapsed < wall ? " (clocks went forward)" : "")}";
    }

    /// <summary>
    /// A paid window as the estimator takes it: a side held back is the rostered wall time (the same instant, with no zone conversion to go wrong), a side worked is converted to the shift's zone and cut to the minute.
    /// Null when it is not a window on the shift's own date (it starts on another day, ends after the next day, or is empty).
    /// </summary>
    private static ClaimSpan? Express(Shift s, ShiftCompletion c, (DateTime Start, DateTime End, bool Held) paid, TimeZoneInfo zone)
    {
        var rostered = Rostered(s);
        var workedStart = paid.Start == c.ActualStart;
        var workedEnd = paid.End == (c.ActualEnd ?? c.ActualStart);
        var start = workedStart ? LocalMinute(paid.Start, zone) : rostered.StartLocal;
        var end = workedEnd ? LocalMinute(paid.End, zone) : rostered.EndLocal;
        var service = s.ServiceDate.ToDateTime(TimeOnly.MinValue);
        if (start.Date != service || end <= start || end.Date > service.AddDays(1)) return null;
        return end.Date > start.Date && end.TimeOfDay > start.TimeOfDay ? null : new ClaimSpan(start, end, workedStart && FirstPass(start, paid.Start, zone), workedEnd && FirstPass(end, paid.End, zone));
    }

    /// <summary>True when the stored instant is the first pass of an ambiguous wall time: the later reading of that wall time is after it.</summary>
    private static bool FirstPass(DateTime wall, DateTime utc, TimeZoneInfo zone) =>
        zone.IsAmbiguousTime(wall) && ProviderLocalTime.LocalToUtc(wall, zone) > new DateTime(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMinute, DateTimeKind.Utc);

    private static DateTime LocalMinute(DateTime utc, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
        return new DateTime(local.Ticks - local.Ticks % TimeSpan.TicksPerMinute);
    }
}
