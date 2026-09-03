namespace Odip.Infrastructure.Services;

/// <summary>Which wizard captures a field. See <see cref="ParticipantFieldEntryMap"/>'s type doc.</summary>
public enum ParticipantFieldEntryPhase
{
    Intake,
    Profile,
}

/// <summary>One row: a wizard/DTO field id and the single wizard that captures it.</summary>
public sealed record ParticipantFieldEntryMapEntry(string FieldId, ParticipantFieldEntryPhase Phase);

/// <summary>
/// PF-10.1 (SPEC-05 <c>docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md</c>) — the
/// backend mirror of <c>frontend/src/lib/documentMapping.ts</c>'s <c>entryPhase</c> tag: which
/// WIZARD captures a given participant field, as opposed to <see cref="ParticipantDocumentFieldMap"/>
/// (which PDF *renders* it). This is a deliberate THIRD, independent file — not a change to
/// <see cref="ParticipantDocumentFieldMap"/>, which stays scoped to PDF rendering and its own
/// `sources`-shaped tag (see that class's doc comment for the cross-reference). Like that file,
/// this is a hand-kept mirror of the frontend's authoritative list, covering every field
/// <c>documentMapping.ts</c>'s <c>DOCUMENT_MAPPING</c> declares (144 entries as of this branch,
/// including the ODIP-operational fields with no Oassist source-form backing that
/// <see cref="ParticipantDocumentFieldMap"/> deliberately excludes — entry-phase allocation is
/// total over the wizard's field set, unlike PDF rendering, which only covers source-form-backed
/// fields).
///
/// A `sources: ['shared']` field in <c>documentMapping.ts</c> is always <see cref="ParticipantFieldEntryPhase.Intake"/>
/// here (captured once, at Intake, then displayed read-only on the Profile wizard/detail page) —
/// there is no "Shared" member on <see cref="ParticipantFieldEntryPhase"/>, mirroring
/// <c>EntryPhase</c>'s TS shape exactly (`'intake' | 'profile'`, no `'shared'`).
///
/// Kept in sync with the frontend BY HAND, exactly like <see cref="ParticipantDocumentFieldMap"/>
/// already is with `sources` — nothing enforces the sync mechanically except the field-id-level
/// cross-check in <c>Odip.Tests/Services/ParticipantFieldEntryMapTests.cs</c>, which reads
/// <c>documentMapping.ts</c>'s source text at test time and fails loudly on any drift.
/// </summary>
public static class ParticipantFieldEntryMap
{
    private static ParticipantFieldEntryMapEntry E(string fieldId, ParticipantFieldEntryPhase phase) => new(fieldId, phase);

