using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT PATCH DTOs — CORE-02 (see SPEC-00-foundations.md)
// ══════════════════════════════════════════════════════════════
//
// The canonical unit for a partial participant save is a semantic FIELD GROUP, not a wizard step
// or a detail-tab section — both of those compose from these 20 groups (16 scalar + 4
// collections), neither defines them. See SPEC-00's CORE-02 section for the full field-group
// partition table and the reasoning behind every grouping decision (e.g. why PreferredStaff is
// isolated from the rest of Identity, why IsRepeatClient sits in NdisPlan rather than
// ServiceProfile).
//
// ATOMICITY: presence is all-or-nothing at the GROUP level, not the field level. A present group's
// nested DTO carries every one of its member fields — exactly the same properties/types as their
// CreateParticipantDto counterparts, so a present group behaves like a mini full-submit for just
// that group. An absent (null) top-level member leaves every one of its fields completely
// untouched. There is deliberately no per-field "null means unchanged" convention anywhere in this
// file: a present group with one of its own members set to null CLEARS that field, exactly as a
// full Create/Update submission would.
//
// CONCURRENCY: last-write-wins per group, no RowVersion/ETag — see SPEC-00's CORE-02 section for
// why (there is zero optimistic-concurrency precedent anywhere in this codebase, and a per-group
// PATCH is already a strict reduction in collision blast radius versus today's whole-payload PUT).
//
// RiskEntries/ContactRoles are excluded entirely (they stay on their existing nested-CRUD
// endpoints); IsDraft/IsActive are lifecycle flags, never part of any group — this DTO has no
// IsDraft member at all, so a partial save can neither finalise nor un-finalise a draft.
public record PatchParticipantDto
{
    public PatchPersonalDetailsDto? PersonalDetails { get; init; }
    public PatchPreferredStaffDto? PreferredStaff { get; init; }
    public PatchAddressDto? Address { get; init; }
    public PatchLivingArrangementDto? LivingArrangement { get; init; }
    public PatchNdisPlanDto? NdisPlan { get; init; }
    public PatchServiceProfileDto? ServiceProfile { get; init; }
    public PatchKeyIdentifiersDto? KeyIdentifiers { get; init; }
    public PatchCulturalBackgroundDto? CulturalBackground { get; init; }
    public PatchSupportNeedsMobilityDto? SupportNeedsMobility { get; init; }
    public PatchMedicalDto? Medical { get; init; }
    public PatchBehaviourCommunicationDto? BehaviourCommunication { get; init; }
    public PatchCommunityAccessBehaviourDto? CommunityAccessBehaviour { get; init; }
    public PatchMealsAndDietDto? MealsAndDiet { get; init; }
    public PatchAboutMeDto? AboutMe { get; init; }
    public PatchSupportsLookLikeDto? SupportsLookLike { get; init; }
    public PatchRisksHazardsSummaryDto? RisksHazardsSummary { get; init; }

    // ── Collections — reuse the existing item DTOs directly (same shapes CreateParticipantDto's
    // matching collections already use). Upserted via the existing UpsertXAsync helper, UNCHANGED
    // from Create/Update's own behaviour (upsert-by-key, never delete-on-omission) — see
    // ParticipantsController.Upsert{Consents,HealthConditions,AdlAssessments,ChecklistItems}Async,
    // reused verbatim. Each member's own doc below spells out the three states that matter for a
    // partial save specifically (top-level null vs. an omitted item-type vs. a present-but-null
    // item-type) — they are easy to conflate and only two of the three are safe for a caller that
    // owns just part of a fixed enumerated set.

    /// <summary>
    /// consents group — Cultural &amp; Consent (wizard step 4). null = this call touches no
    /// consent rows at all. Non-null = upserted by <see cref="Domain.Enums.ConsentType"/> key: a
    /// type included in the array is created/updated from that entry (a present entry with every
    /// field null still CLEARS the existing row's Granted/SignedByName/SignedDate to null — it does
    /// not delete the row); a type simply OMITTED from the array is left completely untouched,
    /// retaining whatever value it already had. Only 7 types exist, so a split-ownership caller is
    /// unlikely here, but the same two rules apply as for ChecklistItems below.
    /// </summary>
    public List<CreateParticipantConsentDto>? Consents { get; init; }

    /// <summary>
    /// healthConditions group — Medical (wizard step 6). Same upsert-by-key contract as
    /// <see cref="Consents"/>, keyed by <see cref="Domain.Enums.HealthConditionType"/>: null = no
    /// health-condition rows touched; a type OMITTED from a non-null array is left untouched; a
    /// type PRESENT in the array with every field null still clears that existing row (does not
    /// delete it).
    /// </summary>
    public List<CreateParticipantHealthConditionDto>? HealthConditions { get; init; }

