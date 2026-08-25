using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// MEDICATION MANAGEMENT DTOs
// ══════════════════════════════════════════════════════════════

public record MedicationListDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Strength { get; init; }
    public MedicationForm Form { get; init; }
    public MedicationRoute Route { get; init; }
    public string DoseDescription { get; init; } = string.Empty;
    public MedicationType Type { get; init; }
    public string? TimesOfDay { get; init; }
    public MedicationStatus Status { get; init; }
    public bool IsHighRisk { get; init; }
    public bool IsPsychotropic { get; init; }
    public bool IsChemicalRestraint { get; init; }
    public DrugSchedule DrugSchedule { get; init; }
    public MedicationSupportLevel SupportLevel { get; init; }
    public PackagingType Packaging { get; init; }
    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public DateTime? NextReviewDue { get; init; }
    public List<string> ComplianceFlags { get; init; } = new();
}

public record MedicationDetailDto : MedicationListDto
{
    public string? Directions { get; init; }
    public string? PrnIndication { get; init; }
    public int? PrnMaxDosesPer24h { get; init; }
    public int? PrnMinIntervalMinutes { get; init; }
    public string? Purpose { get; init; }
    public bool BspInPlace { get; init; }
    public string? RestrictivePracticeAuthorisationRef { get; init; }
    public bool IsHighIntensitySupport { get; init; }
    public string? PrescriberName { get; init; }
    public string? PharmacyName { get; init; }
    public bool ConsentObtained { get; init; }
    public string? ConsentGivenBy { get; init; }
    public DateTime? ConsentDate { get; init; }
    public string? StorageRequirements { get; init; }
    public string? Notes { get; init; }
    public int PrnDosesInLast24h { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateMedicationDto
{
    [Required, StringLength(200)]
    public string Name { get; init; } = string.Empty;

    [StringLength(100)]
    public string? Strength { get; init; }

    public MedicationForm Form { get; init; }
    public MedicationRoute Route { get; init; }

    [Required, StringLength(200)]
    public string DoseDescription { get; init; } = string.Empty;

    [StringLength(1000)]
    public string? Directions { get; init; }

    public MedicationType Type { get; init; }

    [StringLength(200)]
    public string? TimesOfDay { get; init; }

    [StringLength(500)]
    public string? PrnIndication { get; init; }
    public int? PrnMaxDosesPer24h { get; init; }
    public int? PrnMinIntervalMinutes { get; init; }

    [StringLength(500)]
    public string? Purpose { get; init; }
    public bool IsPsychotropic { get; init; }
    public bool IsChemicalRestraint { get; init; }
    public bool BspInPlace { get; init; }

    [StringLength(200)]
    public string? RestrictivePracticeAuthorisationRef { get; init; }
    public bool IsHighRisk { get; init; }
    public bool IsHighIntensitySupport { get; init; }
    public DrugSchedule DrugSchedule { get; init; }
    public MedicationSupportLevel SupportLevel { get; init; }

    [StringLength(200)]
    public string? PrescriberName { get; init; }

    [StringLength(200)]
    public string? PharmacyName { get; init; }
    public PackagingType Packaging { get; init; } = PackagingType.OriginalPackaging;

    public DateTime StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public DateTime? NextReviewDue { get; init; }

    public bool ConsentObtained { get; init; }

    [StringLength(200)]
    public string? ConsentGivenBy { get; init; }
    public DateTime? ConsentDate { get; init; }

    [StringLength(500)]
    public string? StorageRequirements { get; init; }

    [StringLength(2000)]
    public string? Notes { get; init; }
}

public record UpdateMedicationDto : CreateMedicationDto
{
    public MedicationStatus Status { get; init; } = MedicationStatus.Active;
}

public record AdministrationDto
{
    public Guid Id { get; init; }
    public Guid ParticipantMedicationId { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string MedicationName { get; init; } = string.Empty;
    public string DoseDescription { get; init; } = string.Empty;
    public Guid? TripInstanceId { get; init; }
    public DateTime? ScheduledAt { get; init; }
    public DateTime? AdministeredAt { get; init; }
    public MedicationAdministrationStatus Status { get; init; }
    public string? DoseGiven { get; init; }
    public string RecordedByName { get; init; } = string.Empty;
    public string? WitnessName { get; init; }
    public string? Reason { get; init; }
    public string? PrnReason { get; init; }
    public string? PrnOutcome { get; init; }
    public DateTime? PrnOutcomeAt { get; init; }
    public bool LimitBreachAcknowledged { get; init; }
    public string? Notes { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record CreateAdministrationDto
{
    public DateTime? ScheduledAt { get; init; }
    public DateTime? AdministeredAt { get; init; }
    public MedicationAdministrationStatus Status { get; init; }

    [StringLength(200)]
    public string? DoseGiven { get; init; }

    [StringLength(200)]
    public string? WitnessName { get; init; }

    [StringLength(1000)]
    public string? Reason { get; init; }

    [StringLength(500)]
    public string? PrnReason { get; init; }

    [StringLength(1000)]
    public string? Notes { get; init; }
    public Guid? TripInstanceId { get; init; }
    public bool AcknowledgeLimitBreach { get; init; }
}

public record UpdateAdministrationDto
{
    public MedicationAdministrationStatus Status { get; init; }
    public DateTime? AdministeredAt { get; init; }

    [StringLength(200)]
    public string? DoseGiven { get; init; }

    [StringLength(200)]
    public string? WitnessName { get; init; }

    [StringLength(1000)]
    public string? Reason { get; init; }

    [StringLength(500)]
    public string? PrnReason { get; init; }

    [StringLength(1000)]
    public string? PrnOutcome { get; init; }
    public DateTime? PrnOutcomeAt { get; init; }

    [StringLength(1000)]
    public string? Notes { get; init; }
}

public record RecordPrnOutcomeDto
{
    [Required, StringLength(1000)]
    public string PrnOutcome { get; init; } = string.Empty;
}

public record MarEntryDto
{
    public Guid MedicationId { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string MedicationName { get; init; } = string.Empty;
    public string? Strength { get; init; }
    public string DoseDescription { get; init; } = string.Empty;
    public MedicationForm Form { get; init; }
    public MedicationRoute Route { get; init; }
    public PackagingType Packaging { get; init; }

    /// <summary>"08:00" — the time-of-day slot this entry expands.</summary>
    public string ScheduledTime { get; init; } = string.Empty;
    public DateTime ScheduledAt { get; init; }
    public bool IsHighRisk { get; init; }
    public MedicationSupportLevel SupportLevel { get; init; }
    public bool IsOverdue { get; init; }
    public AdministrationDto? Administration { get; init; }
}

public record MarPrnDto
{
    public Guid MedicationId { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Strength { get; init; }
    public string DoseDescription { get; init; } = string.Empty;
    public string? PrnIndication { get; init; }
    public int? PrnMaxDosesPer24h { get; init; }
    public int? PrnMinIntervalMinutes { get; init; }
    public int DosesInLast24h { get; init; }
    public DateTime? LastDoseAt { get; init; }

    /// <summary>Most recent Administered PRN record still missing a PrnOutcome, if any.</summary>
    public Guid? OutcomePendingAdministrationId { get; init; }
}

public record MarDayDto
{
    public DateOnly Date { get; init; }
    public List<MarEntryDto> Entries { get; init; } = new();
    public List<MarPrnDto> PrnMedications { get; init; } = new();
}
