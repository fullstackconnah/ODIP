using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT ADL ASSESSMENT DTOs (INTAKE sub-wave C2)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// <see cref="Id"/> is null for a synthesized "not yet assessed" placeholder row — see
/// ParticipantAdlAssessmentsController.GetForParticipant, which returns exactly one entry per
/// <see cref="AdlType"/> regardless of whether a database row exists yet. Same shape as
/// <see cref="ParticipantHealthConditionDto"/> (INTAKE sub-wave C1).
/// </summary>
public record ParticipantAdlAssessmentDto
{
    public Guid? Id { get; init; }
    public Guid ParticipantId { get; init; }
    public AdlType AdlType { get; init; }
    public AdlLevel? Level { get; init; }
    public string? Notes { get; init; }
    /// <summary>INTAKE-03, CommunityAccessDailyLiving stream-specific. See <see cref="Entities.ParticipantAdlAssessment"/>'s type doc.</summary>
    public string? HowToHelpNotes { get; init; }
    public DateTime? CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// Shape used both by <see cref="CreateParticipantDto.AdlAssessments"/> (rows submitted alongside a
/// new or drafted participant — see ParticipantsController.UpsertAdlAssessmentsAsync) and by
/// ParticipantAdlAssessmentsController.Upsert's route-scoped single-row upsert. The wizard always
/// submits all twenty <see cref="AdlType"/> entries (a fixed enumerated set, not a repeatable
/// add/remove list).
/// </summary>
public record CreateParticipantAdlAssessmentDto
{
    public AdlType AdlType { get; init; }
    public AdlLevel? Level { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}

/// <summary>Upsert payload for the detail-page nested edit endpoint — ParticipantId/AdlType come from the route.</summary>
public record UpsertParticipantAdlAssessmentDto
{
    public AdlLevel? Level { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}
