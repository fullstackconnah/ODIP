using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A record that one restrictive practice's report for one month was lodged in the NDIS Commission portal, and what it said. The portal is the system
/// of record; this row is the provider's own note of it, so the month stops showing as owed. Only inserted and deleted (undo): never edited.
/// </summary>
public class RestrictivePracticeMonthlyReport : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid RestrictivePracticeId { get; set; }
    public RestrictivePractice? RestrictivePractice { get; set; }

    /// <summary>First day of the month reported.</summary>
    public DateOnly Month { get; set; }
    public RestrictivePracticeReportType ReportType { get; set; }
    /// <summary>Only with VariedUse.</summary>
    public RestrictivePracticeVariedKind? VariedKind { get; set; }
    /// <summary>Only with VariedUse.</summary>
    public bool? VariedAlsoUnauthorised { get; set; }
    /// <summary>As-needed practices only: the server's count of uses when it was lodged.</summary>
    public int? UseCount { get; set; }
    public string? Note { get; set; }
    /// <summary>The date it was lodged in the portal, as the user entered it.</summary>
    public DateOnly LodgedOn { get; set; }
    public Guid? LodgedByUserId { get; set; }
    /// <summary>A snapshot of the lodging user's name.</summary>
    public string LodgedByName { get; set; } = string.Empty;
    /// <summary>The practice as it read at lodge, so the history survives later edits.</summary>
    public RestrictivePracticeType PracticeType { get; set; }
    public string PracticeDescription { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
