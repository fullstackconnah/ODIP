namespace Odip.Domain.Rostering;

public enum ClientTimeViolation { None, InFuture, TooOld, BeforeStart }

/// <summary>
/// Times a phone recorded offline and sent late. Within these bounds the server trusts them; otherwise the controller answers 400 with a code
/// (Domain cannot see the codes, so it returns this enum, as <see cref="ShiftBreakViolation"/> does).
/// </summary>
public static class ClientTimeRules
{
    public static readonly TimeSpan MaxAge = TimeSpan.FromHours(48);

    /// <param name="clientUtc">The client's instant, already UTC (<see cref="ShiftBreakRules.ToUtc"/>).</param>
    /// <param name="notBeforeUtc">The earliest instant allowed (the actual start), or null when the caller has no such floor.</param>
    public static ClientTimeViolation Check(DateTime clientUtc, DateTime nowUtc, DateTime? notBeforeUtc) =>
        clientUtc > nowUtc + ShiftBreakRules.ClockSkewAllowance ? ClientTimeViolation.InFuture
        : clientUtc < nowUtc - MaxAge ? ClientTimeViolation.TooOld
        : notBeforeUtc is { } nb && clientUtc < nb ? ClientTimeViolation.BeforeStart
        : ClientTimeViolation.None;
}
