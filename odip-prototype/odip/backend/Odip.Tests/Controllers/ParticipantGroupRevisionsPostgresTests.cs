using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The section revision race against a real PostgreSQL: the check in the UPDATE's WHERE, the first-row PK race, and the whole-save rollback, which EF InMemory cannot show.</summary>
public class ParticipantGroupRevisionsPostgresTests : IClassFixture<PostgresFixture>
{
    private const string NoPg = "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.";
    private readonly PostgresFixture _pg;
    public ParticipantGroupRevisionsPostgresTests(PostgresFixture pg) => _pg = pg;

    private OdipDbContext Ctx(Guid tenantId, params IInterceptor[] interceptors)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, tenant.Object);
    }

    private async Task<(Guid TenantId, Guid Id)> SeedAsync(int? medicalRevision = null)
    {
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await using (seed)
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", MedicalSummary = "old" };
            seed.Participants.Add(p);
            if (medicalRevision is { } rev)
                seed.ParticipantGroupRevisions.Add(new ParticipantGroupRevision { ParticipantId = p.Id, GroupKey = "medical", Revision = rev, UpdatedAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
            return (tenantId, p.Id);
        }
    }

    private static ParticipantsController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static PatchParticipantDto Medical(string summary, int expected) =>
        new() { Medical = new PatchMedicalDto { MedicalSummary = summary }, ExpectedRevisions = new() { ["medical"] = expected } };

    private async Task<(string? Summary, int Revision, int Rows)> StateAsync(Guid tenantId, Guid id)
    {
        await using var db = Ctx(tenantId);
        var rows = await db.ParticipantGroupRevisions.Where(r => r.ParticipantId == id && r.GroupKey == "medical").ToListAsync();
        return ((await db.Participants.SingleAsync(p => p.Id == id)).MedicalSummary, rows.SingleOrDefault()?.Revision ?? 0, rows.Count);
    }

    [SkippableFact]
    public async Task Interleaved_saves_from_one_opened_revision_second_loses()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, id) = await SeedAsync(medicalRevision: 1);
        await using var a = Ctx(tenantId);
        await using var b = Ctx(tenantId);
        var pa = await a.Participants.SingleAsync(p => p.Id == id);
        var pb = await b.Participants.SingleAsync(p => p.Id == id);
        var expected = new Dictionary<string, int> { ["medical"] = 1 };
        pa.MedicalSummary = "X";
        await ParticipantGroupRevisions.BumpChangedAsync(a, pa, expected, default);
        pb.MedicalSummary = "Y";
        await ParticipantGroupRevisions.BumpChangedAsync(b, pb, expected, default);
        await a.SaveChangesAsync();
        var ex = await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => b.SaveChangesAsync());
        Assert.True(ParticipantGroupRevisions.IsLostRace(ex));
        Assert.Equal(("X", 2, 1), await StateAsync(tenantId, id));
    }

    [SkippableFact]
    public async Task First_save_race_on_missing_row_exactly_one_wins()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, id) = await SeedAsync();
        await using var a = Ctx(tenantId);
        await using var b = Ctx(tenantId);
        var pa = await a.Participants.SingleAsync(p => p.Id == id);
        var pb = await b.Participants.SingleAsync(p => p.Id == id);
        var expected = new Dictionary<string, int> { ["medical"] = 0 };
        pa.MedicalSummary = "X";
        await ParticipantGroupRevisions.BumpChangedAsync(a, pa, expected, default);
        pb.MedicalSummary = "Y";
        await ParticipantGroupRevisions.BumpChangedAsync(b, pb, expected, default);
        await a.SaveChangesAsync();
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => b.SaveChangesAsync());
        Assert.True(ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "PK_ParticipantGroupRevisions" });
        Assert.True(ParticipantGroupRevisions.IsLostRace(ex));
        Assert.Equal(("X", 1, 1), await StateAsync(tenantId, id));
    }

    [SkippableFact]
    public async Task Sequential_stale_patch_is_409_on_postgres()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, id) = await SeedAsync();
        await using (var first = Ctx(tenantId))
            Assert.IsType<OkObjectResult>((await Controller(first).Patch(id, Medical("first", 0), default)).Result);
        await using (var second = Ctx(tenantId))
            Assert.IsType<ConflictObjectResult>((await Controller(second).Patch(id, Medical("second", 0), default)).Result);
        Assert.Equal(("first", 1, 1), await StateAsync(tenantId, id));
    }

    [SkippableFact]
    public async Task Interleaved_patch_through_the_controller_is_409_not_500()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, id) = await SeedAsync(medicalRevision: 1);
        var interleave = new RunOnceBeforeSave(async () =>
        {
            await using var a = Ctx(tenantId);
            Assert.IsType<OkObjectResult>((await Controller(a).Patch(id, Medical("A", 1), default)).Result);
        });
        await using var b = Ctx(tenantId, interleave);
        var result = (await Controller(b).Patch(id, Medical("B", 1), default)).Result;
        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var body = Assert.IsType<ApiResponse<ParticipantSectionChangedDto>>(conflict.Value);
        Assert.Equal("participant-section-changed", body.Code);
        Assert.Equal(2, body.Data!.GroupRevisions["medical"]);
        Assert.Equal(("A", 2, 1), await StateAsync(tenantId, id));
    }

    [SkippableFact]
    public async Task Writers_without_expected_both_save_on_a_first_row_race()
    {
        Skip.IfNot(_pg.Available, NoPg);
        var (tenantId, id) = await SeedAsync();
        await using var a = Ctx(tenantId);
        await using var b = Ctx(tenantId);
        var pa = await a.Participants.SingleAsync(p => p.Id == id);
        var pb = await b.Participants.SingleAsync(p => p.Id == id);
        pa.MedicalSummary = "X";
        await ParticipantGroupRevisions.BumpChangedAsync(a, pa, null, default);
        pb.MedicalSummary = "Y";
        await ParticipantGroupRevisions.BumpChangedAsync(b, pb, null, default);
        await ParticipantGroupRevisions.SaveBumpingAsync(a, default);
        await ParticipantGroupRevisions.SaveBumpingAsync(b, default);
        Assert.Equal(("Y", 2, 1), await StateAsync(tenantId, id));
    }

    private sealed class RunOnceBeforeSave(Func<Task> action) : SaveChangesInterceptor
    {
        private bool _ran;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (!_ran) { _ran = true; await action(); }
            return result;
        }
    }
}
