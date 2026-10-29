using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.RestrictivePractices;

/// <summary>
/// Verifies <see cref="RestrictivePracticeBackfill"/> — the C# mirror of the raw SQL the
/// AddRestrictivePractices migration runs against Postgres. Exercised here via EF Core InMemory
/// since raw SQL migrations can't run against that provider.
/// </summary>
public class RestrictivePracticeBackfillTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    [Fact]
    public async Task RunAsync_LegacySupportProfileDetails_CreatesOneUnclassifiedRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var tenantId = Guid.NewGuid();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SupportProfiles.Add(new SupportProfile
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id,
            RestrictivePracticeDetails = "Environmental restriction — locked doors during sleep.",
        });
        db.SaveChanges();

        var created = await RestrictivePracticeBackfill.RunAsync(db);

        Assert.Equal(1, created);
        var row = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(participant.Id, row.ParticipantId);
        Assert.Equal(tenantId, row.TenantId);
        Assert.Equal(RestrictivePracticeType.Unclassified, row.Type);
        Assert.Equal("Environmental restriction — locked doors during sleep.", row.Description);
        Assert.True(row.IsActive);
        Assert.Null(row.RelatedMedicationId);
    }

    [Fact]
    public async Task RunAsync_BlankOrNullSupportProfileDetails_CreatesNoRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SupportProfiles.Add(new SupportProfile { Id = Guid.NewGuid(), ParticipantId = participant.Id, RestrictivePracticeDetails = "   " });
        db.SaveChanges();

        var created = await RestrictivePracticeBackfill.RunAsync(db);

        Assert.Equal(0, created);
        Assert.Empty(await db.RestrictivePractices.ToListAsync());
    }

    [Fact]
    public async Task RunAsync_ChemicalRestraintMedication_CreatesLinkedChemicalRestraintRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var tenantId = Guid.NewGuid();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        var medication = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id,
            Name = "Risperidone", DoseDescription = "1 tablet", IsChemicalRestraint = true,
        };
        db.ParticipantMedications.Add(medication);
        db.SaveChanges();

        var created = await RestrictivePracticeBackfill.RunAsync(db);

        Assert.Equal(1, created);
        var row = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(RestrictivePracticeType.ChemicalRestraint, row.Type);
        Assert.Equal(medication.Id, row.RelatedMedicationId);
        Assert.Equal("Risperidone", row.Description);
        Assert.True(row.IsActive);
    }

    [Fact]
    public async Task RunAsync_NonChemicalRestraintMedication_CreatesNoRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Paracetamol",
            DoseDescription = "2 tablets", IsChemicalRestraint = false,
        });
        db.SaveChanges();

        var created = await RestrictivePracticeBackfill.RunAsync(db);

        Assert.Equal(0, created);
    }

    [Fact]
    public async Task RunAsync_CalledTwice_IsIdempotent()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SupportProfiles.Add(new SupportProfile { Id = Guid.NewGuid(), ParticipantId = participant.Id, RestrictivePracticeDetails = "Legacy note." });
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Risperidone",
            DoseDescription = "1 tablet", IsChemicalRestraint = true,
        });
        db.SaveChanges();

        var firstRun = await RestrictivePracticeBackfill.RunAsync(db);
        var secondRun = await RestrictivePracticeBackfill.RunAsync(db);

        Assert.Equal(2, firstRun);
        Assert.Equal(0, secondRun);
        Assert.Equal(2, await db.RestrictivePractices.CountAsync());
    }

    [Fact]
    public async Task RunAsync_MultipleParticipantsAndMedications_BackfillsEachIndependently()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participantA = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var participantB = new Participant { Id = Guid.NewGuid(), FirstName = "Harrison", LastName = "Lee", IsActive = true };
        db.Participants.AddRange(participantA, participantB);
        db.SupportProfiles.Add(new SupportProfile { Id = Guid.NewGuid(), ParticipantId = participantA.Id, RestrictivePracticeDetails = "A's legacy note." });
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantB.Id, Name = "Olanzapine",
            DoseDescription = "1 tablet", IsChemicalRestraint = true,
        });
        db.SaveChanges();

        var created = await RestrictivePracticeBackfill.RunAsync(db);

        Assert.Equal(2, created);
        Assert.Single(await db.RestrictivePractices.Where(r => r.ParticipantId == participantA.Id).ToListAsync());
        Assert.Single(await db.RestrictivePractices.Where(r => r.ParticipantId == participantB.Id).ToListAsync());
    }

    // ── M16: chemical-restraint medicines ────────────────────────────

    private static ParticipantMedication Med(Guid tenantId, Guid participantId, string name, bool restraint, MedicationStatus status = MedicationStatus.Active) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Name = name, Strength = "1 mg", DoseDescription = "1 tablet",
        Type = MedicationType.Regular, Purpose = "Manage behaviour", Status = status, IsChemicalRestraint = restraint,
        StartDate = new DateTime(2026, 1, 1), ConsentObtained = true,
    };

    private static Participant Person(Guid tenantId) => new() { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };

    private static Task<int> Restraints(OdipDbContext db) =>
        RestrictivePracticeBackfill.RunRestraintMedicinesAsync(db, new RestraintRegisterSync(db, new SafetyNoteSyncService(db)));

    [Fact]
    public async Task RestraintMedicines_CreatesMissing_ForNotCeasedOnly_NeverInventsAnAuthoriser_AndIsIdempotent()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var t = Guid.NewGuid();
        var p = Person(t);
        var onHold = Med(t, p.Id, "Risperidone", true, MedicationStatus.OnHold);
        var ceased = Med(t, p.Id, "Olanzapine", true, MedicationStatus.Ceased);
        db.Participants.Add(p);
        db.ParticipantMedications.AddRange(onHold, ceased);
        db.SaveChanges();

        Assert.Equal(1, await Restraints(db));

        var entry = await db.RestrictivePractices.SingleAsync();
        Assert.Equal(onHold.Id, entry.RelatedMedicationId);
        Assert.Equal(t, entry.TenantId);
        Assert.True(entry.IsActive);
        Assert.Null(entry.AuthorisedBy);
        Assert.Null(entry.AuthorisationDate);
        Assert.True((await db.Participants.SingleAsync()).HasRestrictivePracticeFlag);
        var stamp = entry.UpdatedAt;

        Assert.Equal(0, await Restraints(db));
        Assert.Equal(stamp, (await db.RestrictivePractices.AsNoTracking().SingleAsync()).UpdatedAt);
    }

    [Fact]
    public async Task RestraintMedicines_TwoCeasedOnOneParticipant_DeactivatesBoth_FlagFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var t = Guid.NewGuid();
        var p = Person(t);
        p.HasRestrictivePracticeFlag = true;
        var a = Med(t, p.Id, "Risperidone", true, MedicationStatus.Ceased);
        var b = Med(t, p.Id, "Olanzapine", true, MedicationStatus.Ceased);
        db.Participants.Add(p);
        db.ParticipantMedications.AddRange(a, b);
        db.RestrictivePractices.AddRange(
            new RestrictivePractice { Id = Guid.NewGuid(), TenantId = t, ParticipantId = p.Id, Type = RestrictivePracticeType.ChemicalRestraint, Description = "a", RelatedMedicationId = a.Id, IsActive = true },
            new RestrictivePractice { Id = Guid.NewGuid(), TenantId = t, ParticipantId = p.Id, Type = RestrictivePracticeType.ChemicalRestraint, Description = "b", RelatedMedicationId = b.Id, IsActive = true });
        db.SaveChanges();

        Assert.Equal(2, await Restraints(db));

        Assert.All(await db.RestrictivePractices.ToListAsync(), e => Assert.False(e.IsActive));
        Assert.False((await db.Participants.SingleAsync()).HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task RestraintMedicines_TicksMedicineWithActiveLinkedEntry_AndLeavesUnlinkedEntryAlone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var t = Guid.NewGuid();
        var p = Person(t);
        var m = Med(t, p.Id, "Risperidone", false);
        var loose = new RestrictivePractice { Id = Guid.NewGuid(), TenantId = t, ParticipantId = p.Id, Type = RestrictivePracticeType.ChemicalRestraint, Description = "Hand made", IsActive = true };
        db.Participants.Add(p);
        db.ParticipantMedications.Add(m);
        db.RestrictivePractices.AddRange(loose,
            new RestrictivePractice { Id = Guid.NewGuid(), TenantId = t, ParticipantId = p.Id, Type = RestrictivePracticeType.ChemicalRestraint, Description = "x", RelatedMedicationId = m.Id, IsActive = true });
        db.SaveChanges();

        Assert.Equal(1, await Restraints(db));

        Assert.True((await db.ParticipantMedications.SingleAsync()).IsChemicalRestraint);
        Assert.Equal(2, await db.RestrictivePractices.CountAsync());
        Assert.Null((await db.RestrictivePractices.SingleAsync(e => e.Id == loose.Id)).RelatedMedicationId);
        Assert.Equal(0, await Restraints(db));
    }

    [Fact]
    public async Task AllTenants_OneEntryPerMedicineWithItsTenant_AndAFailingTenantDoesNotStopTheOthers()
    {
        var name = Guid.NewGuid().ToString();
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options;
        var (a, b, c) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        using (var db = CreateDb(name))
        {
            foreach (var t in new[] { a, b, c })
            {
                var p = Person(t);
                db.Participants.Add(p);
                db.ParticipantMedications.Add(Med(t, p.Id, "Risperidone", true));
            }
            db.SaveChanges();
        }

        var (changed, failed) = await RestrictivePracticeBackfill.RunRestraintMedicinesForAllTenantsAsync(options,
            runTenant: async (tdb, ct) =>
            {
                if ((await tdb.ParticipantMedications.FirstAsync(ct)).TenantId == b) throw new InvalidOperationException("boom");
                return await Restraints(tdb);
            });

        Assert.Equal((2, 1), (changed, failed));
        using var check = CreateDb(name);
        var entries = await check.RestrictivePractices.ToListAsync();
        Assert.Equal(new[] { a, c }.OrderBy(x => x), entries.Select(e => e.TenantId).OrderBy(x => x));

        var second = await RestrictivePracticeBackfill.RunRestraintMedicinesForAllTenantsAsync(options);
        Assert.Equal((1, 0), second);
        Assert.Equal(3, await check.RestrictivePractices.CountAsync());
    }
}
