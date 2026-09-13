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
    public MedicationFrequency Frequency { get; init; }
    public List<string> DaysOfWeek { get; init; } = new();
    public int? IntervalDays { get; init; }
    public DateOnly? AnchorDate { get; init; }
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
    /// <summary>MED-01: shown as a "call the pharmacy on ..." tap-to-call link in the missed-medication guidance when present.</summary>
    public string? PharmacyPhone { get; init; }
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

    public MedicationFrequency Frequency { get; init; } = MedicationFrequency.Daily;

    /// <summary>Weekday names (e.g. "Monday"), required when Frequency is SpecificDays.</summary>
    public List<string> DaysOfWeek { get; init; } = new();

    /// <summary>Required when Frequency is EveryNDays.</summary>
    public int? IntervalDays { get; init; }

    /// <summary>Required when Frequency is EveryNDays — the reference date the interval counts from.</summary>
    public DateOnly? AnchorDate { get; init; }

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

    [StringLength(30)]
    public string? PharmacyPhone { get; init; }
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

    /// <summary>The IANA time zone (e.g. "Australia/Sydney") the client was in when it captured
    /// <see cref="AdministeredAt"/> — null when there's no client-supplied timestamp to anchor
    /// (no-JS fallback) or for records predating this field.</summary>
    public string? AdministeredAtTimeZone { get; init; }
    public MedicationAdministrationStatus Status { get; init; }
    public string? DoseGiven { get; init; }
    public string RecordedByName { get; init; } = string.Empty;
    public Guid? RecordedByUserId { get; init; }
    public string? WitnessName { get; init; }
    public Guid? WitnessStaffId { get; init; }
    public WitnessStatus WitnessStatus { get; init; }
    public DateTime? WitnessRequestedAt { get; init; }
    public DateTime? WitnessRespondedAt { get; init; }
    public string? Reason { get; init; }
    public string? PrnReason { get; init; }
    public string? PrnOutcome { get; init; }
    public DateTime? PrnOutcomeAt { get; init; }
    public bool LimitBreachAcknowledged { get; init; }
    public string? Notes { get; init; }
    public DateTime CreatedAt { get; init; }

    /// <summary>Connection-map reverse link (Deliverable 2): id of the newest active
    /// <see cref="Odip.Domain.Entities.IncidentReport"/> whose MedicationAdministrationId points
    /// back at this administration, or null when none does.</summary>
    public Guid? IncidentId { get; init; }
}

public record CreateAdministrationDto
{
    public DateTime? ScheduledAt { get; init; }
    public DateTime? AdministeredAt { get; init; }

    /// <summary>The IANA time zone (e.g. "Australia/Sydney") the client's clock was set to when
    /// it captured <see cref="AdministeredAt"/> — optional; omit for the no-JS-timestamp fallback
    /// (server stamps <see cref="MedicationAdministrationStatus"/>-appropriate UTC time with no
    /// zone recorded).</summary>
    [StringLength(100)]
    public string? AdministeredAtTimeZone { get; init; }
    public MedicationAdministrationStatus Status { get; init; }

    [StringLength(200)]
    public string? DoseGiven { get; init; }

    /// <summary>Legacy free-text witness — still honoured for backward compatibility when
    /// <see cref="WitnessStaffId"/> isn't supplied, but new callers should select a staff witness.</summary>
    [StringLength(200)]
    public string? WitnessName { get; init; }

    /// <summary>The staff member selected to witness a high-risk administration. Puts the record
    /// into <see cref="WitnessStatus.Pending"/> for that staff member to approve/decline in their portal.</summary>
    public Guid? WitnessStaffId { get; init; }

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

    /// <summary>See <see cref="CreateAdministrationDto.AdministeredAtTimeZone"/>. Amending an
    /// administration that didn't change its recorded time should pass through the existing
    /// value rather than clearing it.</summary>
    [StringLength(100)]
    public string? AdministeredAtTimeZone { get; init; }

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
    /// <summary>MED-01: surfaced in the missed-medication guidance's "check the packaging /
    /// call the pharmacy" step when present.</summary>
    public string? PharmacyName { get; init; }
    public string? PharmacyPhone { get; init; }

    /// <summary>"08:00" — the time-of-day slot this entry expands.</summary>
    public string ScheduledTime { get; init; } = string.Empty;
    public DateTime ScheduledAt { get; init; }
    public bool IsHighRisk { get; init; }
    public MedicationSupportLevel SupportLevel { get; init; }
    public bool IsOverdue { get; init; }
    public AdministrationDto? Administration { get; init; }

    /// <summary>Connection-map reverse link (Deliverable 2): mirrors <see cref="AdministrationDto.IncidentId"/>
    /// when <see cref="Administration"/> is present, null otherwise (no administration means no
    /// MedicationAdministrationId for an incident to reference).</summary>
    public Guid? IncidentId { get; init; }
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
    public PackagingType Packaging { get; init; }
    /// <summary>MED-01: same as <see cref="MarEntryDto.PharmacyName"/> — surfaced in the
    /// missed-medication guidance when a PRN dose is recorded as refused/withheld/missed/wrong.</summary>
    public string? PharmacyName { get; init; }
    public string? PharmacyPhone { get; init; }
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
