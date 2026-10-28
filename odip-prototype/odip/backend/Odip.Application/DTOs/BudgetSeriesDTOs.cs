namespace Odip.Application.DTOs;

// ── The budget graph (Funding tab) ──────────────────────────────────────────

/// <summary>Whether the budget graph can be drawn.</summary>
public enum BudgetChartStatus
{
    Ok = 0,
    /// <summary>No price list is in effect on any day of the plan, so nothing can be priced.</summary>
    NoPricing = 1,
    /// <summary>No chart: funded another way, no plan that has started, a plan recorded for later, between plans, or a plan with no pools.</summary>
    None = 2,
}

/// <summary>Whether the expected line (the approved agreement, re-priced) is drawn.</summary>
public enum BudgetExpectedStatus
{
    Ok = 0,
    /// <summary>No approved revision with blocks covers any day of the plan.</summary>
    NoAgreement = 1,
    /// <summary>The agreement could not be priced just now (the organisation's pricing is busy, or the engine refused or failed). The other lines still draw.</summary>
    Unavailable = 2,
}

/// <summary>
/// The participant's current plan as weekly cumulative points, for the whole plan and for each pool: the budget spread evenly, what is used, what is booked ahead and what the approved
/// agreement expects. The plan dates, today and the expected line's state are the same for every scope, so they are sent once.
/// </summary>
public record BudgetSeriesDto
{
    public BudgetChartStatus Chart { get; init; }
    public DateOnly? PlanStart { get; init; }
    public DateOnly? PlanEnd { get; init; }
    /// <summary>The provider's today.</summary>
    public DateOnly Today { get; init; }
    public bool PlanIsCurrent { get; init; }
    public BudgetExpectedDto Expected { get; init; } = new();
    /// <summary>[0] is the whole plan, then the pools by position. Empty unless <see cref="Chart"/> is Ok.</summary>
    public List<BudgetSeriesScopeDto> Scopes { get; init; } = new();
}

public record BudgetSeriesScopeDto
{
    /// <summary>"plan", or the pool's id.</summary>
    public string ScopeKey { get; init; } = "plan";
    /// <summary>"The whole plan", or the pool's label as the pool cards show it.</summary>
    public string Name { get; init; } = string.Empty;
    public decimal Limit { get; init; }
    public List<BudgetSeriesPointDto> Points { get; init; } = new();
    public BudgetSeriesSummaryDto Summary { get; init; } = new();
    public int UnpricedShiftCount { get; init; }
    public List<string> UnpricedShiftReasons { get; init; } = new();
}

/// <summary>Cumulative figures to the end of <see cref="Date"/> (the plan-start point is the start of that day, all zero). Null where the line does not reach.</summary>
public record BudgetSeriesPointDto
{
    public DateOnly Date { get; init; }
    public decimal Budget { get; init; }
    public decimal? Used { get; init; }
    public decimal? UsedAndBooked { get; init; }
    public decimal? Expected { get; init; }
    /// <summary>An opening or closing point of the expected line: it shapes the line only, and is no step of the table, the readout or the keyboard.</summary>
    public bool IsEdge { get; init; }
}

public record BudgetSeriesSummaryDto
{
    public decimal Used { get; init; }
    public decimal EvenToDate { get; init; }
    /// <summary>Used minus the even spread to date: negative is under.</summary>
    public decimal AheadOfEven { get; init; }
    /// <summary>Spend projected to the plan end at the rate so far; null until a quarter of the plan has passed, and for an ended plan.</summary>
    public decimal? Pace { get; init; }
    public decimal? PaceGapAtEnd { get; init; }
    /// <summary>Used plus booked ahead; null when nothing is booked ahead or the plan has ended.</summary>
    public decimal? BookedEnd { get; init; }
    public decimal? ExpectedEnd { get; init; }
    public DateOnly? ExpectedEndDate { get; init; }
    /// <summary>An ended plan only: the limit minus what was used (negative is over).</summary>
    public decimal? LeftAtEnd { get; init; }
}

public record BudgetExpectedDto
{
    public BudgetExpectedStatus Status { get; init; }
    /// <summary>The first covered day, only when it is after the plan start.</summary>
    public DateOnly? StartsOn { get; init; }
    /// <summary>The last covered day, only when it is before the plan end.</summary>
    public DateOnly? EndsOn { get; init; }
    /// <summary>The first day of each later approved revision inside the plan.</summary>
    public List<DateOnly> RevisionChanges { get; init; } = new();
    /// <summary>Lines of the drawn agreement that the NDIS price list for their dates has no price for, so the line leaves them out.</summary>
    public int UnpricedLineCount { get; init; }
}
