using Odip.Domain.Interfaces;

namespace Odip.Domain.Integrations;

/// <summary>
/// One organisation's Employment Hero Payroll connection (Settings → Integrations). The API key is held only as AES-GCM ciphertext and its
/// nonce (IntegrationKeyProtector) and is write-only: never returned, logged or audited. Deliberately NOT in AuditedEntities: a change of key
/// is one SettingChangeAudit row saying only that it changed and who changed it. Disconnect deletes the row; staff links stay on User.
/// </summary>
public class EmploymentHeroConnection : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string BusinessId { get; set; } = string.Empty;
    public string BusinessName { get; set; } = string.Empty;
    public byte[] ApiKeyCiphertext { get; set; } = [];
    public byte[] ApiKeyNonce { get; set; } = [];
    public DateTime ConnectedAt { get; set; }
    public Guid? ConnectedById { get; set; }
    public string ConnectedByName { get; set; } = string.Empty;
    public DateTime? LastSyncAt { get; set; }
    /// <summary>Why the last sync failed, in words for the Admin; null when it worked. Never the key, never a person's details.</summary>
    public string? LastSyncError { get; set; }
    /// <summary>The EH work type ids sent on a timesheet line, by kind of shift. Null = none sent. Set on the Payroll settings; only EH pay categories are offered.</summary>
    public string? WorkTypeStandard { get; set; }
    public string? WorkTypeActiveNight { get; set; }
    public string? WorkTypePassiveNight { get; set; }
    public string? WorkTypeSleepover { get; set; }
    /// <summary>The EH leave category ids sent on a leave request, by ODIP leave type. Null = none chosen: that leave waits.</summary>
    public string? LeaveCategoryAnnual { get; set; }
    public string? LeaveCategorySick { get; set; }
    public string? LeaveCategoryPersonal { get; set; }
    public string? LeaveCategoryOther { get; set; }
}

/// <summary>What a Needs-attention item asks of the Admin. Append-only, stored as an int; the API sends the name.</summary>
public enum EmploymentHeroAttentionKind
{
    /// <summary>An active ODIP staff member with no Employment Hero employee: Link to one, or Leave unlinked.</summary>
    NotLinked = 0,
    /// <summary>An EH employee ODIP cannot take as they are (no email, an email used elsewhere, a value too long): fixed in EH, cleared by the next sync.</summary>
    FixInEmploymentHero = 1,
    /// <summary>EH has a new email for someone who has signed in to ODIP: only an Admin changes a sign-in address, on the staff page.</summary>
    FixInOdip = 2,
    /// <summary>A linked staff member who is no longer in EH's employee list: never archived on absence; Dismiss hides it.</summary>
    MissingFromEmploymentHero = 3,
}

/// <summary>One Needs-attention item on the Employment Hero card. Each sync rewrites the set (Key is stable per problem); a dismissed item stays dismissed while its problem lasts.</summary>
public class EmploymentHeroAttention : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    /// <summary>"{Kind}:{UserId or EH employee id}": one item per problem, unique per organisation.</summary>
    public string Key { get; set; } = string.Empty;
    public EmploymentHeroAttentionKind Kind { get; set; }
    public Guid? UserId { get; set; }
    /// <summary>The EH employee the item is about or, on a NotLinked item, the one with the same name: the suggested link.</summary>
    public string? ExternalEmployeeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? DismissedAt { get; set; }
}

/// <summary>One row per sync or send run per organisation: when, which business, what changed and, on failure, the error class. No keys, no pay data, no names.</summary>
public class EmploymentHeroSyncLog : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string BusinessId { get; set; } = string.Empty;
    public EmploymentHeroSyncKind Kind { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime FinishedAt { get; set; }
    public int Linked { get; set; }
    public int Created { get; set; }
    public int Updated { get; set; }
    public int Archived { get; set; }
    public int NeedsAttention { get; set; }
    /// <summary>Lines sent and lines that failed, on a Timesheets or Leave run; 0 on a Staff run.</summary>
    public int Sent { get; set; }
    public int Failed { get; set; }
    /// <summary>Null when the run worked; otherwise an EmploymentHeroFailure name, or "KeyUnreadable".</summary>
    public string? ErrorClass { get; set; }
}

/// <summary>What a sync log row records. Append-only, stored as an int.</summary>
public enum EmploymentHeroSyncKind { Staff = 0, Timesheets = 1, Leave = 2 }

/// <summary>What an outbox row sends to Employment Hero. Append-only, stored as an int.</summary>
public enum EmploymentHeroOutboxKind { Timesheet = 0, Leave = 1, LeaveCancel = 2 }

/// <summary>Where an outbox row is. Append-only, stored as an int; the Payroll page prints PayrollShiftStatus, derived from it.</summary>
public enum EmploymentHeroOutboxStatus { Pending = 0, Sent = 1, Failed = 2, NeedsAttention = 3 }

/// <summary>
/// One row per entity for life, re-queued in place (the NotificationOutbox shape). For a Timesheet, EntityId is the ShiftCompletion id and is the
/// externalId sent to EH. PR 3 adds Leave rows. Not audited: it holds a fingerprint and an EH id, never pay data. UpdatedAt is the concurrency token.
/// </summary>
public class EmploymentHeroOutbox : ITenantEntity
{
    public const string OneRowIndexName = "IX_EmploymentHeroOutbox_TenantId_Kind_EntityId";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public EmploymentHeroOutboxKind Kind { get; set; }
    public Guid EntityId { get; set; }
    public EmploymentHeroOutboxStatus Status { get; set; } = EmploymentHeroOutboxStatus.Pending;
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    /// <summary>Why the last try failed, in words for the Admin. Never the key or a person's details.</summary>
    public string? LastError { get; set; }
    /// <summary>A fingerprint of the last payload sent, not data.</summary>
    public string? PayloadHash { get; set; }
    /// <summary>The EH timesheet id, once EH has the line.</summary>
    public string? ExternalId { get; set; }
    public string? ExternalEmployeeId { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
