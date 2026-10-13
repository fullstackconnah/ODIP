using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class ImportTenantIsolationPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ImportTenantIsolationPostgresTests(PostgresFixture pg) => _pg = pg;

    private OdipDbContext Context(Guid tenantId) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, Tenant(tenantId));

    [SkippableFact]
    public async Task One_organisations_import_neither_reads_nor_touches_another()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setupA, a) = await _pg.NewTenantContextAsync();
        var (setupB, b) = await _pg.NewTenantContextAsync();
        await setupA.DisposeAsync();
        await setupB.DisposeAsync();
        var file = Csv("First name,Last name,NDIS number", "Ava,Stone,430000777");

        ImportResultDto bImport;
        await using (var dbB = Context(b))
            bImport = await Service(dbB, b).CommitAsync(ImportKind.Participants, file, "b.csv", null, ImportLanding.Active, "b-key", Admin(), CancellationToken.None);

        await using var dbA = Context(a);
        var serviceA = Service(dbA, a);
        // B's participant with the same NDIS number is invisible to A, so A's row is Ready, not "already in ODIP".
        Assert.Equal(ImportRowStatus.Ready, (await serviceA.PreviewAsync(ImportKind.Participants, file, "a.csv", null, CancellationToken.None)).Rows.Single().Status);
        Assert.Empty(await serviceA.HistoryAsync(CancellationToken.None));
        Assert.True((await serviceA.UndoAsync(bImport.BatchId, Admin(), CancellationToken.None)).NotFound);
        // The same idempotency key in another organisation is a different import.
        var aImport = await serviceA.CommitAsync(ImportKind.Participants, file, "a.csv", null, ImportLanding.Active, "b-key", Admin(), CancellationToken.None);
        Assert.False(aImport.Replayed);

        await using var admin = PostgresFixture.NewContext(_pg.ConnectionString);
        var bParticipantId = await admin.ImportBatchItems.Where(i => i.BatchId == bImport.BatchId).Select(i => i.EntityId).SingleAsync();
        Assert.Equal(b, (await admin.Participants.SingleAsync(p => p.Id == bParticipantId)).TenantId);
        Assert.Equal(a, (await admin.ImportBatches.SingleAsync(x => x.Id == aImport.BatchId)).TenantId);
        Assert.Null((await admin.ImportBatches.SingleAsync(x => x.Id == bImport.BatchId)).UndoneAt);
    }

    [SkippableFact]
    public async Task The_untouched_rules_and_history_translate_to_SQL()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await setup.DisposeAsync();
        await using var db = Context(tenantId);
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.Participants, Csv("First name,Last name", "Ava,Stone", "Ben,Lee"), "p.csv", null, ImportLanding.Onboarding, "k", Admin(), CancellationToken.None);
        var ava = await db.Participants.SingleAsync(p => p.LastName == "Stone");
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), ParticipantId = ava.Id, ServiceDate = new DateOnly(2026, 11, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), Status = ShiftStatus.Draft });
        await db.SaveChangesAsync();

        Assert.Equal("has shifts", (await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None)).Blockers.Single().Reason);
        Assert.Single(await service.HistoryAsync(CancellationToken.None));
    }
}
