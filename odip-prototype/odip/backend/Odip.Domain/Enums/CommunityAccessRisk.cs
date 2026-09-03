namespace Odip.Domain.Enums;

/// <summary>
/// PF-10.2 (SPEC-05 <c>docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md</c>) — the
/// three rated-risk categories the Profile — Community Access variant's §10 "Community Access Risk
/// Assessment" groups its 22 items into (research spec §10, Road &amp; Traffic Safety / Behaviours
/// of Concern / Health &amp; Personal Safety). The fourth heading on the source form, "Community &amp;
/// Social", has no populated rated-item rows in the source document — only the category heading —
/// so it is not represented here (see <see cref="Entities.ParticipantCommunityAccessRiskItem"/>'s
/// type doc). Derived via <see cref="CommunityAccessRiskItemTypeGroups"/> from
/// <see cref="CommunityAccessRiskItemType"/>'s fixed declaration order, same "category derived, not
/// stored" shape as <see cref="AdlCategory"/>/<see cref="AdlTypeGroups"/> and
/// <see cref="ChecklistType"/>/<see cref="ChecklistItemTypeGroups"/>.
/// </summary>
public enum CommunityAccessRiskCategory
{
    RoadTraffic,
    BehavioursOfConcern,
    HealthAndPersonalSafety,
}

/// <summary>
/// PF-10.2 — one member per rated item in the Profile — Community Access variant's §10 "Community
/// Access Risk Assessment" matrix (research spec §10, quoted verbatim below), 22 total across the
/// three <see cref="CommunityAccessRiskCategory"/> groups. Modelled as ONE enum (not three), same
/// "single enum, category derived from declaration order" shape as <see cref="AdlType"/> and
/// <see cref="ChecklistItemType"/> — category is derived via
/// <see cref="CommunityAccessRiskItemTypeGroups"/>, not stored.
///
/// Genuinely a different shape from the existing <see cref="ChecklistItemType"/> Yes/No/N-A
/// checklist (INTAKE-03/04): this matrix rates each item Low/Medium/High/Critical (reusing
/// <see cref="RiskRatingLevel"/>, already shared by <see cref="Entities.Participant.FallsRiskRating"/>/
/// <see cref="Entities.Participant.BehaviourRiskRating"/>) with a free-text Support/Strategy note
/// per item, not a tri-state checkbox — see <see cref="Entities.ParticipantCommunityAccessRiskItem"/>.
///
/// ROAD &amp; TRAFFIC SAFETY (first 5, research spec §10, quoted verbatim): "General Road awareness,
/// Runs across roads / bolts into traffic, Absconding/flight risk in the community, Wanders or gets
/// lost in crowds/large venues, Removes seatbelt/opens door while vehicle moving".
/// BEHAVIOURS OF CONCERN (next 8, quoted verbatim): "Harm to self (hits self, head banging,
/// scratching), Harm to others (hits, kicks, bites, spits, pushes), Break items / throws objects,
/// Property damage (windows, walls, cars, furniture), Verbal aggression/yelling in public, Refusal
/// to return to vehicle/transition refusal, Inappropriate public behaviour, Taking food or items
/// belonging to others".
/// HEALTH &amp; PERSONAL SAFETY (remaining 9, quoted verbatim): "Choking / eating and drinking in the
/// community, Seizure in the community, Diabetes — hypo/hyper event, Asthma / breathing difficulty,
/// Allergy or anaphylaxis exposure, Falls — uneven ground, stairs, fatigue, Continence accident
/// while out, Heat/sun exposure, Water safety (pool, beach, river)".
/// </summary>
public enum CommunityAccessRiskItemType
{
    // ── Road & Traffic Safety (research spec §10) ───────────────────────────────
    GeneralRoadAwareness,
    RunsAcrossRoadsOrBoltsIntoTraffic,
    AbscondingFlightRiskInCommunity,
    WandersOrGetsLostInCrowds,
    RemovesSeatbeltOrOpensDoorWhileMoving,

