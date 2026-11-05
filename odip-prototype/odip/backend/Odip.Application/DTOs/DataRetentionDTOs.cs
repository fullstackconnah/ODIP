namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// DATA RETENTION DTOs: archived participants past their 7 years, and the confirmed purge
// ══════════════════════════════════════════════════════════════

/// <summary>One archived participant whose retention has run out. The name is here because the Admin must type it to confirm.</summary>
public record RetentionDueDto
{
    public Guid ParticipantId { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    /// <summary>The later of the archive date and the last service, claim, invoice, trip or incident.</summary>
    public DateOnly StartsOn { get; init; }
    /// <summary>True when the archive date was worked out from the audit log or the last edit (records archived before the clock existed).</summary>
    public bool StartEstimated { get; init; }
    public DateOnly DueOn { get; init; }
    /// <summary>Rows per table that the purge would delete, by table name.</summary>
    public Dictionary<string, int> RowCounts { get; init; } = new();
}

public record PurgeParticipantRequest
{
    /// <summary>The participant's last name, typed by the Admin to confirm.</summary>
    public string LastName { get; init; } = string.Empty;
    /// <summary>Why, in the Admin's words. Kept on the purge record only; up to 500 characters. It must not name the person.</summary>
    public string Reason { get; init; } = string.Empty;
}

/// <summary>What stays after a purge: no name, no details, only when, by whom, why and how many rows.</summary>
public record PurgeRecordDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ConfirmedByName { get; init; } = string.Empty;
    public DateTimeOffset ConfirmedAt { get; init; }
    public string Reason { get; init; } = string.Empty;
    public DateOnly RetentionStartsOn { get; init; }
    public bool RetentionStartEstimated { get; init; }
    public DateOnly DueOn { get; init; }
    public Dictionary<string, int> RowCounts { get; init; } = new();
    public int ClaimBatchFilesCleared { get; init; }
}
