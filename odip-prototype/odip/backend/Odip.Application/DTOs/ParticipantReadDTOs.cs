using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT DTOs
// ══════════════════════════════════════════════════════════════

public record ParticipantListDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string? PreferredName { get; init; }
    public string FullName { get; init; } = string.Empty;
    public string? MaskedNdisNumber { get; init; }
    public PlanType PlanType { get; init; }
    public string? Region { get; init; }
    public bool IsRepeatClient { get; init; }
    public bool IsActive { get; init; }
    public bool MobilityAidWheelchair { get; init; }
    public bool MobilityAidWalker { get; init; }
    public bool IsHighSupport { get; init; }
    public bool IsIntensiveSupport { get; init; }
    public SupportRatio SupportRatio { get; init; }
    public OvernightSupportType OvernightSupport { get; init; }
    public bool HasRestrictivePracticeFlag { get; init; }
    public ServiceStreams ServiceStreams { get; init; }
    /// <summary>Derived: true iff the participant has any non-Ceased ParticipantMedication row.</summary>
    public bool HasActiveMedications { get; init; }
    /// <summary>INTAKE-08. See <see cref="Odip.Domain.Entities.Participant.IsDraft"/>.</summary>
    public bool IsDraft { get; init; }
    /// <summary>
    /// What is missing before this participant is fully ready (intake, onboarding, signed service
    /// agreement), as human strings. Null (omitted from the JSON) when nothing is missing. Shown as
    /// a quiet warning in Warn mode; never blocks anything on its own. Set by the participant list
    /// and detail reads only.
    /// </summary>
    public List<string>? ReadinessIssues { get; init; }
    /// <summary>SPEC-05 PF-10.5. See <see cref="Odip.Domain.Entities.Participant.IntakeCompletedAt"/>.</summary>
    public DateTime? IntakeCompletedAt { get; init; }
    /// <summary>When "Begin services" was used. See <see cref="Odip.Domain.Entities.Participant.ServicesStartedAt"/>.</summary>
    public DateTime? ServicesStartedAt { get; init; }
}

