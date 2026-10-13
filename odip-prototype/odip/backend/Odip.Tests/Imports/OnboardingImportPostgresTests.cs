using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

/// <summary>The commit's transaction, lock and idempotency key against a real PostgreSQL: EF InMemory has no transactions and no advisory locks.</summary>
public class OnboardingImportPostgresTests : IClassFixture<PostgresFixture>
{
    private const string Header = "First name,Last name,NDIS number";
    private readonly PostgresFixture _pg;
    public OnboardingImportPostgresTests(PostgresFixture pg) => _pg = pg;

    private OdipDbContext Context(Guid tenantId, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, Tenant(tenantId));

    private static Task<ImportResultDto> Commit(OdipDbContext db, Guid tenantId, byte[] file, string key) =>
        Service(db, tenantId).CommitAsync(ImportKind.Participants, file, "people.csv", null, ImportLanding.Active, key, Admin(), CancellationToken.None);

    /// <summary>Fails the save that inserts the second participant, the way a database fault halfway through would.</summary>
    private sealed class FailOnSecondParticipant : SaveChangesInterceptor
    {
        private int _participants;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<Participant>().Any(e => e.State == EntityState.Added) && ++_participants == 2)
                throw new DbUpdateException("simulated fault");
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private async Task<Guid> NewOrganisationAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        return tenantId;
    }

    [SkippableFact]
    public async Task A_failure_halfway_rolls_back_the_whole_batch()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var tenantId = await NewOrganisationAsync();
        await using (var db = Context(tenantId, new FailOnSecondParticipant()))
        {
            var ex = await Assert.ThrowsAsync<ImportException>(() => Commit(db, tenantId, Csv(Header, "Ava,Stone,", "Ben,Lee,", "Cal,Wu,"), "key-fail"));
            Assert.Equal((OnboardingImportService.CommitFailed, 500), (ex.Message, ex.StatusCode));
        }
        await using var check = Context(tenantId);
        Assert.Equal(0, await check.Participants.CountAsync());
        Assert.Equal(0, await check.ImportBatches.CountAsync());
    }

    [SkippableFact]
    public async Task Two_imports_with_the_same_key_at_once_create_one_batch()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var tenantId = await NewOrganisationAsync();
        var file = Csv(Header, "Ava,Stone,430000001", "Ben,Lee,430000002");
        await using var one = Context(tenantId);
        await using var two = Context(tenantId);

        var results = await Task.WhenAll(Commit(one, tenantId, file, "same-key"), Commit(two, tenantId, file, "same-key"));

        Assert.Equal(results[0].BatchId, results[1].BatchId);
        Assert.Single(results, r => r.Replayed);
        await using var check = Context(tenantId);
        Assert.Equal(2, await check.Participants.CountAsync());
        Assert.Equal(1, await check.ImportBatches.CountAsync());
    }

    [SkippableFact]
    public async Task A_second_import_is_told_another_is_running_when_it_cannot_get_the_lock()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var tenantId = await NewOrganisationAsync();
        await using var holder = new NpgsqlConnection(_pg.ConnectionString);
        await holder.OpenAsync();
        await using var tx = await holder.BeginTransactionAsync();
        await using (var hold = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@k)", holder, tx))
        {
            hold.Parameters.AddWithValue("k", OnboardingImportService.LockKey(tenantId));
            await hold.ExecuteNonQueryAsync();
        }

        await using var db = Context(tenantId);
        var ex = await Assert.ThrowsAsync<ImportException>(() => Commit(db, tenantId, Csv(Header, "Ava,Stone,"), "key-busy"));

        Assert.Equal((OnboardingImportService.LockBusy, 409), (ex.Message, ex.StatusCode));
    }

    [SkippableFact]
    public async Task Duplicate_checks_translate_and_ignore_an_undone_imports_participants()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var tenantId = await NewOrganisationAsync();
        await using var db = Context(tenantId);
        var archived = new Participant { Id = Guid.NewGuid(), FirstName = "Ava", LastName = "Stone", NdisNumber = "430000001", IsActive = false };
        var batch = new ImportBatch { Id = Guid.NewGuid(), FileName = "old.csv", FileSha256 = "x", IdempotencyKey = "old", CreatedByName = "A", UndoneAt = DateTime.UtcNow };
        batch.Items.Add(new ImportBatchItem { Id = Guid.NewGuid(), EntityType = "Participant", EntityId = archived.Id });
        db.AddRange(archived, batch, new Participant { Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Lee", NdisNumber = "430 000 002" });
        await db.SaveChangesAsync();

        var preview = await Service(db, tenantId).PreviewAsync(ImportKind.Participants, Csv(Header, "Ava,Stone,430000001", "Ben,Lee,430000002"), "people.csv", null, CancellationToken.None);

        Assert.Equal(new[] { ImportRowStatus.Ready, ImportRowStatus.Skipped }, preview.Rows.Select(r => r.Status));
    }

    [SkippableFact]
    public async Task Undo_waits_for_a_note_being_added_to_an_imported_participant_and_then_refuses()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var tenantId = await NewOrganisationAsync();
        await using var db = Context(tenantId);
        var result = await Commit(db, tenantId, Csv(Header, "Ava,Stone,430000001"), "key-race");
        var avaId = await db.Participants.Select(p => p.Id).SingleAsync();

        // A coordinator's note, inserted but not yet committed when the undo starts.
        await using var coordinator = Context(tenantId);
        await using var noteTx = await coordinator.Database.BeginTransactionAsync();
        coordinator.ParticipantNotes.Add(new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = avaId, Title = "t", Description = "d", CreatedByName = "x" });
        await coordinator.SaveChangesAsync();

        await using var undoDb = Context(tenantId);
        var undo = Service(undoDb, tenantId).UndoAsync(result.BatchId, Admin(), CancellationToken.None);
        await Task.Delay(TimeSpan.FromSeconds(2));
        Assert.False(undo.IsCompleted, "undo did not wait for the note's transaction");
        await noteTx.CommitAsync();

        Assert.Equal("has notes", (await undo).Blockers.Single().Reason);
        await using var check = Context(tenantId);
        Assert.True((await check.Participants.SingleAsync()).IsActive);
    }
}
