using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Alerts;

/// <summary>
/// Coverage for <see cref="ParticipantAlertsService"/> (task 6c) — the computed, non-persisted
/// participant risk alerts. Follows the same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as
/// ParticipantRoutinesControllerTests/MedicationsControllerTests. Every "overdue"/"expiring" date
/// is computed relative to <see cref="DateTime.UtcNow"/> at test time (there is no injectable
/// clock anywhere in this codebase — see MedicationsController's own NextReviewDue check for the
/// same pattern) rather than a literal absolute date, which is what "fixed dates" means here.
/// </summary>
public class ParticipantAlertsServiceTests
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

    private static OdipDbContext CreateTenantScopedDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedParticipant(
        OdipDbContext db, string firstName = "Sophie", string lastName = "Brown",
        bool isHighSupport = false, OvernightSupportType overnightSupport = OvernightSupportType.None,
        DateOnly? planEndDate = null)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true,
            IsHighSupport = isHighSupport, OvernightSupport = overnightSupport, PlanEndDate = planEndDate,
        };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static ParticipantMedication SeedMedication(
        OdipDbContext db, Guid participantId, string name = "Panadol",
        bool isHighRisk = false, MedicationType type = MedicationType.Regular,
        MedicationFrequency frequency = MedicationFrequency.Daily,
        MedicationStatus status = MedicationStatus.Active)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = name, DoseDescription = "1 tablet",
            Type = type, TimesOfDay = "08:00", Frequency = frequency, IsHighRisk = isHighRisk, Status = status,
            StartDate = DateTime.UtcNow.AddDays(-90),
        };
        db.ParticipantMedications.Add(med);
        db.SaveChanges();
        return med;
    }

    // ── Rule 1: restrictive practice review overdue ─────────────────────────

    [Fact]
    public async Task RestrictivePracticeReviewOverdue_ActiveRowPastReviewDate_Fires()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.RestrictivePractices.Add(new RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.Seclusion,
            Description = "d", IsActive = true, ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1),
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alert = Assert.Single(result.Single().Alerts);
        Assert.Equal("restrictive-practice-review-overdue", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
        Assert.Equal("restrictive-practices", alert.DeepLinkTab);
    }

    [Fact]
    public async Task RestrictivePracticeReviewOverdue_ReviewDateInFuture_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.RestrictivePractices.Add(new RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.Seclusion,
            Description = "d", IsActive = true, ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(30),
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Empty(result.Single().Alerts);
    }

    [Fact]
    public async Task RestrictivePracticeReviewOverdue_InactiveRow_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        db.RestrictivePractices.Add(new RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.Seclusion,
            Description = "d", IsActive = false, ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1),
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Empty(result.Single().Alerts);
    }

    // ── Rule 2: high-risk medication witness gap ────────────────────────────

    [Fact]
    public async Task HighRiskMedicationWitnessGap_AdministeredWithPendingWitness_Fires()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id, isHighRisk: true);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddDays(-1),
            WitnessStatus = WitnessStatus.Pending, RecordedByName = "Test",
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alert = Assert.Single(result.Single().Alerts);
        Assert.Equal("high-risk-medication-witness-gap", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("medications", alert.DeepLinkTab);
    }

    [Fact]
    public async Task HighRiskMedicationWitnessGap_ApprovedWitness_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id, isHighRisk: true);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddDays(-1),
            WitnessStatus = WitnessStatus.Approved, RecordedByName = "Test",
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "high-risk-medication-witness-gap");
    }

    [Fact]
    public async Task HighRiskMedicationWitnessGap_OutsideWindow_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id, isHighRisk: true);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddDays(-30),
            WitnessStatus = WitnessStatus.Pending, RecordedByName = "Test",
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "high-risk-medication-witness-gap");
    }

    [Fact]
    public async Task HighRiskMedicationWitnessGap_NotHighRisk_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id, isHighRisk: false);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Administered, AdministeredAt = DateTime.UtcNow.AddDays(-1),
            WitnessStatus = WitnessStatus.Pending, RecordedByName = "Test",
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "high-risk-medication-witness-gap");
    }

    // ── Rule 3: routine coverage gap ─────────────────────────────────────────

    [Fact]
    public async Task RoutineCoverageGap_HighSupportNoActiveRoutines_Fires()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, isHighSupport: true);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alert = Assert.Single(result.Single().Alerts);
        Assert.Equal("routine-coverage-gap", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
        Assert.Equal("routines", alert.DeepLinkTab);
    }

    [Fact]
    public async Task RoutineCoverageGap_OvernightSupportNoActiveRoutines_Fires()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, overnightSupport: OvernightSupportType.Sleepover);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Contains(result.Single().Alerts, a => a.Type == "routine-coverage-gap");
    }

    [Fact]
    public async Task RoutineCoverageGap_HasActiveRoutine_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, isHighSupport: true);
        db.ParticipantRoutines.Add(new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Morning", Description = "d", IsActive = true,
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "routine-coverage-gap");
    }

    [Fact]
    public async Task RoutineCoverageGap_NotHighSupportOrOvernight_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Empty(result.Single().Alerts);
    }

    [Fact]
    public async Task RoutineCoverageGap_OnlyInactiveRoutine_StillFires()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, isHighSupport: true);
        db.ParticipantRoutines.Add(new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Title = "Retired", Description = "d", IsActive = false,
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Contains(result.Single().Alerts, a => a.Type == "routine-coverage-gap");
    }

    // ── Rule 4: plan end date ────────────────────────────────────────────────

    [Fact]
    public async Task PlanEndDate_InThePast_FiresCritical()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, planEndDate: DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-5));

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alert = Assert.Single(result.Single().Alerts);
        Assert.Equal("plan-expired", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("details", alert.DeepLinkTab);
    }

    [Fact]
    public async Task PlanEndDate_WithinWarningWindow_FiresWarning()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, planEndDate: DateOnly.FromDateTime(DateTime.UtcNow).AddDays(10));

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alert = Assert.Single(result.Single().Alerts);
        Assert.Equal("plan-expiring-soon", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
    }

    [Fact]
    public async Task PlanEndDate_FarInFuture_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, planEndDate: DateOnly.FromDateTime(DateTime.UtcNow).AddDays(200));

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Empty(result.Single().Alerts);
    }

    [Fact]
    public async Task PlanEndDate_Null_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, planEndDate: null);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Empty(result.Single().Alerts);
    }

    // ── Rule 5: missed-dose signal ───────────────────────────────────────────

    [Fact]
    public async Task MissedDoseSignal_ActiveDailyRegularNoRecentAdministration_Fires()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        SeedMedication(db, participant.Id, type: MedicationType.Regular, frequency: MedicationFrequency.Daily);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alert = Assert.Single(result.Single().Alerts);
        Assert.Equal("missed-dose-signal", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
        Assert.Equal("medications", alert.DeepLinkTab);
    }

    [Fact]
    public async Task MissedDoseSignal_HasRecentAdministration_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        var med = SeedMedication(db, participant.Id, type: MedicationType.Regular, frequency: MedicationFrequency.Daily);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participant.Id,
            Status = MedicationAdministrationStatus.Missed, AdministeredAt = null,
            ScheduledAt = DateTime.UtcNow.AddDays(-1), RecordedByName = "Test",
        });
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "missed-dose-signal");
    }

    [Fact]
    public async Task MissedDoseSignal_PrnMedication_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        SeedMedication(db, participant.Id, type: MedicationType.Prn, frequency: MedicationFrequency.Daily);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "missed-dose-signal");
    }

    [Fact]
    public async Task MissedDoseSignal_SpecificDaysFrequency_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        SeedMedication(db, participant.Id, type: MedicationType.Regular, frequency: MedicationFrequency.SpecificDays);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.DoesNotContain(result.Single().Alerts, a => a.Type == "missed-dose-signal");
    }

    [Fact]
    public async Task MissedDoseSignal_CeasedMedication_DoesNotFire()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db);
        SeedMedication(db, participant.Id, type: MedicationType.Regular, frequency: MedicationFrequency.Daily, status: MedicationStatus.Ceased);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Empty(result.Single().Alerts);
    }

    // ── Aggregate shape / ranking ────────────────────────────────────────────

    [Fact]
    public async Task GetAlertsAsync_NoFilter_ReturnsEntryForEveryParticipantIncludingZeroAlerts()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var quiet = SeedParticipant(db, "Quiet", "Client");
        var noisy = SeedParticipant(db, "Noisy", "Client", isHighSupport: true);

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(null);

        Assert.Equal(2, result.Count);
        var quietDto = result.Single(r => r.ParticipantId == quiet.Id);
        var noisyDto = result.Single(r => r.ParticipantId == noisy.Id);
        Assert.Empty(quietDto.Alerts);
        Assert.Equal(0, quietDto.CriticalCount + quietDto.WarningCount + quietDto.InfoCount);
        Assert.NotEmpty(noisyDto.Alerts);
        Assert.Equal(1, noisyDto.WarningCount);
    }

    [Fact]
    public async Task GetAlertsAsync_RanksCriticalBeforeWarning()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(
            db, isHighSupport: true, // -> Warning routine-coverage-gap
            planEndDate: DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1)); // -> Critical plan-expired

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        var alerts = result.Single().Alerts;
        Assert.Equal(2, alerts.Count);
        Assert.Equal(AlertSeverity.Critical, alerts[0].Severity);
        Assert.Equal(AlertSeverity.Warning, alerts[1].Severity);
        Assert.Equal(1, result.Single().CriticalCount);
        Assert.Equal(1, result.Single().WarningCount);
    }

    [Fact]
    public async Task GetAlertsAsync_ParticipantNameUsesPreferredNameWhenSet()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedParticipant(db, "Formal", "Name");
        participant.PreferredName = "Sunny";
        db.SaveChanges();

        var result = await new ParticipantAlertsService(db).GetAlertsAsync(participant.Id);

        Assert.Equal("Sunny Name", result.Single().ParticipantName);
    }

    // ── Tenant scoping ────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAlertsAsync_TenantScoped_OnlyComputesForCurrentTenantsParticipants()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        Guid participantAId;
        using (var seedDb = CreateDb(dbName))
        {
            var participantA = new Participant
            {
                Id = Guid.NewGuid(), TenantId = tenantA, FirstName = "Sophie", LastName = "Brown",
                IsActive = true, IsHighSupport = true,
            };
            var participantB = new Participant
            {
                Id = Guid.NewGuid(), TenantId = tenantB, FirstName = "Harrison", LastName = "Lee",
                IsActive = true, IsHighSupport = true,
            };
            seedDb.Participants.AddRange(participantA, participantB);
            participantAId = participantA.Id;
            seedDb.SaveChanges();
        }

        using var scopedDb = CreateTenantScopedDb(dbName, tenantA);
        var result = await new ParticipantAlertsService(scopedDb).GetAlertsAsync(null);

        var dto = Assert.Single(result);
        Assert.Equal(participantAId, dto.ParticipantId);
        Assert.Contains(dto.Alerts, a => a.Type == "routine-coverage-gap");
    }
}
