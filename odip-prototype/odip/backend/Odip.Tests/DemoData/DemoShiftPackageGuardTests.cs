using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The guard's rules for the tables PR 2 writes (the shift package and the medication chart): a row may be added only when it points at people
/// the Demo tenant owns, and an existing row may change only the columns a live shift's own day needs, never what was given, who gave it, when
/// a shift started or who a break belongs to.
/// </summary>
public class DemoShiftPackageGuardTests
{
    private static readonly Guid DemoTenant = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnedParticipant = Guid.Parse("d1000000-0000-0000-0000-0000000000f1");
    private static readonly Guid OwnedUser = Guid.Parse("b1000000-0000-0000-0000-0000000000f1");

    private static DbContextOptions<OdipDbContext> NewOptions() =>
        new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;

    private static OdipDbContext NewDb(DbContextOptions<OdipDbContext> options)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(DemoTenant);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(options, tenant.Object);
    }

    private static DemoTenantGuard NewGuard()
    {
        var owned = new DemoOwnedIds();
        owned.Users.Add(OwnedUser);
        owned.Participants.Add(OwnedParticipant);
        return new DemoTenantGuard(DemoTenant, owned);
    }

    private static async Task<OdipDbContext> DbWithAsync(DbContextOptions<OdipDbContext> options, params object[] rows)
    {
        await using (var seed = NewDb(options))
        {
            seed.AddRange(rows);
            await seed.SaveChangesAsync();
        }
        return NewDb(options);
    }

    private static MedicationAdministration Dose(Guid? recorder = null, Guid? witness = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = DemoTenant, ParticipantMedicationId = Guid.NewGuid(), ParticipantId = OwnedParticipant,
        ScheduledAt = new DateTime(2026, 10, 2, 8, 0, 0, DateTimeKind.Unspecified), AdministeredAt = new DateTime(2026, 10, 1, 22, 4, 0, DateTimeKind.Utc),
        Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet", RecordedByName = "James O'Brien", RecordedByUserId = recorder ?? OwnedUser,
        WitnessUserId = witness, WitnessStatus = witness is null ? WitnessStatus.NotRequired : WitnessStatus.Pending,
    };

    private static ShiftBreak Break() => new()
    {
        Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftCompletionId = Guid.NewGuid(), StartedAt = new DateTime(2026, 10, 1, 23, 30, 0, DateTimeKind.Utc), CreatedByUserId = OwnedUser,
    };

    private static ShiftCompletion Completion() => new()
    {
        Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftId = Guid.NewGuid(), SubmittedByUserId = OwnedUser, ActualStart = new DateTime(2026, 10, 1, 20, 58, 0, DateTimeKind.Utc),
        StartedAt = new DateTime(2026, 10, 1, 20, 58, 0, DateTimeKind.Utc), TimeZoneId = "Australia/Sydney", IsActive = true,
    };

    private static ParticipantMedication Medication() => new()
    {
        Id = Guid.NewGuid(), TenantId = DemoTenant, ParticipantId = OwnedParticipant, Name = "Melatonin", Strength = "2mg", DoseDescription = "1 tablet (2mg)", Type = MedicationType.Regular,
        TimesOfDay = "20:00", StartDate = new DateTime(2026, 6, 24), Status = MedicationStatus.Active,
    };

    // ── additions point only at people the Demo tenant owns ──

    public static IEnumerable<object[]> NewRows() => new[]
    {
        new object[] { "ShiftBreak (CreatedByUserId)", (Func<Guid, object>)(u => new ShiftBreak { Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftCompletionId = Guid.NewGuid(), StartedAt = DateTime.UtcNow, CreatedByUserId = u }) },
        new object[] { "ShiftNote (AuthorUserId)", (Func<Guid, object>)(u => new ShiftNote { Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftId = Guid.NewGuid(), AuthorUserId = u, AuthorName = "x", Body = "x" }) },
        new object[] { "ShiftRoutineCheck (CheckedByUserId)", (Func<Guid, object>)(u => new ShiftRoutineCheck { Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftCompletionId = Guid.NewGuid(), ParticipantRoutineId = Guid.NewGuid(), RoutineTitle = "x", CheckedByUserId = u, CheckedAt = DateTime.UtcNow }) },
        new object[] { "HandoverAcknowledgement (UserId)", (Func<Guid, object>)(u => new HandoverAcknowledgement { Id = Guid.NewGuid(), TenantId = DemoTenant, SourceCompletionId = Guid.NewGuid(), ShiftId = Guid.NewGuid(), UserId = u, AcknowledgedAt = DateTime.UtcNow }) },
        new object[] { "MedicationAdministration (RecordedByUserId)", (Func<Guid, object>)(u => Dose(recorder: u)) },
        new object[] { "MedicationAdministration (WitnessUserId)", (Func<Guid, object>)(u => Dose(witness: u)) },
    };

    [Theory]
    [MemberData(nameof(NewRows))]
    public async Task ANewRow_IsAcceptedForAnOwnedUser_AndRefusedForOneTheDemoTenantDoesNotOwn(string label, Func<Guid, object> build)
    {
        await using var ok = NewDb(NewOptions());
        ok.Add(build(OwnedUser));
        NewGuard().Verify(ok.ChangeTracker);

        await using var bad = NewDb(NewOptions());
        bad.Add(build(Guid.NewGuid()));
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(bad.ChangeTracker));
        Assert.True(ex.Message.Contains("does not own", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("owned", StringComparison.OrdinalIgnoreCase), label + ": " + ex.Message);
    }

    [Fact]
    public async Task ADose_ForAParticipantTheDemoTenantDoesNotOwn_IsRefused()
    {
        await using var db = NewDb(NewOptions());
        var dose = Dose();
        dose.ParticipantId = Guid.NewGuid();
        db.Add(dose);

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(MedicationAdministration.ParticipantId), ex.Message);
    }

    // ── incidents: no tenant column, so the reporter is what makes one the Demo tenant's ──

    private static IncidentReport Incident(Guid reporter, Guid? participant = null) => new()
    {
        Id = Guid.NewGuid(), ReportedByUserId = reporter, InvolvedParticipantId = participant, IncidentType = IncidentType.Injury, Severity = IncidentSeverity.Low, Status = IncidentStatus.Submitted,
        Title = "A graze", Description = "A graze on the knee.", IncidentDateTime = new DateTime(2026, 10, 1, 10, 0, 0), CreatedAt = new DateTime(2026, 10, 1, 0, 30, 0, DateTimeKind.Utc),
        UpdatedAt = new DateTime(2026, 10, 1, 0, 30, 0, DateTimeKind.Utc),
    };

    [Fact]
    public async Task AnIncident_IsAcceptedForAnOwnedReporter_AndRefusedForAnyoneElse()
    {
        await using var ok = NewDb(NewOptions());
        ok.IncidentReports.Add(Incident(OwnedUser, OwnedParticipant));
        NewGuard().Verify(ok.ChangeTracker);

        await using var bad = NewDb(NewOptions());
        bad.IncidentReports.Add(Incident(Guid.NewGuid()));
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(bad.ChangeTracker));
        Assert.Contains(nameof(IncidentReport), ex.Message);
    }

    [Fact]
    public async Task AnIncidentAboutAParticipantOfAnotherTenant_IsRefused_EvenWithAnOwnedReporter()
    {
        await using var db = NewDb(NewOptions());
        db.IncidentReports.Add(Incident(OwnedUser, Guid.NewGuid()));

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(IncidentReport.InvolvedParticipantId), ex.Message);
    }

    [Fact]
    public async Task AnInjuryAndAWitness_AreAcceptedUnderAnIncidentOfTheSameSave_AndRefusedUnderOneThatIsNot()
    {
        var incident = Incident(OwnedUser);
        await using var ok = NewDb(NewOptions());
        ok.IncidentReports.Add(incident);
        ok.IncidentInjuries.Add(new IncidentInjury { Id = Guid.NewGuid(), IncidentReportId = incident.Id, Region = BodyRegion.LeftKnee, InjuryType = InjuryType.Abrasion, Description = "Grazed." });
        ok.IncidentWitnesses.Add(new IncidentWitness { Id = Guid.NewGuid(), IncidentReportId = incident.Id, WitnessUserId = OwnedUser, WitnessName = "A worker", WitnessStatus = WitnessStatus.Pending });
        NewGuard().Verify(ok.ChangeTracker);

        await using var orphan = NewDb(NewOptions());
        orphan.IncidentInjuries.Add(new IncidentInjury { Id = Guid.NewGuid(), IncidentReportId = Guid.NewGuid(), Region = BodyRegion.LeftKnee, InjuryType = InjuryType.Abrasion, Description = "Grazed." });
        Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(orphan.ChangeTracker));
        await using var orphanWitness = NewDb(NewOptions());
        orphanWitness.IncidentWitnesses.Add(new IncidentWitness { Id = Guid.NewGuid(), IncidentReportId = Guid.NewGuid(), WitnessName = "A bystander", WitnessStatus = WitnessStatus.NotRequired });
        Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(orphanWitness.ChangeTracker));
    }

    [Fact]
    public async Task AWitnessWhoIsAUserTheDemoTenantDoesNotOwn_IsRefused()
    {
        var incident = Incident(OwnedUser);
        await using var db = NewDb(NewOptions());
        db.IncidentReports.Add(incident);
        db.IncidentWitnesses.Add(new IncidentWitness { Id = Guid.NewGuid(), IncidentReportId = incident.Id, WitnessUserId = Guid.NewGuid(), WitnessName = "Somebody", WitnessStatus = WitnessStatus.Pending });

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(IncidentWitness.WitnessUserId), ex.Message);
    }

    [Theory]
    [InlineData(nameof(IncidentReport.Status))]
    [InlineData(nameof(IncidentReport.ReviewedAt))]
    [InlineData(nameof(IncidentReport.ResolvedAt))]
    [InlineData(nameof(IncidentReport.QscReportedAt))]
    [InlineData(nameof(IncidentReport.QscReportingStatus))]
    [InlineData(nameof(IncidentReport.FamilyNotified))]
    [InlineData(nameof(IncidentReport.FamilyNotifiedAt))]
    [InlineData(nameof(IncidentReport.SupportCoordinatorNotified))]
    [InlineData(nameof(IncidentReport.SupportCoordinatorNotifiedAt))]
    [InlineData(nameof(IncidentReport.UpdatedAt))]
    public async Task AnIncident_MayBeReviewedResolvedAndReported(string property)
    {
        var incident = Incident(OwnedUser, OwnedParticipant);
        await using var db = await DbWithAsync(NewOptions(), incident);
        var tracked = await db.IncidentReports.SingleAsync(i => i.Id == incident.Id);

        switch (property)
        {
            case nameof(IncidentReport.Status): tracked.Status = IncidentStatus.UnderReview; break;
            case nameof(IncidentReport.ReviewedAt): tracked.ReviewedAt = DateTime.UtcNow; break;
            case nameof(IncidentReport.ResolvedAt): tracked.ResolvedAt = DateTime.UtcNow; break;
            case nameof(IncidentReport.QscReportedAt): tracked.QscReportedAt = DateTime.UtcNow; break;
            case nameof(IncidentReport.QscReportingStatus): tracked.QscReportingStatus = QscReportingStatus.ReportedWithin24h; break;
            case nameof(IncidentReport.FamilyNotified): tracked.FamilyNotified = true; break;
            case nameof(IncidentReport.FamilyNotifiedAt): tracked.FamilyNotifiedAt = DateTime.UtcNow; break;
            case nameof(IncidentReport.SupportCoordinatorNotified): tracked.SupportCoordinatorNotified = true; break;
            case nameof(IncidentReport.SupportCoordinatorNotifiedAt): tracked.SupportCoordinatorNotifiedAt = DateTime.UtcNow; break;
            default: tracked.UpdatedAt = DateTime.UtcNow; break;
        }

        NewGuard().Verify(db.ChangeTracker);
    }

    [Theory]
    [InlineData(nameof(IncidentReport.Title))]
    [InlineData(nameof(IncidentReport.Description))]
    [InlineData(nameof(IncidentReport.Severity))]
    [InlineData(nameof(IncidentReport.IncidentType))]
    [InlineData(nameof(IncidentReport.InvolvedParticipantId))]
    [InlineData(nameof(IncidentReport.CreatedAt))]
    [InlineData(nameof(IncidentReport.ShiftId))]
    public async Task AnIncident_NeverHasWhatHappenedHowSeriousOrWhoItWasAboutRewritten(string property)
    {
        var incident = Incident(OwnedUser, OwnedParticipant);
        await using var db = await DbWithAsync(NewOptions(), incident);
        var tracked = await db.IncidentReports.SingleAsync(i => i.Id == incident.Id);

        switch (property)
        {
            case nameof(IncidentReport.Title): tracked.Title = "Another"; break;
            case nameof(IncidentReport.Description): tracked.Description = "Another account."; break;
            case nameof(IncidentReport.Severity): tracked.Severity = IncidentSeverity.Critical; break;
            case nameof(IncidentReport.IncidentType): tracked.IncidentType = IncidentType.Death; break;
            case nameof(IncidentReport.InvolvedParticipantId): tracked.InvolvedParticipantId = Guid.NewGuid(); break;
            case nameof(IncidentReport.CreatedAt): tracked.CreatedAt = DateTime.UtcNow; break;
            default: tracked.ShiftId = Guid.NewGuid(); break;
        }

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(property, ex.Message);
    }

    [Theory]
    [InlineData(nameof(ParticipantMedication.Status))]
    [InlineData(nameof(ParticipantMedication.EndDate))]
    [InlineData(nameof(ParticipantMedication.Notes))]
    [InlineData(nameof(ParticipantMedication.UpdatedAt))]
    public async Task AMedication_MayBeCeasedOrPutOnHold(string property)
    {
        var medication = Medication();
        await using var db = await DbWithAsync(NewOptions(), medication);
        var tracked = await db.ParticipantMedications.SingleAsync(m => m.Id == medication.Id);

        switch (property)
        {
            case nameof(ParticipantMedication.Status): tracked.Status = MedicationStatus.OnHold; break;
            case nameof(ParticipantMedication.EndDate): tracked.EndDate = new DateTime(2026, 9, 12); break;
            case nameof(ParticipantMedication.Notes): tracked.Notes = "On hold while the sleep review is booked."; break;
            default: tracked.UpdatedAt = DateTime.UtcNow; break;
        }

        NewGuard().Verify(db.ChangeTracker);
    }

    [Theory]
    [InlineData(nameof(ParticipantMedication.Name))]
    [InlineData(nameof(ParticipantMedication.DoseDescription))]
    [InlineData(nameof(ParticipantMedication.TimesOfDay))]
    [InlineData(nameof(ParticipantMedication.IsHighRisk))]
    [InlineData(nameof(ParticipantMedication.ParticipantId))]
    [InlineData(nameof(ParticipantMedication.StartDate))]
    public async Task AMedication_NeverHasItsDoseItsScheduleOrWhoItIsForRewritten(string property)
    {
        var medication = Medication();
        await using var db = await DbWithAsync(NewOptions(), medication);
        var tracked = await db.ParticipantMedications.SingleAsync(m => m.Id == medication.Id);

        switch (property)
        {
            case nameof(ParticipantMedication.Name): tracked.Name = "Another"; break;
            case nameof(ParticipantMedication.DoseDescription): tracked.DoseDescription = "2 tablets"; break;
            case nameof(ParticipantMedication.TimesOfDay): tracked.TimesOfDay = "06:00"; break;
            case nameof(ParticipantMedication.IsHighRisk): tracked.IsHighRisk = true; break;
            case nameof(ParticipantMedication.ParticipantId): tracked.ParticipantId = Guid.NewGuid(); break;
            default: tracked.StartDate = new DateTime(2026, 1, 1); break;
        }

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(property, ex.Message);
    }

    [Fact]
    public async Task AnIncidentOfAReporterTheDemoTenantDoesNotOwn_CannotBeAged()
    {
        var foreign = Incident(Guid.NewGuid());
        await using var db = await DbWithAsync(NewOptions(), foreign);
        (await db.IncidentReports.SingleAsync(i => i.Id == foreign.Id)).Status = IncidentStatus.Closed;

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(IncidentReport), ex.Message);
    }

    // ── an existing row changes only what its day needs ──

    [Theory]
    [InlineData(nameof(MedicationAdministration.PrnOutcome))]
    [InlineData(nameof(MedicationAdministration.PrnOutcomeAt))]
    [InlineData(nameof(MedicationAdministration.WitnessStatus))]
    [InlineData(nameof(MedicationAdministration.WitnessRespondedAt))]
    [InlineData(nameof(MedicationAdministration.UpdatedAt))]
    public async Task ADose_MayGetAWitnessAnswerOrAnOutcome(string property)
    {
        var dose = Dose(witness: OwnedUser);
        await using var db = await DbWithAsync(NewOptions(), dose);
        var tracked = await db.MedicationAdministrations.SingleAsync(a => a.Id == dose.Id);

        switch (property)
        {
            case nameof(MedicationAdministration.PrnOutcome): tracked.PrnOutcome = "Settled."; break;
            case nameof(MedicationAdministration.PrnOutcomeAt): tracked.PrnOutcomeAt = DateTime.UtcNow; break;
            case nameof(MedicationAdministration.WitnessStatus): tracked.WitnessStatus = WitnessStatus.Approved; break;
            case nameof(MedicationAdministration.WitnessRespondedAt): tracked.WitnessRespondedAt = DateTime.UtcNow; break;
            default: tracked.UpdatedAt = DateTime.UtcNow; break;
        }

        NewGuard().Verify(db.ChangeTracker);
    }

    [Theory]
    [InlineData(nameof(MedicationAdministration.Status))]
    [InlineData(nameof(MedicationAdministration.DoseGiven))]
    [InlineData(nameof(MedicationAdministration.AdministeredAt))]
    [InlineData(nameof(MedicationAdministration.RecordedByUserId))]
    [InlineData(nameof(MedicationAdministration.WitnessUserId))]
    [InlineData(nameof(MedicationAdministration.ScheduledAt))]
    [InlineData(nameof(MedicationAdministration.IdempotencyKey))]
    public async Task ADose_NeverHasWhatWasGivenWhoGaveItOrWhenChanged(string property)
    {
        var dose = Dose(witness: OwnedUser);
        await using var db = await DbWithAsync(NewOptions(), dose);
        var tracked = await db.MedicationAdministrations.SingleAsync(a => a.Id == dose.Id);

        switch (property)
        {
            case nameof(MedicationAdministration.Status): tracked.Status = MedicationAdministrationStatus.Refused; break;
            case nameof(MedicationAdministration.DoseGiven): tracked.DoseGiven = "2 tablets"; break;
            case nameof(MedicationAdministration.AdministeredAt): tracked.AdministeredAt = DateTime.UtcNow; break;
            case nameof(MedicationAdministration.RecordedByUserId): tracked.RecordedByUserId = Guid.NewGuid(); break;
            case nameof(MedicationAdministration.WitnessUserId): tracked.WitnessUserId = Guid.NewGuid(); break;
            case nameof(MedicationAdministration.ScheduledAt): tracked.ScheduledAt = DateTime.UtcNow; break;
            default: tracked.IdempotencyKey = "other"; break;
        }

        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(property, ex.Message);
    }

    [Fact]
    public async Task ABreak_MayBeEnded_ButNeverMovedOrGivenToSomebodyElse()
    {
        var brk = Break();
        await using var db = await DbWithAsync(NewOptions(), brk);
        var tracked = await db.ShiftBreaks.SingleAsync(b => b.Id == brk.Id);
        tracked.EndedAt = tracked.StartedAt.AddMinutes(20);
        tracked.EditedAt = tracked.EndedAt;
        tracked.UpdatedAt = tracked.EndedAt.Value;
        NewGuard().Verify(db.ChangeTracker);

        tracked.StartedAt = tracked.StartedAt.AddHours(1);
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(ShiftBreak.StartedAt), ex.Message);
    }

    [Fact]
    public async Task ACompletion_MayBeFinishedAndApproved_ButNeverRestartedOrRezoned()
    {
        var completion = Completion();
        await using var db = await DbWithAsync(NewOptions(), completion);
        var tracked = await db.ShiftCompletions.SingleAsync(c => c.Id == completion.Id);
        tracked.ActualEnd = tracked.ActualStart.AddHours(6);
        tracked.SubmittedAt = tracked.ActualEnd.Value.AddMinutes(5);
        tracked.VarianceMinutesEnd = 4;
        tracked.HandoverText = "Settled day.";
        tracked.NothingToHandOver = false;
        tracked.NothingToNoteConfirmed = true;
        tracked.UpdatedAt = tracked.SubmittedAt.Value;
        NewGuard().Verify(db.ChangeTracker);

        foreach (var change in new (string Property, Action<ShiftCompletion> Apply)[]
        {
            (nameof(ShiftCompletion.ActualStart), c => c.ActualStart = c.ActualStart.AddHours(1)),
            (nameof(ShiftCompletion.StartedAt), c => c.StartedAt = c.StartedAt.AddHours(1)),
            (nameof(ShiftCompletion.TimeZoneId), c => c.TimeZoneId = "Australia/Perth"),
            (nameof(ShiftCompletion.ShiftId), c => c.ShiftId = Guid.NewGuid()),
            (nameof(ShiftCompletion.SubmittedByUserId), c => c.SubmittedByUserId = Guid.NewGuid()),
        })
        {
            await using var each = await DbWithAsync(NewOptions(), Completion());
            var row = await each.ShiftCompletions.SingleAsync();
            change.Apply(row);
            var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(each.ChangeTracker));
            Assert.Contains(change.Property, ex.Message);
        }
    }

    [Fact]
    public async Task ANoteATickAndAnAcknowledgement_AreNeverChangedOnceWritten()
    {
        var note = new ShiftNote { Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftId = Guid.NewGuid(), AuthorUserId = OwnedUser, AuthorName = "x", Body = "Settled." };
        var tick = new ShiftRoutineCheck { Id = Guid.NewGuid(), TenantId = DemoTenant, ShiftCompletionId = Guid.NewGuid(), ParticipantRoutineId = Guid.NewGuid(), RoutineTitle = "Morning", CheckedByUserId = OwnedUser, CheckedAt = DateTime.UtcNow };
        var ack = new HandoverAcknowledgement { Id = Guid.NewGuid(), TenantId = DemoTenant, SourceCompletionId = Guid.NewGuid(), ShiftId = Guid.NewGuid(), UserId = OwnedUser, AcknowledgedAt = DateTime.UtcNow };
        await using var db = await DbWithAsync(NewOptions(), note, tick, ack);

        (await db.ShiftNotes.SingleAsync()).Body = "Rewritten.";
        var ex = Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker));
        Assert.Contains(nameof(ShiftNote), ex.Message);

        db.ChangeTracker.Clear();
        (await db.ShiftRoutineChecks.SingleAsync()).RoutineTitle = "Evening";
        Assert.Contains(nameof(ShiftRoutineCheck), Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker)).Message);

        db.ChangeTracker.Clear();
        (await db.HandoverAcknowledgements.SingleAsync()).AcknowledgedAt = DateTime.UtcNow.AddDays(1);
        Assert.Contains(nameof(HandoverAcknowledgement), Assert.Throws<DemoGuardViolationException>(() => NewGuard().Verify(db.ChangeTracker)).Message);
    }
}
