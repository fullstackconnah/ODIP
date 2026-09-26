namespace Odip.Domain.Entities;

/// <summary>
/// Append-only evidence produced when intake is explicitly completed. SnapshotJson, PdfContent and
/// ContentHash are never updated: later participant/profile changes must create a new revision.
/// </summary>
public class ParticipantIntakeSnapshot
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public int Revision { get; set; }
    public DateTime CompletedAtUtc { get; set; }
    public string CompletedBy { get; set; } = string.Empty;
    public string RequestId { get; set; } = string.Empty;
    public string SnapshotJson { get; set; } = string.Empty;
    public string ContentHash { get; set; } = string.Empty;
    public byte[] PdfContent { get; set; } = Array.Empty<byte>();
    public Participant? Participant { get; set; }
}
