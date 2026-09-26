using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Tenant-owned, immutable service-agreement draft revision. It is deliberately not a contract
/// or signed agreement: legal template approval and evidence storage are separate prerequisites.
/// </summary>
public class ServiceAgreementDraft : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public int Version { get; set; }
    public DateOnly PlanStartDate { get; set; }
    public DateOnly PlanEndDate { get; set; }
    public DateOnly AgreementStartDate { get; set; }
    public DateOnly AgreementEndDate { get; set; }
    public string State { get; set; } = string.Empty;
    public string ServiceTypesJson { get; set; } = "[]";
    public string? Representative { get; set; }
    public string ParticipantNameSnapshot { get; set; } = string.Empty;
    public string? NdisNumberSnapshot { get; set; }
    public DateOnly? DateOfBirthSnapshot { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
    public ICollection<ServiceAgreementDraftLine> Lines { get; set; } = new List<ServiceAgreementDraftLine>();
}

/// <summary>Catalogue provenance is copied to the revision so future catalogue changes cannot mutate a draft.</summary>
public class ServiceAgreementDraftLine
{
    public Guid Id { get; set; }
    public Guid DraftId { get; set; }
    public ServiceAgreementDraft? Draft { get; set; }
    public string ServiceType { get; set; } = string.Empty;
    public decimal Hours { get; set; }
    public string ItemCode { get; set; } = string.Empty;
    public string CatalogueVersion { get; set; } = string.Empty;
    public DateOnly CatalogueEffectiveFrom { get; set; }
    public DateOnly? CatalogueEffectiveTo { get; set; }
    public decimal UnitPrice { get; set; }
}
