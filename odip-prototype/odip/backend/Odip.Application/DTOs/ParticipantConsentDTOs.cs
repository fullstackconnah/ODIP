using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT CONSENT DTOs (INTAKE sub-wave B)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// <see cref="Id"/> is null for a synthesized "not yet answered" placeholder row — see
/// ParticipantConsentsController.GetForParticipant, which returns exactly one entry per
/// <see cref="ConsentType"/> regardless of whether a database row exists yet.
/// </summary>
public record ParticipantConsentDto
{
    public Guid? Id { get; init; }
    public Guid ParticipantId { get; init; }
    public ConsentType ConsentType { get; init; }
    public bool? Granted { get; init; }
    public DateTime? RecordedAt { get; init; }
    public string? SignedByName { get; init; }
    public DateOnly? SignedDate { get; init; }
    public DateTime? CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// Shape used both by <see cref="CreateParticipantDto.Consents"/> (rows submitted alongside a new
/// or drafted participant — see ParticipantsController.UpsertConsentsAsync) and by
/// ParticipantConsentsController.Upsert's route-scoped single-row upsert. The wizard always
/// submits all seven <see cref="Domain.Enums.ConsentType"/> entries (this is a fixed enumerated
/// set, not a repeatable add/remove list like <see cref="CreateParticipantRiskEntryDto"/>).
/// </summary>
public record CreateParticipantConsentDto
{
    public ConsentType ConsentType { get; init; }
    public bool? Granted { get; init; }
    [StringLength(200)]
    public string? SignedByName { get; init; }
    public DateOnly? SignedDate { get; init; }
}

/// <summary>Upsert payload for the detail-page nested edit endpoint — ParticipantId/ConsentType come from the route.</summary>
public record UpsertParticipantConsentDto
{
    public bool? Granted { get; init; }
    [StringLength(200)]
    public string? SignedByName { get; init; }
    public DateOnly? SignedDate { get; init; }
}
