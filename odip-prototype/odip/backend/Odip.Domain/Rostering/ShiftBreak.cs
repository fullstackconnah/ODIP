using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// One break a worker took during a shift, recorded against the shift's ACTIVE <see cref="ShiftCompletion"/>
/// (so a Return, which archives the completion, archives its breaks with it). Times are UTC instants.
///
/// Breaks are an honest record of what happened, NOT a billing input: claims still use ROSTERED hours
/// (<c>ShiftClaimGenerationService</c>) and paid/unpaid break rules and payroll output are out of scope.
/// Net worked minutes (<see cref="ShiftBreakRules.NetWorked"/>) are reported on the completion so the
/// coordinator can see them.
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
    public static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Local => value.ToUniversalTime(),
        DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        _ => value,
    };

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
    /// while the shift is still in progress) minus the time spent on breaks. A running break counts up to now; every
    /// break is clamped to the worked span. Whole minutes, rounded half away from zero, with
    /// <c>Net = Gross - Break</c> exactly so the three numbers always add up on screen.
    /// </summary>
    public static (int GrossMinutes, int BreakMinutes, int NetMinutes) NetWorked(
        DateTime actualStartUtc, DateTime? actualEndUtc, DateTime nowUtc, IEnumerable<ShiftBreak> breaks)
    {
        var end = actualEndUtc ?? nowUtc;
        if (end < actualStartUtc) end = actualStartUtc;

        var breakSpan = TimeSpan.Zero;
        foreach (var b in breaks)
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
}
