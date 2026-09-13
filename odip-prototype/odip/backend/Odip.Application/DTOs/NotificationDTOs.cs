using Odip.Domain.Notifications;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// NOTIFICATION DTOs
// docs/specs/2026-09-08-notifications-design.md §2
// eventType/channel/status serialise as string enum names ("LeaveRequestSubmitted", "Email",
// "Failed") — the API already globally installs JsonStringEnumConverter (Program.cs), so this
// is the default, not extra code.
// ══════════════════════════════════════════════════════════════

public record NotificationPreferenceRowDto
{
    public NotificationEventType EventType { get; init; }
    public NotificationChannelKind Channel { get; init; }
    public bool Enabled { get; init; }
}

/// <summary>GET/PUT api/v1/notifications/preferences response — every event x channel, `enabled` = the user's row or the event default (email ON, sms OFF-by-construction-of-no-provider).</summary>
public record NotificationPreferenceGridDto
{
    public List<NotificationPreferenceRowDto> Rows { get; init; } = new();
}

/// <summary>
/// PUT api/v1/notifications/preferences request row. EventType/Channel are strings here
/// (rather than the enum types NotificationPreferenceRowDto uses for output) so an unknown
/// value can be turned into the spec's own 400 "Unknown event type or channel." message —
/// letting System.Text.Json's JsonStringEnumConverter reject an invalid name during model
/// binding would 400 with the framework's generic ProblemDetails body instead.
/// </summary>
public record UpdateNotificationPreferenceDto
{
    public string EventType { get; init; } = string.Empty;
    public string Channel { get; init; } = string.Empty;
    public bool Enabled { get; init; }
}

/// <summary>GET api/v1/admin/notifications row / POST retry response.</summary>
public record NotificationOutboxDto
{
    public Guid Id { get; init; }
    public NotificationEventType EventType { get; init; }
    public string EntityType { get; init; } = string.Empty;
    public Guid EntityId { get; init; }
    public Guid RecipientUserId { get; init; }
    public string? RecipientName { get; init; }
    public NotificationOutboxStatus Status { get; init; }
    public int Attempts { get; init; }
    public DateTime NextAttemptAt { get; init; }
    public string? LastError { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? SentAt { get; init; }
}

/// <summary>POST api/v1/admin/notifications/test-email response.</summary>
public record TestEmailResultDto
{
    public bool Sent { get; init; }
    public string? Error { get; init; }
}

/// <summary>POST api/v1/admin/notifications/test-email request.</summary>
public record SendTestEmailDto
{
    public string To { get; init; } = string.Empty;
}
