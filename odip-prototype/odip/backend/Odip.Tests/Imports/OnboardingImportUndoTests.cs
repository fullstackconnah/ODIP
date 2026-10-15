using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class OnboardingImportUndoTests
{
    private static readonly byte[] File = Csv("First name,Last name,NDIS number", "Ava,Stone,430000001", "Ben,Lee,430000002");

    private static async Task<(OdipDbContext Db, OnboardingImportService Service, ImportResultDto Result)> ImportedAsync(ImportLanding landing)
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.Participants, File, "people.csv", null, landing, "key-1", Admin(), CancellationToken.None);
        return (db, service, result);
    }

    [Fact]
    public async Task Undo_archives_the_participants_and_the_same_file_can_be_imported_again()
    {
        var (db, service, result) = await ImportedAsync(ImportLanding.Onboarding);
        using var _ = db;

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(outcome.Blockers);
        Assert.Equal("Ada Admin", outcome.Batch!.UndoneByName);
        Assert.All(await db.Participants.ToListAsync(), p => Assert.Equal((false, false), (p.IsActive, p.IsDraft)));
        var again = await service.CommitAsync(ImportKind.Participants, File, "people.csv", null, ImportLanding.Active, "key-2", Admin(), CancellationToken.None);
        Assert.Equal(2, again.CreatedCount);
    }

    [Fact]
    public async Task Undo_is_refused_and_lists_what_changed()
    {
        var (db, service, result) = await ImportedAsync(ImportLanding.Active);
        using var _ = db;
        var ava = await db.Participants.SingleAsync(p => p.LastName == "Stone");
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), ParticipantId = ava.Id, ServiceDate = new DateOnly(2026, 11, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), Status = ShiftStatus.Published });
        await db.SaveChangesAsync();

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Equal(new ImportUndoBlockerDto(ava.Id, "Ava Stone", "has shifts"), outcome.Blockers.Single());
        Assert.Null(outcome.Batch);
        Assert.All(await db.Participants.ToListAsync(), p => Assert.True(p.IsActive));
        Assert.Null((await db.ImportBatches.SingleAsync()).UndoneAt);
    }

    [Theory]
    [InlineData("agreement", "has onboarding progress")]
    [InlineData("begin services", "has begun services")]
    [InlineData("make active", "was made active")]
    public async Task Undo_of_an_onboarding_import_is_refused_once_its_checklist_has_moved_on(string step, string reason)
    {
        var (db, service, result) = await ImportedAsync(ImportLanding.Onboarding);
        using var _ = db;
        var ava = await db.Participants.SingleAsync(p => p.LastName == "Stone");
        switch (step)
        {
            case "agreement":
                (await db.ParticipantOnboardings.SingleAsync(o => o.ParticipantId == ava.Id)).RecordAgreement(new DateOnly(2026, 10, 1), null, "coordinator", DateTime.UtcNow);
                break;
            case "begin services":
                (ava.ServicesStartedAt, ava.IsActive) = (DateTime.UtcNow, true);
                break;
            default:
                (ava.IsDraft, ava.IsActive) = (false, true);
                break;
        }
        await db.SaveChangesAsync();

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Equal(new ImportUndoBlockerDto(ava.Id, "Ava Stone", reason), outcome.Blockers.Single());
        Assert.Null((await db.ImportBatches.SingleAsync()).UndoneAt);
    }

    [Theory]
    [InlineData(ImportLanding.Onboarding)]
    [InlineData(ImportLanding.Active)]
    public async Task The_contacts_an_import_made_do_not_block_its_undo_but_one_added_later_does(ImportLanding landing)
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var service = Service(db, tenantId);
        var file = Csv("First name,Last name,NDIS number,Contact 1 name,Contact 1 relationship", "Ava,Stone,430000001,Kim Stone,Next of kin", "Ben,Lee,430000002,Sam Lee,Next of kin");
        var first = await service.CommitAsync(ImportKind.Participants, file, "people.csv", null, landing, "key-1", Admin(), CancellationToken.None);
        Assert.Equal(2, await db.ParticipantContactRoles.CountAsync());
        Assert.Empty((await service.UndoAsync(first.BatchId, Admin(), CancellationToken.None)).Blockers);

        var second = await service.CommitAsync(ImportKind.Participants, file, "again.csv", null, landing, "key-2", Admin(), CancellationToken.None);
        var ben = await db.Participants.SingleAsync(p => p.LastName == "Lee" && db.ImportBatchItems.Any(i => i.BatchId == second.BatchId && i.EntityId == p.Id));
        var imported = await db.ParticipantContactRoles.FirstAsync(r => r.ParticipantId == ben.Id);
        db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = ben.Id, PersonId = Guid.NewGuid(), RoleType = imported.RoleType, CreatedAt = DateTime.UtcNow.AddMinutes(1) });
        await db.SaveChangesAsync();

        var outcome = await service.UndoAsync(second.BatchId, Admin(), CancellationToken.None);

        Assert.Equal(new ImportUndoBlockerDto(ben.Id, "Ben Lee", "has contacts added after the import"), outcome.Blockers.Single());
    }

    [Theory]
    [InlineData("untouched", false)]
    [InlineData("linked elsewhere", true)]
    [InlineData("edited", true)]
    [InlineData("role edited", true)]
    public async Task Undo_removes_the_contacts_the_import_made_unless_they_were_used_or_edited_since(string change, bool kept)
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var service = Service(db, tenantId);
        var file = Csv("First name,Last name,NDIS number,Contact 1 name,Contact 1 relationship", "Ava,Stone,430000001,Kim Stone,Next of kin", "Ben,Lee,430000002,Sam Lee,Next of kin");
        var result = await service.CommitAsync(ImportKind.Participants, file, "people.csv", null, ImportLanding.Active, "key-1", Admin(), CancellationToken.None);
        var kim = await db.People.SingleAsync(p => p.FirstName == "Kim");
        var later = DateTime.UtcNow.AddMinutes(1);
        switch (change)
        {
            case "linked elsewhere":
                db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), PersonId = kim.Id, RoleType = ContactRoleType.NextOfKin, CreatedAt = later });
                break;
            case "edited":
                kim.UpdatedAt = later;
                break;
            case "role edited":
                (await db.ParticipantContactRoles.SingleAsync(r => r.PersonId == kim.Id)).UpdatedAt = later;
                break;
        }
        await db.SaveChangesAsync();

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(outcome.Blockers);
        Assert.NotNull(outcome.Batch!.UndoneAt);
        Assert.Equal(kept, await db.People.AnyAsync(p => p.Id == kim.Id));
        Assert.Equal(kept, await db.ParticipantContactRoles.AnyAsync(r => r.PersonId == kim.Id && r.CreatedAt < later));
        Assert.False(await db.People.AnyAsync(p => p.FirstName == "Sam"));
    }

    [Fact]
    public async Task Undo_of_another_or_an_unknown_batch_is_not_found_and_a_second_undo_is_refused()
    {
        var (db, service, result) = await ImportedAsync(ImportLanding.Active);
        using var _ = db;
        Assert.True((await service.UndoAsync(Guid.NewGuid(), Admin(), CancellationToken.None)).NotFound);
        await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);
        var ex = await Assert.ThrowsAsync<ImportException>(() => service.UndoAsync(result.BatchId, Admin(), CancellationToken.None));
        Assert.Equal("This import was already undone.", ex.Message);
    }

    [Fact]
    public async Task History_lists_the_organisations_batches_newest_first()
    {
        var (db, service, first) = await ImportedAsync(ImportLanding.Active);
        using var _ = db;
        await service.UndoAsync(first.BatchId, Admin(), CancellationToken.None);
        var second = await service.CommitAsync(ImportKind.Participants, File, "again.csv", null, ImportLanding.Active, "key-2", Admin(), CancellationToken.None);

        var history = await service.HistoryAsync(CancellationToken.None);

        Assert.Equal(new[] { second.BatchId, first.BatchId }, history.Select(b => b.Id));
        Assert.Equal(("again.csv", (DateTime?)null, 2), (history[0].FileName, history[0].UndoneAt, history[0].CreatedCount));
        Assert.NotNull(history[1].UndoneAt);
    }
}