    /// <summary>
    /// adlAssessments group — Daily Living (wizard step 8). Same upsert-by-key contract as
    /// <see cref="Consents"/>, keyed by <see cref="Domain.Enums.AdlType"/>: null = no ADL rows
    /// touched; a type OMITTED from a non-null array is left untouched; a type PRESENT in the array
    /// with every field null still clears that existing row (does not delete it).
    /// </summary>
    public List<CreateParticipantAdlAssessmentDto>? AdlAssessments { get; init; }

    /// <summary>
    /// checklistItems group — Support Needs &amp; Mobility (wizard step 5, rows 0-8) AND Behaviour
    /// &amp; Communication (wizard step 7, rows 9-20) — ONE flat 21-row collection whose rows are
    /// split across TWO wizard steps by row, not by field. null = no checklist rows touched.
    /// Non-null is upserted by <see cref="Domain.Enums.ChecklistItemType"/> key, same as every
    /// other collection group here — but the split ownership makes the two upsert-by-key rules
    /// load-bearing in a way the other three collections don't hit in practice:
    /// <list type="bullet">
    /// <item>a type OMITTED from the submitted array is left completely untouched — safe, and the
    /// mechanism a step-scoped caller MUST rely on for the other step's rows;</item>
    /// <item>a type PRESENT in the array with every field null still CLEARS that existing row to
    /// null (it does not delete the row) — NOT safe for a type the calling step doesn't own.</item>
    /// </list>
    /// The caller obligation this creates: a step-scoped PATCH (e.g. step 5's save) MUST submit
    /// ONLY the item-types its own step owns (its 9 rows) and MUST NOT include the other step's
    /// item-types at all, not even as null-valued placeholder rows — doing so would clear that
    /// other step's data via the second rule above. This is a deliberate correction to an earlier
    /// draft of SPEC-02, which assumed the wizard's whole-submission "always resend the full
    /// 21-row array" convention also applied to per-step PATCH calls; under this contract that
    /// would be both unnecessary and actively destructive whenever the calling step's own form
    /// state for the other step's rows isn't fully hydrated (it would submit them as nulls and
    /// clear them). Create/Update's full-submission path is unaffected — it still legitimately
    /// resends the full fixed array every time, per its own established contract.
    /// </summary>
    public List<CreateParticipantChecklistItemDto>? ChecklistItems { get; init; }
}

