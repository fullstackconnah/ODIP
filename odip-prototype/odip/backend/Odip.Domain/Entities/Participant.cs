using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Master record for every NDIS client/participant.
/// </summary>
public class Participant : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? PreferredName { get; set; }

    /// <summary>
    /// INTAKE (sub-wave A), Master Data Dictionary PID-004. Optional — the Oassist source forms
    /// carry a Middle Name field alongside First/Last/Preferred; not folded into
    /// <see cref="FullName"/> (which stays First/Preferred + Last, unchanged) since none of the
    /// source forms show it used that way.
    /// </summary>
    public string? MiddleName { get; set; }
    public string FullName => string.IsNullOrWhiteSpace(PreferredName)
        ? $"{FirstName} {LastName}"
        : $"{PreferredName} {LastName}";
    public DateOnly? DateOfBirth { get; set; }

    /// <summary>Participant identity gender (INTAKE-05). Null = not specified.</summary>
    public Gender? Gender { get; set; }

    /// <summary>Optional free-text self-description, only meaningful when <see cref="Gender"/> is <see cref="Enums.Gender.Other"/>.</summary>
    public string? GenderSelfDescription { get; set; }

    /// <summary>INTAKE (sub-wave A), Master Data Dictionary PID-010. Free text (e.g. a suburb/town
    /// or hospital name) — no curated picklist in the source forms.</summary>
    public string? PlaceOfBirth { get; set; }

    /// <summary>
    /// INTAKE (sub-wave A), Master Data Dictionary CON-006. Deliberately separate from
    /// <see cref="AddressState"/>/<see cref="AddressPostcode"/> (INTAKE-06's structured AU
    /// address) — the source forms show Country as its own field on the Participant Details
    /// block, not folded into the address group. Free text — AU-centric operations rarely need a
    /// curated country list, and the spec doesn't call for one.
    /// </summary>
    public string? Country { get; set; }

    /// <summary>
    /// INTAKE (sub-wave A), Master Data Dictionary CON-007 — the participant's OWN phone number,
    /// flagged in the research spec (§5) as a foundational gap: every other phone number in this
    /// codebase belongs to a <see cref="Contact"/>/<see cref="Person"/> (NOK, coordinator, etc.),
    /// never to the participant themselves. Format validated server-side (AU-tolerant, non-strict
    /// — see ParticipantsController.ValidatePhone) whenever provided; absence never blocks a save,
    /// including a draft (INTAKE-08 doctrine: format checks run on provided values only).
    /// </summary>
    public string? Phone { get; set; }

    /// <summary>
    /// INTAKE (sub-wave A), Master Data Dictionary CON-008 — the participant's OWN email, same gap
    /// as <see cref="Phone"/>. Format validated server-side whenever provided (see
    /// ParticipantsController.ValidateEmail); absence never blocks a draft.
    /// </summary>
    public string? Email { get; set; }
    public string? NdisNumber { get; set; }
    public PlanType PlanType { get; set; }
    public string? Region { get; set; }

    /// <summary>
    /// INTAKE (sub-wave A), Master Data Dictionary NDIS-006 — "Disability Support for Older
    /// Australians" flag, spelled out in full per the research spec's labelling instruction.
    /// Deliberately a standalone bool rather than folded into <see cref="FundingSource"/>: the
    /// research spec (§4.3) notes DSOA would otherwise have to be inferred from FundingSource=Other
    /// plus free-text FundingOrganisation, which is lossy — a DSOA-funded participant may still be
    /// NDIS-funded overall. Defaults false; no backfill for pre-existing participants.
    /// </summary>
    public bool IsDsoa { get; set; }

    /// <summary>FUND-02: NDIS vs Other funding source. Defaults to Ndis (also the backfill default
    /// for pre-existing rows with no FundingOrganisation text).</summary>
    public ParticipantFundingSource FundingSource { get; set; } = ParticipantFundingSource.Ndis;

    /// <summary>
    /// Reused as the "Other — specify" free-text field (FUND-02): required when
    /// <see cref="FundingSource"/> is <see cref="Enums.ParticipantFundingSource.Other"/>, hidden
    /// and excluded from the wizard payload when <see cref="Enums.ParticipantFundingSource.Ndis"/>.
    /// </summary>
    public string? FundingOrganisation { get; set; }
    public bool IsRepeatClient { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsHighSupport { get; set; }
    public bool IsIntensiveSupport { get; set; }

    /// <summary>LIVING-01: living arrangement type. Nullable — unset until intake captures it.</summary>
    public LivingArrangement? LivingArrangement { get; set; }

    // LIVING-02 (Family arrangement). MainSupportPersonName plausibly links to a future
    // CONTACT-01 typed contact rather than free text ("decide during design", per the backlog).
    // CONTACT-01/02/03 have now landed (see Person/ParticipantContactRole) — but per that task's
    // brief this linkage is deliberately NOT made yet: these two fields stay free text, and no
    // data migration from here into a Person/ParticipantContactRole row is performed. A future
    // pass can replace MainSupportPersonName/Relationship with a FK to a ParticipantContactRole
    // (there is no dedicated "family/other" role type in ContactRoleType — NextOfKin is the
    // closest existing fit) instead of duplicating name/relationship as plain strings here.
    public string? MainSupportPersonName { get; set; }
    public string? MainSupportPersonRelationship { get; set; }
    public string? OthersLivingInAccommodation { get; set; }
    public string? ResidentialInfo { get; set; }

    // LIVING-03 (Independent arrangement).
    public bool? LivesWithOthers { get; set; }
    public string? WhoLivesWith { get; set; }

    // LIVING-04 (Supported Accommodation arrangement) — controller ruling, since the backlog's
    // source bullet was empty: SIL provider name/contact, accommodation type (free text — see
    // AccommodationType doc comment), on-site support hours (free text, e.g. "24/7"/"9-5
    // weekdays"). "Notes" from the same ruling is LivingArrangementNotes below, shared with the
    // other two arrangement types rather than duplicated per-type.
    public string? SilProviderName { get; set; }
    public string? SilProviderContactPhone { get; set; }
    /// <summary>
    /// Free text rather than a validated picklist (judged against field-registry conventions —
    /// c.f. Region, MobilityNotes): unlike MobilitySupportOptions, there is no curated Master
    /// Data Dictionary list for accommodation type to validate against, and the ruling explicitly
    /// allows "free text or small enum".
    /// </summary>
    public string? AccommodationType { get; set; }
    public string? OnSiteSupportHours { get; set; }

    /// <summary>
    /// LIVING-01's one genuinely shared field: modelled ONCE and shown for whichever arrangement
    /// is selected (Family, Independent, or Supported Accommodation), rather than duplicated per
    /// arrangement type — mirrors INTAKE-04's de-duplication principle. Also satisfies LIVING-04's
    /// ruled "notes" field. See conditionalFields.ts's multi-def pitfall warning for why this is a
    /// single unioned ConditionalFieldDef on the frontend rather than one per arrangement type.
    /// </summary>
    public string? LivingArrangementNotes { get; set; }

    // INTAKE-06 — structured address. Relates to LIVING-01 (address is where the participant
    // lives) but kept as plain participant-level fields rather than nested under the living
    // arrangement — a participant has exactly one current address regardless of arrangement type.
    public string? AddressStreet { get; set; }
    public string? AddressSuburb { get; set; }
    /// <summary>AU state/territory abbreviation (e.g. "QLD", "NSW") — frontend renders a fixed dropdown.</summary>
    public string? AddressState { get; set; }
    /// <summary>4-digit AU postcode, validated server-side (see ParticipantsController.ValidateAddressPostcode).</summary>
    public string? AddressPostcode { get; set; }

    // Mobility aids (multi-select — a participant may use several)
    public bool MobilityAidWheelchair { get; set; }
    public bool MobilityAidWalker { get; set; }

    /// <summary>
    /// Transfer/mobility support methods. Values come from the Master Data Dictionary
    /// mobility picklist (SeedData/DataDictionarySeed.json) — the spreadsheet is the
    /// source of truth for the allowed set.
    /// </summary>
    public List<string> MobilitySupportOptions { get; set; } = new();

    public OvernightSupportType OvernightSupport { get; set; }
    public SupportRatio OvernightRatio { get; set; } = SupportRatio.OneToOne;

    // Equipment required (notes live in the existing EquipmentRequirements field)
    public bool RequiresHiLoBed { get; set; }
    public bool RequiresHoist { get; set; }
    public bool RequiresShowerChair { get; set; }
    public bool RequiresCommode { get; set; }
    public bool RequiresStandingMachine { get; set; }

    /// <summary>
    /// Legacy independently-writable flag — no writer sets this anymore. Every read path now
    /// derives the effective value from <see cref="RestrictivePractices"/> (true iff any active
    /// row exists) instead. Kept as a column rather than dropped to avoid a wider migration
    /// ripple; see the AddRestrictivePractices migration/task-5 report for details.
    /// </summary>
    public bool HasRestrictivePracticeFlag { get; set; }
    public SupportRatio SupportRatio { get; set; }
    public string? MobilityNotes { get; set; }
    public string? EquipmentRequirements { get; set; }
    public string? TransportRequirements { get; set; }
    public string? MedicalSummary { get; set; }
    public string? BehaviourRiskSummary { get; set; }
    public string? Notes { get; set; }
    public DateOnly? PlanStartDate { get; set; }
    public DateOnly? PlanEndDate { get; set; }
    public Guid? PlanManagerContactId { get; set; }
    public Contact? PlanManagerContact { get; set; }
    public Guid? PreferredUserId { get; set; }
    public User? PreferredUser { get; set; }

    /// <summary>
    /// Business-stream tags (STA/BSP/In-Home Support/Trip/HIDPA/Community Access & Daily
    /// Living/Community Nursing). Defaults to <see cref="ServiceStreams.None"/> — untagged; no
    /// backfill is performed for participants that existed before this field was added.
    /// </summary>
    public ServiceStreams ServiceStreams { get; set; } = ServiceStreams.None;

    /// <summary>
    /// DIAG-01: the participant's single primary diagnosis. Free text bounded to 200 chars —
    /// selected from the curated <see cref="Enums.Diagnoses.All"/> picklist in the wizard, or
    /// typed via the "Other — specify" escape hatch; either way the same plain string is stored
    /// (see <see cref="Enums.Diagnoses"/>'s type doc for why this is not validated as a closed
    /// set server-side). Null/unset until intake captures it.
    /// </summary>
    public string? PrimaryDiagnosis { get; set; }

    /// <summary>
    /// DIAG-01: any number of additional diagnoses beyond <see cref="PrimaryDiagnosis"/>. Same
    /// multi-value-as-array-column convention as <see cref="MobilitySupportOptions"/> (a
    /// Postgres text[] column via EF, see OdipDbContext), and the same open-set/curated-plus-other
    /// entries as PrimaryDiagnosis.
    /// </summary>
    public List<string> OtherDiagnoses { get; set; } = new();

    /// <summary>
    /// DIAG-02: HIDPA (High Intensity Daily Personal Activities) support categories the
    /// participant needs. See <see cref="Enums.HidpaSupportCategory"/>'s doc for the full
    /// rationale, the epilepsy-derivation rule, and why this is a distinct concept from
    /// <see cref="ServiceStreams.HIDPA"/>. Defaults to <see cref="Enums.HidpaSupportCategory.None"/>
    /// — no backfill for pre-existing participants.
    /// </summary>
    public HidpaSupportCategory HidpaSupportCategories { get; set; } = HidpaSupportCategory.None;

    /// <summary>
    /// INTAKE-08: true while this participant is a partially-completed wizard draft, saved via
    /// the "Save as draft" action on any intake wizard step rather than a full Review submission.
    /// Defaults false (a normal, fully-validated participant). A draft is excluded from every
    /// operational picker/aggregate surface (roster board, shift assignment, compatibility,
    /// medication/witness pickers, incident participant pickers, trip/booking pickers,
    /// claims/billing, the alerts aggregate, and the portal) — see the surfaces enumerated in
    /// ParticipantsController's Create/Update doc and the individual `!p.IsDraft` query sites
    /// this flag gates — while still showing (with a badge) on the plain participants list, so a
    /// coordinator can find and resume it. Cleared back to false the moment a final submission
    /// (IsDraft=false on the Update payload) comes from the wizard's Review step.
    /// </summary>
    public bool IsDraft { get; set; }

    // ── Key Identifiers (INTAKE sub-wave A, Master Data Dictionary CARD-*, PHY-*) ──────────
    // Wizard step "Key Identifiers", placed after "NDIS & Funding" — see
    // ParticipantCreatePage.tsx's WIZARD_STEPS. All optional; the Participant Profile source
    // form (§4.4/§5) lists these as a discrete section with no field marked required. Expiry
    // dates render as date inputs; Weight/Height are numeric with unit-labelled fields
    // (kg/cm respectively, not stored as free text so future reporting can do real comparisons).
    // Deliberately NOT included: a second "Plan Number" field (spec §6.3 — ambiguous vs.
    // NdisNumber, flagged rather than guessed) and Participant Photo (needs an upload/storage
    // design, deferred — see this PR's description).
    public string? PensionCardNumber { get; set; }
    public DateOnly? PensionCardExpiry { get; set; }
    public string? MedicareNumber { get; set; }
    public DateOnly? MedicareExpiry { get; set; }
    public string? CompanionCardNumber { get; set; }
    public DateOnly? CompanionCardExpiry { get; set; }
    public string? PrivateHealthFund { get; set; }
    public string? PrivateHealthMembershipNumber { get; set; }
    public string? TaxiCardNumber { get; set; }
    public string? HairColour { get; set; }
    public string? EyeColour { get; set; }
    public decimal? WeightKg { get; set; }
    public decimal? HeightCm { get; set; }

    // ── Cultural & Consent — cultural/rights flags (INTAKE sub-wave B, Master Data Dictionary
    // CUL-*) ──────────────────────────────────────────────────────────────────────────────────
    // Wizard step "Cultural & Consent", placed immediately after "Contacts" — see
    // ParticipantCreatePage.tsx's WIZARD_STEPS. Flat columns (unlike ParticipantConsent below,
    // these aren't compliance records with an audit trail of their own — they're identity/rights
    // attributes, same footing as Gender/LivingArrangement). All nullable/optional — the source
    // forms (Intake coversheet §1a-5 and Participant Profile §1c-3) list these as a discrete
    // checkbox block with no field marked required. Null = not asked/unknown, distinct from false.
    /// <summary>Culturally and Linguistically Diverse.</summary>
    public bool? IsCald { get; set; }
    /// <summary>
    /// The source forms label this checkbox "LGBTIQA+"; named IsLgbtqi here per this PR's brief.
    /// Flagged, not silently reconciled — see this PR's report.
    /// </summary>
    public bool? IsLgbtqi { get; set; }
    public bool? IsFamilyCommunity { get; set; }
    /// <summary>Respectful full label, per the design guardrails: "Aboriginal and/or Torres Strait Islander".</summary>
    public bool? IsAboriginalOrTorresStraitIslander { get; set; }
    /// <summary>The 5 "information received" flags from the source forms' Cultural table — Rights and Responsibilities.</summary>
    public bool? ReceivedRightsAndResponsibilitiesInfo { get; set; }
    public bool? ReceivedPrivacyAndConfidentialityInfo { get; set; }
    /// <summary>Source form label: "Feedback Info and Form".</summary>
    public bool? ReceivedFeedbackInfo { get; set; }
    public bool? ReceivedBeingSafeInfo { get; set; }
    public bool? ReceivedAdvocacyInfo { get; set; }
    public string? PersonalInterests { get; set; }
    /// <summary>Free text — Participant Choice and Control notes (research spec §5's "Choice &amp; Control notes").</summary>
    public string? ChoiceControlNotes { get; set; }

    // ── Allergies/Anaphylaxis (INTAKE sub-wave C1, Master Data Dictionary MED-012) ─────────────
    // Wizard step "Medical" — see Participant.cs's field group doc pattern above. Distinct from
    // MedicalSummary (generic free text) and from HealthConditions below (the 10-condition
    // support-planning grid) — allergies get their own explicit fields per the research spec's §5
    // call-out rather than being folded into either.
    public string? AllergiesDetail { get; set; }
    public bool? IsAnaphylaxisRisk { get; set; }
    public string? AllergyManagementNotes { get; set; }

    // ── Mobility & Functional (INTAKE sub-wave C1, Master Data Dictionary MOB-002/003/005..010/012)
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Wizard step "Support Needs & Mobility" (renamed from "Support Needs & Equipment" — the
    // existing name no longer honestly covers the content once these 9 fields land; see this PR's
    // report). Flat nullable columns, per this PR's brief. Where the source form shows a
    // Y/No/Plan-plus-free-detail shape (Orthotics, Continence Support, Colostomy/Catheter/Enema/
    // Suppository, Menstruation Support) this collapses to ONE free-text descriptive column per
    // item rather than exploding into 3-4 sub-fields each — a deliberate simplification, flagged
    // in this PR's report, that keeps the migration additive-and-minimal and matches this PR's
    // brief naming each of these as a single item rather than a sub-field group.
    /// <summary>MOB-002. Ambulant sub-grid (§1c-9): No Assist/Unsteady/Frame/Short Distance.</summary>
    public AmbulantStatus? AmbulantStatus { get; set; }
    /// <summary>MOB-003. Falls Risk rating — source-supported Low/Med/High/Critical values only (see <see cref="Enums.RiskRatingLevel"/>).</summary>
    public RiskRatingLevel? FallsRiskRating { get; set; }
    /// <summary>MOB-002's "Uneven ground Y/N" sub-field.</summary>
    public bool? UnevenGroundFlag { get; set; }
    /// <summary>MOB-006. Independent/Supervision/One-person/Two-person.</summary>
    public PersonalCareLevel? LevelOfPersonalCare { get; set; }
    /// <summary>MOB-007. "Y/N/Plan + list" collapsed to one free-text column — see the field-group doc above.</summary>
    public string? Orthotics { get; set; }
    /// <summary>MOB-008. "Y/NA/Plan + Prompt/Assist + aids + Pull-up/Pads + night support" collapsed to one free-text column.</summary>
    public string? ContinenceSupportDetail { get; set; }
    /// <summary>MOB-009/010. Colostomy/Catheter/Enema/Suppository "Y/No/Plan + equipment + support-required + training" collapsed to one free-text column.</summary>
    public string? BowelCareDetail { get; set; }
    /// <summary>MOB-012. "Y/No/Plan + Independent/Verbal/Physical" collapsed to one free-text column.</summary>
    public string? MenstruationSupport { get; set; }
    /// <summary>Not further enumerated in the source form — free text.</summary>
    public string? SkinIntegrity { get; set; }

    // ── Behaviour & Communication (INTAKE sub-wave C1, Master Data Dictionary COG-001..004/006/
    // 008/009/010/011, COM-001..004) ────────────────────────────────────────────────────────────
    // NEW wizard step "Behaviour & Communication", placed between "Medical" and "Risks & Hazards"
    // — the Medical step already carries diagnoses/HIDPA/allergies/the health-condition grid, and
    // this domain's 14 fields would push that step past a reasonable single-screen length; see
    // this PR's report for the fuller reasoning.
    /// <summary>COG-001. Excellent/Fair/Poor.</summary>
    public MemoryLevel? Memory { get; set; }
    public bool? MemoryAids { get; set; }
    /// <summary>COG-003. Split from ImpairedJudgementReasoning below — the source form has these as two separate Y/N fields ("Impaired Understanding"/"Impaired Judgement/Reasoning"), not one combined item.</summary>
    public bool? ImpairedUnderstanding { get; set; }
    public bool? ImpairedJudgementReasoning { get; set; }
    /// <summary>COG-005. Discrete Y/N — current behaviours of concern.</summary>
    public bool? BehavioursOfConcernCurrent { get; set; }
    /// <summary>Discrete Y/N — behaviours of concern in the past 5 years.</summary>
    public bool? BehavioursOfConcernFiveYearHistory { get; set; }
    /// <summary>COG-011. Source-supported Low/Med/High/Critical values only (see <see cref="Enums.RiskRatingLevel"/>) — shares the enum with <see cref="FallsRiskRating"/>.</summary>
    public RiskRatingLevel? BehaviourRiskRating { get; set; }
    public bool? RidsLogged { get; set; }
    public bool? BspPlanProvided { get; set; }
    public bool? BocChartProvided { get; set; }
    /// <summary>COM-001. Free text — source form combines High/Med/Low + Verbal/Non-verbal/Restrictions/Sign, too varied for one enum.</summary>
    public string? ExpressiveSkills { get; set; }
    /// <summary>COM-002. Free text — source form combines High/Med/Low.</summary>
    public string? ReceptiveSkills { get; set; }
    /// <summary>COM-003. Free text — source form combines Y/N + Good/Med/Low.</summary>
    public string? ReadingAbility { get; set; }
    /// <summary>COM-004. Free text — source form combines Y/N + specify.</summary>
    public string? CommunicationAids { get; set; }

    // ── Meals & Diet (INTAKE sub-wave C2, Master Data Dictionary MEAL-001..012) ────────────────
    // New wizard step "Daily Living", placed between "Behaviour & Communication" and "Risks &
    // Hazards" — see ParticipantCreatePage.tsx's WIZARD_STEPS. All optional. Source form shape
    // (§1c-13/§1c-14) is Y/N + risk-grid detail for most items; collapsed to one free-text
    // descriptive column per item, same deliberate simplification as the Mobility & Functional
    // group above (Orthotics/ContinenceSupportDetail/BowelCareDetail) — flagged in this PR's
    // report, not re-litigated per field here.
    // DEDUP — allergies: the source form's Dietary Requirements table includes "Other
    // Allergies/Alerts", but Participant already has AllergiesDetail/IsAnaphylaxisRisk/
    // AllergyManagementNotes (INTAKE sub-wave C1, Medical step) — NOT duplicated here. A second
    // allergies field was deliberately not added; see this PR's report.
    /// <summary>MEAL-001. "Meal assistance [Y/N]" — collapsed to a free-text descriptive column.</summary>
    public string? MealAssistanceDetail { get; set; }
    /// <summary>
    /// MEAL-002/003. "Fluid intake/Choking risk [Y/N + Low/Med/High/Crit]" / "Modified Diet [Y/N +
    /// choking risk grid]" — the MEAL-specific choking/swallowing-management detail (how meals are
    /// prepared/supervised to manage the risk day to day). Distinct from, but related to, the
    /// <see cref="Entities.ParticipantHealthCondition"/> grid's Dysphagia row (INTAKE sub-wave C1,
    /// Medical step): that row records WHETHER Dysphagia is a diagnosed support need (Has/Severity/
    /// PlanProvided/TrainingRequired); this field records the day-to-day MEAL-MANAGEMENT detail
    /// (what staff actually do at mealtimes) — deliberately not merged, same "detail vs. Has flag"
    /// split as the health-condition-grid/diagnosis reconciliation. See this PR's report.
    /// </summary>
    public string? ChokingRiskMealDetail { get; set; }
    /// <summary>MEAL-003. Modified Diet detail (e.g. Soft/Minced/Pureed/Cut small).</summary>
    public string? ModifiedDietDetail { get; set; }
    /// <summary>MEAL-004. PEG feeding regime detail — loosely related to <see cref="HidpaSupportCategory.EnteralFeeding"/> (DIAG-02), not merged with it.</summary>
    public string? PegRegimeMealDetail { get; set; }
    /// <summary>MEAL-005. Special utensils required, with a free-text description of which.</summary>
    public string? SpecialUtensilsDetail { get; set; }
    /// <summary>MEAL-006. Special dietary needs (e.g. vegetarian, halal, low-sodium) — distinct from allergies (see the DEDUP note above).</summary>
    public string? SpecialDietaryNeedsDetail { get; set; }
    /// <summary>MEAL-008..010. Favourite Meals snapshot table — follows the source's Breakfast/Lunch/Dinner shape rather than a generic "favourite 1/2/3" list.</summary>
    public string? FavouriteBreakfast { get; set; }
    public string? FavouriteLunch { get; set; }
    public string? FavouriteDinner { get; set; }
    /// <summary>MEAL-011. "Tricks for medication" — how medication is best given alongside food.</summary>
    public string? MedicationTricks { get; set; }
    /// <summary>MEAL-012. "Foods always eaten".</summary>
    public string? FoodsAlwaysEaten { get; set; }

    // ── About Me (INTAKE sub-wave C2, Master Data Dictionary GOAL-001..008) ────────────────────
    // Same "Daily Living" wizard step as Meals & Diet above. All optional free text.
    // DEDUP — Goals/Support Areas/Strengths & Fears: sub-wave B's ChoiceControlNotes doc explicitly
    // flagged this exact finer split as "a later-wave design decision if needed" (see
    // documentMapping.ts's choiceControlNotes entry) — this IS that later wave. ChoiceControlNotes
    // is kept (existing data, and as a general elaboration field for anything not captured by the
    // three dedicated fields below) rather than removed or backfilled from it; new intake now
    // captures the finer-grained fields directly. See this PR's report.
    /// <summary>GOAL-002. The finer-grained split of ChoiceControlNotes flagged in sub-wave B — see the DEDUP note above.</summary>
    public string? Goals { get; set; }
    /// <summary>GOAL-001. See the DEDUP note above.</summary>
    public string? SupportAreas { get; set; }
    /// <summary>GOAL-003. See the DEDUP note above.</summary>
    public string? StrengthsFears { get; set; }
    /// <summary>GOAL-004. "Things you need to know" — no prior field.</summary>
    public string? ThingsToKnow { get; set; }
    /// <summary>GOAL-005. "Who/what is important" — no prior field.</summary>
    public string? WhoIsImportant { get; set; }
    /// <summary>
    /// GOAL-007. "Likes and dislikes" — no prior field. NOTE: GOAL-006 "Hobbies/interests" is
    /// deliberately NOT a new field here — <see cref="PersonalInterests"/> (sub-wave B) already
    /// sources from this exact same source-form line (see documentMapping.ts's personalInterests
    /// entry: "Profile's Personal and Cultural Preferences 'Hobbies/interests' free text"). Adding
    /// a second Hobbies field would be a straight duplicate, not a finer split — see this PR's
    /// report for the dedup call.
    /// </summary>
    public string? LikesDislikes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public SupportProfile? SupportProfile { get; set; }
    public ICollection<ParticipantBooking> Bookings { get; set; } = new List<ParticipantBooking>();
    public ICollection<ParticipantContact> ParticipantContacts { get; set; } = new List<ParticipantContact>();
    public ICollection<RestrictivePractice> RestrictivePractices { get; set; } = new List<RestrictivePractice>();

    /// <summary>CONTACT-01/02/03. See <see cref="Entities.ParticipantContactRole"/>'s type doc.</summary>
    public ICollection<ParticipantContactRole> ContactRoles { get; set; } = new List<ParticipantContactRole>();

    /// <summary>INTAKE sub-wave B. See <see cref="Entities.ParticipantConsent"/>'s type doc.</summary>
    public ICollection<ParticipantConsent> Consents { get; set; } = new List<ParticipantConsent>();

    /// <summary>INTAKE sub-wave C1. See <see cref="Entities.ParticipantHealthCondition"/>'s type doc.</summary>
    public ICollection<ParticipantHealthCondition> HealthConditions { get; set; } = new List<ParticipantHealthCondition>();

    /// <summary>INTAKE sub-wave C2. See <see cref="Entities.ParticipantAdlAssessment"/>'s type doc.</summary>
    public ICollection<ParticipantAdlAssessment> AdlAssessments { get; set; } = new List<ParticipantAdlAssessment>();
}
