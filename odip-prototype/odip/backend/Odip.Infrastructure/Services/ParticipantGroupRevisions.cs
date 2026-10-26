using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Per-section revisions for a participant's scalar PATCH groups. One table ties each key to its DTO property and its Participant
/// columns, so "sent", "changed" and the key list cannot drift apart. A missing row is revision 0.
/// </summary>
public static class ParticipantGroupRevisions
{
    public const string ChangedCode = "participant-section-changed";
    public const string ChangedMessage = "Someone else saved this section since you opened it.";

    // Literal camelCase keys: no DictionaryKeyPolicy is configured, so keys serialise as written.
    internal static readonly (string Key, Func<PatchParticipantDto, object?> Sent, string[] Columns)[] Groups =
    [
        ("personalDetails", d => d.PersonalDetails, ["FirstName", "LastName", "PreferredName", "MiddleName", "DateOfBirth", "Gender", "GenderSelfDescription", "PlaceOfBirth", "Country", "Phone", "Email"]),
        ("preferredStaff", d => d.PreferredStaff, ["PreferredUserId"]),
        ("address", d => d.Address, ["AddressStreet", "AddressSuburb", "AddressState", "AddressPostcode"]),
        ("livingArrangement", d => d.LivingArrangement, ["LivingArrangement", "MainSupportPersonName", "MainSupportPersonRelationship", "OthersLivingInAccommodation", "ResidentialInfo", "LivesWithOthers", "WhoLivesWith", "SilProviderName", "SilProviderContactPhone", "AccommodationType", "OnSiteSupportHours", "LivingArrangementNotes"]),
        ("ndisPlan", d => d.NdisPlan, ["NdisNumber", "PlanStartDate", "PlanEndDate", "PlanType", "FundingSource", "FundingOrganisation", "IsDsoa", "IsRepeatClient"]),
        ("serviceProfile", d => d.ServiceProfile, ["Region", "ServiceStreams"]),
        ("keyIdentifiers", d => d.KeyIdentifiers, ["PensionCardNumber", "PensionCardExpiry", "MedicareNumber", "MedicareExpiry", "CompanionCardNumber", "CompanionCardExpiry", "PrivateHealthFund", "PrivateHealthMembershipNumber", "TaxiCardNumber", "HairColour", "EyeColour", "WeightKg", "HeightCm"]),
        ("culturalBackground", d => d.CulturalBackground, ["IsCald", "IsLgbtqi", "IsFamilyCommunity", "IsAboriginalOrTorresStraitIslander", "ReceivedRightsAndResponsibilitiesInfo", "ReceivedPrivacyAndConfidentialityInfo", "ReceivedFeedbackInfo", "ReceivedBeingSafeInfo", "ReceivedAdvocacyInfo", "PersonalInterests", "ChoiceControlNotes"]),
        ("supportNeedsMobility", d => d.SupportNeedsMobility, ["IsHighSupport", "IsIntensiveSupport", "SupportRatio", "MobilityAidWheelchair", "MobilityAidWalker", "MobilitySupportOptions", "OvernightSupport", "OvernightRatio", "RequiresHiLoBed", "RequiresHoist", "RequiresShowerChair", "RequiresCommode", "RequiresStandingMachine", "MobilityNotes", "EquipmentRequirements", "TransportRequirements", "AmbulantStatus", "FallsRiskRating", "UnevenGroundFlag", "LevelOfPersonalCare", "Orthotics", "ContinenceSupportDetail", "BowelCareDetail", "MenstruationSupport", "SkinIntegrity"]),
        ("medical", d => d.Medical, ["PrimaryDiagnosis", "OtherDiagnoses", "HidpaSupportCategories", "HidpaNotes", "MedicalSummary", "AllergiesDetail", "IsAnaphylaxisRisk", "AllergyManagementNotes"]),
        ("behaviourCommunication", d => d.BehaviourCommunication, ["Memory", "MemoryAids", "ImpairedUnderstanding", "ImpairedJudgementReasoning", "BehavioursOfConcernCurrent", "BehavioursOfConcernFiveYearHistory", "BehaviourRiskRating", "RidsLogged", "BspPlanProvided", "BocChartProvided", "ExpressiveSkills", "ReceptiveSkills", "ReadingAbility", "CommunicationAids"]),
        ("communityAccessBehaviour", d => d.CommunityAccessBehaviour, ["SignsHappyAndSettled", "WhatHelpsMeCalmDown", "BocTriggers", "BocEarlyWarningSigns", "BocDeEscalationStrategies", "BocWhatNotToDo", "OverallCommunityAccessRiskRating"]),
        ("mealsAndDiet", d => d.MealsAndDiet, ["MealAssistanceDetail", "ChokingRiskMealDetail", "ModifiedDietDetail", "PegRegimeMealDetail", "SpecialUtensilsDetail", "SpecialDietaryNeedsDetail", "FavouriteBreakfast", "FavouriteLunch", "FavouriteDinner", "MedicationTricks", "FoodsAlwaysEaten"]),
        ("aboutMe", d => d.AboutMe, ["Goals", "SupportAreas", "StrengthsFears", "ThingsToKnow", "WhoIsImportant", "LikesDislikes"]),
        ("supportsLookLike", d => d.SupportsLookLike, ["SupportsLookLikeMorning", "SupportsLookLikeDay", "SupportsLookLikeAfternoonEvening", "SupportsLookLikeOvernight"]),
        ("risksHazardsSummary", d => d.RisksHazardsSummary, ["BehaviourRiskSummary", "Notes"]),
    ];

