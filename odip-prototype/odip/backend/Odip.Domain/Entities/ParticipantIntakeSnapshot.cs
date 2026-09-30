using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Append-only evidence produced when intake is explicitly completed. SnapshotJson, PdfContent and
/// ContentHash are never updated: later participant/profile changes must create a new revision.
/// Implements <see cref="ITenantEntity"/> so OdipDbContext.SaveChangesAsync stamps the caller's tenant
/// when it is still default: a participant created and completed in one POST has no TenantId yet
/// when the snapshot is prepared, and without the stamp its evidence was saved under Guid.Empty and
/// hidden from the tenant's own snapshot list/download by the tenant query filter.
/// </summary>
public class ParticipantIntakeSnapshot : ITenantEntity
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
