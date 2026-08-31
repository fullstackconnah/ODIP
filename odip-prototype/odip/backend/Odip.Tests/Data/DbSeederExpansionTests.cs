using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// Coverage for the seed-expansion task: richer demo medications/administrations/notes/routines/
/// restrictive-practices, plus the participant coherence pass (address/living-arrangement/plan
/// dates). Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as DbSeederDiagnosesTests /
/// ParticipantAlertsServiceTests. Every test seeds a fresh InMemory database via the full
/// DbSeeder call chain (SeedAsync then the per-area seed methods, mirroring Program.cs's actual
/// startup order) rather than hand-building rows, since the point is to exercise the seeder
/// itself.
/// </summary>
public class DbSeederExpansionTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static async Task<OdipDbContext> SeedFullAsync(string dbName)
    {
        var db = CreateDb(dbName);
        await DbSeeder.SeedAsync(db, CancellationToken.None);
        await DbSeeder.SeedMedicationsAsync(db, CancellationToken.None);
        await DbSeeder.SeedParticipantNotesAsync(db, CancellationToken.None);
        await DbSeeder.SeedParticipantRoutinesAsync(db, CancellationToken.None);
        await DbSeeder.SeedRestrictivePracticesAsync(db, CancellationToken.None);
        return db;
    }

    // ── Per-area counts ──────────────────────────────────────────────────

    [Fact]
    public async Task SeedMedicationsAsync_SeedsAtLeastFourteenMedications()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var count = await db.ParticipantMedications.IgnoreQueryFilters().CountAsync();

        Assert.True(count >= 14, $"Expected at least 14 medications, found {count}.");
    }

    [Fact]
    public async Task SeedMedicationsAsync_SeedsAtLeastTwentyFiveAdministrations()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var count = await db.MedicationAdministrations.IgnoreQueryFilters().CountAsync();

        Assert.True(count >= 25, $"Expected at least 25 administration records, found {count}.");
    }

    [Fact]
    public async Task SeedParticipantNotesAsync_SeedsAtLeastEightNotes()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var count = await db.ParticipantNotes.IgnoreQueryFilters().CountAsync();

        Assert.True(count >= 8, $"Expected at least 8 notes, found {count}.");
    }

    [Fact]
    public async Task SeedParticipantRoutinesAsync_SeedsBetweenTenAndFifteenRoutines()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var count = await db.ParticipantRoutines.IgnoreQueryFilters().CountAsync();

        Assert.InRange(count, 10, 15);
    }

    [Fact]
    public async Task SeedParticipantRoutinesAsync_IncludesAtLeastOneInactiveRoutine()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var inactiveCount = await db.ParticipantRoutines.IgnoreQueryFilters().CountAsync(r => !r.IsActive);

        Assert.True(inactiveCount >= 1, "Expected at least one retired (IsActive = false) routine.");
    }

    [Fact]
    public async Task SeedRestrictivePracticesAsync_CoversAllSixRestrictivePracticeTypes()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var types = await db.RestrictivePractices.IgnoreQueryFilters()
            .Select(rp => rp.Type).Distinct().ToListAsync();

        foreach (var expected in Enum.GetValues<RestrictivePracticeType>())
            Assert.Contains(expected, types);
    }

    [Fact]
    public async Task SeedRestrictivePracticesAsync_HasAtLeastTwoOverdueReviewsAndOneRecentlyReviewed()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var overdueCount = await db.RestrictivePractices.IgnoreQueryFilters()
            .CountAsync(rp => rp.IsActive && rp.ReviewDate != null && rp.ReviewDate < today);
        var recentlyReviewedCount = await db.RestrictivePractices.IgnoreQueryFilters()
            .CountAsync(rp => rp.IsActive && rp.AuthorisationDate != null && rp.AuthorisationDate >= today.AddDays(-30));

        Assert.True(overdueCount >= 2, $"Expected at least 2 overdue-review restrictive practices, found {overdueCount}.");
        Assert.True(recentlyReviewedCount >= 1, "Expected at least one recently authorised/reviewed restrictive practice.");
    }

    [Fact]
    public async Task SeedRestrictivePracticesAsync_ChemicalRestraintRowLinksToItsMedication()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var chemicalRestraint = await db.RestrictivePractices.IgnoreQueryFilters()
            .SingleAsync(rp => rp.Type == RestrictivePracticeType.ChemicalRestraint);

        Assert.NotNull(chemicalRestraint.RelatedMedicationId);
        var linkedMedication = await db.ParticipantMedications.IgnoreQueryFilters()
            .SingleAsync(m => m.Id == chemicalRestraint.RelatedMedicationId);
        Assert.True(linkedMedication.IsChemicalRestraint);
        Assert.Equal(chemicalRestraint.ParticipantId, linkedMedication.ParticipantId);
    }

    // ── HasRestrictivePracticeFlag consistency ──────────────────────────

    [Fact]
    public async Task AllDemoParticipants_HasRestrictivePracticeFlagMatchesActiveRegisterRows()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var participants = await db.Participants.IgnoreQueryFilters().ToListAsync();
        var participantIdsWithActiveRp = (await db.RestrictivePractices.IgnoreQueryFilters()
                .Where(rp => rp.IsActive)
                .Select(rp => rp.ParticipantId)
                .Distinct()
                .ToListAsync())
            .ToHashSet();

        foreach (var participant in participants)
        {
            var expectedFlag = participantIdsWithActiveRp.Contains(participant.Id);
            Assert.True(participant.HasRestrictivePracticeFlag == expectedFlag,
                $"{participant.FirstName} {participant.LastName} ({participant.Id}): HasRestrictivePracticeFlag={participant.HasRestrictivePracticeFlag} but active-register-row presence={expectedFlag}.");
        }
    }

    // ── Medication schedule variety ─────────────────────────────────────

    [Fact]
    public async Task SeedMedicationsAsync_CoversSpecificDaysAndEveryNDaysFrequencies()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        Assert.True(await db.ParticipantMedications.IgnoreQueryFilters()
            .AnyAsync(m => m.Frequency == MedicationFrequency.SpecificDays && m.DaysOfWeek != null));
        Assert.True(await db.ParticipantMedications.IgnoreQueryFilters()
            .AnyAsync(m => m.Frequency == MedicationFrequency.EveryNDays && m.IntervalDays == 2 && m.AnchorDate != null));
    }

    [Fact]
    public async Task SeedMedicationsAsync_HasMultipleHighRiskMedicationsAndPrnDosingLimits()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var highRiskCount = await db.ParticipantMedications.IgnoreQueryFilters().CountAsync(m => m.IsHighRisk);
        var prnWithLimitsCount = await db.ParticipantMedications.IgnoreQueryFilters()
            .CountAsync(m => m.Type == MedicationType.Prn && m.PrnMaxDosesPer24h != null && m.PrnMinIntervalMinutes != null);

        Assert.True(highRiskCount >= 2, $"Expected at least 2 high-risk medications, found {highRiskCount}.");
        Assert.True(prnWithLimitsCount >= 2, $"Expected at least 2 PRN medications with dosing limits, found {prnWithLimitsCount}.");
    }

    [Fact]
    public async Task SeedMedicationsAsync_CoversVariedFormsAndPackaging()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var forms = await db.ParticipantMedications.IgnoreQueryFilters().Select(m => m.Form).Distinct().ToListAsync();
        var packagings = await db.ParticipantMedications.IgnoreQueryFilters().Select(m => m.Packaging).Distinct().ToListAsync();

        Assert.True(forms.Count >= 6, $"Expected at least 6 distinct medication forms, found {forms.Count}.");
        Assert.True(packagings.Count >= 4, $"Expected at least 4 distinct packaging types, found {packagings.Count}.");
    }

    [Fact]
    public async Task SeedMedicationsAsync_MostMedicationsCarryAPharmacyName()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var total = await db.ParticipantMedications.IgnoreQueryFilters().CountAsync();
        var withPharmacy = await db.ParticipantMedications.IgnoreQueryFilters()
            .CountAsync(m => m.PharmacyName != null && m.PharmacyName != "");

        Assert.True(withPharmacy >= total - 2, $"Expected almost every medication to carry a PharmacyName ({withPharmacy}/{total}).");
    }

    // ── Guard: RecordedByName/WitnessName must agree with the resolved user (fix round 1) ──

    [Fact]
    public async Task SeedMedicationsAsync_RecordedByNameAndWitnessNameAgreeWithTheirResolvedUser()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var users = await db.Users.IgnoreQueryFilters().ToDictionaryAsync(u => u.Id, u => u.FullName);
        var administrations = await db.MedicationAdministrations.IgnoreQueryFilters().ToListAsync();

        foreach (var a in administrations)
        {
            if (a.RecordedByUserId is { } recordedByUserId)
            {
                Assert.True(users.TryGetValue(recordedByUserId, out var expectedName),
                    $"Administration {a.Id}: RecordedByUserId {recordedByUserId} does not match any seeded user.");
                Assert.True(a.RecordedByName == expectedName,
                    $"Administration {a.Id}: RecordedByName \"{a.RecordedByName}\" does not match RecordedByUserId {recordedByUserId}'s FullName \"{expectedName}\".");
            }

            if (a.WitnessUserId is { } witnessUserId && a.WitnessName is not null)
            {
                Assert.True(users.TryGetValue(witnessUserId, out var expectedWitnessName),
                    $"Administration {a.Id}: WitnessUserId {witnessUserId} does not match any seeded user.");
                Assert.True(a.WitnessName == expectedWitnessName,
                    $"Administration {a.Id}: WitnessName \"{a.WitnessName}\" does not match WitnessUserId {witnessUserId}'s FullName \"{expectedWitnessName}\".");
            }
        }
    }

    // ── Administration record variety ───────────────────────────────────

    [Fact]
    public async Task SeedMedicationsAsync_AdministrationsCoverAllFiveStatusesAndFourWitnessStates()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var statuses = await db.MedicationAdministrations.IgnoreQueryFilters().Select(a => a.Status).Distinct().ToListAsync();
        foreach (var expected in Enum.GetValues<MedicationAdministrationStatus>())
            Assert.Contains(expected, statuses);

        var witnessStates = await db.MedicationAdministrations.IgnoreQueryFilters().Select(a => a.WitnessStatus).Distinct().ToListAsync();
        foreach (var expected in Enum.GetValues<WitnessStatus>())
            Assert.Contains(expected, witnessStates);
    }

    [Fact]
    public async Task SeedMedicationsAsync_WrongMedicationRecordHasReasonAndNotes()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var wrongMed = await db.MedicationAdministrations.IgnoreQueryFilters()
            .SingleAsync(a => a.Status == MedicationAdministrationStatus.WrongMedication);

        Assert.False(string.IsNullOrWhiteSpace(wrongMed.Reason));
        Assert.False(string.IsNullOrWhiteSpace(wrongMed.Notes));
    }

    [Fact]
    public async Task SeedMedicationsAsync_HasRecordsWithRecordedByUserIdAndMelbourneTimeZone()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());

        var withRecordedByUser = await db.MedicationAdministrations.IgnoreQueryFilters()
            .CountAsync(a => a.RecordedByUserId != null);
        var withMelbourneTz = await db.MedicationAdministrations.IgnoreQueryFilters()
            .CountAsync(a => a.AdministeredAtTimeZone == "Australia/Melbourne");

        Assert.True(withRecordedByUser >= 10, $"Expected at least 10 administrations with RecordedByUserId set, found {withRecordedByUser}.");
        Assert.True(withMelbourneTz >= 2, $"Expected at least 2 administrations with AdministeredAtTimeZone=Australia/Melbourne, found {withMelbourneTz}.");
    }

    // ── ParticipantAlertsService integration — the overdue-RP scenario fires ────────────

    [Fact]
    public async Task ParticipantAlertsService_SurfacesOverdueRestrictivePracticeReviewsFromSeedData()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());
        var service = new ParticipantAlertsService(db);

        var alerts = await service.GetAlertsAsync(participantId: null, activeOnly: false);

        var overdueAlerts = alerts.SelectMany(a => a.Alerts)
            .Where(a => a.Type == "restrictive-practice-review-overdue")
            .ToList();

        Assert.True(overdueAlerts.Count >= 2, $"Expected at least 2 restrictive-practice-review-overdue alerts, found {overdueAlerts.Count}.");
        Assert.All(overdueAlerts, a => Assert.Equal(AlertSeverity.Warning, a.Severity));
    }

    [Fact]
    public async Task ParticipantAlertsService_AggregateShowsBothCriticalAndWarningPlanAlerts_NotAWall()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());
        var service = new ParticipantAlertsService(db);

        // activeOnly: true — mirrors the dashboard/participants-table aggregate consumer.
        var alerts = await service.GetAlertsAsync(participantId: null, activeOnly: true);

        var planExpired = alerts.SelectMany(a => a.Alerts).Count(a => a.Type == "plan-expired");
        var planExpiringSoon = alerts.SelectMany(a => a.Alerts).Count(a => a.Type == "plan-expiring-soon");
        var totalActiveParticipants = alerts.Count;

        Assert.True(planExpired >= 1, "Expected at least one active participant with an expired plan (the Critical demo).");
        Assert.True(planExpiringSoon >= 1, "Expected at least one active participant with a plan expiring within 30 days (the Warning demo).");
        // "Not a wall": plan alerts should be a minority of the active participant set, not everyone.
        Assert.True(planExpired + planExpiringSoon < totalActiveParticipants,
            $"Plan alerts ({planExpired + planExpiringSoon}) should not cover the entire active participant set ({totalActiveParticipants}).");
    }

    [Fact]
    public async Task ParticipantAlertsService_ExcludesInactiveParticipantsExpiredPlanFromAggregate()
    {
        using var db = await SeedFullAsync(Guid.NewGuid().ToString());
        var service = new ParticipantAlertsService(db);

        // Zoe Campbell is seeded IsActive=false with an already-expired plan — she must not
        // contribute a plan-expired alert to the activeOnly aggregate.
        var zoeId = Guid.Parse("d2000000-0000-0000-0000-000000000007");
        var zoe = await db.Participants.IgnoreQueryFilters().SingleAsync(p => p.Id == zoeId);
        Assert.False(zoe.IsActive);
        Assert.NotNull(zoe.PlanEndDate);
        Assert.True(zoe.PlanEndDate < DateOnly.FromDateTime(DateTime.UtcNow));

        var aggregateAlerts = await service.GetAlertsAsync(participantId: null, activeOnly: true);
        Assert.DoesNotContain(aggregateAlerts, a => a.ParticipantId == zoeId);

        // But her own detail-page lookup (activeOnly: false) still surfaces it.
        var directAlerts = await service.GetAlertsAsync(participantId: zoeId, activeOnly: false);
        Assert.Contains(directAlerts.Single().Alerts, a => a.Type == "plan-expired");
    }
}
