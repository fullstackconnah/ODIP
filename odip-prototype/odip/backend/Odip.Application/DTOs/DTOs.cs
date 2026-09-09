using System.ComponentModel.DataAnnotations;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
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
    /// <summary>SPEC-05 PF-10.5. See <see cref="Odip.Domain.Entities.Participant.IntakeCompletedAt"/>.</summary>
    public DateTime? IntakeCompletedAt { get; init; }
}

public record ParticipantDetailDto : ParticipantListDto
{
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

    /// <summary>INTAKE-03/04, CommunityAccessDailyLiving stream. Always all twenty-one <see cref="Domain.Enums.ChecklistItemType"/> entries — see ParticipantChecklistItemsController.GetForParticipant.</summary>
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

public record CreateParticipantDto
{
    // INTAKE-08: deliberately NOT [Required] (unlike every other truly-mandatory field in this
    // codebase, requiredness here is enforced via ParticipantsController.ValidateNames, not a
    // DataAnnotation) — a [Required] attribute is checked by ASP.NET's automatic [ApiController]
    // model-validation filter BEFORE the action method runs, which would 400 a draft save with
    // both names blank before ValidateNames ever got a chance to relax that to "at least one of
    // the two", and would answer with a generic ProblemDetails body rather than this codebase's
    // ApiResponse-shaped error (same reasoning as ValidateAddressPostcode's doc on why format
    // checks here are hand-written rather than attribute-driven).
    [StringLength(100)]
    public string FirstName { get; init; } = string.Empty;
    [StringLength(100)]
    public string LastName { get; init; } = string.Empty;
    /// <summary>
    /// INTAKE-08: true for a "Save as draft" wizard call (relaxes ValidateNames to "at least one
    /// of FirstName/LastName"). Every other validator in ParticipantsController still runs
    /// identically for a draft, since a provided value being internally inconsistent, e.g.
    /// FundingSource=Other with no FundingOrganisation, is never OK regardless of draft status —
    /// with one further exception (fix round 2, Finding 1): ValidateContactRoles also relaxes
    /// for a draft, skipping (rather than hard-failing on) a <see cref="ContactRoles"/> row that
    /// identifies no person at all, since the wizard's Contacts step lets a row be added and then
    /// abandoned mid-fill before a draft save. False (the default) is a normal, fully-validated
    /// create/update, and is also what a final submission from the wizard's Review step sends to
    /// clear a participant's existing draft flag back off.
    /// </summary>
    public bool IsDraft { get; init; }
    /// <summary>
    /// SPEC-05 (PF-10.3/PF-10.5) — set true by the Intake wizard's final-step submission to stamp
    /// <see cref="Odip.Domain.Entities.Participant.IntakeCompletedAt"/> server-side. Deliberately
    /// distinct from <see cref="IsDraft"/>: a mid-intake "save as draft" call still creates/updates
    /// the row (IsDraft=true) without this flag, so it must NOT also stamp IntakeCompletedAt.
    /// Read on BOTH call sites as of PF-10.5: Create (a brand-new Intake) and Update (resuming an
    /// existing Intake draft whose IntakeCompletedAt is still null — see
    /// ParticipantsController.Update's handling, which never overwrites an already-set value and
    /// never touches IsDraft). PF-10.3's original note said Update ignored this flag entirely;
    /// PF-10.5 revises that once the resume-Intake flow needed a way to finish stamping an
    /// existing draft row rather than creating a second Participant.
    /// </summary>
    public bool CompleteIntake { get; init; }
    [StringLength(100)]
    public string? PreferredName { get; init; }
    /// <summary>INTAKE sub-wave A, PID-004.</summary>
    [StringLength(100)]
    public string? MiddleName { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    public Gender? Gender { get; init; }
    /// <summary>Only meaningful (and validated server-side) when Gender is "Other".</summary>
    [StringLength(200)]
    public string? GenderSelfDescription { get; init; }
    /// <summary>INTAKE sub-wave A, PID-010.</summary>
    [StringLength(200)]
    public string? PlaceOfBirth { get; init; }
    /// <summary>INTAKE sub-wave A, CON-006.</summary>
    [StringLength(100)]
    public string? Country { get; init; }
    /// <summary>INTAKE sub-wave A, CON-007 — the participant's own phone. Format validated
    /// server-side (see ParticipantsController.ValidatePhone) whenever provided; absence never
    /// blocks a draft (INTAKE-08 doctrine).</summary>
    [StringLength(30)]
    public string? Phone { get; init; }
    /// <summary>INTAKE sub-wave A, CON-008 — the participant's own email. Format validated
    /// server-side (see ParticipantsController.ValidateEmail) whenever provided; absence never
    /// blocks a draft.</summary>
    [StringLength(200)]
    public string? Email { get; init; }
    [StringLength(20)]
    public string? NdisNumber { get; init; }
    public DateOnly? PlanStartDate { get; init; }
    public DateOnly? PlanEndDate { get; init; }
    public PlanType PlanType { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    /// <summary>INTAKE sub-wave A, NDIS-006 — Disability Support for Older Australians, labelled
    /// in full on the wizard. Defaults false; standalone from FundingSource (see Participant.cs's
    /// doc for why folding it into FundingSource=Other would be lossy).</summary>
    public bool IsDsoa { get; init; }
    /// <summary>FUND-02. Defaults to Ndis — matches the entity default and the migration backfill.</summary>
    public ParticipantFundingSource FundingSource { get; init; } = ParticipantFundingSource.Ndis;
    /// <summary>Reused "Other — specify" field: required (and validated server-side, see
    /// ParticipantsController.ValidateFundingSource) iff FundingSource is Other; ignored when Ndis.</summary>
    [StringLength(200)]
    public string? FundingOrganisation { get; init; }
    /// <summary>LIVING-01. Nullable — unset until intake captures it.</summary>
    public LivingArrangement? LivingArrangement { get; init; }
    /// <summary>LIVING-02 (Family). Required (server-side, see ValidateLivingArrangement) iff LivingArrangement is Family.</summary>
    [StringLength(200)]
    public string? MainSupportPersonName { get; init; }
    [StringLength(100)]
    public string? MainSupportPersonRelationship { get; init; }
    [StringLength(2000)]
    public string? OthersLivingInAccommodation { get; init; }
    [StringLength(2000)]
    public string? ResidentialInfo { get; init; }
    /// <summary>LIVING-03 (Independent).</summary>
    public bool? LivesWithOthers { get; init; }
    /// <summary>Required (server-side) iff LivingArrangement is Independent and LivesWithOthers is true.</summary>
    [StringLength(2000)]
    public string? WhoLivesWith { get; init; }
    /// <summary>LIVING-04 (Supported Accommodation). Required (server-side) iff LivingArrangement is SupportedAccommodation.</summary>
    [StringLength(200)]
    public string? SilProviderName { get; init; }
    [StringLength(20)]
    public string? SilProviderContactPhone { get; init; }
    [StringLength(100)]
    public string? AccommodationType { get; init; }
    [StringLength(100)]
    public string? OnSiteSupportHours { get; init; }
    /// <summary>Shared across all three arrangement types — see Participant.LivingArrangementNotes.</summary>
    [StringLength(2000)]
    public string? LivingArrangementNotes { get; init; }
    /// <summary>INTAKE-06 — structured address.</summary>
    [StringLength(200)]
    public string? AddressStreet { get; init; }
    [StringLength(100)]
    public string? AddressSuburb { get; init; }
    [StringLength(10)]
    public string? AddressState { get; init; }
    /// <summary>4-digit AU postcode. Format validated server-side (see ValidateAddressPostcode), not via [RegularExpression], to match this codebase's controller-level custom-validator convention (mirrors ValidateGender/ValidateFundingSource) rather than ASP.NET's automatic DataAnnotations pipeline, which controller unit tests bypass.</summary>
    [StringLength(4)]
    public string? AddressPostcode { get; init; }
    public bool IsRepeatClient { get; init; }
    public bool MobilityAidWheelchair { get; init; }
    public bool MobilityAidWalker { get; init; }
    public List<string> MobilitySupportOptions { get; init; } = new();
    /// <summary>DIAG-01. Free text — selected from the curated picklist or typed via "Other — specify"; see Diagnoses.cs's type doc.</summary>
    [StringLength(200)]
    public string? PrimaryDiagnosis { get; init; }
    /// <summary>DIAG-01. Each entry validated server-side (see ValidateDiagnoses) for non-blank + length only, not against the curated set.</summary>
    public List<string> OtherDiagnoses { get; init; } = new();
    /// <summary>DIAG-02. Defaults to None — untagged until intake captures it.</summary>
    public HidpaSupportCategory HidpaSupportCategories { get; init; } = HidpaSupportCategory.None;
    /// <summary>DIAG-02/INTAKE-03 reconciliation. See <see cref="Entities.Participant.HidpaNotes"/>'s doc.</summary>
    [StringLength(2000)]
    public string? HidpaNotes { get; init; }
    public bool IsHighSupport { get; init; }
    public bool IsIntensiveSupport { get; init; }
    public OvernightSupportType OvernightSupport { get; init; }
    public SupportRatio OvernightRatio { get; init; } = SupportRatio.OneToOne;
    public bool RequiresHiLoBed { get; init; }
    public bool RequiresHoist { get; init; }
    public bool RequiresShowerChair { get; init; }
    public bool RequiresCommode { get; init; }
    public bool RequiresStandingMachine { get; init; }
    // HasRestrictivePracticeFlag is intentionally NOT here — it is derived (true iff the
    // participant has any active RestrictivePractice register row) and can no longer be set
    // independently via create/update. See ParticipantListDto/ParticipantDetailDto for the
    // read-only computed value.
    public SupportRatio SupportRatio { get; init; }
    [StringLength(2000)]
    public string? MobilityNotes { get; init; }
    [StringLength(2000)]
    public string? EquipmentRequirements { get; init; }
    [StringLength(2000)]
    public string? TransportRequirements { get; init; }
    [StringLength(4000)]
    public string? MedicalSummary { get; init; }
    [StringLength(4000)]
    public string? BehaviourRiskSummary { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
    public Guid? PreferredStaffId { get; init; }
    public ServiceStreams ServiceStreams { get; init; } = ServiceStreams.None;
    /// <summary>
    /// INTAKE-09. Repeatable risk-entry rows captured at intake, created transactionally with the
    /// participant — see ParticipantsController.Create. Edit-mode manages risk entries via the
    /// separate nested CRUD (ParticipantRiskEntriesController) instead: despite this list being
    /// inherited onto UpdateParticipantDto below, ParticipantsController.Update never reads it.
    /// </summary>
    public List<CreateParticipantRiskEntryDto> RiskEntries { get; init; } = new();

    /// <summary>
    /// CONTACT-02: contact roles captured on the wizard's Contacts step (placed after NDIS &amp;
    /// Funding — see ParticipantCreatePage.tsx's WIZARD_STEPS), created transactionally with the
    /// participant exactly like RiskEntries above. Edit-mode manages contact roles afterwards via
    /// the separate nested CRUD (ParticipantContactRolesController) instead — ParticipantsController.Update
    /// never reads this list, same convention as RiskEntries.
    /// </summary>
    public List<CreateParticipantContactRoleDto> ContactRoles { get; init; } = new();

    // INTAKE sub-wave A — Key Identifiers step (Master Data Dictionary CARD-*/PHY-*). All
    // optional; see Participant.cs's field group doc for the full rationale and the
    // deliberately-deferred/omitted fields (Photo, a second Plan Number).
    [StringLength(50)]
    public string? PensionCardNumber { get; init; }
    public DateOnly? PensionCardExpiry { get; init; }
    [StringLength(50)]
    public string? MedicareNumber { get; init; }
    public DateOnly? MedicareExpiry { get; init; }
    [StringLength(50)]
    public string? CompanionCardNumber { get; init; }
    public DateOnly? CompanionCardExpiry { get; init; }
    [StringLength(100)]
    public string? PrivateHealthFund { get; init; }
    [StringLength(50)]
    public string? PrivateHealthMembershipNumber { get; init; }
    [StringLength(50)]
    public string? TaxiCardNumber { get; init; }
    [StringLength(50)]
    public string? HairColour { get; init; }
    [StringLength(50)]
    public string? EyeColour { get; init; }
    public decimal? WeightKg { get; init; }
    public decimal? HeightCm { get; init; }

    // INTAKE sub-wave B — Cultural & Consent step (Master Data Dictionary CUL-*). All optional;
    // see Participant.cs's field group doc for the full rationale and the IsLgbtqi naming flag.
    public bool? IsCald { get; init; }
    public bool? IsLgbtqi { get; init; }
    public bool? IsFamilyCommunity { get; init; }
    public bool? IsAboriginalOrTorresStraitIslander { get; init; }
    public bool? ReceivedRightsAndResponsibilitiesInfo { get; init; }
    public bool? ReceivedPrivacyAndConfidentialityInfo { get; init; }
    public bool? ReceivedFeedbackInfo { get; init; }
    public bool? ReceivedBeingSafeInfo { get; init; }
    public bool? ReceivedAdvocacyInfo { get; init; }
    [StringLength(2000)]
    public string? PersonalInterests { get; init; }
    [StringLength(2000)]
    public string? ChoiceControlNotes { get; init; }
    /// <summary>
    /// Consent rows captured on the wizard's Cultural &amp; Consent step, upserted transactionally
    /// with the participant — see ParticipantsController.UpsertConsentsAsync. Unlike RiskEntries/
    /// ContactRoles (create-mode-only fields), this list is read by BOTH Create and Update: consent
    /// answers are meant to keep being fillable across draft saves and full edits, not just at
    /// initial intake, and the detail page's nested CRUD (ParticipantConsentsController) is an
    /// additional, always-available write path for the same data.
    /// </summary>
    public List<CreateParticipantConsentDto> Consents { get; init; } = new();

    // ── INTAKE sub-wave C1 — Allergies/Anaphylaxis (Medical step, Master Data Dictionary MED-012). All optional.
    [StringLength(2000)]
    public string? AllergiesDetail { get; init; }
    public bool? IsAnaphylaxisRisk { get; init; }
    [StringLength(2000)]
    public string? AllergyManagementNotes { get; init; }

    /// <summary>
    /// INTAKE sub-wave C1 — the structured health-condition grid, upserted transactionally with
    /// the participant on both create and update (same read-on-both-paths convention as Consents
    /// above, for the same reason: this step stays editable in edit mode too) — see
    /// ParticipantsController.UpsertHealthConditionsAsync.
    /// </summary>
    public List<CreateParticipantHealthConditionDto> HealthConditions { get; init; } = new();

    // ── INTAKE sub-wave C1 — Mobility & Functional (Master Data Dictionary MOB-002/003/005..010/012). All optional.
    public AmbulantStatus? AmbulantStatus { get; init; }
    public RiskRatingLevel? FallsRiskRating { get; init; }
    public bool? UnevenGroundFlag { get; init; }
    public PersonalCareLevel? LevelOfPersonalCare { get; init; }
    [StringLength(500)]
    public string? Orthotics { get; init; }
    [StringLength(2000)]
    public string? ContinenceSupportDetail { get; init; }
    [StringLength(2000)]
    public string? BowelCareDetail { get; init; }
    [StringLength(500)]
    public string? MenstruationSupport { get; init; }
    [StringLength(2000)]
    public string? SkinIntegrity { get; init; }

    // ── INTAKE sub-wave C1 — Behaviour & Communication (Master Data Dictionary COG-*/COM-*). All optional.
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
    [StringLength(500)]
    public string? ExpressiveSkills { get; init; }
    [StringLength(500)]
    public string? ReceptiveSkills { get; init; }
    [StringLength(500)]
    public string? ReadingAbility { get; init; }
    [StringLength(500)]
    public string? CommunicationAids { get; init; }

    /// <summary>
    /// INTAKE sub-wave C2 — the structured ADL rating grid, upserted transactionally with the
    /// participant on both create and update (same read-on-both-paths convention as HealthConditions
    /// above, for the same reason: this step stays editable in edit mode too) — see
    /// ParticipantsController.UpsertAdlAssessmentsAsync.
    /// </summary>
    public List<CreateParticipantAdlAssessmentDto> AdlAssessments { get; init; } = new();

    /// <summary>
    /// INTAKE-03/04, CommunityAccessDailyLiving stream — the structured Community Mobility &amp;
    /// Transport Risk / Community Behaviours of Concern checklist grid, upserted transactionally
    /// with the participant on both create and update (same read-on-both-paths convention as
    /// AdlAssessments above) — see ParticipantsController.UpsertChecklistItemsAsync.
    /// </summary>
    public List<CreateParticipantChecklistItemDto> ChecklistItems { get; init; } = new();

    // ── INTAKE sub-wave C2 — Meals & Diet (Master Data Dictionary MEAL-001..012, minus the
    // allergies dedup — see Participant.cs's field group doc). All optional.
    [StringLength(500)]
    public string? MealAssistanceDetail { get; init; }
    [StringLength(1000)]
    public string? ChokingRiskMealDetail { get; init; }
    [StringLength(500)]
    public string? ModifiedDietDetail { get; init; }
    [StringLength(500)]
    public string? PegRegimeMealDetail { get; init; }
    [StringLength(500)]
    public string? SpecialUtensilsDetail { get; init; }
    [StringLength(500)]
    public string? SpecialDietaryNeedsDetail { get; init; }
    [StringLength(200)]
    public string? FavouriteBreakfast { get; init; }
    [StringLength(200)]
    public string? FavouriteLunch { get; init; }
    [StringLength(200)]
    public string? FavouriteDinner { get; init; }
    [StringLength(1000)]
    public string? MedicationTricks { get; init; }
    [StringLength(1000)]
    public string? FoodsAlwaysEaten { get; init; }

    // ── INTAKE sub-wave C2 — About Me (Master Data Dictionary GOAL-001..008, minus the Hobbies
    // dedup onto PersonalInterests — see Participant.cs's field group doc). All optional.
    [StringLength(2000)]
    public string? Goals { get; init; }
    [StringLength(2000)]
    public string? SupportAreas { get; init; }
    [StringLength(2000)]
    public string? StrengthsFears { get; init; }
    [StringLength(2000)]
    public string? ThingsToKnow { get; init; }
    [StringLength(2000)]
    public string? WhoIsImportant { get; init; }
    [StringLength(2000)]
    public string? LikesDislikes { get; init; }

    // ── INTAKE-03 — Community Access Behaviour & Support Detail (CommunityAccessDailyLiving
    // stream, research spec §3). All optional; conditional-visibility gating on ServiceStreams
    // happens in the wizard (frontend PR), not here.
    [StringLength(2000)]
    public string? SignsHappyAndSettled { get; init; }
    [StringLength(2000)]
    public string? WhatHelpsMeCalmDown { get; init; }
    [StringLength(2000)]
    public string? BocTriggers { get; init; }
    [StringLength(2000)]
    public string? BocEarlyWarningSigns { get; init; }
    [StringLength(2000)]
    public string? BocDeEscalationStrategies { get; init; }
    [StringLength(2000)]
    public string? BocWhatNotToDo { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeMorning { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeDay { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeAfternoonEvening { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeOvernight { get; init; }

    /// <summary>
    /// PF-10.2 (SPEC-05 <c>docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md</c>),
    /// CommunityAccessDailyLiving stream — the structured Community Access Risk Assessment matrix
    /// grid, upserted transactionally with the participant on both create and update (same
    /// read-on-both-paths convention as ChecklistItems above) — see
    /// ParticipantsController.UpsertCommunityAccessRiskItemsAsync.
    /// </summary>
    public List<CreateParticipantCommunityAccessRiskItemDto> CommunityAccessRiskItems { get; init; } = new();

    /// <summary>PF-10.2 — the risk matrix's 23rd, non-itemised overall rating. See Participant.cs's field doc.</summary>
    public RiskRatingLevel? OverallCommunityAccessRiskRating { get; init; }
}

public record UpdateParticipantDto : CreateParticipantDto
{
    public bool IsActive { get; init; } = true;
}

public record SupportProfileDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string? CommunicationNotes { get; init; }
    public string? BehaviourSupportNotes { get; init; }
    public string? RestrictivePracticeDetails { get; init; }
    public string? ManualHandlingNotes { get; init; }
    public string? MedicationHealthSummary { get; init; }
    public string? EmergencyConsiderations { get; init; }
    public string? TravelSpecificNotes { get; init; }
    public DateOnly? ReviewDate { get; init; }
}

public record UpdateSupportProfileDto
{
    public string? CommunicationNotes { get; init; }
    public string? BehaviourSupportNotes { get; init; }
    // RestrictivePracticeDetails is intentionally NOT here — the restrictive practices register
    // (RestrictivePracticeDto/RestrictivePracticesController) replaces it as the write path.
    // Existing SupportProfile.RestrictivePracticeDetails data is left in place and still
    // readable via SupportProfileDto below.
    public string? ManualHandlingNotes { get; init; }
    public string? MedicationHealthSummary { get; init; }
    public string? EmergencyConsiderations { get; init; }
    public string? TravelSpecificNotes { get; init; }
    public DateOnly? ReviewDate { get; init; }
}

// ══════════════════════════════════════════════════════════════
// CONTACT DTOs
// ══════════════════════════════════════════════════════════════

public record ContactDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? RoleRelationship { get; init; }
    public string? Organisation { get; init; }
    public string? Email { get; init; }
    public string? Mobile { get; init; }
    public string? Phone { get; init; }
    public PreferredContactMethod PreferredContactMethod { get; init; }
}

// ══════════════════════════════════════════════════════════════
// PERSON / PARTICIPANT CONTACT ROLE DTOs (CONTACT-01/02/03)
// ══════════════════════════════════════════════════════════════

public record PersonDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? Mobile { get; init; }
    public string? Email { get; init; }
    public string? AddressLine { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Postcode { get; init; }
    public string? Organisation { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    public string? Notes { get; init; }
    /// <summary>Count of active contact roles this person currently holds (any participant) — a
    /// quick "already in use" signal for the SearchableSelect person picker.</summary>
    public int ActiveRoleCount { get; init; }
}

public record CreatePersonDto
{
    [StringLength(100)]
    public string FirstName { get; init; } = string.Empty;
    [StringLength(100)]
    public string LastName { get; init; } = string.Empty;
    [StringLength(30)]
    public string? Phone { get; init; }
    [StringLength(30)]
    public string? Mobile { get; init; }
    [StringLength(200)]
    public string? Email { get; init; }
    [StringLength(200)]
    public string? AddressLine { get; init; }
    [StringLength(100)]
    public string? Suburb { get; init; }
    [StringLength(10)]
    public string? State { get; init; }
    [StringLength(4)]
    public string? Postcode { get; init; }
    [StringLength(200)]
    public string? Organisation { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}

public record UpdatePersonDto : CreatePersonDto;

/// <summary>
/// Shape shared by every ParticipantContactRole write path: the nested-CRUD create endpoint
/// (ParticipantContactRolesController), the standalone update endpoint (person fields below are
/// ignored on update — see UpdateParticipantContactRoleDto), and the rows submitted transactionally
/// with a brand-new participant (CreateParticipantDto.ContactRoles). Exactly one of
/// <see cref="PersonId"/> or the <c>NewPerson*</c> fields is expected to be populated, mirroring
/// CONTACT-03's "existing person vs new person" add-contact UI choice.
/// </summary>
public record CreateParticipantContactRoleDto
{
    /// <summary>Set when adding a role to an already-known Person (CONTACT-03's "existing
    /// person" path). Null when the NewPerson* fields below should create one inline instead.</summary>
    public Guid? PersonId { get; init; }
    [StringLength(100)]
    public string? NewPersonFirstName { get; init; }
    [StringLength(100)]
    public string? NewPersonLastName { get; init; }
    [StringLength(30)]
    public string? NewPersonPhone { get; init; }
    [StringLength(30)]
    public string? NewPersonMobile { get; init; }
    [StringLength(200)]
    public string? NewPersonEmail { get; init; }
    [StringLength(200)]
    public string? NewPersonOrganisation { get; init; }
    /// <summary>PF-6 (SPEC-02): the rest of CreatePersonDto's optional fields, so a genuinely new
    /// person can be captured with more than just a name/phone/email/org on first add.</summary>
    [StringLength(200)]
    public string? NewPersonAddressLine { get; init; }
    [StringLength(100)]
    public string? NewPersonSuburb { get; init; }
    [StringLength(10)]
    public string? NewPersonState { get; init; }
    [StringLength(4)]
    public string? NewPersonPostcode { get; init; }
    public DateOnly? NewPersonDateOfBirth { get; init; }

    public ContactRoleType RoleType { get; init; }
    [StringLength(100)]
    public string? RelationshipToParticipant { get; init; }
    public bool IsPrimary { get; init; }
    public int? PriorityOrder { get; init; }
    public bool? AuthorisedForMedicalInfo { get; init; }
    [StringLength(50)]
    public string? AppointingTribunal { get; init; }
    public List<string> OrderScopeDomains { get; init; } = new();
    public DateOnly? OrderStartDate { get; init; }
    public DateOnly? OrderReviewDate { get; init; }
    public DateOnly? OrderEndDate { get; init; }
    public NomineeScope? NomineeScope { get; init; }
    public DateOnly? AppointmentDate { get; init; }
    [StringLength(500)]
    public string? ReasonForAppointment { get; init; }
    [StringLength(200)]
    public string? AlternateRepresentativeName { get; init; }
    [StringLength(100)]
    public string? FundingLineItemType { get; init; }
    [StringLength(200)]
    public string? OrganisationName { get; init; }
    [StringLength(100)]
    public string? RegistrationNumber { get; init; }
    public DateOnly? LastVisitDate { get; init; }
    public bool? ConsentToShare { get; init; }
    [StringLength(100)]
    public string? Discipline { get; init; }
    [StringLength(200)]
    public string? FrequencyOfContact { get; init; }
    public bool? WebsterPackFlag { get; init; }
    [StringLength(100)]
    public string? RoleTitle { get; init; }
    public bool? RegisteredProviderFlag { get; init; }
    [StringLength(500)]
    public string? ScopeNotes { get; init; }
    [StringLength(200)]
    public string? AuthorisationDocumentReference { get; init; }
    [StringLength(100)]
    public string? PreferredLanguage { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public ContactRoleStatus Status { get; init; } = ContactRoleStatus.Active;
    [StringLength(2000)]
    public string? Notes { get; init; }
}

/// <summary>
/// Same role-specific field set as <see cref="CreateParticipantContactRoleDto"/>, minus the
/// person-identifying fields — CONTACT-03: "adding a role to an existing person reuses their
/// Person row", and a role's Person is likewise fixed after creation (edit the Person's own
/// details via PersonsController instead).
/// </summary>
public record UpdateParticipantContactRoleDto
{
    public ContactRoleType RoleType { get; init; }
    [StringLength(100)]
    public string? RelationshipToParticipant { get; init; }
    public bool IsPrimary { get; init; }
    public int? PriorityOrder { get; init; }
    public bool? AuthorisedForMedicalInfo { get; init; }
    [StringLength(50)]
    public string? AppointingTribunal { get; init; }
    public List<string> OrderScopeDomains { get; init; } = new();
    public DateOnly? OrderStartDate { get; init; }
    public DateOnly? OrderReviewDate { get; init; }
    public DateOnly? OrderEndDate { get; init; }
    public NomineeScope? NomineeScope { get; init; }
    public DateOnly? AppointmentDate { get; init; }
    [StringLength(500)]
    public string? ReasonForAppointment { get; init; }
    [StringLength(200)]
    public string? AlternateRepresentativeName { get; init; }
    [StringLength(100)]
    public string? FundingLineItemType { get; init; }
    [StringLength(200)]
    public string? OrganisationName { get; init; }
    [StringLength(100)]
    public string? RegistrationNumber { get; init; }
    public DateOnly? LastVisitDate { get; init; }
    public bool? ConsentToShare { get; init; }
    [StringLength(100)]
    public string? Discipline { get; init; }
    [StringLength(200)]
    public string? FrequencyOfContact { get; init; }
    public bool? WebsterPackFlag { get; init; }
    [StringLength(100)]
    public string? RoleTitle { get; init; }
    public bool? RegisteredProviderFlag { get; init; }
    [StringLength(500)]
    public string? ScopeNotes { get; init; }
    [StringLength(200)]
    public string? AuthorisationDocumentReference { get; init; }
    [StringLength(100)]
    public string? PreferredLanguage { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public ContactRoleStatus Status { get; init; } = ContactRoleStatus.Active;
    [StringLength(2000)]
    public string? Notes { get; init; }
}

public record ParticipantContactRoleDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public Guid PersonId { get; init; }
    public string PersonFullName { get; init; } = string.Empty;
    public string? PersonPhone { get; init; }
    public string? PersonMobile { get; init; }
    public string? PersonEmail { get; init; }
    public string? PersonOrganisation { get; init; }
    public ContactRoleType RoleType { get; init; }
    public string? RelationshipToParticipant { get; init; }
    public bool IsPrimary { get; init; }
    public int? PriorityOrder { get; init; }
    public bool? AuthorisedForMedicalInfo { get; init; }
    public string? AppointingTribunal { get; init; }
    public List<string> OrderScopeDomains { get; init; } = new();
    public DateOnly? OrderStartDate { get; init; }
    public DateOnly? OrderReviewDate { get; init; }
    public DateOnly? OrderEndDate { get; init; }
    public NomineeScope? NomineeScope { get; init; }
    public DateOnly? AppointmentDate { get; init; }
    public string? ReasonForAppointment { get; init; }
    public string? AlternateRepresentativeName { get; init; }
    public string? FundingLineItemType { get; init; }
    public string? OrganisationName { get; init; }
    public string? RegistrationNumber { get; init; }
    public DateOnly? LastVisitDate { get; init; }
    public bool? ConsentToShare { get; init; }
    public string? Discipline { get; init; }
    public string? FrequencyOfContact { get; init; }
    public bool? WebsterPackFlag { get; init; }
    public string? RoleTitle { get; init; }
    public bool? RegisteredProviderFlag { get; init; }
    public string? ScopeNotes { get; init; }
    public string? AuthorisationDocumentReference { get; init; }
    public string? PreferredLanguage { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public ContactRoleStatus Status { get; init; }
    public string? Notes { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

// ══════════════════════════════════════════════════════════════
// TRIP DTOs
// ══════════════════════════════════════════════════════════════

public record TripListDto
{
    public Guid Id { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public int? MaxParticipants { get; init; }
    public int CurrentParticipantCount { get; init; }
    public int WaitlistCount { get; init; }
    public string? LeadCoordinatorName { get; init; }
}

public record TripDetailDto : TripListDto
{
    public Guid? EventTemplateId { get; init; }
    public string? EventTemplateName { get; init; }
    public DateOnly OopDueDate { get; init; }
    public DateOnly? BookingCutoffDate { get; init; }
    public Guid? LeadCoordinatorId { get; init; }
    public int? MinParticipants { get; init; }
    public int? RequiredWheelchairCapacity { get; init; }
    public int? RequiredBeds { get; init; }
    public int? RequiredBedrooms { get; init; }
    public int? MinStaffRequired { get; init; }
    public decimal CalculatedStaffRequired { get; init; }
    public string? Notes { get; init; }
    public int HighSupportCount { get; init; }
    public int WheelchairCount { get; init; }
    public int OvernightSupportCount { get; init; }
    public int StaffAssignedCount { get; init; }
    public int OutstandingTaskCount { get; init; }
    public int InsuranceConfirmedCount { get; init; }
    public int InsuranceOutstandingCount { get; init; }
    public decimal ActiveHoursPerDay { get; init; }
    public TimeOnly? DepartureTime { get; init; }
    public TimeOnly? ReturnTime { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateTripDto
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string TripName { get; init; } = string.Empty;
    [StringLength(50)]
    public string? TripCode { get; init; }
    public Guid? EventTemplateId { get; init; }
    [StringLength(200)]
    public string? Destination { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    [Range(1, 365)]
    public int DurationDays { get; init; }
    public DateOnly? BookingCutoffDate { get; init; }
    public Guid? LeadCoordinatorId { get; init; }
    [Range(0, 1000)]
    public int? MinParticipants { get; init; }
    [Range(0, 1000)]
    public int? MaxParticipants { get; init; }
    [Range(0, 100)]
    public int? RequiredWheelchairCapacity { get; init; }
    [Range(0, 1000)]
    public int? RequiredBeds { get; init; }
    [Range(0, 1000)]
    public int? RequiredBedrooms { get; init; }
    [Range(0, 100)]
    public int? MinStaffRequired { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
}

public record UpdateTripDto : CreateTripDto
{
    public TripStatus Status { get; init; } = TripStatus.Draft;
    public TimeOnly? DepartureTime { get; init; }
    public TimeOnly? ReturnTime { get; init; }
}

public record PatchTripDto
{
    public TripStatus? Status { get; init; }
}

// ══════════════════════════════════════════════════════════════
// BOOKING DTOs
// ══════════════════════════════════════════════════════════════

public record BookingListDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid ParticipantId { get; init; }
    public string? ParticipantName { get; init; }
    public BookingStatus BookingStatus { get; init; }
    public DateOnly BookingDate { get; init; }
    public bool WheelchairRequired { get; init; }
    public bool HighSupportRequired { get; init; }
    public bool NightSupportRequired { get; init; }
    public bool HasRestrictivePracticeFlag { get; init; }
    public SupportRatio? SupportRatioOverride { get; init; }
    public bool ActionRequired { get; init; }
    public InsuranceStatus InsuranceStatus { get; init; }
    public PaymentStatus PaymentStatus { get; init; }
}

public record BookingDetailDto : BookingListDto
{
    public PlanType? PlanTypeOverride { get; init; }
    public string? FundingNotes { get; init; }
    public string? RoomPreference { get; init; }
    public string? TransportNotes { get; init; }
    public string? EquipmentNotes { get; init; }
    public string? RiskSupportNotes { get; init; }
    public string? BookingNotes { get; init; }
    public string? CancellationReason { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public string? InsuranceProvider { get; init; }
    public string? InsurancePolicyNumber { get; init; }
    public DateOnly? InsuranceCoverageStart { get; init; }
    public DateOnly? InsuranceCoverageEnd { get; init; }
    public bool IsInsuranceValid { get; init; }
}

public record CreateBookingDto
{
    [Required]
    public Guid TripInstanceId { get; init; }
    [Required]
    public Guid ParticipantId { get; init; }
    public BookingStatus BookingStatus { get; init; } = BookingStatus.Enquiry;
    public DateOnly? BookingDate { get; init; }
    public SupportRatio? SupportRatioOverride { get; init; }
    public bool NightSupportRequired { get; init; }
    public bool WheelchairRequired { get; init; }
    public bool HighSupportRequired { get; init; }
    public bool HasRestrictivePracticeFlag { get; init; }
    public PlanType? PlanTypeOverride { get; init; }
    [StringLength(2000)]
    public string? FundingNotes { get; init; }
    [StringLength(500)]
    public string? RoomPreference { get; init; }
    [StringLength(2000)]
    public string? TransportNotes { get; init; }
    [StringLength(2000)]
    public string? EquipmentNotes { get; init; }
    [StringLength(4000)]
    public string? RiskSupportNotes { get; init; }
    [StringLength(4000)]
    public string? BookingNotes { get; init; }
    [StringLength(200)]
    public string? InsuranceProvider { get; init; }
    [StringLength(100)]
    public string? InsurancePolicyNumber { get; init; }
    public DateOnly? InsuranceCoverageStart { get; init; }
    public DateOnly? InsuranceCoverageEnd { get; init; }
    public InsuranceStatus InsuranceStatus { get; init; } = InsuranceStatus.None;
}

public record UpdateBookingDto : CreateBookingDto
{
    public PaymentStatus PaymentStatus { get; init; }
    public bool ActionRequired { get; init; }
    public string? CancellationReason { get; init; }
}

public record PatchBookingDto
{
    public BookingStatus? BookingStatus { get; init; }
    public InsuranceStatus? InsuranceStatus { get; init; }
    public PaymentStatus? PaymentStatus { get; init; }
}

// ══════════════════════════════════════════════════════════════
// ACCOMMODATION DTOs
// ══════════════════════════════════════════════════════════════

public record AccommodationListDto
{
    public Guid Id { get; init; }
    public string PropertyName { get; init; } = string.Empty;
    public string? Location { get; init; }
    public string? Region { get; init; }
    public string? Address { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Postcode { get; init; }
    public bool IsFullyModified { get; init; }
    public bool IsSemiModified { get; init; }
    public bool IsWheelchairAccessible { get; init; }
    public int? BedroomCount { get; init; }
    public int? BedCount { get; init; }
    public int? MaxCapacity { get; init; }
    public bool IsActive { get; init; }
}

public record AccommodationDetailDto : AccommodationListDto
{
    public string? ProviderOwner { get; init; }
    public string? ContactPerson { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Mobile { get; init; }
    public string? Website { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? BeddingConfiguration { get; init; }
    public string? HoistBathroomNotes { get; init; }
    public string? GeneralNotes { get; init; }
}

public record CreateAccommodationDto
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string PropertyName { get; init; } = string.Empty;
    [StringLength(200)]
    public string? ProviderOwner { get; init; }
    [StringLength(200)]
    public string? Location { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    [StringLength(500)]
    public string? Address { get; init; }
    [StringLength(100)]
    public string? Suburb { get; init; }
    [StringLength(50)]
    public string? State { get; init; }
    [StringLength(10)]
    public string? Postcode { get; init; }
    [StringLength(200)]
    public string? ContactPerson { get; init; }
    [StringLength(200), EmailAddress]
    public string? Email { get; init; }
    [StringLength(50)]
    public string? Phone { get; init; }
    [StringLength(50)]
    public string? Mobile { get; init; }
    [StringLength(500)]
    public string? Website { get; init; }
    public bool IsFullyModified { get; init; }
    public bool IsSemiModified { get; init; }
    public bool IsWheelchairAccessible { get; init; }
    public string? AccessibilityNotes { get; init; }
    public int? BedroomCount { get; init; }
    public int? BedCount { get; init; }
    public int? MaxCapacity { get; init; }
    public string? BeddingConfiguration { get; init; }
    public string? HoistBathroomNotes { get; init; }
    public string? GeneralNotes { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateAccommodationDto : CreateAccommodationDto { }

// ══════════════════════════════════════════════════════════════
// RESERVATION DTOs
// ══════════════════════════════════════════════════════════════

public record ReservationDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid AccommodationPropertyId { get; init; }
    public string? PropertyName { get; init; }
    public DateOnly? RequestSentDate { get; init; }
    public DateOnly? DateBooked { get; init; }
    public DateOnly? DateConfirmed { get; init; }
    public DateOnly CheckInDate { get; init; }
    public DateOnly CheckOutDate { get; init; }
    public int? BedroomsReserved { get; init; }
    public int? BedsReserved { get; init; }
    public decimal? Cost { get; init; }
    public string? ConfirmationReference { get; init; }
    public ReservationStatus ReservationStatus { get; init; }
    public string? Comments { get; init; }
    public string? CancellationReason { get; init; }
    public bool HasOverlapConflict { get; init; }
}

public record CreateReservationDto
{
    public Guid TripInstanceId { get; init; }
    public Guid AccommodationPropertyId { get; init; }
    public DateOnly? RequestSentDate { get; init; }
    public DateOnly CheckInDate { get; init; }
    public DateOnly CheckOutDate { get; init; }
    public int? BedroomsReserved { get; init; }
    public int? BedsReserved { get; init; }
    public decimal? Cost { get; init; }
    public string? Comments { get; init; }
    public ReservationStatus ReservationStatus { get; init; } = ReservationStatus.Researching;
}

public record UpdateReservationDto : CreateReservationDto
{
    public DateOnly? DateBooked { get; init; }
    public DateOnly? DateConfirmed { get; init; }
    public string? ConfirmationReference { get; init; }
    public string? CancellationReason { get; init; }
}

// ══════════════════════════════════════════════════════════════
// VEHICLE DTOs
// ══════════════════════════════════════════════════════════════

public record VehicleListDto
{
    public Guid Id { get; init; }
    public string VehicleName { get; init; } = string.Empty;
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    public int TotalSeats { get; init; }
    public int WheelchairPositions { get; init; }
    public bool IsInternal { get; init; }
    public bool IsActive { get; init; }
    public DateOnly? ServiceDueDate { get; init; }
    public DateOnly? RegistrationDueDate { get; init; }
}

public record VehicleDetailDto : VehicleListDto
{
    public string? RampHoistDetails { get; init; }
    public string? DriverRequirements { get; init; }
    public string? Notes { get; init; }
}

public record CreateVehicleDto
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string VehicleName { get; init; } = string.Empty;
    [StringLength(20)]
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    [Range(0, 100)]
    public int TotalSeats { get; init; }
    [Range(0, 20)]
    public int WheelchairPositions { get; init; }
    [StringLength(1000)]
    public string? RampHoistDetails { get; init; }
    [StringLength(1000)]
    public string? DriverRequirements { get; init; }
    public bool IsInternal { get; init; } = true;
    public bool IsActive { get; init; } = true;
    public DateOnly? ServiceDueDate { get; init; }
    public DateOnly? RegistrationDueDate { get; init; }
    public string? Notes { get; init; }
}

public record UpdateVehicleDto : CreateVehicleDto { }

// ══════════════════════════════════════════════════════════════
// VEHICLE ASSIGNMENT DTOs
// ══════════════════════════════════════════════════════════════

public record VehicleAssignmentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public Guid VehicleId { get; init; }
    public string? VehicleName { get; init; }
    public string? Registration { get; init; }
    public VehicleAssignmentStatus Status { get; init; }
    public DateOnly? RequestedDate { get; init; }
    public DateOnly? ConfirmedDate { get; init; }
    public Guid? DriverStaffId { get; init; }
    public string? DriverName { get; init; }
    public int? SeatRequirement { get; init; }
    public int? WheelchairPositionRequirement { get; init; }
    public string? PickupTravelNotes { get; init; }
    public string? Comments { get; init; }
    public bool HasOverlapConflict { get; init; }
    public bool HasConflict { get; init; }
    public string? OverrideReason { get; init; }
    public string? AcknowledgedFindingCodes { get; init; }
}

public record CreateVehicleAssignmentDto
{
    public Guid TripInstanceId { get; init; }
    public Guid VehicleId { get; init; }
    public Guid? DriverStaffId { get; init; }
    public int? SeatRequirement { get; init; }
    public int? WheelchairPositionRequirement { get; init; }
    public string? PickupTravelNotes { get; init; }
    public string? Comments { get; init; }
    /// <summary>Required when the candidate carries a RequiresReason finding; ignored (never enough) for a Blocking finding.</summary>
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
}

public record UpdateVehicleAssignmentDto : CreateVehicleAssignmentDto
{
    public VehicleAssignmentStatus Status { get; init; }
    public DateOnly? ConfirmedDate { get; init; }
}

/// <summary>Dry-run input for POST /vehicle-assignments/check — mirrors CheckStaffAssignmentDto's shape for the vehicle-assignment analogue.</summary>
public record CheckVehicleAssignmentDto
{
    public Guid VehicleId { get; init; }
    public Guid TripInstanceId { get; init; }
    /// <summary>The existing assignment being re-checked, if any — excluded from its own conflict queries. Null for a brand-new candidate.</summary>
    public Guid? ExcludeAssignmentId { get; init; }
}

// ══════════════════════════════════════════════════════════════
// STAFF DTOs
// ══════════════════════════════════════════════════════════════

public record StaffListDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    /// <summary>The access-control role (Admin/Coordinator/SupportWorker/ReadOnly/SuperAdmin) — separate from <see cref="Position"/>.</summary>
    public UserRole Role { get; init; }
    /// <summary>Display-only staff position/title — separate from and unrelated to <see cref="Role"/>.</summary>
    public Position Position { get; init; }
    public string? Email { get; init; }
    public string? Mobile { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public bool IsActive { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    public bool HasExpiredQualifications { get; init; }
    public string? Notes { get; init; }
}

public record StaffDetailDto : StaffListDto { }

/// <summary>
/// Create request for a Staff/User row. Username and Email are required per the staff/user
/// unification design spec §4.1 — a staff record now IS a real login-capable account, not a
/// lightweight profile row. Username itself is not an input field here: it is derived from
/// FirstName/LastName with collision-safe suffixing (see
/// <see cref="Odip.Infrastructure.Data.StaffUserUnificationMapping.ResolveUsername"/>, reused
/// by <see cref="Odip.Api.Controllers.StaffController.Create"/> rather than duplicated), the same
/// algorithm the staff/user-unification migration uses. <see cref="Role"/> is the access-control
/// role (subject to the §4.1 guardrails — own-tenant only, cannot grant/edit SuperAdmin, a
/// Coordinator actor cannot assign Admin); <see cref="Position"/> is the separate display-only title.
/// </summary>
public record CreateStaffDto
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string FirstName { get; init; } = string.Empty;
    [Required, StringLength(100, MinimumLength = 1)]
    public string LastName { get; init; } = string.Empty;
    [Required, StringLength(200), EmailAddress]
    public string Email { get; init; } = string.Empty;
    public UserRole Role { get; init; } = UserRole.SupportWorker;
    public Position Position { get; init; }
    [StringLength(50)]
    public string? Mobile { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public bool IsActive { get; init; } = true;
    public string? Notes { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
}

public record UpdateStaffDto : CreateStaffDto { }

// ══════════════════════════════════════════════════════════════
// APP SETTINGS DTOs
// ══════════════════════════════════════════════════════════════

public record AppSettingsDto
{
    public int QualificationWarningDays { get; init; }
}

public record UpdateAppSettingsDto
{
    [System.ComponentModel.DataAnnotations.Range(1, 365)]
    public int QualificationWarningDays { get; init; }
}

// ══════════════════════════════════════════════════════════════
// STAFF AVAILABILITY DTOs
// ══════════════════════════════════════════════════════════════

public record StaffAvailabilityDto
{
    public Guid Id { get; init; }
    public Guid StaffId { get; init; }
    public DateTime StartDateTime { get; init; }
    public DateTime EndDateTime { get; init; }
    public AvailabilityType AvailabilityType { get; init; }
    public bool IsRecurring { get; init; }
    public string? RecurrenceNotes { get; init; }
    public string? Notes { get; init; }
}

public record CreateStaffAvailabilityDto
{
    public Guid StaffId { get; init; }
    public DateTime StartDateTime { get; init; }
    public DateTime EndDateTime { get; init; }
    public AvailabilityType AvailabilityType { get; init; }
    public bool IsRecurring { get; init; }
    public string? RecurrenceNotes { get; init; }
    public string? Notes { get; init; }
}

public record UpdateStaffAvailabilityDto : CreateStaffAvailabilityDto { }

// ══════════════════════════════════════════════════════════════
// STAFF ASSIGNMENT DTOs
// ══════════════════════════════════════════════════════════════

public record StaffAssignmentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid StaffId { get; init; }
    public string? StaffName { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public AssignmentStatus Status { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; }
    public string? ShiftNotes { get; init; }
    public bool HasConflict { get; init; }
    public string? OverrideReason { get; init; }
    public string? AcknowledgedFindingCodes { get; init; }
}

public record CreateStaffAssignmentDto
{
    public Guid TripInstanceId { get; init; }
    public Guid StaffId { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; } = SleepoverType.None;
    public string? ShiftNotes { get; init; }
    /// <summary>Required when the candidate carries a RequiresReason finding; ignored (never enough) for a Blocking finding.</summary>
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
}

public record UpdateStaffAssignmentDto : CreateStaffAssignmentDto
{
    public AssignmentStatus Status { get; init; }
}

/// <summary>Dry-run input for POST /staff-assignments/check — mirrors CheckShiftDto's shape for the trip-assignment analogue.</summary>
public record CheckStaffAssignmentDto
{
    public Guid StaffId { get; init; }
    public Guid TripInstanceId { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    /// <summary>The existing assignment being re-checked, if any — excluded from its own conflict queries. Null for a brand-new candidate.</summary>
    public Guid? ExcludeAssignmentId { get; init; }
}

// ══════════════════════════════════════════════════════════════
// SCHEDULE DTOs
// ══════════════════════════════════════════════════════════════

public record TripDayDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public int DayNumber { get; init; }
    public DateOnly Date { get; init; }
    public string? DayTitle { get; init; }
    public string? DayNotes { get; init; }
    public List<ScheduledActivityDto> ScheduledActivities { get; init; } = new();
}

public record UpdateTripDayDto
{
    public string? DayTitle { get; init; }
    public string? DayNotes { get; init; }
}

public record ScheduledActivityDto
{
    public Guid Id { get; init; }
    public Guid TripDayId { get; init; }
    public Guid? ActivityId { get; init; }
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? Notes { get; init; }
    public int SortOrder { get; init; }
    public ScheduledActivityStatus Status { get; init; }
    public string? BookingReference { get; init; }
    public string? ProviderName { get; init; }
    public string? ProviderPhone { get; init; }
    public string? ProviderEmail { get; init; }
    public string? ProviderWebsite { get; init; }
    public decimal? EstimatedCost { get; init; }
    public ActivityCategory? Category { get; init; }
}

public record CreateScheduledActivityDto
{
    public Guid? ActivityId { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    [StringLength(300)]
    public string? Location { get; init; }
    [StringLength(2000)]
    public string? AccessibilityNotes { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
    [Range(0, 1000)]
    public int SortOrder { get; init; }
    public ScheduledActivityStatus Status { get; init; } = ScheduledActivityStatus.Planned;
    [StringLength(200)]
    public string? BookingReference { get; init; }
    [StringLength(200)]
    public string? ProviderName { get; init; }
    [StringLength(50)]
    public string? ProviderPhone { get; init; }
    [StringLength(200), EmailAddress]
    public string? ProviderEmail { get; init; }
    [StringLength(500), Url]
    public string? ProviderWebsite { get; init; }
    [Range(0, 999999.99)]
    public decimal? EstimatedCost { get; init; }
}

public record UpdateScheduledActivityDto
{
    public Guid? ActivityId { get; init; }
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? Notes { get; init; }
    public int SortOrder { get; init; }
    public ScheduledActivityStatus Status { get; init; }
    public string? BookingReference { get; init; }
    public string? ProviderName { get; init; }
    public string? ProviderPhone { get; init; }
    public string? ProviderEmail { get; init; }
    public string? ProviderWebsite { get; init; }
    public decimal? EstimatedCost { get; init; }
}

// ══════════════════════════════════════════════════════════════
// TASK DTOs
// ══════════════════════════════════════════════════════════════

public record TaskDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? AccommodationReservationId { get; init; }
    public Guid? VehicleAssignmentId { get; init; }
    public Guid? StaffAssignmentId { get; init; }
    public TaskType TaskType { get; init; }
    public string Title { get; init; } = string.Empty;
    public Guid? OwnerId { get; init; }
    public string? OwnerName { get; init; }
    public TaskPriority Priority { get; init; }
    public DateOnly? DueDate { get; init; }
    public TaskItemStatus Status { get; init; }
    public DateOnly? CompletedDate { get; init; }
    public string? Notes { get; init; }
}

public record CreateTaskDto
{
    [Required]
    public Guid TripInstanceId { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? AccommodationReservationId { get; init; }
    public Guid? VehicleAssignmentId { get; init; }
    public Guid? StaffAssignmentId { get; init; }
    public TaskType TaskType { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    public Guid? OwnerId { get; init; }
    public TaskPriority Priority { get; init; } = TaskPriority.Medium;
    public DateOnly? DueDate { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
}

public record UpdateTaskDto : CreateTaskDto
{
    public TaskItemStatus Status { get; init; }
    public DateOnly? CompletedDate { get; init; }
}

// ══════════════════════════════════════════════════════════════
// ACTIVITY DTOs
// ══════════════════════════════════════════════════════════════

public record ActivityDto
{
    public Guid Id { get; init; }
    public Guid? EventTemplateId { get; init; }
    public string ActivityName { get; init; } = string.Empty;
    public ActivityCategory Category { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? SuitabilityNotes { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; }
}

public record CreateActivityDto
{
    public Guid? EventTemplateId { get; init; }
    public string ActivityName { get; init; } = string.Empty;
    public ActivityCategory Category { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? SuitabilityNotes { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateActivityDto : CreateActivityDto { }

// ══════════════════════════════════════════════════════════════
// EVENT TEMPLATE DTOs
// ══════════════════════════════════════════════════════════════

public record EventTemplateDto
{
    public Guid Id { get; init; }
    public string EventCode { get; init; } = string.Empty;
    public string EventName { get; init; } = string.Empty;
    public string? DefaultDestination { get; init; }
    public string? DefaultRegion { get; init; }
    public string? PreferredTimeOfYear { get; init; }
    public int? StandardDurationDays { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? FullyModifiedAccommodationNotes { get; init; }
    public string? SemiModifiedAccommodationNotes { get; init; }
    public string? WheelchairAccessNotes { get; init; }
    public string? TypicalActivities { get; init; }
    public bool IsActive { get; init; }
}

public record CreateEventTemplateDto
{
    public string EventCode { get; init; } = string.Empty;
    public string EventName { get; init; } = string.Empty;
    public string? DefaultDestination { get; init; }
    public string? DefaultRegion { get; init; }
    public string? PreferredTimeOfYear { get; init; }
    public int? StandardDurationDays { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? FullyModifiedAccommodationNotes { get; init; }
    public string? SemiModifiedAccommodationNotes { get; init; }
    public string? WheelchairAccessNotes { get; init; }
    public string? TypicalActivities { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateEventTemplateDto : CreateEventTemplateDto { }

// ══════════════════════════════════════════════════════════════
// DOCUMENT DTOs
// ══════════════════════════════════════════════════════════════

public record TripDocumentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public DocumentType DocumentType { get; init; }
    public string FileName { get; init; } = string.Empty;
    public string? FilePath { get; init; }
    public long? FileSize { get; init; }
    public DateOnly? DocumentDate { get; init; }
    public string? Notes { get; init; }
    public DateTime UploadedAt { get; init; }
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD DTOs
// ══════════════════════════════════════════════════════════════

public record DashboardSummaryDto
{
    public int UpcomingTripCount { get; init; }
    public int ActiveParticipantCount { get; init; }
    public int OutstandingTaskCount { get; init; }
    public int OverdueTaskCount { get; init; }
    public int ConflictCount { get; init; }
    public int TripsMissingAccommodation { get; init; }
    public int TripsMissingVehicles { get; init; }
    public int TripsMissingStaff { get; init; }
    public int OpenIncidentCount { get; init; }
    public int QscOverdueCount { get; init; }
    public List<TripListDto> UpcomingTrips { get; init; } = new();
    public List<TaskDto> OverdueTasks { get; init; } = new();
}

// ══════════════════════════════════════════════════════════════
// ITINERARY DTOs (read-only composite view)
// ══════════════════════════════════════════════════════════════

public record ItineraryDto
{
    public Guid TripId { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public string? LeadCoordinatorName { get; init; }
    public string? Notes { get; init; }
    public int ParticipantCount { get; init; }
    public int StaffCount { get; init; }
    public decimal TotalEstimatedCost { get; init; }
    public List<ItineraryParticipantDto> Participants { get; init; } = new();
    public List<ItineraryAccommodationDto> Accommodation { get; init; } = new();
    public List<ItineraryVehicleDto> Vehicles { get; init; } = new();
    public List<ItineraryStaffDto> Staff { get; init; } = new();
    public List<ItineraryDayDto> Days { get; init; } = new();
}

public record ItineraryParticipantDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public bool WheelchairRequired { get; init; }
    public bool HighSupportRequired { get; init; }
    public bool NightSupportRequired { get; init; }
    public SupportRatio? SupportRatio { get; init; }
    public string? MobilityNotes { get; init; }
    public string? MedicalSummary { get; init; }
}

public record ItineraryAccommodationDto
{
    public string PropertyName { get; init; } = string.Empty;
    public string? Address { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Phone { get; init; }
    public DateOnly CheckInDate { get; init; }
    public DateOnly CheckOutDate { get; init; }
    public int? BedroomsReserved { get; init; }
    public int? BedsReserved { get; init; }
    public string? ConfirmationReference { get; init; }
    public ReservationStatus ReservationStatus { get; init; }
    public decimal? Cost { get; init; }
    public string? Comments { get; init; }
}

public record ItineraryVehicleDto
{
    public string VehicleName { get; init; } = string.Empty;
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    public int TotalSeats { get; init; }
    public int WheelchairPositions { get; init; }
    public string? DriverName { get; init; }
    public VehicleAssignmentStatus Status { get; init; }
    public string? PickupTravelNotes { get; init; }
}

public record ItineraryStaffDto
{
    public string Name { get; init; } = string.Empty;
    public string? Role { get; init; }
    public string? Email { get; init; }
    public string? Mobile { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; }
    public AssignmentStatus Status { get; init; }
}

public record ItineraryDayDto
{
    public int DayNumber { get; init; }
    public DateOnly Date { get; init; }
    public string? DayTitle { get; init; }
    public string? DayNotes { get; init; }
    public List<ItineraryActivityDto> Activities { get; init; } = new();
    public List<ItineraryDayAccommodationEventDto> AccommodationEvents { get; init; } = new();
    public List<string> StaffOnDuty { get; init; } = new();
}

public record ItineraryActivityDto
{
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string? Location { get; init; }
    public ActivityCategory? Category { get; init; }
    public ScheduledActivityStatus Status { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? Notes { get; init; }
    public string? BookingReference { get; init; }
    public string? ProviderName { get; init; }
    public string? ProviderPhone { get; init; }
    public decimal? EstimatedCost { get; init; }
}

public record ItineraryDayAccommodationEventDto
{
    public string EventType { get; init; } = string.Empty; // "Check-in" or "Check-out"
    public string PropertyName { get; init; } = string.Empty;
    public string? Address { get; init; }
    public string? ConfirmationReference { get; init; }
}

public record AuthResponseDto
{
    /// <summary>
    /// The signed-in user's own id. Post staff/user unification this is the frontend's
    /// self-exclusion source (spec §5) — e.g. excluding yourself from a witness/picker — now
    /// that there is no separate StaffId concept to serve that role.
    /// </summary>
    public Guid Id { get; init; }
    public string Token { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
    public string Username { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public string? TenantName { get; init; }
    public Guid? TenantId { get; init; }
}

// NOTE: ExchangeTokenDto (the Firebase-token-exchange request DTO this record sits next to per
// spec) actually lives in its own file, Odip.Application/DTOs/ExchangeTokenDto.cs — this record
// is placed here instead, next to its response counterpart AuthResponseDto above.
public record DevLoginDto
{
    public string? Username { get; init; }
}

// ══════════════════════════════════════════════════════════════
// SCHEDULE OVERVIEW DTOs
// ══════════════════════════════════════════════════════════════

public record ScheduleOverviewDto
{
    public List<ScheduleTripDto> Trips { get; init; } = new();
    public List<ScheduleStaffDto> Staff { get; init; } = new();
    public List<ScheduleVehicleDto> Vehicles { get; init; } = new();
}

public record ScheduleTripDto
{
    public Guid Id { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public int? MaxParticipants { get; init; }
    public int CurrentParticipantCount { get; init; }
    public int? MinStaffRequired { get; init; }
    public int? StaffRequired { get; init; }
    public int StaffAssignedCount { get; init; }
    public int VehicleAssignedCount { get; init; }
    public string? LeadCoordinatorName { get; init; }
    public int PreferenceMatchCount { get; init; }
}

public record ScheduleStaffDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public Position Role { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public List<ScheduleStaffTripStatusDto> TripStatuses { get; init; } = new();
    public List<StaffAvailabilityDto> Availability { get; init; } = new();
    public List<TripPreferenceDto> PreferredForTrips { get; init; } = new();
}

public record ScheduleStaffTripStatusDto
{
    public Guid TripId { get; init; }
    /// Available, Unavailable, Assigned, Conflict
    public string Status { get; init; } = string.Empty;
    public string? AssignmentRole { get; init; }
    public AssignmentStatus? AssignmentStatus { get; init; }
    public Guid? AssignmentId { get; init; }
}

public record TripPreferenceDto(Guid TripId, int ParticipantCount);

public record ScheduleVehicleDto
{
    public Guid Id { get; init; }
    public string VehicleName { get; init; } = string.Empty;
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    public int TotalSeats { get; init; }
    public int WheelchairPositions { get; init; }
    public bool IsInternal { get; init; }
    public List<ScheduleVehicleTripStatusDto> TripStatuses { get; init; } = new();
}

public record ScheduleVehicleTripStatusDto
{
    public Guid TripId { get; init; }
    /// Available, Assigned, Conflict
    public string Status { get; init; } = string.Empty;
    public VehicleAssignmentStatus? AssignmentStatus { get; init; }
}

// ══════════════════════════════════════════════════════════════
// INCIDENT REPORT DTOs
// ══════════════════════════════════════════════════════════════

public record IncidentListDto
{
    public Guid Id { get; init; }
    public ServiceStreams ServiceType { get; init; }
    public Guid? TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public IncidentType IncidentType { get; init; }
    /// <summary>Required (both ends) when <see cref="IncidentType"/> is <see cref="IncidentType.Other"/> (INC-02).</summary>
    public string? OtherTypeSpecify { get; init; }
    public IncidentSeverity Severity { get; init; }
    public IncidentStatus Status { get; init; }
    public string Title { get; init; } = string.Empty;
    public DateTime IncidentDateTime { get; init; }
    public string? Location { get; init; }
    public string? ReportedByName { get; init; }
    public string? InvolvedParticipantName { get; init; }
    public QscReportingStatus QscReportingStatus { get; init; }
    public bool IsOverdue24h { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record IncidentDetailDto : IncidentListDto
{
    public Guid? ParticipantBookingId { get; init; }
    public Guid? InvolvedParticipantId { get; init; }
    public Guid? InvolvedStaffId { get; init; }
    public string? InvolvedStaffName { get; init; }
    public Guid ReportedByStaffId { get; init; }
    /// <summary>INC-04: which of the register's 6 categories was used. Null unless <see cref="IncidentListDto.IncidentType"/> is <see cref="IncidentType.RestrictivePracticeUse"/>.</summary>
    public RestrictivePracticeType? RestrictivePracticeType { get; init; }
    /// <summary>INC-05: the linked register entry, if the reporter picked one of the involved participant's authorised practices.</summary>
    public Guid? RestrictivePracticeId { get; init; }
    public string? RestrictivePracticeDescription { get; init; }
    public DateOnly? RestrictivePracticeReviewDate { get; init; }
    /// <summary>IN-4: see <see cref="Entities.IncidentReport.UnapprovedRestrictivePracticeDetails"/>. Detail-only, mirrors <see cref="RestrictivePracticeId"/>'s own detail-only placement.</summary>
    public string? UnapprovedRestrictivePracticeDetails { get; init; }
    /// <summary>
    /// INC-04: true = an active register entry of <see cref="RestrictivePracticeType"/> existed for
    /// the involved participant at creation (authorised); false = none did (unauthorised —
    /// reportable-incident territory); null = not determinable (not an RP incident, or no
    /// participant selected). Frozen at creation — see the entity XML doc for why Update never
    /// recomputes this.
    /// </summary>
    public bool? IsRestrictivePracticeAuthorised { get; init; }
    public string Description { get; init; } = string.Empty;
    public string? ImmediateActionsTaken { get; init; }
    public bool WereEmergencyServicesCalled { get; init; }
    public string? EmergencyServicesDetails { get; init; }
    public string? WitnessNames { get; init; }
    public string? WitnessStatements { get; init; }
    /// <summary>IN-5: recorded injuries, populated only when <see cref="IncidentListDto.IncidentType"/> is <see cref="IncidentType.Injury"/> (empty list otherwise).</summary>
    public List<IncidentInjuryDto> Injuries { get; init; } = new();
    /// <summary>IN-7: witnesses — staff (approvable) and free-text external witnesses in one list. See <see cref="Entities.IncidentWitness"/>.</summary>
    public List<IncidentWitnessDto> Witnesses { get; init; } = new();
    public DateTime? QscReportedAt { get; init; }
    public string? QscReferenceNumber { get; init; }
    public Guid? ReviewedByStaffId { get; init; }
    public string? ReviewedByName { get; init; }
    public DateTime? ReviewedAt { get; init; }
    public string? ReviewNotes { get; init; }
    public string? CorrectiveActions { get; init; }
    public DateTime? ResolvedAt { get; init; }
    public bool FamilyNotified { get; init; }
    public DateTime? FamilyNotifiedAt { get; init; }
    public bool SupportCoordinatorNotified { get; init; }
    public DateTime? SupportCoordinatorNotifiedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateIncidentDto
{
    /// <summary>Business stream the incident occurred under (INC-01). Defaults to <see cref="ServiceStreams.None"/>.</summary>
    public ServiceStreams ServiceType { get; init; } = ServiceStreams.None;
    /// <summary>Only meaningful (and validated server-side) when <see cref="ServiceType"/> is <see cref="ServiceStreams.Trip"/>.</summary>
    public Guid? TripInstanceId { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? InvolvedParticipantId { get; init; }
    public Guid? InvolvedStaffId { get; init; }
    [Required]
    public Guid ReportedByStaffId { get; init; }
    public IncidentType IncidentType { get; init; }
    /// <summary>Required (server-validated) when <see cref="IncidentType"/> is <see cref="IncidentType.Other"/> (INC-02).</summary>
    [StringLength(500)]
    public string? OtherTypeSpecify { get; init; }
    /// <summary>INC-04: required (server-validated) when <see cref="IncidentType"/> is <see cref="IncidentType.RestrictivePracticeUse"/> — same 6-value set as the participant register.</summary>
    public RestrictivePracticeType? RestrictivePracticeType { get; init; }
    /// <summary>INC-05: optional link to one of the involved participant's register entries. Must belong to <see cref="InvolvedParticipantId"/> and match <see cref="RestrictivePracticeType"/> (server-validated).</summary>
    public Guid? RestrictivePracticeId { get; init; }
    /// <summary>
    /// IN-4: free-text description of the restrictive practice actually used, when it was NOT one
    /// of the participant's approved/active register entries. Mutually exclusive with
    /// <see cref="RestrictivePracticeId"/> — a request setting both is rejected 400 (see
    /// <see cref="IncidentsController.ValidateServiceTypeAndIncidentType"/>). Never causes a
    /// <see cref="Entities.RestrictivePractice"/> row to be created or updated — see
    /// <see cref="Entities.IncidentReport.UnapprovedRestrictivePracticeDetails"/>'s doc.
    /// </summary>
    [StringLength(2000)]
    public string? UnapprovedRestrictivePracticeDetails { get; init; }
    public IncidentSeverity Severity { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    [Required, StringLength(10000, MinimumLength = 1)]
    public string Description { get; init; } = string.Empty;
    public DateTime IncidentDateTime { get; init; }
    [StringLength(300)]
    public string? Location { get; init; }
    [StringLength(4000)]
    public string? ImmediateActionsTaken { get; init; }
    public bool WereEmergencyServicesCalled { get; init; }
    [StringLength(2000)]
    public string? EmergencyServicesDetails { get; init; }
    [StringLength(1000)]
    public string? WitnessNames { get; init; }
    [StringLength(4000)]
    public string? WitnessStatements { get; init; }
    /// <summary>
    /// IN-5: repeatable injury rows, backing the frontend <c>BodyDiagram</c> component. Only
    /// meaningful (server-validated as non-empty) when <see cref="IncidentType"/> is
    /// <see cref="Enums.IncidentType.Injury"/> — see <see cref="IncidentsController.ValidateServiceTypeAndIncidentType"/>.
    /// Update full-replaces the persisted collection with this list every time (see
    /// <see cref="Entities.IncidentInjury"/>'s type doc).
    /// </summary>
    public List<CreateIncidentInjuryDto> Injuries { get; init; } = new();

    /// <summary>
    /// IN-7: repeatable witness rows — staff (<see cref="CreateIncidentWitnessDto.WitnessUserId"/>
    /// set) and free-text external witnesses coexist in this one list. On Create every row is
    /// inserted fresh. On Update, a row whose <see cref="CreateIncidentWitnessDto.Id"/> matches an
    /// existing persisted witness has its already-set approval state preserved (see
    /// <see cref="IncidentsController.Update"/>) — only a row with no <see cref="CreateIncidentWitnessDto.Id"/>
    /// is treated as newly added.
    /// </summary>
    public List<CreateIncidentWitnessDto> Witnesses { get; init; } = new();
}

/// <summary>IN-5: one submitted injury row — see <see cref="Entities.IncidentInjury"/>.</summary>
public record CreateIncidentInjuryDto
{
    public BodyRegion Region { get; init; }
    public InjuryType InjuryType { get; init; }
    [StringLength(2000)]
    public string Description { get; init; } = string.Empty;
}

/// <summary>IN-5: one persisted injury row, as returned by <c>GET /incidents/{id}</c>.</summary>
public record IncidentInjuryDto
{
    public Guid Id { get; init; }
    public BodyRegion Region { get; init; }
    public InjuryType InjuryType { get; init; }
    public string Description { get; init; } = string.Empty;
}

/// <summary>
/// IN-7: one submitted witness row. <see cref="Id"/> is null/omitted for a newly-added witness
/// (Create, or a row added during an edit) and set to an existing <see cref="Entities.IncidentWitness.Id"/>
/// when the frontend is echoing back an already-persisted row on Update — see
/// <see cref="IncidentsController.Update"/> for why that distinction matters (preserving an
/// already-responded row's approval state rather than resetting it to Pending).
/// </summary>
public record CreateIncidentWitnessDto
{
    public Guid? Id { get; init; }
    /// <summary>Set for a staff witness — must resolve to an active User, and must not equal the
    /// incident's own ReportedByStaffId (self-witness is rejected, mirroring the medication
    /// witness flow's own rule). Null for a free-text/external witness.</summary>
    public Guid? WitnessUserId { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string WitnessName { get; init; } = string.Empty;
}

/// <summary>IN-7: one persisted witness row, as returned by <c>GET /incidents/{id}</c>.</summary>
public record IncidentWitnessDto
{
    public Guid Id { get; init; }
    public Guid? WitnessUserId { get; init; }
    public string WitnessName { get; init; } = string.Empty;
    /// <summary>True when this is a staff witness (<see cref="WitnessUserId"/> set) — drives the
    /// frontend's Staff/External type badge.</summary>
    public bool IsStaffWitness { get; init; }
    public WitnessStatus WitnessStatus { get; init; }
    public DateTime? WitnessRequestedAt { get; init; }
    public DateTime? WitnessRespondedAt { get; init; }
    /// <summary>Optional, supplied by the witness themself at approval/decline time — see <see cref="Entities.IncidentWitness.StatementText"/>.</summary>
    public string? StatementText { get; init; }
}

public record UpdateIncidentDto : CreateIncidentDto
{
    public IncidentStatus Status { get; init; }
    public QscReportingStatus QscReportingStatus { get; init; }
    public DateTime? QscReportedAt { get; init; }
    public string? QscReferenceNumber { get; init; }
    public Guid? ReviewedByStaffId { get; init; }
    public string? ReviewNotes { get; init; }
    public string? CorrectiveActions { get; init; }
    public bool FamilyNotified { get; init; }
    public DateTime? FamilyNotifiedAt { get; init; }
    public bool SupportCoordinatorNotified { get; init; }
    public DateTime? SupportCoordinatorNotifiedAt { get; init; }
}

// ── Tenant DTOs ─────────────────────────────────────────────────────────────

public record TenantDto(
    Guid Id,
    string Name,
    string EmailDomain,
    bool IsActive,
    DateTime CreatedAt);

public record CreateTenantDto(
    string Name,
    string EmailDomain);

public record UpdateTenantDto(
    string Name,
    string EmailDomain,
    bool IsActive);

public record TenantUserDto(
    Guid Id,
    string FullName,
    string Role,
    bool IsActive);

// ── Admin User DTOs ────────────────────────────────────────────────────────
// Per staff/user unification design spec §4.5: the "linked Staff record" concept (StaffId) no
// longer exists and is dropped entirely (not just always-null as it was mid-Task-1). These DTOs
// gain the §3.1 profile/qualification fields as OPTIONAL fields instead — Settings → Users
// remains SuperAdmin-only and unchanged in access scope; profile editing still primarily lives on
// the /staff page (design spec §2 Decisions), these are here so a SuperAdmin can set them too.

public record AdminUserDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public Guid TenantId { get; init; }
    public string TenantName { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? LastLoginAt { get; init; }
    public Position? Position { get; init; }
    public string? Mobile { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    public string? Notes { get; init; }
}

public record CreateAdminUserDto
{
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public Guid TenantId { get; init; }
    public string? Password { get; init; }
    public Position? Position { get; init; }
    public string? Mobile { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    public string? Notes { get; init; }
}

public record UpdateAdminUserDto
{
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    public Position? Position { get; init; }
    public string? Mobile { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    public string? Notes { get; init; }
}

// ── Tenant Summary DTO (includes user count) ──────────────────────────────

public record TenantSummaryDto(
    Guid Id,
    string Name,
    string EmailDomain,
    bool IsActive,
    DateTime CreatedAt,
    int UserCount);

// ── Bundled Tenant Creation ───────────────────────────────────────────────

public record CreateTenantWithSetupDto(
    string Name,
    string EmailDomain,
    UpsertProviderSettingsDto? ProviderSettings,
    CreateInitialUserDto? InitialUser);

public record CreateInitialUserDto(
    string FirstName,
    string LastName,
    string Email,
    string Username,
    string Role,
    string? Password);

// ── Public Holidays Sync DTOs ──────────────────────────────────────────────

public record SyncHolidaysDto
{
    public int? FromYear { get; init; }
    public int? ToYear { get; init; }
}

public record SyncResultDto
{
    public int YearsProcessed { get; init; }
    public int HolidaysAdded { get; init; }
    public int HolidaysUpdated { get; init; }
    public string[] Errors { get; init; } = [];
}

// ══════════════════════════════════════════════════════════════════════════
// FIELD REGISTRY / FORMS ENGINE DTOs
// (Odip.Api/Controllers/FieldRegistryController.cs — added at the end of this
// file, in its own region, to minimise merge conflicts with concurrent DTO work.)
// ══════════════════════════════════════════════════════════════════════════

/// <summary>A single field definition from the Master Data Dictionary, as exposed over the API.</summary>
public record FieldDefinitionDto
{
    public Guid Id { get; init; }
    public string FieldId { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Domain { get; init; } = string.Empty;
    /// <summary>String form of <c>Odip.Domain.Dictionary.FieldDataType</c> (e.g. "SingleSelect").</summary>
    public string DataType { get; init; } = string.Empty;
    /// <summary>Parsed picklist options. Only meaningful for SingleSelect/MultiSelect fields.</summary>
    public List<string> AllowedValues { get; init; } = new();
    public string? Comments { get; init; }
    public string? Notes { get; init; }
    /// <summary>True when this field belongs to a clinical-adjacent domain (see DataDictionarySeeder.SensitiveDomains).</summary>
    public bool IsSensitive { get; init; }
    public bool IsActive { get; init; }
    public List<string> AppearsInForms { get; init; } = new();
}

/// <summary>One dictionary domain with its field count, for building navigation.</summary>
public record FieldDomainSummaryDto
{
    public string Domain { get; init; } = string.Empty;
    public int FieldCount { get; init; }
}

/// <summary>A single field as it should be rendered within a form.</summary>
public record FormFieldDto
{
    public string FieldId { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public string DataType { get; init; } = string.Empty;
    public List<string> AllowedValues { get; init; } = new();
    /// <summary>
    /// Always false: the current Master Data Dictionary does not carry an explicit
    /// "required" column, so there is no source data to derive this from yet. Present on
    /// the DTO so the frontend has a stable contract once the dictionary adds one.
    /// </summary>
    public bool IsRequired { get; init; }
    public bool IsSensitive { get; init; }
}

/// <summary>One section of a <see cref="FormTemplateDto"/>, with its fields resolved.</summary>
public record FormSectionDto
{
    public string Title { get; init; } = string.Empty;
    public List<FormFieldDto> Fields { get; init; } = new();
}

/// <summary>A renderable form skeleton, built from <c>FormTemplate.FromAppearsIn</c> with fields resolved.</summary>
public record FormTemplateDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Description { get; init; }
    public List<FormSectionDto> Sections { get; init; } = new();
}

/// <summary>A single stored EAV value, joined to its field definition.</summary>
public record FieldValueDto
{
    public Guid FieldDefinitionId { get; init; }
    public string FieldId { get; init; } = string.Empty;
    public string FieldName { get; init; } = string.Empty;
    public string DataType { get; init; } = string.Empty;
    public string? Value { get; init; }
    public bool IsSensitive { get; init; }
    public DateTime UpdatedAt { get; init; }
    public string? UpdatedBy { get; init; }
}

/// <summary>One value to upsert in a batch PUT.</summary>
public record UpsertFieldValueDto
{
    [Required]
    public Guid FieldDefinitionId { get; init; }
    public string? Value { get; init; }
}

/// <summary>Request body for the batch field-value upsert endpoint.</summary>
public record UpsertFieldValuesDto
{
    [Required]
    public List<UpsertFieldValueDto> Values { get; init; } = new();
}

// ══════════════════════════════════════════════════════════════
// BILLING DTOs
// ══════════════════════════════════════════════════════════════

public record FundingSourceDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string? ParticipantName { get; init; }
    public FundingRouteType RouteType { get; init; }
    public string? BudgetCategory { get; init; }
    public string? NdisPlanNumber { get; init; }
    public DateOnly? PlanStartDate { get; init; }
    public DateOnly? PlanEndDate { get; init; }
    public decimal? Budget { get; init; }
    public string? PayerName { get; init; }
    public string? PayerEmail { get; init; }
    public bool IsActive { get; init; }
}

public record CreateFundingSourceDto
{
    [Required]
    public Guid ParticipantId { get; init; }
    public FundingRouteType RouteType { get; init; }
    [StringLength(200)]
    public string? BudgetCategory { get; init; }
    [StringLength(50)]
    public string? NdisPlanNumber { get; init; }
    public DateOnly? PlanStartDate { get; init; }
    public DateOnly? PlanEndDate { get; init; }
    [Range(0, 99999999.99)]
    public decimal? Budget { get; init; }
    [StringLength(200)]
    public string? PayerName { get; init; }
    [StringLength(200), EmailAddress]
    public string? PayerEmail { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateFundingSourceDto : CreateFundingSourceDto { }

public record ServiceBookingLineDto
{
    public Guid Id { get; init; }
    public string SupportItemNumber { get; init; } = string.Empty;
    public decimal AllocatedAmount { get; init; }
    public decimal ClaimedAmount { get; init; }
    public decimal RemainingAmount { get; init; }
}

public record CreateServiceBookingLineDto
{
    [Required, StringLength(50, MinimumLength = 1)]
    public string SupportItemNumber { get; init; } = string.Empty;
    [Range(0, 99999999.99)]
    public decimal AllocatedAmount { get; init; }
}

public record ServiceBookingListDto
{
    public Guid Id { get; init; }
    public Guid FundingSourceId { get; init; }
    public Guid? ParticipantId { get; init; }
    public string? ParticipantName { get; init; }
    public string ProdaBookingReference { get; init; } = string.Empty;
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int ClaimWindowDays { get; init; }
    public DateOnly ClaimDeadline { get; init; }
    public decimal TotalAllocated { get; init; }
    public decimal TotalClaimed { get; init; }
    public decimal TotalRemaining { get; init; }
}

public record ServiceBookingDetailDto : ServiceBookingListDto
{
    public List<ServiceBookingLineDto> Lines { get; init; } = new();
}

public record CreateServiceBookingDto
{
    [Required]
    public Guid FundingSourceId { get; init; }
    [Required, StringLength(50, MinimumLength = 1)]
    public string ProdaBookingReference { get; init; } = string.Empty;
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    [Range(0, 3650)]
    public int ClaimWindowDays { get; init; } = 60;
    [MinLength(1)]
    public List<CreateServiceBookingLineDto> Lines { get; init; } = new();
}

public record BillableEventDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string? ParticipantName { get; init; }
    public Guid FundingSourceId { get; init; }
    public Guid? ServiceBookingId { get; init; }
    public IncomeStream Stream { get; init; }
    public string? SourceEntityType { get; init; }
    public Guid? SourceEntityId { get; init; }
    public string SupportItemNumber { get; init; } = string.Empty;
    public DateOnly SupportsDeliveredFrom { get; init; }
    public DateOnly SupportsDeliveredTo { get; init; }
    public ClaimDayType DayType { get; init; }
    public decimal? Quantity { get; init; }
    public TimeSpan? Hours { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal TotalAmount { get; init; }
    public GSTCode GstCode { get; init; }
    public ClaimType ClaimType { get; init; }
    public string? CancellationReasonCode { get; init; }
    public bool ParticipantApproved { get; init; }
    public string ClaimReference { get; init; } = string.Empty;
    public BillableEventStatus Status { get; init; }
    public string? RejectionReason { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record CreateBillableEventDto
{
    [Required]
    public Guid ParticipantId { get; init; }
    [Required]
    public Guid FundingSourceId { get; init; }
    public Guid? ServiceBookingId { get; init; }
    public IncomeStream Stream { get; init; }
    [StringLength(100)]
    public string? SourceEntityType { get; init; }
    public Guid? SourceEntityId { get; init; }
    [Required, StringLength(50, MinimumLength = 1)]
    public string SupportItemNumber { get; init; } = string.Empty;
    public DateOnly SupportsDeliveredFrom { get; init; }
    public DateOnly SupportsDeliveredTo { get; init; }
    public ClaimDayType DayType { get; init; }
    public decimal? Quantity { get; init; }
    public TimeSpan? Hours { get; init; }
    [Range(0, 99999999.99)]
    public decimal UnitPrice { get; init; }
    [Range(0, 99999999.99)]
    public decimal TotalAmount { get; init; }
    public GSTCode GstCode { get; init; } = GSTCode.P2;
    public ClaimType ClaimType { get; init; } = ClaimType.Standard;
    [StringLength(50)]
    public string? CancellationReasonCode { get; init; }
    public bool ParticipantApproved { get; init; }
    [Required, StringLength(100, MinimumLength = 1)]
    public string ClaimReference { get; init; } = string.Empty;
}

public record UpdateBillableEventDto : CreateBillableEventDto { }

public record ClaimBatchListDto
{
    public Guid Id { get; init; }
    public string FileName { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime? SubmittedAt { get; init; }
    public int EventCount { get; init; }
    public decimal TotalAmount { get; init; }
}

public record ClaimBatchDetailDto : ClaimBatchListDto
{
    public List<BillableEventDto> Events { get; init; } = new();
}

public record CreateClaimBatchDto
{
    [Required, MinLength(1)]
    public List<Guid> EventIds { get; init; } = new();
}

public record ValidateBillingDto
{
    [Required, MinLength(1)]
    public List<Guid> EventIds { get; init; } = new();
}

public record BillingValidationResultDto
{
    public Guid EventId { get; init; }
    public BillingSeverity Severity { get; init; }
    public string Code { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;

    public static BillingValidationResultDto From(BillingValidationResult r) =>
        new() { EventId = r.EventId, Severity = r.Severity, Code = r.Code, Message = r.Message };
}
