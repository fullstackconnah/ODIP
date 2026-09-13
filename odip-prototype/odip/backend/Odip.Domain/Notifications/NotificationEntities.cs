using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Notifications;

/// <summary>
/// The kinds of events that can raise a notification. Append-only — never renumber, never
/// remove — same discipline as <see cref="Odip.Domain.Enums.CaregiverSubmissionStatus"/> ("do
/// not reorder"). A plain int EF column (repo default); DTOs serialise it as a string name
/// (NotificationDTOs.cs), via the API's global JsonStringEnumConverter.
/// docs/specs/2026-09-08-notifications-design.md §1.
/// </summary>
public enum NotificationEventType
{
    LeaveRequestSubmitted = 0,
    LeaveRequestDecided = 1,
    ShiftAssigned = 2,
    ShiftCompletionPendingReview = 3,   // wired in docs/specs/2026-09-08-shift-completion-design.md
    ShiftCompletionReturned = 4,        // wired in docs/specs/2026-09-08-shift-completion-design.md
    WitnessRequested = 5,
    CaregiverSubmissionReceived = 6,
    IncidentReported = 7,
    ServiceAgreementSent = 8,           // reserved — docs/specs/2026-09-08-service-agreements-and-budgets-design.md
    ServiceAgreementSigned = 9,         // reserved — docs/specs/2026-09-08-service-agreements-and-budgets-design.md
    IntegrationDegraded = 10,           // reserved — docs/specs/2026-09-08-integration-framework-design.md
}

public enum NotificationChannelKind { Email = 0, Sms = 1 }

public enum NotificationOutboxStatus { Pending = 0, Sent = 1, Failed = 2, Skipped = 3 }

/// <summary>
/// Transactional outbox row: "notify user X about event Y." Written in the SAME
/// <c>SaveChangesAsync</c> call as the domain write that caused it (ruling 4) — never call
/// <c>SaveChangesAsync</c> from inside <see cref="Odip.Application.Interfaces.INotificationRaiser"/>
/// itself. Drained by <see cref="Odip.Infrastructure.BackgroundServices.NotificationDispatchBackgroundService"/>.
/// </summary>
public class NotificationOutbox : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public NotificationEventType EventType { get; set; }
    public string EntityType { get; set; } = string.Empty;   // e.g. "LeaveRequest", "Shift"
    public Guid EntityId { get; set; }
    public Guid RecipientUserId { get; set; }
    public string PayloadJson { get; set; } = string.Empty;  // template inputs, JSON-serialised
    public NotificationOutboxStatus Status { get; set; } = NotificationOutboxStatus.Pending;
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
}

/// <summary>
/// Per-user, per-event-type, per-channel opt-out. Absence of a row means the event's documented
/// default applies — email ON for every v1 event. SMS rows may exist (the UI shows the disabled
/// column) but the dispatcher never sends over that channel regardless of <see cref="Enabled"/>,
/// since <see cref="Odip.Infrastructure.Notifications.SmsChannel"/> always resolves
/// <c>NotSupported</c>.
/// </summary>
public class NotificationPreference : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public NotificationEventType EventType { get; set; }
    public NotificationChannelKind Channel { get; set; }
    public bool Enabled { get; set; } = true;
}

/// <summary>Purpose-built delivery trail for a successfully sent notification — separate from <see cref="NotificationOutbox"/>'s own Status/LastError/SentAt churn.</summary>
public class NotificationLog : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid OutboxId { get; set; }
    public NotificationOutbox? Outbox { get; set; }
    public NotificationChannelKind Channel { get; set; }
    public string? ProviderMessageId { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public string RecipientAddress { get; set; } = string.Empty;
}
