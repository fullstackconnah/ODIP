using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A free-text note about a participant — e.g. a personal-care preference, a general
/// observation, or a reminder for support staff. Pinned notes surface first; archived
/// notes are hidden from the default view but never hard-deleted (record retention).
/// </summary>
public class ParticipantNote : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public bool IsPinned { get; set; }
    public bool IsArchived { get; set; }

    /// <summary>Set server-side from JWT claims at creation time — never client-supplied.</summary>
    public string CreatedByName { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
