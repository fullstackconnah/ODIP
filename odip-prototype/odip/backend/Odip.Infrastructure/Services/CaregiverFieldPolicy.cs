using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
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
    // Enums by name, as everywhere else the API serialises (Program.cs): the caregiver page and the review compare them as names.
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

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
    /// Make a caregiver payload safe to apply: an allow-list of the groups the caregiver form sends (PersonalDetails,
    /// KeyIdentifiers, CulturalBackground, SupportNeedsMobility, Medical, BehaviourCommunication, MealsAndDiet, AboutMe,
    /// Consents, HealthConditions, AdlAssessments). Every other group (NdisPlan, ServiceProfile, PreferredStaff,
    /// RisksHazardsSummary, and any group added to PatchParticipantDto later) becomes null, which PATCH treats as untouched.
    /// Inside the allowed BehaviourCommunication group, BehaviourRiskRating is internal, so it is overwritten with the
    /// participant's current value: nulling it would clear it, since a present group with a null member clears that member.
    /// Accept runs this on the payload and the base before the merge, and again on the merged result.
    /// </summary>
    public static PatchParticipantDto Sanitise(PatchParticipantDto payload, Participant current)
    {
        // Allow-list: only the groups the caregiver form sends. A group added to PatchParticipantDto later is blocked until listed here.
        var clean = new PatchParticipantDto
        {
            PersonalDetails = payload.PersonalDetails,
            KeyIdentifiers = payload.KeyIdentifiers,
            CulturalBackground = payload.CulturalBackground,
            SupportNeedsMobility = payload.SupportNeedsMobility,
            Medical = payload.Medical,
            BehaviourCommunication = payload.BehaviourCommunication,
            MealsAndDiet = payload.MealsAndDiet,
            AboutMe = payload.AboutMe,
            Consents = payload.Consents,
            HealthConditions = payload.HealthConditions,
            AdlAssessments = payload.AdlAssessments,
        };

        if (clean.BehaviourCommunication is { } bc)
            clean = clean with { BehaviourCommunication = bc with { BehaviourRiskRating = current.BehaviourRiskRating } };

        return clean;
    }

    private static readonly (string Group, string Key)[] CollectionGroups =
        [("consents", "consentType"), ("healthConditions", "conditionType"), ("adlAssessments", "adlType")];

    /// <summary>
    /// Three-way merge: keep only what the caregiver changed from the form they loaded (<paramref name="base"/>);
    /// every other member takes the live value from <paramref name="current"/> (the projection). Both sides changed: the caregiver wins.
    /// A group with no change is dropped. Collection rows match by key and are compared column by column.
    /// </summary>
    public static PatchParticipantDto MergeAgainstBase(JsonObject current, PatchParticipantDto payload, PatchParticipantDto @base)
    {
        var p = (JsonObject)JsonSerializer.SerializeToNode(payload, Web)!;
        var b = (JsonObject)JsonSerializer.SerializeToNode(@base, Web)!;
        var merged = new JsonObject();
        foreach (var (group, pv) in p)
        {
            if (pv is JsonObject pg)
            {
                if (b[group] is not JsonObject bg) { merged[group] = pg.DeepClone(); continue; }
                var o = new JsonObject();
                var changed = false;
                foreach (var (m, v) in pg)
                {
                    if (Differs(v, bg[m])) { o[m] = v?.DeepClone(); changed = true; }
                    else o[m] = current[m]?.DeepClone();
                }
                if (changed) merged[group] = o;
            }
            else if (pv is JsonArray pa)
            {
                var key = CollectionGroups.FirstOrDefault(c => c.Group == group).Key;
                if (key is null || b[group] is not JsonArray ba) { merged[group] = pa.DeepClone(); continue; }
                var rows = MergeRows(key, pa, ba, current[group] as JsonArray);
                if (rows.Count > 0) merged[group] = rows;
            }
        }
        return merged.Deserialize<PatchParticipantDto>(Web)!;
    }

    private static JsonArray MergeRows(string key, JsonArray payload, JsonArray @base, JsonArray? live)
    {
        // Last row wins for a repeated key; never ToDictionary.
        static Dictionary<string, JsonObject> ByKey(string key, JsonArray? rows)
        {
            var d = new Dictionary<string, JsonObject>();
            foreach (var r in rows ?? []) if (r is JsonObject o && o[key]?.ToString() is { } k) d[k] = o;
            return d;
        }
        var baseRows = ByKey(key, @base);
        var liveRows = ByKey(key, live);
        var result = new JsonArray();
        foreach (var (k, row) in ByKey(key, payload))
        {
            baseRows.TryGetValue(k, out var baseRow);
            var changedCols = row.Where(c => c.Key != key && Differs(c.Value, baseRow?[c.Key])).ToList();
            if (changedCols.Count == 0) continue;
            var outRow = liveRows.TryGetValue(k, out var l) ? (JsonObject)l.DeepClone() : new JsonObject { [key] = row[key]?.DeepClone() };
            foreach (var c in changedCols) outRow[c.Key] = c.Value?.DeepClone();
            result.Add(outRow);
        }
        return result;
    }

    // null and "" are the same value; lists compare in order.
    private static bool Differs(JsonNode? a, JsonNode? b)
    {
        static bool Blank(JsonNode? n) => n is null || (n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length == 0);
        return !(Blank(a) && Blank(b)) && !JsonNode.DeepEquals(a, b);
    }
}
