using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// One break a worker took during a shift, recorded against the shift's ACTIVE <see cref="ShiftCompletion"/>
/// (so a Return, which archives the completion, archives its breaks with it). Times are UTC instants.
///
/// A break is either paid (<see cref="WithParticipant"/>: ate with the participant, counted as worked) or unpaid
/// (on my own: deducted from pay by <see cref="ShiftBreakRules.NetWorked"/>, the one rule Payroll, Reports and the
/// completion record all read). A claim covers the ROSTERED window minus the breaks taken alone inside it (<see cref="ShiftBreakRules.UnclaimedSpans"/>);
/// breaks with the participant are still claimed.
///
/// At most ONE break per completion may be running (<see cref="EndedAt"/> null); a partial unique index
/// (<see cref="OneRunningIndexName"/>) enforces it in the database, the service checks it first so the worker
/// gets a clear 409 rather than a constraint error. Audited (see AuditedEntities).
/// </summary>
public class ShiftBreak : ITenantEntity
{
    /// <summary>Partial unique index on ShiftCompletionId WHERE "EndedAt" IS NULL — at most one running break per completion.</summary>
    public const string OneRunningIndexName = "IX_ShiftBreaks_ShiftCompletionId_Running";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ShiftCompletionId { get; set; }
    public ShiftCompletion? ShiftCompletion { get; set; }

    /// <summary>UTC. Server-stamped when the break is started; editable (within the rules) before Finish.</summary>
    public DateTime StartedAt { get; set; }

    /// <summary>UTC. Null while the break is running.</summary>
    public DateTime? EndedAt { get; set; }

    /// <summary>The worker who created the break — the shift's own worker.</summary>
    public Guid CreatedByUserId { get; set; }

    /// <summary>Set when the times were edited after creation (PUT), so a coordinator can see a break was adjusted.</summary>
    public DateTime? EditedAt { get; set; }

    /// <summary>Ate with the participant: paid, counted as worked (and, from the claims PR, claimed). False = on my own: unpaid and
    /// deducted from pay. Old rows read as false, which is what they were paid as before this column existed. Changing it is not an
    /// "edit" of the times, so it leaves <see cref="EditedAt"/> alone.</summary>
    public bool WithParticipant { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public bool IsRunning => EndedAt is null;
}

public enum ShiftBreakViolation
{
    None,

    /// <summary>The break starts before the shift's actual start.</summary>
    BeforeShiftStart,

    /// <summary>The break starts or ends in the future (beyond a small device-clock-skew allowance).</summary>
    InFuture,

    /// <summary>The break ends at or before it starts.</summary>
    EndNotAfterStart,

    /// <summary>The break overlaps another break of the same shift.</summary>
    Overlap,

    /// <summary>An already-ended break was edited to have no end; only a running break may have none.</summary>
    EndRequired,

    /// <summary>A client-recorded time is more than <see cref="ClientTimeRules.MaxAge"/> old.</summary>
    ClientTimeTooOld,
}

/// <summary>
/// Pure break rules and arithmetic: a break must sit inside the shift's actual window (from the actual start up to
/// now, since breaks are only recorded or edited while the shift is in progress), must not overlap another break,
/// and net worked time is the worked span minus the breaks.
/// </summary>
public static class ShiftBreakRules
{
    /// <summary>Same device-clock-skew allowance as the shift's manual-start rule (Finish accepts a start up to 5 minutes ahead).</summary>
    public static readonly TimeSpan ClockSkewAllowance = TimeSpan.FromMinutes(5);

    /// <summary>Normalises a client-supplied instant to UTC: an unsuffixed value is treated as UTC (the codebase's F4
    /// rule - Npgsql persists Kind verbatim), a Local value is converted.</summary>
    public static DateTime ToUtc(DateTime value) => ProviderLocalTime.AsUtc(value);

    /// <summary>Whole minutes of a span, rounded half away from zero.</summary>
    public static int WholeMinutes(TimeSpan span) => (int)Math.Round(span.TotalMinutes, MidpointRounding.AwayFromZero);

    /// <param name="startedAtUtc">Proposed break start (UTC).</param>
    /// <param name="endedAtUtc">Proposed break end (UTC), or null for a running break.</param>
    /// <param name="actualStartUtc">The shift's actual start (<see cref="ShiftCompletion.ActualStart"/>).</param>
    /// <param name="nowUtc">The current instant: the upper bound of the window while the shift is in progress.</param>
    /// <param name="others">The shift's OTHER breaks (exclude the one being edited).</param>
    public static ShiftBreakViolation Validate(
        DateTime startedAtUtc, DateTime? endedAtUtc, DateTime actualStartUtc, DateTime nowUtc, IEnumerable<ShiftBreak> others)
    {
        if (startedAtUtc < actualStartUtc) return ShiftBreakViolation.BeforeShiftStart;

        var limit = nowUtc + ClockSkewAllowance;
        if (startedAtUtc > limit || (endedAtUtc is { } end && end > limit)) return ShiftBreakViolation.InFuture;

        if (endedAtUtc is { } e && e <= startedAtUtc) return ShiftBreakViolation.EndNotAfterStart;

        // A running break is open-ended: treat its end as "never" so it overlaps anything that starts after it.
        var candidateEnd = endedAtUtc ?? DateTime.MaxValue;
        foreach (var other in others)
        {
            var otherEnd = other.EndedAt ?? DateTime.MaxValue;
            if (startedAtUtc < otherEnd && other.StartedAt < candidateEnd) return ShiftBreakViolation.Overlap;
        }

        return ShiftBreakViolation.None;
    }