    public static readonly IReadOnlyList<ParticipantFieldEntryMapEntry> Entries = new List<ParticipantFieldEntryMapEntry>
    {
        // ── Participant Details (Identity step) ─────────────────────────────────────────
        E("firstName", ParticipantFieldEntryPhase.Intake),
        E("lastName", ParticipantFieldEntryPhase.Intake),
        E("preferredName", ParticipantFieldEntryPhase.Intake),
        E("middleName", ParticipantFieldEntryPhase.Profile),
        E("dateOfBirth", ParticipantFieldEntryPhase.Intake),
        E("gender", ParticipantFieldEntryPhase.Profile),
        E("genderSelfDescription", ParticipantFieldEntryPhase.Profile),
        E("placeOfBirth", ParticipantFieldEntryPhase.Profile),
        E("country", ParticipantFieldEntryPhase.Profile),
        E("phone", ParticipantFieldEntryPhase.Intake),
        E("email", ParticipantFieldEntryPhase.Intake),
        E("addressStreet", ParticipantFieldEntryPhase.Intake),
        E("addressSuburb", ParticipantFieldEntryPhase.Intake),
        E("addressState", ParticipantFieldEntryPhase.Intake),
        E("addressPostcode", ParticipantFieldEntryPhase.Intake),
        E("preferredStaffId", ParticipantFieldEntryPhase.Profile),

        // ── Living Arrangements (Identity step) ─────────────────────────────────────────
        E("livingArrangement", ParticipantFieldEntryPhase.Intake),
        E("mainSupportPersonName", ParticipantFieldEntryPhase.Intake),
        E("mainSupportPersonRelationship", ParticipantFieldEntryPhase.Intake),
        E("othersLivingInAccommodation", ParticipantFieldEntryPhase.Intake),
        E("residentialInfo", ParticipantFieldEntryPhase.Intake),
        E("livesWithOthers", ParticipantFieldEntryPhase.Intake),
        E("whoLivesWith", ParticipantFieldEntryPhase.Intake),
        E("silProviderName", ParticipantFieldEntryPhase.Intake),
        E("silProviderContactPhone", ParticipantFieldEntryPhase.Intake),
        E("accommodationType", ParticipantFieldEntryPhase.Intake),
        E("onSiteSupportHours", ParticipantFieldEntryPhase.Intake),
        E("livingArrangementNotes", ParticipantFieldEntryPhase.Intake),

        // ── NDIS & Funding ───────────────────────────────────────────────────────────────
        E("ndisNumber", ParticipantFieldEntryPhase.Intake),
        E("planStartDate", ParticipantFieldEntryPhase.Intake),
        E("planEndDate", ParticipantFieldEntryPhase.Intake),
        E("planType", ParticipantFieldEntryPhase.Intake),
        E("fundingSource", ParticipantFieldEntryPhase.Intake),
        E("fundingOrganisation", ParticipantFieldEntryPhase.Intake),
        E("isDsoa", ParticipantFieldEntryPhase.Profile),
        E("region", ParticipantFieldEntryPhase.Intake),
        E("isRepeatClient", ParticipantFieldEntryPhase.Intake),
        E("serviceStreams", ParticipantFieldEntryPhase.Intake),

        // ── Key Identifiers (entire step moves to Profile) ──────────────────────────────
        E("pensionCardNumber", ParticipantFieldEntryPhase.Profile),
        E("pensionCardExpiry", ParticipantFieldEntryPhase.Profile),
        E("medicareNumber", ParticipantFieldEntryPhase.Profile),
        E("medicareExpiry", ParticipantFieldEntryPhase.Profile),
        E("companionCardNumber", ParticipantFieldEntryPhase.Profile),
        E("companionCardExpiry", ParticipantFieldEntryPhase.Profile),
        E("privateHealthFund", ParticipantFieldEntryPhase.Profile),
        E("privateHealthMembershipNumber", ParticipantFieldEntryPhase.Profile),
        E("taxiCardNumber", ParticipantFieldEntryPhase.Profile),
        E("hairColour", ParticipantFieldEntryPhase.Profile),
        E("eyeColour", ParticipantFieldEntryPhase.Profile),
        E("weightKg", ParticipantFieldEntryPhase.Profile),
        E("heightCm", ParticipantFieldEntryPhase.Profile),

        // ── Contacts ─────────────────────────────────────────────────────────────────────
        E("contactRoles", ParticipantFieldEntryPhase.Intake),

        // ── Support Needs & Mobility (fissions) ─────────────────────────────────────────
        E("mobilityAidWheelchair", ParticipantFieldEntryPhase.Intake),
        E("mobilityAidWalker", ParticipantFieldEntryPhase.Intake),
        E("mobilitySupportOptions", ParticipantFieldEntryPhase.Profile),
        E("isHighSupport", ParticipantFieldEntryPhase.Intake),
        E("isIntensiveSupport", ParticipantFieldEntryPhase.Intake),
        E("overnightSupport", ParticipantFieldEntryPhase.Intake),
        E("overnightRatio", ParticipantFieldEntryPhase.Intake),
        E("requiresHiLoBed", ParticipantFieldEntryPhase.Intake),
        E("requiresHoist", ParticipantFieldEntryPhase.Intake),
        E("requiresShowerChair", ParticipantFieldEntryPhase.Intake),
        E("requiresCommode", ParticipantFieldEntryPhase.Intake),
        E("requiresStandingMachine", ParticipantFieldEntryPhase.Intake),
        E("supportRatio", ParticipantFieldEntryPhase.Intake),
        E("mobilityNotes", ParticipantFieldEntryPhase.Profile),
        E("equipmentRequirements", ParticipantFieldEntryPhase.Profile),
        E("transportRequirements", ParticipantFieldEntryPhase.Profile),
        E("ambulantStatus", ParticipantFieldEntryPhase.Profile),
        E("fallsRiskRating", ParticipantFieldEntryPhase.Profile),
        E("unevenGroundFlag", ParticipantFieldEntryPhase.Profile),
        E("levelOfPersonalCare", ParticipantFieldEntryPhase.Profile),
        E("orthotics", ParticipantFieldEntryPhase.Profile),
        E("continenceSupportDetail", ParticipantFieldEntryPhase.Profile),
        E("bowelCareDetail", ParticipantFieldEntryPhase.Profile),
        E("menstruationSupport", ParticipantFieldEntryPhase.Profile),
        // NOT accounted for in SPEC-05 PF-10.1's allocation table (silent on this field) —
        // allocated Profile by extension of the "Mobility & Functional" cluster's rule (free-text,
        // no source-form backing, no day-one-safety signal), matching orthotics/
        // continenceSupportDetail/etc. immediately above. See documentMapping.ts's matching
        // comment and this branch's PR report for the same flagged deviation on the frontend side.
        E("skinIntegrity", ParticipantFieldEntryPhase.Profile),

        // ── Medical (fissions) ───────────────────────────────────────────────────────────
        E("primaryDiagnosis", ParticipantFieldEntryPhase.Profile),
        E("otherDiagnoses", ParticipantFieldEntryPhase.Profile),
        E("hidpaSupportCategories", ParticipantFieldEntryPhase.Profile),
        E("medicalSummary", ParticipantFieldEntryPhase.Intake),
        E("allergiesDetail", ParticipantFieldEntryPhase.Profile),
        E("isAnaphylaxisRisk", ParticipantFieldEntryPhase.Profile),
        E("allergyManagementNotes", ParticipantFieldEntryPhase.Profile),
        E("healthConditions", ParticipantFieldEntryPhase.Profile),

        // ── Cultural & Consent (fissions) ────────────────────────────────────────────────
        E("isCald", ParticipantFieldEntryPhase.Intake),
        E("isLgbtqi", ParticipantFieldEntryPhase.Intake),
        E("isFamilyCommunity", ParticipantFieldEntryPhase.Intake),
        E("isAboriginalOrTorresStraitIslander", ParticipantFieldEntryPhase.Intake),
        E("receivedRightsAndResponsibilitiesInfo", ParticipantFieldEntryPhase.Intake),
        E("receivedPrivacyAndConfidentialityInfo", ParticipantFieldEntryPhase.Intake),
        E("receivedFeedbackInfo", ParticipantFieldEntryPhase.Intake),
        E("receivedBeingSafeInfo", ParticipantFieldEntryPhase.Intake),
        E("receivedAdvocacyInfo", ParticipantFieldEntryPhase.Intake),
        E("personalInterests", ParticipantFieldEntryPhase.Profile),
        E("choiceControlNotes", ParticipantFieldEntryPhase.Profile),
        // Consents (photo/video, privacy, emergency medical — ungated; alcohol, OTC medication,
        // travel insurance, T&Cs — conditional on ServiceStreams.STA per PF-10.4's gating
        // predicate) are all Profile-entry regardless of gating; the STA gate controls which
        // consent rows are collectible, not which wizard captures the field.
        E("consents", ParticipantFieldEntryPhase.Profile),

        // ── Behaviour & Communication (fissions) ────────────────────────────────────────
        E("memory", ParticipantFieldEntryPhase.Profile),
        E("memoryAids", ParticipantFieldEntryPhase.Profile),
        E("impairedUnderstanding", ParticipantFieldEntryPhase.Profile),
        E("impairedJudgementReasoning", ParticipantFieldEntryPhase.Profile),
        E("behavioursOfConcernCurrent", ParticipantFieldEntryPhase.Intake),
        E("behavioursOfConcernFiveYearHistory", ParticipantFieldEntryPhase.Intake),
        E("behaviourRiskRating", ParticipantFieldEntryPhase.Profile),
        E("ridsLogged", ParticipantFieldEntryPhase.Profile),
        E("bspPlanProvided", ParticipantFieldEntryPhase.Profile),
        E("bocChartProvided", ParticipantFieldEntryPhase.Profile),
        E("expressiveSkills", ParticipantFieldEntryPhase.Intake),
        E("receptiveSkills", ParticipantFieldEntryPhase.Profile),
        E("readingAbility", ParticipantFieldEntryPhase.Profile),
        E("communicationAids", ParticipantFieldEntryPhase.Profile),

        // ── Daily Living (entire step moves to Profile) ─────────────────────────────────
        E("adlAssessments", ParticipantFieldEntryPhase.Profile),
        E("mealAssistanceDetail", ParticipantFieldEntryPhase.Profile),
        E("chokingRiskMealDetail", ParticipantFieldEntryPhase.Profile),
        E("modifiedDietDetail", ParticipantFieldEntryPhase.Profile),
        E("pegRegimeMealDetail", ParticipantFieldEntryPhase.Profile),
        E("specialUtensilsDetail", ParticipantFieldEntryPhase.Profile),
        E("specialDietaryNeedsDetail", ParticipantFieldEntryPhase.Profile),
        E("favouriteBreakfast", ParticipantFieldEntryPhase.Profile),
        E("favouriteLunch", ParticipantFieldEntryPhase.Profile),
        E("favouriteDinner", ParticipantFieldEntryPhase.Profile),
        E("medicationTricks", ParticipantFieldEntryPhase.Profile),
        E("foodsAlwaysEaten", ParticipantFieldEntryPhase.Profile),
        E("goals", ParticipantFieldEntryPhase.Profile),
        E("supportAreas", ParticipantFieldEntryPhase.Profile),
        E("strengthsFears", ParticipantFieldEntryPhase.Profile),
        E("thingsToKnow", ParticipantFieldEntryPhase.Profile),
        E("whoIsImportant", ParticipantFieldEntryPhase.Profile),
        E("likesDislikes", ParticipantFieldEntryPhase.Profile),

        // ── Community Access (entire section, CommunityAccessDailyLiving-gated) — Profile ──
        E("signsHappyAndSettled", ParticipantFieldEntryPhase.Profile),
        E("whatHelpsMeCalmDown", ParticipantFieldEntryPhase.Profile),
        E("bocTriggers", ParticipantFieldEntryPhase.Profile),
        E("bocEarlyWarningSigns", ParticipantFieldEntryPhase.Profile),
        E("bocDeEscalationStrategies", ParticipantFieldEntryPhase.Profile),
        E("bocWhatNotToDo", ParticipantFieldEntryPhase.Profile),
        E("checklistItems", ParticipantFieldEntryPhase.Profile),
        // hidpaNotes lives in the Medical step, ungated (see documentMapping.ts's own note) — not
        // part of the Community Access section, listed here only to keep this map's ordering
        // aligned with documentMapping.ts's declaration order.
        E("hidpaNotes", ParticipantFieldEntryPhase.Intake),
        E("supportsLookLikeMorning", ParticipantFieldEntryPhase.Profile),
        E("supportsLookLikeDay", ParticipantFieldEntryPhase.Profile),
        E("supportsLookLikeAfternoonEvening", ParticipantFieldEntryPhase.Profile),
        E("supportsLookLikeOvernight", ParticipantFieldEntryPhase.Profile),

        // ── Risks & Hazards ──────────────────────────────────────────────────────────────
        E("behaviourRiskSummary", ParticipantFieldEntryPhase.Intake),
        E("notes", ParticipantFieldEntryPhase.Intake),
        E("riskEntries", ParticipantFieldEntryPhase.Intake),
    };
}
