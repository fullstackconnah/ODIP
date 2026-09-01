using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// IN-5: one recorded injury on an <see cref="IncidentReport"/> whose <see cref="IncidentReport.IncidentType"/>
/// is <see cref="Enums.IncidentType.Injury"/> — a genuine one-to-many (zero or many injuries per
/// incident), backing the frontend <c>BodyDiagram</c> component's repeatable injury rows.
///
/// No <c>TenantId</c>/<c>ITenantEntity</c> — mirrors <see cref="IncidentReport"/> itself, which has
/// neither; same-tenant scoping comes transitively through the parent <see cref="IncidentReport"/>
/// FK, exactly like <see cref="IncidentReport"/>'s own scoping comes transitively through its
/// <c>ReportedByUser</c>/<c>InvolvedParticipant</c> FKs.
///
/// Update (edit mode) full-replaces this collection on save (delete all existing rows for the
/// incident, re-insert the submitted list) — the form always sends the complete list, so no
/// per-row diff/reconciliation is needed. Contrast with <see cref="IncidentWitness"/> (IN-7),
/// which preserves already-responded rows across an Update because a witness's approval state is
/// something OTHER than the reporter can set — an injury row has no equivalent external state to
/// protect, so straightforward full-replace is correct here.
/// </summary>
public class IncidentInjury
{
    public Guid Id { get; set; }

    public Guid IncidentReportId { get; set; }
    public IncidentReport IncidentReport { get; set; } = null!;

    public BodyRegion Region { get; set; }
    public InjuryType InjuryType { get; set; }
    public string Description { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
