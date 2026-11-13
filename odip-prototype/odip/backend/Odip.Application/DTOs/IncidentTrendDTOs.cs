namespace Odip.Application.DTOs;

// ── Incident trend (incidents and restrictive practice uses by month)

public record IncidentTrendDto
{
    /// <summary>The provider's date, so the client names "this month" without its own clock.</summary>
    public DateOnly Today { get; init; }
    /// <summary>Exactly 6, oldest first; the last is Today's month (partial).</summary>
    public List<IncidentTrendMonthDto> Months { get; init; } = new();
}

/// <summary>One calendar month of non-Draft reports (Closed, which is how archiving is stored, included) by their own (wall-clock) IncidentDateTime. <c>RpUses + OtherIncidents == Incidents</c>.</summary>
public record IncidentTrendMonthDto
{
    /// <summary>"yyyy-MM".</summary>
    public string Month { get; init; } = "";
    public int Incidents { get; init; }
    public int RpUses { get; init; }
    public int OtherIncidents { get; init; }
}

/// <summary>The provider's calendar date now, "yyyy-MM-dd" (GET provider-today, open to every signed-in role).</summary>
public record ProviderTodayDto(string Date);
