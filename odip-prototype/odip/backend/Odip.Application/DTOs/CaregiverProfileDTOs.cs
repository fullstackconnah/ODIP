using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// CAREGIVER PROFILE FORM DTOs — docs/specs/2026-09-03-caregiver-profile-form-design.md
// ══════════════════════════════════════════════════════════════
//
// Public (token) side: what the caregiver sees and sends. The participant projection is a
// JSON object built by CaregiverFieldPolicy (cg02) — never ParticipantDetailDto — so internal
// fields cannot leak by construction. The payload IS a PatchParticipantDto: the caregiver wizard
// builds it exactly as the Profile wizard does, and accept applies it through the same code.
//
// Admin side: link issue/revoke and the submission review lifecycle.

// ── Public ────────────────────────────────────────────────

public record CaregiverFormDto
{
    public CaregiverSubmissionStatus Status { get; init; }
    public string? CaregiverName { get; init; }
    public string? CaregiverRelationship { get; init; }
    public DateTime ExpiresAt { get; init; }
    public string? RejectionNote { get; init; }

    /// <summary>Caregiver-visible current values, keyed by ParticipantDetailDto JSON property name.</summary>
    public System.Text.Json.Nodes.JsonObject Current { get; init; } = new();

    /// <summary>Field ids (allocation-contract ids) the caregiver may edit. Everything else in Current is read-only.</summary>
    public IReadOnlyList<string> Editable { get; init; } = Array.Empty<string>();

    /// <summary>The caregiver's saved draft, if any.</summary>
    public PatchParticipantDto? Draft { get; init; }
}

public record CaregiverDraftDto
{
    [Required, StringLength(300)] public string CaregiverName { get; init; } = string.Empty;
    [StringLength(100)] public string? CaregiverRelationship { get; init; }
    [Required] public PatchParticipantDto Payload { get; init; } = new();
}

// ── Admin ─────────────────────────────────────────────────

public record CaregiverLinkDto
{
    /// <summary>Raw token. Returned ONCE, at creation. The frontend composes the URL as {origin}/caregiver/{token}.</summary>
    public string Token { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
}

public record CaregiverSubmissionListItemDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public CaregiverSubmissionStatus Status { get; init; }
    public string? CaregiverName { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public DateTime? SubmittedAt { get; init; }
}

public record CaregiverSubmissionDetailDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public CaregiverSubmissionStatus Status { get; init; }
    public string? CaregiverName { get; init; }
    public string? CaregiverRelationship { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public DateTime? SubmittedAt { get; init; }
    public DateTime? ReviewedAt { get; init; }
    public string? RejectionNote { get; init; }

    /// <summary>Same projection the caregiver saw — the "current" side of the diff.</summary>
    public System.Text.Json.Nodes.JsonObject Current { get; init; } = new();

    /// <summary>The caregiver's submitted payload — the "proposed" side of the diff.</summary>
    public PatchParticipantDto? Payload { get; init; }
}

public record RejectCaregiverSubmissionDto
{
    [Required, StringLength(4000)] public string Note { get; init; } = string.Empty;
}
