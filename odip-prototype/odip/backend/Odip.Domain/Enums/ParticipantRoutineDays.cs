namespace Odip.Domain.Enums;

/// <summary>
/// PD-4: which day(s) of the week a <see cref="Entities.ParticipantRoutine"/> applies on. Stored
/// as a plain <c>int</c> column on <see cref="Entities.ParticipantRoutine.Days"/> — same
/// "[Flags] enum, plain int column, no HasConversion" storage idiom as
/// <see cref="Odip.Domain.Rostering.ShiftNoteFlagCategory"/>/<see cref="ServiceStreams"/>. Bit
/// positions are Monday-first (bit 0 = Monday ... bit 6 = Sunday), matching the frontend's
/// existing Monday-first <c>WEEKDAYS</c> display order rather than .NET's <see cref="DayOfWeek"/>
/// wire order (which is Sunday = 0) — the two conventions are DIFFERENT and a conversion table is
/// required wherever they meet (see the day-list ⇄ flags mapper below).
///
/// <see cref="None"/> (0) is an INVALID value for a routine — a routine must apply on at least one
/// day, so <see cref="None"/> is rejected by DTO validation rather than being given a meaning of
/// its own. <see cref="All"/> (127, every bit set) is what "every day" means — the literal,
/// unambiguous encoding ("applies Monday AND Tuesday AND ... AND Sunday" IS every day) that
/// composes correctly with any "does this routine apply on day X" bitwise check with no special
/// case for "every day".
/// </summary>
[Flags]
public enum ParticipantRoutineDays
{
    None = 0,
    Monday = 1 << 0,
    Tuesday = 1 << 1,
    Wednesday = 1 << 2,
    Thursday = 1 << 3,
    Friday = 1 << 4,
    Saturday = 1 << 5,
    Sunday = 1 << 6,
    All = Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday,
}

/// <summary>
/// Converts between the wire representation of a routine's day set
/// (<c>IReadOnlyList&lt;System.DayOfWeek&gt;</c>, the shape <see cref="Application.DTOs.ParticipantRoutineDto"/>
/// and its create/update siblings expose — JSON-serialises as day-name strings, e.g.
/// <c>["Monday","Wednesday"]</c>, keeping the wire format close to the old single day-name-string
/// convention) and the storage representation (<see cref="ParticipantRoutineDays"/> flags, stored
/// as a plain int on <see cref="Entities.ParticipantRoutine.Days"/>). Extracted as a standalone
/// static class (rather than being inlined in the controller) specifically so the bit-mapping
/// logic — including the one-off migration's data-conversion rule (null → every day, a single
/// <see cref="DayOfWeek"/> → that one day) — is directly unit-testable without spinning up a
/// controller or a real migration/database.
/// </summary>
public static class ParticipantRoutineDayMapper
{
    /// <summary>Every non-<see cref="ParticipantRoutineDays.None"/>/<see cref="ParticipantRoutineDays.All"/> single-bit member, in Monday-first declaration order.</summary>
    public static readonly IReadOnlyList<ParticipantRoutineDays> Days = new[]
    {
        ParticipantRoutineDays.Monday,
        ParticipantRoutineDays.Tuesday,
        ParticipantRoutineDays.Wednesday,
        ParticipantRoutineDays.Thursday,
        ParticipantRoutineDays.Friday,
        ParticipantRoutineDays.Saturday,
        ParticipantRoutineDays.Sunday,
    };

    /// <summary>Maps a single <see cref="System.DayOfWeek"/> value to its Monday-first bit.</summary>
    public static ParticipantRoutineDays ToFlag(DayOfWeek day) => day switch
    {
        DayOfWeek.Monday => ParticipantRoutineDays.Monday,
        DayOfWeek.Tuesday => ParticipantRoutineDays.Tuesday,
        DayOfWeek.Wednesday => ParticipantRoutineDays.Wednesday,
        DayOfWeek.Thursday => ParticipantRoutineDays.Thursday,
        DayOfWeek.Friday => ParticipantRoutineDays.Friday,
        DayOfWeek.Saturday => ParticipantRoutineDays.Saturday,
        DayOfWeek.Sunday => ParticipantRoutineDays.Sunday,
        _ => throw new ArgumentOutOfRangeException(nameof(day), day, "Unrecognised DayOfWeek value"),
    };

    /// <summary>Maps a Monday-first single bit back to its <see cref="System.DayOfWeek"/> value.</summary>
    public static DayOfWeek ToDayOfWeek(ParticipantRoutineDays flag) => flag switch
    {
        ParticipantRoutineDays.Monday => DayOfWeek.Monday,
        ParticipantRoutineDays.Tuesday => DayOfWeek.Tuesday,
        ParticipantRoutineDays.Wednesday => DayOfWeek.Wednesday,
        ParticipantRoutineDays.Thursday => DayOfWeek.Thursday,
        ParticipantRoutineDays.Friday => DayOfWeek.Friday,
        ParticipantRoutineDays.Saturday => DayOfWeek.Saturday,
        ParticipantRoutineDays.Sunday => DayOfWeek.Sunday,
        _ => throw new ArgumentOutOfRangeException(nameof(flag), flag, "Expected exactly one day bit"),
    };

    /// <summary>Wire list → storage flags. Duplicate days in the input collapse harmlessly (bitwise OR).</summary>
    public static ParticipantRoutineDays ToFlags(IReadOnlyList<DayOfWeek>? days)
    {
        var result = ParticipantRoutineDays.None;
        if (days == null) return result;
        foreach (var day in days) result |= ToFlag(day);
        return result;
    }

    /// <summary>Storage flags → wire list, in Monday-first order.</summary>
    public static IReadOnlyList<DayOfWeek> ToDayList(ParticipantRoutineDays flags) =>
        Days.Where(d => flags.HasFlag(d)).Select(ToDayOfWeek).ToList();

    /// <summary>
    /// The one-off data-migration conversion rule for existing rows (PD-4): a row that had no
    /// single day set (<paramref name="legacyDayOfWeek"/> is null) applied every day, so it
    /// converts to <see cref="ParticipantRoutineDays.All"/>; a row with a specific
    /// <see cref="System.DayOfWeek"/> converts to that single day's bit. Exercised directly by
    /// unit tests since the migration's raw SQL <c>CASE</c> expression encodes the identical rule
    /// but isn't itself unit-testable — this method is the source of truth both are checked
    /// against.
    /// </summary>
    public static ParticipantRoutineDays ConvertLegacyDayOfWeek(DayOfWeek? legacyDayOfWeek) =>
        legacyDayOfWeek.HasValue ? ToFlag(legacyDayOfWeek.Value) : ParticipantRoutineDays.All;
}
