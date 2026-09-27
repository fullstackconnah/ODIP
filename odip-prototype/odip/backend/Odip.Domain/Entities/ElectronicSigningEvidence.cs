using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>Immutable, tenant-scoped snapshot produced from a specific agreement-draft revision. It is evidence awaiting verification, not a legal signature.</summary>
public class ElectronicSigningSnapshot : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Guid DraftId { get; set; }
    public int DraftVersion { get; set; }
    public string DocumentJson { get; set; } = string.Empty;
    public string DocumentHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<ElectronicSigningEvidence> Evidence { get; set; } = new List<ElectronicSigningEvidence>();
}

/// <summary>Append-only assertion of an in-app signing attempt. Never sets an agreement signed boolean or scheduling approval.</summary>
public class ElectronicSigningEvidence : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid SnapshotId { get; set; }
    public ElectronicSigningSnapshot? Snapshot { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public string SignerName { get; set; } = string.Empty;
    public string SignerCapacity { get; set; } = string.Empty;
    public bool IsAuthorisedRepresentative { get; set; }
    public bool ConsentToElectronicMethod { get; set; }
    public bool IntendsToSign { get; set; }
    public bool DocumentWasDisplayed { get; set; }
    public string EvidenceHash { get; set; } = string.Empty;
    public string PreviousEvidenceHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "PendingVerification";
}
