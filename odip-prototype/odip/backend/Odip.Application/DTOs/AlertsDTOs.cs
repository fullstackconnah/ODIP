using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT RISK ALERTS (task 6c) — computed at read time from
// existing data; nothing here is persisted. See
// Odip.Infrastructure.Services.ParticipantAlertsService for the rule logic.
// ══════════════════════════════════════════════════════════════

/// <summary>
/// A single computed alert. <see cref="Type"/> is a stable machine-readable code (kebab-case,
/// e.g. "plan-expired") a caller can key off; <see cref="Message"/> is the human-readable text;
/// <see cref="DeepLinkTab"/> is the <c>ParticipantDetailPage</c> tab key
/// (<c>?tab=&lt;DeepLinkTab&gt;</c>) that resolves the alert.
/// </summary>
public record ParticipantAlertDto
{
    public string Type { get; init; } = string.Empty;
    public AlertSeverity Severity { get; init; }
    public string Message { get; init; } = string.Empty;
    public string DeepLinkTab { get; init; } = string.Empty;
}

/// <summary>
/// Ranked alerts for one participant plus per-severity counts (the counts avoid every consumer —
/// table badge, dashboard card — having to re-derive them from <see cref="Alerts"/>). Returned
/// for every participant the query covers, even when <see cref="Alerts"/> is empty, so a table
/// row can look itself up by <see cref="ParticipantId"/> without a separate existence check.
/// </summary>
public record ParticipantAlertsDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;

    /// <summary>Ranked Critical-first, then Warning, then Info (see <see cref="AlertSeverity"/>).</summary>
    public List<ParticipantAlertDto> Alerts { get; init; } = new();
    public int CriticalCount { get; init; }
    public int WarningCount { get; init; }
    public int InfoCount { get; init; }
}
