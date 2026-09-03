namespace Odip.Infrastructure.Services;

/// <summary>Which document(s) a field belongs to — <see cref="Shared"/> matches both PDFs.</summary>
public enum ParticipantDocumentTag
{
    Intake,
    Profile,
    Shared,
}

/// <summary>
/// One row of the field map: either a scalar <see cref="Participant"/> property (
/// <see cref="ParticipantPropertyName"/> set, <see cref="IsTable"/> false) or a structured table
/// (<see cref="ParticipantPropertyName"/> null, <see cref="IsTable"/> true — the actual
/// row/column-building logic for each of the six tables lives in
/// <see cref="ParticipantDocumentComposer"/>, keyed off <see cref="FieldId"/>).
/// </summary>
public sealed record ParticipantDocumentFieldMapEntry(
    string FieldId,
    string SectionHeading,
    string Label,
    ParticipantDocumentTag Tag,
    string? ParticipantPropertyName,
    bool IsTable,
    bool IsCommunityAccessGated);

/// <summary>
/// DOC-01 — hand-authored field map for the Intake Form / Participant Profile PDFs. This is a
/// deliberate, INDEPENDENT C# mirror of <c>frontend/src/lib/documentMapping.ts</c> (the sibling
/// authority for which participant fields belong on which Oassist source document) — not a shared
/// or generated artifact. It reuses that file's `field` string identifiers as <see cref="ParticipantDocumentFieldMapEntry.FieldId"/>
/// so the two can be diffed by eye, but the two lists must be kept in sync by hand whenever either
/// changes; nothing enforces that mechanically.
///
/// Section order mirrors the wizard step family order documentMapping.ts's own section comments
/// use: Participant Details -> NDIS &amp; Funding -> Key Identifiers -> Contacts -> Support Needs
/// &amp; Mobility -> Medical -> Cultural &amp; Consent -> Behaviour &amp; Communication -> Daily
/// Living -> Community Access (stream-gated) -> Risks &amp; Hazards.
///
/// A field with `sources: []` and no `serviceStreams` gate in documentMapping.ts (ODIP-operational
/// fields such as livingArrangement/region/serviceStreams/notes/genderSelfDescription/etc., and
/// "Living Arrangements" as a whole block) has NO Oassist source-form backing and is therefore
/// entirely excluded from this map — neither PDF renders it.
///
/// DELIBERATE DIVERGENCES from a literal reading of documentMapping.ts (each also called out on
/// the entry itself below):
///  - <c>hidpaNotes</c> is tagged <see cref="ParticipantDocumentTag.Shared"/> here even though
///    documentMapping.ts tags it `sources: []` — that entry's own note says it is "DELIBERATELY
///    tagged 'all' ... ungated in the wizard, same visibility as hidpaSupportCategories itself",
///    i.e. it is meant to be visible wherever hidpaSupportCategories (Profile) is, plus it belongs
///    on the Intake side too as free-text elaboration alongside the same HIDPA checklist — treated
///    here as Shared so it surfaces on both documents rather than being dropped entirely by a
///    literal `sources: []` reading.
///  - The <c>riskEntries</c> table is included here (Participant Profile only) even though
///    documentMapping.ts tags it `sources: []` ("no direct backing in either of the 4 Oassist
///    documents analysed") — DOC-01's brief explicitly requires a risk-entries child-entity table
///    in the composed output, so it is modelled as an ODIP-operational structured register on the
///    Profile PDF, not as a source-form-backed field.
///
/// PF-10.1 (SPEC-05 <c>docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md</c>) adds a
/// THIRD, independent file — <see cref="ParticipantFieldEntryMap"/> — mirroring
/// <c>documentMapping.ts</c>'s new `entryPhase` tag (which wizard captures a field). This class is
/// unaffected: it stays scoped to `sources`/PDF rendering, not `entryPhase`/wizard capture — do
/// not conflate the two purposes when reading either file.
/// </summary>
public static class ParticipantDocumentFieldMap
{
    private static ParticipantDocumentFieldMapEntry S(string fieldId, string section, string label, ParticipantDocumentTag tag, string propertyName, bool caGated = false) =>
        new(fieldId, section, label, tag, propertyName, IsTable: false, IsCommunityAccessGated: caGated);