    /// <summary>
    /// Worked minutes for a completion: the span from the actual start to the actual end (or <paramref name="nowUtc"/>
    /// while the shift is still in progress) minus the time spent on breaks ON MY OWN (a break <see cref="ShiftBreak.WithParticipant"/>
    /// is paid and counts as worked, so <c>BreakMinutes</c> is unpaid minutes only). A running break counts up to now; every
    /// break is clamped to the worked span. Whole minutes, rounded half away from zero, with
    /// <c>Net = Gross - Break</c> exactly so the three numbers always add up on screen.
    /// </summary>
    public static (int GrossMinutes, int BreakMinutes, int NetMinutes) NetWorked(
        DateTime actualStartUtc, DateTime? actualEndUtc, DateTime nowUtc, IEnumerable<ShiftBreak> breaks)
    {
        var end = actualEndUtc ?? nowUtc;
        if (end < actualStartUtc) end = actualStartUtc;

        var breakSpan = TimeSpan.Zero;
        foreach (var b in breaks.Where(b => !b.WithParticipant))   // a break with the participant is paid, so it is not deducted
        {
            var from = b.StartedAt < actualStartUtc ? actualStartUtc : b.StartedAt;
            var to = b.EndedAt ?? end;
            if (to > end) to = end;
            if (to > from) breakSpan += to - from;
        }

        var gross = (int)Math.Round((end - actualStartUtc).TotalMinutes, MidpointRounding.AwayFromZero);
        var breakMinutes = (int)Math.Round(breakSpan.TotalMinutes, MidpointRounding.AwayFromZero);
        return (gross, breakMinutes, Math.Max(0, gross - breakMinutes));
    }

    /// <summary>
    /// The stretches of the ROSTERED window a claim leaves out: each break taken on the worker's own, clamped to the window, as whole-minute offsets from the rostered start. Offsets come from
    /// UTC instants, so a day the clocks change counts elapsed minutes, as <c>ShiftBands</c> does. Nothing outside the window was claimed, so it deducts nothing; a sleepover is claimed as a flat item, so it has none.
    /// </summary>
    /// <param name="aloneBreaks">The shift's breaks with <see cref="ShiftBreak.WithParticipant"/> false, from its ACTIVE completion; a running break ends at the actual end.</param>
    public static IReadOnlyList<(int From, int To)> UnclaimedSpans(
        DateOnly serviceDate, TimeOnly start, TimeOnly end, bool endsNextDay, SleepoverType nightType, IEnumerable<(DateTime From, DateTime To)> aloneBreaks, TimeZoneInfo zone)
    {
        if (nightType == SleepoverType.Sleepover) return Array.Empty<(int, int)>();

        var startUtc = ProviderLocalTime.LocalToUtc(serviceDate.ToDateTime(start), zone);
        var endUtc = ProviderLocalTime.LocalToUtc(serviceDate.AddDays(endsNextDay ? 1 : 0).ToDateTime(end), zone);
        var rostered = WholeMinutes(endUtc - startUtc);
        return aloneBreaks
            .Select(b => (From: Math.Max(0, WholeMinutes(b.From - startUtc)), To: Math.Min(rostered, WholeMinutes(b.To - startUtc))))
            .Where(s => s.To > s.From)
            .OrderBy(s => s.From)
            .ToList();
    }

    /// <summary>
    /// The minutes a completed shift is paid, shared by Payroll and Reports so the two pages never disagree: rostered minutes,
    /// the break minutes, and the paid minutes (a sleepover is paid its rostered hours, otherwise net worked time).
    /// </summary>
    public static (int RosteredMinutes, int BreakMinutes, int PaidMinutes) PaidMinutes(
        Shift shift, ShiftCompletion completion, DateTime nowUtc, IEnumerable<ShiftBreak> breaks)
    {
        var rostered = (int)(shift.EndTime.ToTimeSpan() - shift.StartTime.ToTimeSpan()).TotalMinutes + (shift.EndsNextDay ? 1440 : 0);
        var (_, breakMinutes, net) = NetWorked(completion.ActualStart, completion.ActualEnd, nowUtc, breaks);
        return (rostered, breakMinutes, shift.NightType == SleepoverType.Sleepover ? rostered : net);
    }
}
