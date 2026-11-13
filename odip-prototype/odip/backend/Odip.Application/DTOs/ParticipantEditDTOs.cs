using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

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
    /// <summary>Stable client request key: retries of one completion reuse its immutable evidence revision.</summary>
    [StringLength(100)]
    public string? CompletionRequestId { get; init; }
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
    [NoMaskedId, StringLength(20)]
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
    [NoMaskedId, StringLength(50)]
    public string? PensionCardNumber { get; init; }
    public DateOnly? PensionCardExpiry { get; init; }
    [NoMaskedId, StringLength(50)]
    public string? MedicareNumber { get; init; }
    public DateOnly? MedicareExpiry { get; init; }
    [NoMaskedId, StringLength(50)]
    public string? CompanionCardNumber { get; init; }
    public DateOnly? CompanionCardExpiry { get; init; }
    [StringLength(100)]
    public string? PrivateHealthFund { get; init; }
    [NoMaskedId, StringLength(50)]
    public string? PrivateHealthMembershipNumber { get; init; }
    [NoMaskedId, StringLength(50)]
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
    /// ParticipantPatchApplier.UpsertCommunityAccessRiskItemsAsync.
    /// </summary>
    public List<CreateParticipantCommunityAccessRiskItemDto> CommunityAccessRiskItems { get; init; } = new();

    /// <summary>PF-10.2 — the risk matrix's 23rd, non-itemised overall rating. See Participant.cs's field doc.</summary>
    public RiskRatingLevel? OverallCommunityAccessRiskRating { get; init; }
}

public record UpdateParticipantDto : CreateParticipantDto
{
    public bool IsActive { get; init; } = true;
}

/// <summary>Immutable intake-completion evidence available to the participant's tenant.</summary>
public record ParticipantIntakeSnapshotDto
{
    public int Revision { get; init; }
    public DateTime CompletedAtUtc { get; init; }
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
