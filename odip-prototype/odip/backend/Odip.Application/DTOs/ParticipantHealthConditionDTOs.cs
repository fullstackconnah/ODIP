using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT HEALTH CONDITION DTOs (INTAKE sub-wave C1)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// <see cref="Id"/> is null for a synthesized "not yet answered" placeholder row — see
/// ParticipantHealthConditionsController.GetForParticipant, which returns exactly one entry per
/// <see cref="HealthConditionType"/> regardless of whether a database row exists yet. Same shape as
/// <see cref="ParticipantConsentDto"/> (INTAKE sub-wave B) — see this PR's report for why this
/// fixed-enumerated-set grid is modelled as its own child entity rather than flat columns.
/// </summary>
public record ParticipantHealthConditionDto
{
    public Guid? Id { get; init; }
    public Guid ParticipantId { get; init; }
    public HealthConditionType ConditionType { get; init; }
    public bool? Has { get; init; }
    public string? Severity { get; init; }
    public bool? PlanProvided { get; init; }
    public bool? TrainingRequired { get; init; }
    public string? Notes { get; init; }
    public DateTime? CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// Shape used both by <see cref="CreateParticipantDto.HealthConditions"/> (rows submitted
/// alongside a new or drafted participant — see ParticipantsController.UpsertHealthConditionsAsync)
/// and by ParticipantHealthConditionsController.Upsert's route-scoped single-row upsert. The
/// wizard always submits all ten <see cref="HealthConditionType"/> entries (a fixed enumerated
/// set, not a repeatable add/remove list).
/// </summary>
public record CreateParticipantHealthConditionDto
{
    public HealthConditionType ConditionType { get; init; }
    public bool? Has { get; init; }
    [StringLength(200)]
    public string? Severity { get; init; }
    public bool? PlanProvided { get; init; }
    public bool? TrainingRequired { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}

/// <summary>Upsert payload for the detail-page nested edit endpoint — ParticipantId/ConditionType come from the route.</summary>
public record UpsertParticipantHealthConditionDto
{
    public bool? Has { get; init; }
    [StringLength(200)]
    public string? Severity { get; init; }
    public bool? PlanProvided { get; init; }
    public bool? TrainingRequired { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}