    // ── Behaviours of Concern (research spec §10) ───────────────────────────────
    HarmToSelf,
    HarmToOthers,
    BreakItemsOrThrowsObjects,
    PropertyDamage,
    VerbalAggressionYellingInPublic,
    RefusalToReturnToVehicleTransition,
    InappropriatePublicBehaviour,
    TakingFoodOrItemsBelongingToOthers,

    // ── Health & Personal Safety (research spec §10) ────────────────────────────
    ChokingEatingDrinkingInCommunity,
    SeizureInCommunity,
    DiabetesHypoHyperEvent,
    AsthmaBreathingDifficulty,
    AllergyOrAnaphylaxisExposure,
    FallsUnevenGroundStairsFatigue,
    ContinenceAccidentWhileOut,
    HeatSunExposure,
    WaterSafety,
}

/// <summary>
/// Static <see cref="CommunityAccessRiskItemType"/> -&gt; <see cref="CommunityAccessRiskCategory"/>
/// lookup, derived from <see cref="CommunityAccessRiskItemType"/>'s fixed declaration order (the
/// first 5 members are Road &amp; Traffic Safety, the next 8 are Behaviours of Concern, the
/// remaining 9 are Health &amp; Personal Safety) rather than a stored column — exactly the same
/// shape and reasoning as <see cref="AdlTypeGroups"/>/<see cref="ChecklistItemTypeGroups"/>.
/// </summary>
public static class CommunityAccessRiskItemTypeGroups
{
    public static readonly IReadOnlyList<CommunityAccessRiskItemType> RoadTraffic = new[]
    {
        CommunityAccessRiskItemType.GeneralRoadAwareness, CommunityAccessRiskItemType.RunsAcrossRoadsOrBoltsIntoTraffic,
        CommunityAccessRiskItemType.AbscondingFlightRiskInCommunity, CommunityAccessRiskItemType.WandersOrGetsLostInCrowds,
        CommunityAccessRiskItemType.RemovesSeatbeltOrOpensDoorWhileMoving,
    };

    public static readonly IReadOnlyList<CommunityAccessRiskItemType> BehavioursOfConcern = new[]
    {
        CommunityAccessRiskItemType.HarmToSelf, CommunityAccessRiskItemType.HarmToOthers,
        CommunityAccessRiskItemType.BreakItemsOrThrowsObjects, CommunityAccessRiskItemType.PropertyDamage,
        CommunityAccessRiskItemType.VerbalAggressionYellingInPublic, CommunityAccessRiskItemType.RefusalToReturnToVehicleTransition,
        CommunityAccessRiskItemType.InappropriatePublicBehaviour, CommunityAccessRiskItemType.TakingFoodOrItemsBelongingToOthers,
    };

    public static readonly IReadOnlyList<CommunityAccessRiskItemType> HealthAndPersonalSafety = new[]
    {
        CommunityAccessRiskItemType.ChokingEatingDrinkingInCommunity, CommunityAccessRiskItemType.SeizureInCommunity,
        CommunityAccessRiskItemType.DiabetesHypoHyperEvent, CommunityAccessRiskItemType.AsthmaBreathingDifficulty,
        CommunityAccessRiskItemType.AllergyOrAnaphylaxisExposure, CommunityAccessRiskItemType.FallsUnevenGroundStairsFatigue,
        CommunityAccessRiskItemType.ContinenceAccidentWhileOut, CommunityAccessRiskItemType.HeatSunExposure,
        CommunityAccessRiskItemType.WaterSafety,
    };

    public static CommunityAccessRiskCategory CategoryOf(CommunityAccessRiskItemType type) =>
        RoadTraffic.Contains(type) ? CommunityAccessRiskCategory.RoadTraffic
        : BehavioursOfConcern.Contains(type) ? CommunityAccessRiskCategory.BehavioursOfConcern
        : CommunityAccessRiskCategory.HealthAndPersonalSafety;
}
