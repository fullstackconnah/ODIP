using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A medication prescribed for a participant, including the compliance metadata NDIS medication
/// management practices require: PRN dosing limits, chemical-restraint/BSP tracking, consent, and
/// review scheduling. Never hard-deleted — NDIS record retention is ~7 years, so lifecycle is
/// tracked via <see cref="Status"/> (Active/OnHold/Ceased) instead.
/// </summary>
public class ParticipantMedication : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public string Name { get; set; } = string.Empty;
    public string? Strength { get; set; }
    public MedicationForm Form { get; set; }
    public MedicationRoute Route { get; set; }

    /// <summary>e.g. "2 tablets (1000mg)".</summary>
    public string DoseDescription { get; set; } = string.Empty;
    public string? Directions { get; set; }

    public MedicationType Type { get; set; }

    /// <summary>CSV of 24h times, e.g. "08:00,20:00". Used for <see cref="MedicationType.Regular"/> dosing.</summary>
    public string? TimesOfDay { get; set; }

    public string? PrnIndication { get; set; }
    public int? PrnMaxDosesPer24h { get; set; }
    public int? PrnMinIntervalMinutes { get; set; }

    /// <summary>Why the medication was prescribed — supports the psychotropic/chemical-restraint distinction NDIS rules require.</summary>
    public string? Purpose { get; set; }
    public bool IsPsychotropic { get; set; }

    /// <summary>Medication used primarily to influence behaviour — a restrictive practice requiring BSP + authorisation.</summary>
    public bool IsChemicalRestraint { get; set; }
    public bool BspInPlace { get; set; }
    public string? RestrictivePracticeAuthorisationRef { get; set; }

    /// <summary>Requires a witness on administration.</summary>
    public bool IsHighRisk { get; set; }

    /// <summary>e.g. subcutaneous injection / enteral — NDIS High Intensity Support module.</summary>
    public bool IsHighIntensitySupport { get; set; }

    public DrugSchedule DrugSchedule { get; set; }
    public MedicationSupportLevel SupportLevel { get; set; }

    public string? PrescriberName { get; set; }
    public string? PharmacyName { get; set; }

    /// <summary>How this medication is physically packaged for administration.</summary>
    public PackagingType Packaging { get; set; } = PackagingType.OriginalPackaging;

    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public DateTime? NextReviewDue { get; set; }

    public bool ConsentObtained { get; set; }
    public string? ConsentGivenBy { get; set; }
    public DateTime? ConsentDate { get; set; }

    public string? StorageRequirements { get; set; }
    public MedicationStatus Status { get; set; } = MedicationStatus.Active;
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<MedicationAdministration> Administrations { get; set; } = new List<MedicationAdministration>();
}