/// <summary>personalDetails group — Identity (wizard step 0) / Identity (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchPersonalDetailsDto
{
    [StringLength(100)]
    public string FirstName { get; init; } = string.Empty;
    [StringLength(100)]
    public string LastName { get; init; } = string.Empty;
    [StringLength(100)]
    public string? PreferredName { get; init; }
    [StringLength(100)]
    public string? MiddleName { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    public Gender? Gender { get; init; }
    [StringLength(200)]
    public string? GenderSelfDescription { get; init; }
    [StringLength(200)]
    public string? PlaceOfBirth { get; init; }
    [StringLength(100)]
    public string? Country { get; init; }
    [StringLength(30)]
    public string? Phone { get; init; }
    [StringLength(200)]
    public string? Email { get; init; }
}

/// <summary>
/// preferredStaff group — isolated from the rest of Identity so StaffCompatibilityLinkService sync
/// gates on THIS group's presence+diff, not all of Identity. See PatchParticipantDto's doc.
/// </summary>
public record PatchPreferredStaffDto
{
    public Guid? PreferredStaffId { get; init; }
}

/// <summary>address group — Identity (wizard step 0) / Address &amp; Living Arrangements (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchAddressDto
{
    [StringLength(200)]
    public string? AddressStreet { get; init; }
    [StringLength(100)]
    public string? AddressSuburb { get; init; }
    [StringLength(10)]
    public string? AddressState { get; init; }
    [StringLength(4)]
    public string? AddressPostcode { get; init; }
}

/// <summary>livingArrangement group — Identity (wizard step 0) / Address &amp; Living Arrangements (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchLivingArrangementDto
{
    public LivingArrangement? LivingArrangement { get; init; }
    [StringLength(200)]
    public string? MainSupportPersonName { get; init; }
    [StringLength(100)]
    public string? MainSupportPersonRelationship { get; init; }
    [StringLength(2000)]
    public string? OthersLivingInAccommodation { get; init; }
    [StringLength(2000)]
    public string? ResidentialInfo { get; init; }
    public bool? LivesWithOthers { get; init; }
    [StringLength(2000)]
    public string? WhoLivesWith { get; init; }
    [StringLength(200)]
    public string? SilProviderName { get; init; }
    [StringLength(20)]
    public string? SilProviderContactPhone { get; init; }
    [StringLength(100)]
    public string? AccommodationType { get; init; }
    [StringLength(100)]
    public string? OnSiteSupportHours { get; init; }
    [StringLength(2000)]
    public string? LivingArrangementNotes { get; init; }
}

/// <summary>ndisPlan group — NDIS &amp; Funding (wizard step 1) / NDIS &amp; Funding (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchNdisPlanDto
{
    [StringLength(20)]
    public string? NdisNumber { get; init; }
    public DateOnly? PlanStartDate { get; init; }
    public DateOnly? PlanEndDate { get; init; }
    public PlanType PlanType { get; init; }
    public ParticipantFundingSource FundingSource { get; init; } = ParticipantFundingSource.Ndis;
    [StringLength(200)]
    public string? FundingOrganisation { get; init; }
    public bool IsDsoa { get; init; }
    public bool IsRepeatClient { get; init; }
}

/// <summary>
/// serviceProfile group — NDIS &amp; Funding (wizard step 1) / no detail-tab section today
/// (Region/ServiceStreams are header-display only). Kept as its own group so a future editable
/// section doesn't have to be carved out of ndisPlan later. See PatchParticipantDto's doc.
/// </summary>
public record PatchServiceProfileDto
{
    [StringLength(100)]
    public string? Region { get; init; }
    public ServiceStreams ServiceStreams { get; init; } = ServiceStreams.None;
}

/// <summary>keyIdentifiers group — Key Identifiers (wizard step 2) / Key Identifiers (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchKeyIdentifiersDto
{
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
}

/// <summary>culturalBackground group — Cultural &amp; Consent (wizard step 4) / Cultural Background (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchCulturalBackgroundDto
{
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
}

/// <summary>
/// supportNeedsMobility group — Support Needs &amp; Mobility (wizard step 5) / Support Profile tab
/// (PD-6) — exact match to both callers, no split needed. See PatchParticipantDto's doc.
/// </summary>
public record PatchSupportNeedsMobilityDto
{
    public bool IsHighSupport { get; init; }
    public bool IsIntensiveSupport { get; init; }
    public SupportRatio SupportRatio { get; init; }
    public bool MobilityAidWheelchair { get; init; }
    public bool MobilityAidWalker { get; init; }
    public List<string> MobilitySupportOptions { get; init; } = new();
    public OvernightSupportType OvernightSupport { get; init; }
    public SupportRatio OvernightRatio { get; init; } = SupportRatio.OneToOne;
    public bool RequiresHiLoBed { get; init; }
    public bool RequiresHoist { get; init; }
    public bool RequiresShowerChair { get; init; }
    public bool RequiresCommode { get; init; }
    public bool RequiresStandingMachine { get; init; }
    [StringLength(2000)]
    public string? MobilityNotes { get; init; }
    [StringLength(2000)]
    public string? EquipmentRequirements { get; init; }
    [StringLength(2000)]
    public string? TransportRequirements { get; init; }
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
}

/// <summary>medical group — Medical (wizard step 6) / Medical (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchMedicalDto
{
    [StringLength(200)]
    public string? PrimaryDiagnosis { get; init; }
    public List<string> OtherDiagnoses { get; init; } = new();
    public HidpaSupportCategory HidpaSupportCategories { get; init; } = HidpaSupportCategory.None;
    [StringLength(2000)]
    public string? HidpaNotes { get; init; }
    [StringLength(4000)]
    public string? MedicalSummary { get; init; }
    [StringLength(2000)]
    public string? AllergiesDetail { get; init; }
    public bool? IsAnaphylaxisRisk { get; init; }
    [StringLength(2000)]
    public string? AllergyManagementNotes { get; init; }
}

/// <summary>behaviourCommunication group — Behaviour &amp; Communication (wizard step 7) / Behaviour &amp; Communication (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchBehaviourCommunicationDto
{
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
}

/// <summary>communityAccessBehaviour group — Behaviour &amp; Communication (wizard step 7, CA-gated) / Community Access tab (with supportsLookLike). See PatchParticipantDto's doc.</summary>
public record PatchCommunityAccessBehaviourDto
{
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
}

/// <summary>mealsAndDiet group — Daily Living (wizard step 8) / Meals &amp; Diet (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchMealsAndDietDto
{
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
}

/// <summary>aboutMe group — Daily Living (wizard step 8) / About Me (detail tab). See PatchParticipantDto's doc.</summary>
public record PatchAboutMeDto
{
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
}

/// <summary>supportsLookLike group — Daily Living (wizard step 8, CA-gated) / Community Access tab (with communityAccessBehaviour). See PatchParticipantDto's doc.</summary>
public record PatchSupportsLookLikeDto
{
    [StringLength(2000)]
    public string? SupportsLookLikeMorning { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeDay { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeAfternoonEvening { get; init; }
    [StringLength(2000)]
    public string? SupportsLookLikeOvernight { get; init; }
}

/// <summary>risksHazardsSummary group — Risks &amp; Hazards (wizard step 9) / Risks &amp; Hazards Summary (detail tab). RiskEntries stays its own nested CRUD, unaffected. See PatchParticipantDto's doc.</summary>
public record PatchRisksHazardsSummaryDto
{
    [StringLength(4000)]
    public string? BehaviourRiskSummary { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
}
