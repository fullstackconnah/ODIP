namespace Odip.Application.DTOs;

/// <summary>
/// One pool in one funding period that an action takes past its funding (budget phase 3): the shifts a pattern has just made, the shifts approving an agreement would make, or a trip booking that has just
/// been confirmed. A warning only, in every mode: the action has happened (or will), and nothing here is a reason to refuse it. The figures are the server's, worked out with the action counted, so the screen
/// prints them and does no sum of its own.
/// </summary>
public record BudgetWarningDto
{
    public string PoolName { get; init; } = string.Empty;
    public DateOnly PeriodStart { get; init; }
    public DateOnly PeriodEnd { get; init; }
    public decimal Available { get; init; }
    public decimal Used { get; init; }
    /// <summary>Used plus booked ahead, with the action counted.</summary>
    public decimal Forecast { get; init; }
    /// <summary>What the action itself adds to this pool in this period, priced the way ODIP will claim it.</summary>
    public decimal Added { get; init; }
    /// <summary>How far the forecast is past what is available.</summary>
    public decimal OverBy { get; init; }
    /// <summary>How many shifts (or bookings) the action puts in this pool and period.</summary>
    public int Count { get; init; }
    /// <summary>The warning in a sentence: "These 8 shifts take Core (flexible) to $8,640.00 of $8,000.00 for 1 Oct - 31 Dec 2026, $640.00 over."</summary>
    public string Message { get; init; } = string.Empty;
    /// <summary>Whose budget this is, for a trip booking (omitted for shifts, which are one participant's by their screen). The bulk confirm of several bookings lists each line with its participant (the phase 3 review, C5).</summary>
    public string? ParticipantName { get; init; }
}
