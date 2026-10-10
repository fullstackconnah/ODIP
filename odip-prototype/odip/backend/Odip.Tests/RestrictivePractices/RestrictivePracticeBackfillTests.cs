using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
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
}
