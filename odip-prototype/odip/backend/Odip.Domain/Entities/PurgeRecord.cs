using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// The tombstone a confirmed purge leaves: that a participant record was purged after its retention period, when, by whom, why and how many rows of each
/// kind went. It is the audit of the purge, so the purge writes no AuditLog row. Deliberately NOT in AuditedEntities.
/// Holds nothing personal: no name, date of birth, NDIS or Medicare number, address or contact. <see cref="EntityId"/> is a random Guid that no longer
/// resolves to anything; the only free text is the Admin's <see cref="Reason"/> (the screen asks them not to name the person).
/// Unique on (TenantId, EntityType, EntityId), which makes a repeated or racing confirm answer with the same record.
/// </summary>
public class PurgeRecord : ITenantEntity
{
    public const string ParticipantType = "Participant";
    public const int ReasonMaxLength = 500;

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public string EntityType { get; set; } = ParticipantType;
    public Guid EntityId { get; set; }

    public Guid ConfirmedById { get; set; }
    /// <summary>The Admin's name as it was then, like AuditLog.ChangedByName.</summary>
    public string ConfirmedByName { get; set; } = string.Empty;
    public DateTimeOffset ConfirmedAt { get; set; }

    public string Reason { get; set; } = string.Empty;

    public DateOnly RetentionStartsOn { get; set; }
    public bool RetentionStartEstimated { get; set; }
    public DateOnly DueOn { get; set; }

    /// <summary>JSON object of table name to rows deleted, such as {"ParticipantNotes": 12}. Counts only.</summary>
    public string RowCounts { get; set; } = "{}";

    /// <summary>How many claim files (ClaimBatch.Content) were blanked because they held this participant's NDIS number.</summary>
    public int ClaimBatchFilesCleared { get; set; }
}
