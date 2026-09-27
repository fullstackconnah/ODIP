using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

public record ParticipantInquiryDto
{
    public Guid Id { get; init; }
    public Guid? ParticipantId { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string Source { get; init; } = string.Empty;
    public string? Provenance { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record CreateParticipantInquiryDto
{
    [Required, StringLength(100)] public string FirstName { get; init; } = string.Empty;
    [Required, StringLength(100)] public string LastName { get; init; } = string.Empty;
    [StringLength(50)] public string? Phone { get; init; }
    [EmailAddress, StringLength(200)] public string? Email { get; init; }
    [Required, RegularExpression("^(Web|Email|Phone)$")] public string Source { get; init; } = string.Empty;
    [StringLength(2000)] public string? Provenance { get; init; }
}

public record UpdateParticipantInquiryDto : CreateParticipantInquiryDto;

public record ConvertParticipantInquiryDto
{
    /// <summary>Optional same-tenant target. Omit to create exactly one draft Participant on first conversion.</summary>
    public Guid? ParticipantId { get; init; }
}

public record ParticipantOnboardingDto
{
    public Guid ParticipantId { get; init; }
    public bool ProfileComplete { get; init; }
    public DateTime? ProfileCompletedAt { get; init; }
    public string? ProfileCompletedBy { get; init; }
    public bool ServiceTypeConfirmed { get; init; }
    public DateTime? ServiceTypeConfirmedAt { get; init; }
    public string? ServiceTypeConfirmedBy { get; init; }
    public bool ServiceAgreementSigned { get; init; }
    public bool IsReady { get; init; }
}

/// <summary>Server-derived worklist row; clients cannot choose a lifecycle stage.</summary>
public record ParticipantOnboardingWorklistDto
{
    public Guid ParticipantId { get; init; }
    public string FullName { get; init; } = string.Empty;
    public string Stage { get; init; } = string.Empty;
    public string NextAction { get; init; } = string.Empty;
    public int CompletedSteps { get; init; }
    public int TotalSteps { get; init; } = 4;
}