public record ParticipantDetailDto : ParticipantListDto
{
    /// <summary>Revision of each scalar PATCH group (see ParticipantGroupRevisions). Set on the staff detail GET only.</summary>
    public Dictionary<string, int>? GroupRevisions { get; init; }
    /// <summary>The tenant-owned inquiry selected for converted-intake continuity, if any.</summary>
    public Guid? InquiryId { get; init; }
    public string? InquirySource { get; init; }
    public string? InquiryProvenance { get; init; }
    /// <summary>INTAKE sub-wave A, PID-004.</summary>
    public string? MiddleName { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    public Gender? Gender { get; init; }
    public string? GenderSelfDescription { get; init; }
    /// <summary>INTAKE sub-wave A, PID-010.</summary>
    public string? PlaceOfBirth { get; init; }
    /// <summary>INTAKE sub-wave A, CON-006.</summary>
    public string? Country { get; init; }
    /// <summary>INTAKE sub-wave A, CON-007 — the participant's own phone (not a Contact's).</summary>
    public string? Phone { get; init; }
    /// <summary>INTAKE sub-wave A, CON-008 — the participant's own email (not a Contact's).</summary>
    public string? Email { get; init; }
    public string? NdisNumber { get; init; }
    public DateOnly? PlanStartDate { get; init; }
    public DateOnly? PlanEndDate { get; init; }
    /// <summary>INTAKE sub-wave A, NDIS-006 — Disability Support for Older Australians.</summary>
    public bool IsDsoa { get; init; }
    public ParticipantFundingSource FundingSource { get; init; }
    public string? FundingOrganisation { get; init; }
    /// <summary>LIVING-01.</summary>
    public LivingArrangement? LivingArrangement { get; init; }
    public string? MainSupportPersonName { get; init; }
    public string? MainSupportPersonRelationship { get; init; }
    public string? OthersLivingInAccommodation { get; init; }
    public string? ResidentialInfo { get; init; }
    public bool? LivesWithOthers { get; init; }
    public string? WhoLivesWith { get; init; }
    public string? SilProviderName { get; init; }
    public string? SilProviderContactPhone { get; init; }
    public string? AccommodationType { get; init; }
    public string? OnSiteSupportHours { get; init; }
    public string? LivingArrangementNotes { get; init; }
    /// <summary>INTAKE-06.</summary>
    public string? AddressStreet { get; init; }
    public string? AddressSuburb { get; init; }
    public string? AddressState { get; init; }
    public string? AddressPostcode { get; init; }
    public int? MmLevel { get; init; }
    public List<string> MobilitySupportOptions { get; init; } = new();
    /// <summary>DIAG-01.</summary>
    public string? PrimaryDiagnosis { get; init; }
    /// <summary>DIAG-01.</summary>
    public List<string> OtherDiagnoses { get; init; } = new();
    /// <summary>DIAG-02.</summary>
    public HidpaSupportCategory HidpaSupportCategories { get; init; }
    /// <summary>DIAG-02/INTAKE-03 reconciliation. See <see cref="Entities.Participant.HidpaNotes"/>'s doc.</summary>
    public string? HidpaNotes { get; init; }
    public SupportRatio OvernightRatio { get; init; }
    public bool RequiresHiLoBed { get; init; }
    public bool RequiresHoist { get; init; }
    public bool RequiresShowerChair { get; init; }
    public bool RequiresCommode { get; init; }
    public bool RequiresStandingMachine { get; init; }
    public string? MobilityNotes { get; init; }
    public string? EquipmentRequirements { get; init; }
    public string? TransportRequirements { get; init; }
    public string? MedicalSummary { get; init; }
    public string? BehaviourRiskSummary { get; init; }
    public string? Notes { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public Guid? PreferredStaffId { get; init; }
    public string? PreferredStaffName { get; init; }

    // INTAKE sub-wave A — Key Identifiers step (Master Data Dictionary CARD-*/PHY-*). See
    // Participant.cs's field group doc for the full rationale/deferred-fields note.
    public string? PensionCardNumber { get; init; }
    public DateOnly? PensionCardExpiry { get; init; }
    public string? MedicareNumber { get; init; }
    public DateOnly? MedicareExpiry { get; init; }
    public string? CompanionCardNumber { get; init; }
    public DateOnly? CompanionCardExpiry { get; init; }
    public string? PrivateHealthFund { get; init; }
    public string? PrivateHealthMembershipNumber { get; init; }
    public string? TaxiCardNumber { get; init; }
    public string? HairColour { get; init; }
    public string? EyeColour { get; init; }
    public decimal? WeightKg { get; init; }
    public decimal? HeightCm { get; init; }

    // INTAKE sub-wave B — Cultural & Consent step. See Participant.cs's field group doc.
    public bool? IsCald { get; init; }
    public bool? IsLgbtqi { get; init; }
    public bool? IsFamilyCommunity { get; init; }
    public bool? IsAboriginalOrTorresStraitIslander { get; init; }
    public bool? ReceivedRightsAndResponsibilitiesInfo { get; init; }
    public bool? ReceivedPrivacyAndConfidentialityInfo { get; init; }
    public bool? ReceivedFeedbackInfo { get; init; }
    public bool? ReceivedBeingSafeInfo { get; init; }
    public bool? ReceivedAdvocacyInfo { get; init; }
    public string? PersonalInterests { get; init; }
    public string? ChoiceControlNotes { get; init; }
    /// <summary>Always all seven <see cref="Domain.Enums.ConsentType"/> entries — see ParticipantConsentsController.GetForParticipant.</summary>
    public List<ParticipantConsentDto> Consents { get; init; } = new();

    // ── INTAKE sub-wave C1 — Allergies/Anaphylaxis (Medical step). See Participant.cs's field group doc.
    public string? AllergiesDetail { get; init; }
    public bool? IsAnaphylaxisRisk { get; init; }
    public string? AllergyManagementNotes { get; init; }

    /// <summary>Always all ten <see cref="Domain.Enums.HealthConditionType"/> entries — see ParticipantHealthConditionsController.GetForParticipant.</summary>
    public List<ParticipantHealthConditionDto> HealthConditions { get; init; } = new();

    // ── INTAKE sub-wave C1 — Mobility & Functional (Support Needs & Mobility step). See Participant.cs's field group doc.
    public AmbulantStatus? AmbulantStatus { get; init; }
    public RiskRatingLevel? FallsRiskRating { get; init; }
    public bool? UnevenGroundFlag { get; init; }
    public PersonalCareLevel? LevelOfPersonalCare { get; init; }
    public string? Orthotics { get; init; }
    public string? ContinenceSupportDetail { get; init; }
    public string? BowelCareDetail { get; init; }
    public string? MenstruationSupport { get; init; }
    public string? SkinIntegrity { get; init; }

    // ── INTAKE sub-wave C1 — Behaviour & Communication (new step). See Participant.cs's field group doc.
    public MemoryLevel? Memory { get; init; }
    public bool? MemoryAids { get; init; }
    public bool? ImpairedUnderstanding { get; init; }
    public bool? ImpairedJudgementReasoning { get; init; }
    public bool? BehavioursOfConcernCurrent { get; init; }
    public bool? BehavioursOfConcernFiveYearHistory { get; init; }
    public RiskRatingLevel? BehaviourRiskRating { get; init; }
    public bool? RidsLogged { get; init; }
    public bool? BspPlanProvided { get; init; }
    public bool? BocChartProvided { get; init; }
    public string? ExpressiveSkills { get; init; }
    public string? ReceptiveSkills { get; init; }
    public string? ReadingAbility { get; init; }
    public string? CommunicationAids { get; init; }

    // ── INTAKE sub-wave C2 — the structured ADL rating grid (Daily Living step). See Participant.cs's field group doc.
    /// <summary>Always all twenty <see cref="Domain.Enums.AdlType"/> entries — see ParticipantAdlAssessmentsController.GetForParticipant.</summary>
    public List<ParticipantAdlAssessmentDto> AdlAssessments { get; init; } = new();

    /// <summary>INTAKE-03/04, CommunityAccessDailyLiving stream. Always all twenty-one <see cref="Domain.Enums.ChecklistItemType"/> entries — see ParticipantChecklistItemsController.MaterializeAll.</summary>
    public List<ParticipantChecklistItemDto> ChecklistItems { get; init; } = new();

    // ── INTAKE sub-wave C2 — Meals & Diet (Daily Living step). See Participant.cs's field group doc.
    public string? MealAssistanceDetail { get; init; }
    public string? ChokingRiskMealDetail { get; init; }
    public string? ModifiedDietDetail { get; init; }
    public string? PegRegimeMealDetail { get; init; }
    public string? SpecialUtensilsDetail { get; init; }
    public string? SpecialDietaryNeedsDetail { get; init; }
    public string? FavouriteBreakfast { get; init; }
    public string? FavouriteLunch { get; init; }
    public string? FavouriteDinner { get; init; }
    public string? MedicationTricks { get; init; }
    public string? FoodsAlwaysEaten { get; init; }

    // ── INTAKE sub-wave C2 — About Me (Daily Living step). See Participant.cs's field group doc.
    public string? Goals { get; init; }
    public string? SupportAreas { get; init; }
    public string? StrengthsFears { get; init; }
    public string? ThingsToKnow { get; init; }
    public string? WhoIsImportant { get; init; }
    public string? LikesDislikes { get; init; }

    // ── INTAKE-03 — Community Access Behaviour & Support Detail (CommunityAccessDailyLiving stream). See Participant.cs's field group doc.
    public string? SignsHappyAndSettled { get; init; }
    public string? WhatHelpsMeCalmDown { get; init; }
    public string? BocTriggers { get; init; }
    public string? BocEarlyWarningSigns { get; init; }
    public string? BocDeEscalationStrategies { get; init; }
    public string? BocWhatNotToDo { get; init; }
    public string? SupportsLookLikeMorning { get; init; }
    public string? SupportsLookLikeDay { get; init; }
    public string? SupportsLookLikeAfternoonEvening { get; init; }
    public string? SupportsLookLikeOvernight { get; init; }

    /// <summary>PF-10.2. Always all twenty-two <see cref="Domain.Enums.CommunityAccessRiskItemType"/> entries — see ParticipantCommunityAccessRiskItemsController.GetForParticipant.</summary>
    public List<ParticipantCommunityAccessRiskItemDto> CommunityAccessRiskItems { get; init; } = new();
    /// <summary>PF-10.2 — the risk matrix's 23rd, non-itemised overall rating. See Participant.cs's field doc.</summary>
    public RiskRatingLevel? OverallCommunityAccessRiskRating { get; init; }

    /// <summary>PF-2 (SPEC-02): advisory-only plan-type↔contact-role completeness warning, computed
    /// from the participant's persisted active <c>ContactRoles</c> via
    /// <see cref="ContactRoleRules.PlanTypeComplianceWarning"/>. Null when the condition for this
    /// participant's <see cref="PlanType"/> is satisfied (or there is no condition, e.g.
    /// SelfManaged). Never blocks a save — see that method's doc for the full rule table.</summary>
    public string? PlanTypeComplianceWarning { get; init; }
}
