using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A "Report a problem" note from a signed-in user. The row is saved first, then sent once to the Work Board and retried
/// in the background (ProblemReportSendBackgroundService), so a report is never lost to a board outage. The context
/// (reporter, organisation, browser) is taken from the server's own view of the request, never from the body.
/// Stored status is the default int, like NotificationOutboxStatus.
/// </summary>
public class ProblemReport : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ReporterUserId { get; set; }
    public string ReporterName { get; set; } = string.Empty;
    public string ReporterRole { get; set; } = string.Empty;
    public string OrganisationName { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public string PagePath { get; set; } = string.Empty;
    public string AppVersion { get; set; } = string.Empty;
    public string ApiVersion { get; set; } = string.Empty;
    public string UserAgent { get; set; } = string.Empty;
    public ProblemReportStatus Status { get; set; } = ProblemReportStatus.Saved;
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    /// <summary>The last failure: a numeric HTTP status, an exception type name, "unknown-outcome" or "not-configured". Never text, a token or a response body.</summary>
    public string? LastError { get; set; }
    /// <summary>The Work Board task id once a card exists.</summary>
    public long? CardId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
}

public enum ProblemReportStatus
{
    Saved,
    Sent,
    Failed,
}
