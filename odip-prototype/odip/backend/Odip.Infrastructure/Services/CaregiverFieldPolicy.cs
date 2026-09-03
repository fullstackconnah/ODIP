using System.Text.Json;
using System.Text.Json.Nodes;
using Odip.Application.DTOs;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// What a caregiver may see and edit. See docs/specs/2026-09-03-caregiver-profile-form-design.md §2.
///
/// InternalFields are JSON property names on <see cref="ParticipantDetailDto"/> (camelCase).
/// <see cref="BuildProjection"/> works by SUBTRACTION from the full DTO so a field can only reach
/// a caregiver if it is on the DTO and not listed here — and
/// CaregiverFieldPolicyTests.EveryInternalFieldExistsOnParticipantDetailDto fails the build if a
/// listed name stops existing on the DTO, so a rename cannot silently un-exclude anything.
///
/// <see cref="IsInternalFieldId"/> treats an allocation-contract field id (e.g. "behaviourRiskRating"
/// in <see cref="ParticipantFieldEntryMap"/>) as identical to the camelCase JSON property name of
/// the same field on <see cref="ParticipantDetailDto"/> — true for every scalar and collection field
/// in both maps (documentMapping.ts's field ids are themselves the frontend's camelCase field
/// names, and ParticipantFieldEntryMap/ParticipantDocumentFieldMap both reuse those same strings
/// verbatim). This is simpler and more robust than resolving through
/// ParticipantDocumentFieldMap.Entries's ParticipantPropertyName, which is null or entirely absent
/// for several Profile fields that matter here (e.g. "preferredStaffId", "isDsoa" have no
/// document-field-map row at all, since they carry no Oassist source-form backing) — routing
/// through that map would silently misclassify exactly the fields this policy most needs to catch.
/// </summary>
public static class CaregiverFieldPolicy
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// JSON property names on ParticipantDetailDto that must never reach a caregiver, grouped by
    /// the spec's exclusion categories (§2):
    ///   restrictive practices + the derived flag → hasRestrictivePracticeFlag (the register itself
    ///     has no ParticipantDetailDto field at all — it lives on its own nested-CRUD endpoint)
    ///   behaviour risk rating → behaviourRiskRating
    ///   risks/hazards summary + its notes → behaviourRiskSummary, notes
    ///   ndisPlan group (PatchNdisPlanDto, all 8 members) → ndisNumber, planStartDate, planEndDate,
    ///     planType, fundingSource, fundingOrganisation, isDsoa, isRepeatClient
    ///   serviceProfile group EXCEPT serviceStreams (PatchServiceProfileDto minus ServiceStreams) → region
    ///   preferred staff → preferredStaffId, preferredStaffName
    /// (riskEntries and safety auto-notes are excluded from this set deliberately: neither has a
    /// ParticipantDetailDto property — RiskEntries/ParticipantNote stay on their own nested-CRUD
    /// endpoints, untouched by this DTO-subtraction projection or by PATCH.)
    /// </summary>
    public static readonly IReadOnlySet<string> InternalFields = new HashSet<string>(StringComparer.Ordinal)
    {
        // Restrictive practices (derived flag only — the register itself isn't on this DTO).
        "hasRestrictivePracticeFlag",

        // Behaviour risk rating.
        "behaviourRiskRating",

        // Risks & hazards summary + its notes.
        "behaviourRiskSummary",
        "notes",

        // ndisPlan group (PatchNdisPlanDto — all 8 members).
        "ndisNumber",
        "planStartDate",
        "planEndDate",
        "planType",
        "fundingSource",
        "fundingOrganisation",
        "isDsoa",
        "isRepeatClient",

        // serviceProfile group except serviceStreams (PatchServiceProfileDto minus ServiceStreams).
        "region",

        // Preferred staff.
        "preferredStaffId",
        "preferredStaffName",
    };

    /// <summary>True iff an allocation-contract field id names an internal DTO property. See this class's type doc for why this is a direct membership check rather than an indirection through ParticipantDocumentFieldMap.</summary>
    public static bool IsInternalFieldId(string fieldId) => InternalFields.Contains(fieldId);

    /// <summary>Allocation-contract field ids with Phase == Profile whose mapped DTO property is not internal.</summary>
    public static IReadOnlyList<string> EditableFieldIds() =>
        ParticipantFieldEntryMap.Entries
            .Where(e => e.Phase == ParticipantFieldEntryPhase.Profile)
            .Select(e => e.FieldId)
            .Where(id => !IsInternalFieldId(id))
            .ToList();

    /// <summary>Serialises the detail DTO with web (camelCase) options and removes every InternalFields key.</summary>
    public static JsonObject BuildProjection(ParticipantDetailDto detail)
    {
        var node = JsonSerializer.SerializeToNode(detail, Web) as JsonObject ?? new JsonObject();
        foreach (var key in InternalFields) node.Remove(key);
        return node;
    }

    /// <summary>
    /// Make a caregiver payload safe to apply. Internal GROUPS become null (absent = untouched by
    /// PATCH's group-level atomicity). Internal SCALARS that live inside caregiver-editable groups
    /// are overwritten with the participant's current value — nulling them would CLEAR them, since
    /// a present group with a null member clears that member exactly as a full Create/Update would.
    ///
    /// The four internal groups nulled here are exactly InternalFields' ndisPlan/serviceProfile/
    /// preferredStaff/risksHazardsSummary members, mapped to their PatchParticipantDto group:
    ///   PreferredStaff          — preferredStaffId (+ preferredStaffName, read-only/derived, has
    ///                             no Patch member at all)
    ///   NdisPlan                — ndisNumber, planStartDate, planEndDate, planType, fundingSource,
    ///                             fundingOrganisation, isDsoa, isRepeatClient
    ///   ServiceProfile          — region (serviceStreams is NOT internal, but the whole group is
    ///                             still server-controlled — the caregiver never edits serviceStreams
    ///                             via this form either)
    ///   RisksHazardsSummary     — behaviourRiskSummary, notes
    ///
    /// Cross-checking InternalFields against every member of PatchParticipantDto's other 12
    /// (caregiver-editable) groups — PersonalDetails, Address, LivingArrangement, KeyIdentifiers,
    /// CulturalBackground, SupportNeedsMobility, Medical, BehaviourCommunication,
    /// CommunityAccessBehaviour, MealsAndDiet, AboutMe, SupportsLookLike — finds exactly ONE
    /// overlap: BehaviourRiskRating inside BehaviourCommunication. hasRestrictivePracticeFlag has
    /// no Patch member anywhere (derived, read-only), so there is nothing to preserve for it beyond
    /// the fact that PATCH never reads it.
    /// </summary>
    public static PatchParticipantDto Sanitise(PatchParticipantDto payload, Participant current)
    {
        var clean = payload with
        {
            PreferredStaff = null,
            NdisPlan = null,
            ServiceProfile = null,
            RisksHazardsSummary = null,
        };

        if (clean.BehaviourCommunication is { } bc)
            clean = clean with { BehaviourCommunication = bc with { BehaviourRiskRating = current.BehaviourRiskRating } };

        return clean;
    }
}
