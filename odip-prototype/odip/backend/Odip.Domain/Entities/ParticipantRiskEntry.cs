using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// INTAKE-09: a captured risk in supporting the participant, categorised by who is at risk —
/// see <see cref="AtRiskParty"/>. A repeatable row per participant (e.g. "risk of falls
/// affecting the participant", "risk of property damage affecting other participants"), with an
/// optional mitigation note per entry. Not a compliance record like
/// <see cref="RestrictivePractice"/>/<see cref="ParticipantMedication"/> — retired via
/// <see cref="IsActive"/> and hard-deletable via the controller, same idiom as
/// <see cref="ParticipantRoutine"/>, whose entity/DTO/controller shape this closely mirrors.
/// A candidate for surfacing read-only in the portal shift detail (active entries only) — see
/// PortalController.
/// </summary>
public class ParticipantRiskEntry : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public AtRiskParty AtRiskParty { get; set; }

    public string Description { get; set; } = string.Empty;
    public string? MitigationNotes { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
