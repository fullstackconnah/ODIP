using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
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
