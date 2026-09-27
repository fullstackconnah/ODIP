using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

public record CreateServiceAgreementDraftDto
{
    public DateOnly PlanStartDate { get; init; }
    public DateOnly PlanEndDate { get; init; }
    public DateOnly AgreementStartDate { get; init; }
    public DateOnly AgreementEndDate { get; init; }
    [Required, RegularExpression("^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$")] public string State { get; init; } = string.Empty;
    public List<string> ServiceTypes { get; init; } = [];
    [StringLength(500)] public string? Representative { get; init; }
    [MinLength(1)] public List<CreateServiceAgreementDraftLineDto> Lines { get; init; } = [];
}

public record CreateServiceAgreementDraftLineDto
{
    [Required, StringLength(200)] public string ServiceType { get; init; } = string.Empty;
    [Required, StringLength(50)] public string ItemCode { get; init; } = string.Empty;
    [Range(typeof(decimal), "0.01", "100000")] public decimal Hours { get; init; }
}

public record ServiceAgreementDraftDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public int Version { get; init; }
    public string Status { get; init; } = "UnapprovedDraft";
    public string TemplateVersion { get; init; } = string.Empty;
    public string TemplateDocxSha256 { get; init; } = string.Empty;
    public string TemplatePdfSha256 { get; init; } = string.Empty;
    public string State { get; init; } = string.Empty;
    public DateOnly AgreementStartDate { get; init; }
    public DateOnly AgreementEndDate { get; init; }
    public List<ServiceAgreementDraftLineDto> Lines { get; init; } = [];
}

public record ServiceAgreementDraftLineDto
{
    public string ServiceType { get; init; } = string.Empty;
    public decimal Hours { get; init; }
    public string ItemCode { get; init; } = string.Empty;
    public decimal UnitPrice { get; init; }
    public string CatalogueVersion { get; init; } = string.Empty;
    public DateOnly CatalogueEffectiveFrom { get; init; }
    public DateOnly? CatalogueEffectiveTo { get; init; }
}

/// <summary>
/// A deliberately non-persistent walkthrough result. It is not evidence, an activation, a
/// booking, a billable event, or a claim.
/// </summary>
public record DemoJourneySimulationDto(string Banner, string Signing, string Activation, string Booking, string RateLabel);