    public static readonly string[] Keys = Groups.Select(g => g.Key).ToArray();

    // Participant columns in no scalar group (ids, tenant, lifecycle, timestamps). The completeness test pins it.
    // FundingSource is in a group but ParticipantFundingSourceBackfill writes it with no bump: startup-only, it re-derives the same value.
    internal static readonly string[] NotGroupColumns =
        ["Id", "TenantId", "IsActive", "HasRestrictivePracticeFlag", "PlanManagerContactId", "IsDraft", "IntakeCompletedAt", "ServicesStartedAt", "CreatedAt", "UpdatedAt"];

    public static IEnumerable<string> SentGroups(PatchParticipantDto dto) =>
        Groups.Where(g => g.Sent(dto) != null).Select(g => g.Key);

    /// <summary>All 16 keys; 0 where there is no row.</summary>
    public static async Task<Dictionary<string, int>> ReadAsync(OdipDbContext db, Guid participantId, CancellationToken ct)
    {
        var rows = await db.ParticipantGroupRevisions.AsNoTracking()
            .Where(r => r.ParticipantId == participantId).ToDictionaryAsync(r => r.GroupKey, r => r.Revision, ct);
        return Keys.ToDictionary(k => k, k => rows.GetValueOrDefault(k));
    }

    /// <summary>The current revisions when any expected, sent key differs (`!=`: an expected value above the current one is stale too); else null. A missing row is 0.</summary>
    public static async Task<Dictionary<string, int>?> StaleAsync(OdipDbContext db, Guid participantId,
        IReadOnlyDictionary<string, int> expected, IEnumerable<string> sentKeys, CancellationToken ct)
    {
        var current = await ReadAsync(db, participantId, ct);
        return sentKeys.Any(k => expected.TryGetValue(k, out var e) && current.GetValueOrDefault(k) != e) ? current : null;
    }

    /// <summary>Call just before SaveChanges. Bumps each group with a changed column.</summary>
    public static async Task BumpChangedAsync(OdipDbContext db, Participant p, IReadOnlyDictionary<string, int>? expected, CancellationToken ct)
    {
        db.ChangeTracker.DetectChanges();
        var entry = db.Entry(p);
        var changed = Groups.Where(g => g.Columns.Any(c => entry.Property(c).IsModified)).Select(g => g.Key).ToList();
        if (changed.Count == 0) return;
        var rows = await db.ParticipantGroupRevisions
            .Where(r => r.ParticipantId == p.Id && changed.Contains(r.GroupKey))
            .ToDictionaryAsync(r => r.GroupKey, ct);
        var now = DateTime.UtcNow;
        foreach (var key in changed)
        {
            if (!rows.TryGetValue(key, out var row))
            {
                // A first save racing another first save loses on the PK insert (23505).
                db.ParticipantGroupRevisions.Add(new ParticipantGroupRevision { ParticipantId = p.Id, GroupKey = key, Revision = 1, UpdatedAt = now });
                continue;
            }
            // The check sits in the UPDATE's WHERE: the revision the person opened, not the one loaded now.
            if (expected != null && expected.TryGetValue(key, out var opened))
                db.Entry(row).Property(r => r.Revision).OriginalValue = opened;
            row.Revision++;
            row.UpdatedAt = now;
        }
    }

    public static bool IsLostRace(DbUpdateException ex) => ex is DbUpdateConcurrencyException c
        ? c.Entries.All(e => e.Entity is ParticipantGroupRevision)
        : ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "PK_ParticipantGroupRevisions" };

    /// <summary>SaveChanges for a writer that sent no expected revision: on a lost revision race, take the latest revision and save once
    /// more, as SaveIntake does. A second loss surfaces as the normal error. Never for a PATCH with expectedRevisions.</summary>
    public static async Task SaveBumpingAsync(OdipDbContext db, CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); return; }
        catch (DbUpdateException ex) when (IsLostRace(ex)) { }
        var now = DateTime.UtcNow;
        foreach (var e in db.ChangeTracker.Entries<ParticipantGroupRevision>().Where(e => e.State is EntityState.Added or EntityState.Modified).ToList())
        {
            var stored = await e.GetDatabaseValuesAsync(ct);
            if (stored is null) continue; // still no row: the insert stands
            var latest = stored.GetValue<int>(nameof(ParticipantGroupRevision.Revision));
            if (e.State == EntityState.Added)
            {
                // Someone inserted the first row meanwhile: update theirs instead.
                e.State = EntityState.Detached;
                var row = new ParticipantGroupRevision { ParticipantId = e.Entity.ParticipantId, GroupKey = e.Entity.GroupKey, Revision = latest };
                db.ParticipantGroupRevisions.Attach(row);
                row.Revision = latest + 1;
                row.UpdatedAt = now;
            }
            else
            {
                e.Property(r => r.Revision).OriginalValue = latest;
                e.Entity.Revision = latest + 1;
            }
        }
        await db.SaveChangesAsync(ct);
    }
}