    private static ParticipantDocumentFieldMapEntry T(string fieldId, string section, string label, ParticipantDocumentTag tag, bool caGated = false) =>
        new(fieldId, section, label, tag, ParticipantPropertyName: null, IsTable: true, IsCommunityAccessGated: caGated);

    public static readonly IReadOnlyList<ParticipantDocumentFieldMapEntry> Entries = new List<ParticipantDocumentFieldMapEntry>
    {
        // ── Participant Details ──────────────────────────────────────────────────────────
        S("firstName", "Participant Details", "First Name", ParticipantDocumentTag.Shared, "FirstName"),
        S("lastName", "Participant Details", "Last Name", ParticipantDocumentTag.Shared, "LastName"),
        S("preferredName", "Participant Details", "Preferred Name", ParticipantDocumentTag.Shared, "PreferredName"),
        S("middleName", "Participant Details", "Middle Name", ParticipantDocumentTag.Profile, "MiddleName"),
        S("dateOfBirth", "Participant Details", "Date of Birth", ParticipantDocumentTag.Shared, "DateOfBirth"),
        S("gender", "Participant Details", "Gender", ParticipantDocumentTag.Profile, "Gender"),
        S("placeOfBirth", "Participant Details", "Place of Birth", ParticipantDocumentTag.Profile, "PlaceOfBirth"),
        S("country", "Participant Details", "Country", ParticipantDocumentTag.Profile, "Country"),
        S("phone", "Participant Details", "Phone", ParticipantDocumentTag.Shared, "Phone"),
        S("email", "Participant Details", "Email", ParticipantDocumentTag.Shared, "Email"),
        S("addressStreet", "Participant Details", "Address — Street", ParticipantDocumentTag.Shared, "AddressStreet"),
        S("addressSuburb", "Participant Details", "Address — Suburb", ParticipantDocumentTag.Shared, "AddressSuburb"),
        S("addressState", "Participant Details", "Address — State", ParticipantDocumentTag.Shared, "AddressState"),
        S("addressPostcode", "Participant Details", "Address — Postcode", ParticipantDocumentTag.Shared, "AddressPostcode"),

        // ── NDIS & Funding ────────────────────────────────────────────────────────────────
        S("ndisNumber", "NDIS & Funding", "NDIS Number", ParticipantDocumentTag.Shared, "NdisNumber"),
        S("planStartDate", "NDIS & Funding", "Plan Start Date", ParticipantDocumentTag.Shared, "PlanStartDate"),
        S("planEndDate", "NDIS & Funding", "Plan End Date", ParticipantDocumentTag.Shared, "PlanEndDate"),
        S("planType", "NDIS & Funding", "Plan Type", ParticipantDocumentTag.Shared, "PlanType"),
        S("fundingSource", "NDIS & Funding", "Funding Source", ParticipantDocumentTag.Shared, "FundingSource"),
        S("isDsoa", "NDIS & Funding", "Disability Support for Older Australians (DSOA)", ParticipantDocumentTag.Profile, "IsDsoa"),

        // ── Key Identifiers (all Profile) ────────────────────────────────────────────────
        S("pensionCardNumber", "Key Identifiers", "Pension Card Number", ParticipantDocumentTag.Profile, "PensionCardNumber"),
        S("pensionCardExpiry", "Key Identifiers", "Pension Card Expiry", ParticipantDocumentTag.Profile, "PensionCardExpiry"),
        S("medicareNumber", "Key Identifiers", "Medicare Number", ParticipantDocumentTag.Profile, "MedicareNumber"),
        S("medicareExpiry", "Key Identifiers", "Medicare Expiry", ParticipantDocumentTag.Profile, "MedicareExpiry"),
        S("companionCardNumber", "Key Identifiers", "Companion Card Number", ParticipantDocumentTag.Profile, "CompanionCardNumber"),
        S("companionCardExpiry", "Key Identifiers", "Companion Card Expiry", ParticipantDocumentTag.Profile, "CompanionCardExpiry"),
        S("privateHealthFund", "Key Identifiers", "Private Health Fund", ParticipantDocumentTag.Profile, "PrivateHealthFund"),
        S("privateHealthMembershipNumber", "Key Identifiers", "Private Health Membership Number", ParticipantDocumentTag.Profile, "PrivateHealthMembershipNumber"),
        S("taxiCardNumber", "Key Identifiers", "Taxi Card Number", ParticipantDocumentTag.Profile, "TaxiCardNumber"),
        S("hairColour", "Key Identifiers", "Hair Colour", ParticipantDocumentTag.Profile, "HairColour"),
        S("eyeColour", "Key Identifiers", "Eye Colour", ParticipantDocumentTag.Profile, "EyeColour"),
        S("weightKg", "Key Identifiers", "Weight (kg)", ParticipantDocumentTag.Profile, "WeightKg"),
        S("heightCm", "Key Identifiers", "Height (cm)", ParticipantDocumentTag.Profile, "HeightCm"),

        // ── Contacts ─────────────────────────────────────────────────────────────────────
        T("contactRoles", "Contacts", "Contacts", ParticipantDocumentTag.Shared),

        // ── Support Needs & Mobility ─────────────────────────────────────────────────────
        S("mobilityAidWheelchair", "Support Needs & Mobility", "Wheelchair", ParticipantDocumentTag.Shared, "MobilityAidWheelchair"),
        S("mobilityAidWalker", "Support Needs & Mobility", "Walker", ParticipantDocumentTag.Intake, "MobilityAidWalker"),
        S("mobilitySupportOptions", "Support Needs & Mobility", "Mobility Support Options", ParticipantDocumentTag.Profile, "MobilitySupportOptions"),
        S("overnightSupport", "Support Needs & Mobility", "Overnight Support", ParticipantDocumentTag.Shared, "OvernightSupport"),
        S("overnightRatio", "Support Needs & Mobility", "Overnight Ratio", ParticipantDocumentTag.Shared, "OvernightRatio"),
        S("requiresHiLoBed", "Support Needs & Mobility", "Hi-Lo Bed", ParticipantDocumentTag.Shared, "RequiresHiLoBed"),
        S("requiresHoist", "Support Needs & Mobility", "Hoist", ParticipantDocumentTag.Shared, "RequiresHoist"),
        S("requiresShowerChair", "Support Needs & Mobility", "Shower Chair", ParticipantDocumentTag.Shared, "RequiresShowerChair"),
        S("requiresCommode", "Support Needs & Mobility", "Commode", ParticipantDocumentTag.Shared, "RequiresCommode"),
        S("requiresStandingMachine", "Support Needs & Mobility", "Standing Machine", ParticipantDocumentTag.Shared, "RequiresStandingMachine"),
        S("supportRatio", "Support Needs & Mobility", "Support Ratio", ParticipantDocumentTag.Shared, "SupportRatio"),
        S("mobilityNotes", "Support Needs & Mobility", "Mobility Notes", ParticipantDocumentTag.Profile, "MobilityNotes"),
        S("equipmentRequirements", "Support Needs & Mobility", "Equipment Requirements", ParticipantDocumentTag.Profile, "EquipmentRequirements"),
        S("transportRequirements", "Support Needs & Mobility", "Transport Requirements", ParticipantDocumentTag.Profile, "TransportRequirements"),
        S("ambulantStatus", "Support Needs & Mobility", "Ambulant Status", ParticipantDocumentTag.Profile, "AmbulantStatus"),
        S("fallsRiskRating", "Support Needs & Mobility", "Falls Risk Rating", ParticipantDocumentTag.Profile, "FallsRiskRating"),
        S("unevenGroundFlag", "Support Needs & Mobility", "Uneven Ground", ParticipantDocumentTag.Profile, "UnevenGroundFlag"),
        S("levelOfPersonalCare", "Support Needs & Mobility", "Level of Personal Care", ParticipantDocumentTag.Profile, "LevelOfPersonalCare"),
        S("orthotics", "Support Needs & Mobility", "Orthotics", ParticipantDocumentTag.Profile, "Orthotics"),
        S("continenceSupportDetail", "Support Needs & Mobility", "Continence Support", ParticipantDocumentTag.Profile, "ContinenceSupportDetail"),
        S("bowelCareDetail", "Support Needs & Mobility", "Colostomy / Catheter / Enema / Suppository", ParticipantDocumentTag.Profile, "BowelCareDetail"),
        S("menstruationSupport", "Support Needs & Mobility", "Menstruation Support", ParticipantDocumentTag.Profile, "MenstruationSupport"),

        // ── Medical ──────────────────────────────────────────────────────────────────────
        S("primaryDiagnosis", "Medical", "Primary Diagnosis", ParticipantDocumentTag.Profile, "PrimaryDiagnosis"),
        S("otherDiagnoses", "Medical", "Other Diagnoses", ParticipantDocumentTag.Profile, "OtherDiagnoses"),
        S("hidpaSupportCategories", "Medical", "HIDPA Support Categories", ParticipantDocumentTag.Profile, "HidpaSupportCategories"),
        S("medicalSummary", "Medical", "Medical Summary", ParticipantDocumentTag.Shared, "MedicalSummary"),
        S("allergiesDetail", "Medical", "Allergies", ParticipantDocumentTag.Profile, "AllergiesDetail"),
        S("isAnaphylaxisRisk", "Medical", "Anaphylaxis Risk", ParticipantDocumentTag.Profile, "IsAnaphylaxisRisk"),
        // DEVIATION (see this class's doc comment): documentMapping.ts tags hidpaNotes `sources: []`,
        // but its own note says it's "DELIBERATELY tagged 'all' ... ungated in the wizard, same
        // visibility as hidpaSupportCategories itself" — modelled here as Shared so it renders
        // alongside hidpaSupportCategories on both documents rather than being silently dropped.
        S("hidpaNotes", "Medical", "HIDPA Notes", ParticipantDocumentTag.Shared, "HidpaNotes"),
        T("healthConditions", "Medical", "Health Conditions", ParticipantDocumentTag.Profile),

        // ── Cultural & Consent ───────────────────────────────────────────────────────────
        S("isCald", "Cultural & Consent", "Culturally and Linguistically Diverse (CALD)", ParticipantDocumentTag.Shared, "IsCald"),
        S("isLgbtqi", "Cultural & Consent", "LGBTIQA+", ParticipantDocumentTag.Shared, "IsLgbtqi"),
        S("isFamilyCommunity", "Cultural & Consent", "Family / Community", ParticipantDocumentTag.Shared, "IsFamilyCommunity"),
        S("isAboriginalOrTorresStraitIslander", "Cultural & Consent", "Aboriginal and/or Torres Strait Islander", ParticipantDocumentTag.Shared, "IsAboriginalOrTorresStraitIslander"),
        S("receivedRightsAndResponsibilitiesInfo", "Cultural & Consent", "Received: Rights and Responsibilities", ParticipantDocumentTag.Shared, "ReceivedRightsAndResponsibilitiesInfo"),
        S("receivedPrivacyAndConfidentialityInfo", "Cultural & Consent", "Received: Privacy and Confidentiality", ParticipantDocumentTag.Shared, "ReceivedPrivacyAndConfidentialityInfo"),
        S("receivedFeedbackInfo", "Cultural & Consent", "Received: Feedback Information and Form", ParticipantDocumentTag.Shared, "ReceivedFeedbackInfo"),
        S("receivedBeingSafeInfo", "Cultural & Consent", "Received: Being Safe Information", ParticipantDocumentTag.Shared, "ReceivedBeingSafeInfo"),
        S("receivedAdvocacyInfo", "Cultural & Consent", "Received: Advocacy Information", ParticipantDocumentTag.Shared, "ReceivedAdvocacyInfo"),
        S("personalInterests", "Cultural & Consent", "Personal Interests", ParticipantDocumentTag.Profile, "PersonalInterests"),
        S("choiceControlNotes", "Cultural & Consent", "Choice & Control Notes", ParticipantDocumentTag.Profile, "ChoiceControlNotes"),
        T("consents", "Cultural & Consent", "Consents", ParticipantDocumentTag.Profile),

        // ── Behaviour & Communication ────────────────────────────────────────────────────
        S("memory", "Behaviour & Communication", "Memory", ParticipantDocumentTag.Profile, "Memory"),
        S("memoryAids", "Behaviour & Communication", "Memory Aids", ParticipantDocumentTag.Profile, "MemoryAids"),
        S("impairedUnderstanding", "Behaviour & Communication", "Impaired Understanding", ParticipantDocumentTag.Profile, "ImpairedUnderstanding"),
        S("impairedJudgementReasoning", "Behaviour & Communication", "Impaired Judgement / Reasoning", ParticipantDocumentTag.Profile, "ImpairedJudgementReasoning"),
        S("behavioursOfConcernCurrent", "Behaviour & Communication", "Behaviours of Concern (Current)", ParticipantDocumentTag.Shared, "BehavioursOfConcernCurrent"),
        S("behavioursOfConcernFiveYearHistory", "Behaviour & Communication", "Behaviours of Concern (5-Year History)", ParticipantDocumentTag.Shared, "BehavioursOfConcernFiveYearHistory"),
        S("behaviourRiskRating", "Behaviour & Communication", "Behaviour Risk Rating", ParticipantDocumentTag.Profile, "BehaviourRiskRating"),
        S("ridsLogged", "Behaviour & Communication", "RIDS Logged", ParticipantDocumentTag.Profile, "RidsLogged"),
        S("bspPlanProvided", "Behaviour & Communication", "BSP Plan Provided", ParticipantDocumentTag.Profile, "BspPlanProvided"),
        S("bocChartProvided", "Behaviour & Communication", "BOC Chart Provided", ParticipantDocumentTag.Profile, "BocChartProvided"),
        S("expressiveSkills", "Behaviour & Communication", "Expressive Skills", ParticipantDocumentTag.Shared, "ExpressiveSkills"),
        S("receptiveSkills", "Behaviour & Communication", "Receptive Skills", ParticipantDocumentTag.Profile, "ReceptiveSkills"),
        S("readingAbility", "Behaviour & Communication", "Reading Ability", ParticipantDocumentTag.Profile, "ReadingAbility"),
        S("communicationAids", "Behaviour & Communication", "Communication Aids", ParticipantDocumentTag.Profile, "CommunicationAids"),

        // ── Daily Living ─────────────────────────────────────────────────────────────────
        S("mealAssistanceDetail", "Daily Living", "Meal Assistance", ParticipantDocumentTag.Profile, "MealAssistanceDetail"),
        S("chokingRiskMealDetail", "Daily Living", "Choking Risk — Meal Management", ParticipantDocumentTag.Profile, "ChokingRiskMealDetail"),
        S("modifiedDietDetail", "Daily Living", "Modified Diet", ParticipantDocumentTag.Profile, "ModifiedDietDetail"),
        S("pegRegimeMealDetail", "Daily Living", "PEG Regime", ParticipantDocumentTag.Profile, "PegRegimeMealDetail"),
        S("specialUtensilsDetail", "Daily Living", "Special Utensils", ParticipantDocumentTag.Profile, "SpecialUtensilsDetail"),
        S("specialDietaryNeedsDetail", "Daily Living", "Special Dietary Needs", ParticipantDocumentTag.Profile, "SpecialDietaryNeedsDetail"),
        S("favouriteBreakfast", "Daily Living", "Favourite Breakfast", ParticipantDocumentTag.Profile, "FavouriteBreakfast"),
        S("favouriteLunch", "Daily Living", "Favourite Lunch", ParticipantDocumentTag.Profile, "FavouriteLunch"),
        S("favouriteDinner", "Daily Living", "Favourite Dinner", ParticipantDocumentTag.Profile, "FavouriteDinner"),
        S("medicationTricks", "Daily Living", "Medication Tricks", ParticipantDocumentTag.Profile, "MedicationTricks"),
        S("foodsAlwaysEaten", "Daily Living", "Foods Always Eaten", ParticipantDocumentTag.Profile, "FoodsAlwaysEaten"),
        S("goals", "Daily Living", "Goals", ParticipantDocumentTag.Profile, "Goals"),
        S("supportAreas", "Daily Living", "Support Areas", ParticipantDocumentTag.Profile, "SupportAreas"),
        S("strengthsFears", "Daily Living", "Strengths / Fears", ParticipantDocumentTag.Profile, "StrengthsFears"),
        S("thingsToKnow", "Daily Living", "Things to Know", ParticipantDocumentTag.Profile, "ThingsToKnow"),
        S("whoIsImportant", "Daily Living", "Who/What Is Important", ParticipantDocumentTag.Profile, "WhoIsImportant"),
        S("likesDislikes", "Daily Living", "Likes & Dislikes", ParticipantDocumentTag.Profile, "LikesDislikes"),
        // Not CA-gated at the table level (see documentMapping.ts's adlAssessments note: "the whole
        // adlAssessments field stays tagged 'all' since the base grid itself is relevant regardless
        // of stream; only its howToHelpNotes column is CA-specific") — the CA gate instead controls
        // just the extra "How To Help" column, applied inside the composer's table builder.
        T("adlAssessments", "Daily Living", "ADL Assessments", ParticipantDocumentTag.Profile),

        // ── Community Access (entire section CA-gated; Participant Profile only) ───────────
        S("signsHappyAndSettled", "Community Access", "Signs I Am Happy and Settled", ParticipantDocumentTag.Profile, "SignsHappyAndSettled", caGated: true),
        S("whatHelpsMeCalmDown", "Community Access", "What Helps Me Calm Down", ParticipantDocumentTag.Profile, "WhatHelpsMeCalmDown", caGated: true),
        S("bocTriggers", "Community Access", "Behaviours of Concern — Triggers", ParticipantDocumentTag.Profile, "BocTriggers", caGated: true),
        S("bocEarlyWarningSigns", "Community Access", "Behaviours of Concern — Early Warning Signs", ParticipantDocumentTag.Profile, "BocEarlyWarningSigns", caGated: true),
        S("bocDeEscalationStrategies", "Community Access", "Behaviours of Concern — De-Escalation Strategies", ParticipantDocumentTag.Profile, "BocDeEscalationStrategies", caGated: true),
        S("bocWhatNotToDo", "Community Access", "Behaviours of Concern — What Not To Do", ParticipantDocumentTag.Profile, "BocWhatNotToDo", caGated: true),
        S("supportsLookLikeMorning", "Community Access", "What My Supports Look Like — Morning", ParticipantDocumentTag.Profile, "SupportsLookLikeMorning", caGated: true),
        S("supportsLookLikeDay", "Community Access", "What My Supports Look Like — Day", ParticipantDocumentTag.Profile, "SupportsLookLikeDay", caGated: true),
        S("supportsLookLikeAfternoonEvening", "Community Access", "What My Supports Look Like — Afternoon-Evening", ParticipantDocumentTag.Profile, "SupportsLookLikeAfternoonEvening", caGated: true),
        S("supportsLookLikeOvernight", "Community Access", "What My Supports Look Like — Overnight", ParticipantDocumentTag.Profile, "SupportsLookLikeOvernight", caGated: true),
        T("checklistItems", "Community Access", "Checklist Items", ParticipantDocumentTag.Profile, caGated: true),

        // ── Risks & Hazards ──────────────────────────────────────────────────────────────
        S("behaviourRiskSummary", "Risks & Hazards", "Behaviour Risk Summary", ParticipantDocumentTag.Shared, "BehaviourRiskSummary"),
        // DEVIATION (see this class's doc comment): documentMapping.ts tags riskEntries
        // `sources: []` (ODIP-only, no Oassist source-form backing) — included here anyway,
        // Participant Profile only, as an ODIP-operational structured register, because DOC-01's
        // brief explicitly requires a risk-entries table in the composed output.
        T("riskEntries", "Risks & Hazards", "Risk Entries", ParticipantDocumentTag.Profile),
    };
}
