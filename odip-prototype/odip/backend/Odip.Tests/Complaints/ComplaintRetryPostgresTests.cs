using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Complaints;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the filtered unique index on
/// (TenantId, IdempotencyKey) that makes a retried complaint submit safe, and the race the controller answers as a replay.
/// </summary>
public class ComplaintRetryPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public ComplaintRetryPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Complaint NewComplaint(Guid tenantId, string? key) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ReceivedOn = new DateOnly(2026, 10, 1), Channel = ComplaintChannel.Phone,
        ComplainantKind = ComplainantKind.Other, Summary = "Arrived late.", IdempotencyKey = key,
    };

    [SkippableFact]
    public async Task TheIndex_RefusesTheSameKeyTwiceInATenant_ButNotNullKeys_OrAnotherTenant()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenant) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (otherDb, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = otherDb;

        db.Complaints.AddRange(NewComplaint(tenant, null), NewComplaint(tenant, null), NewComplaint(tenant, "key-1"));
        await db.SaveChangesAsync(Ct); // two null keys are outside the filtered index
        otherDb.Complaints.Add(NewComplaint(otherTenant, "key-1"));
        await otherDb.SaveChangesAsync(Ct); // the same key in another tenant is its own row

        db.Complaints.Add(NewComplaint(tenant, "key-1"));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal(Complaint.IdempotencyIndexName, pg.ConstraintName);
    }

    /// <summary>Hands the first save a rival that commits the same (tenant, key) just before it, which is what two submits passing the lookup together look like.</summary>
    private sealed class RivalFirstInterceptor(Func<Task> rival) : SaveChangesInterceptor
    {
        private bool _fired;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_fired) { _fired = true; await rival(); }
            return result;
        }
    }

    [SkippableFact]
    public async Task ARacingSubmitWithTheSameKey_AnswersAsAReplayOfTheWinner_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenant) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var winner = NewComplaint(tenant, "race-key");

        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString)
            .AddInterceptors(new RivalFirstInterceptor(async () =>
            {
                await using var rival = PostgresFixture.NewContext(_pg.ConnectionString);
                rival.Complaints.Add(winner);
                await rival.SaveChangesAsync(Ct);
            })).Options;
        var tenantMock = new Moq.Mock<Odip.Domain.Interfaces.ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenant);
        tenantMock.Setup(t => t.IsSuperAdmin).Returns(false);
        await using var db = new OdipDbContext(options, tenantMock.Object);

        var result = await new ComplaintsController(db, tenantMock.Object, TimeProvider.System).Create(new SaveComplaintDto
        {
            ReceivedOn = new DateOnly(2026, 10, 1), Channel = ComplaintChannel.Phone, ComplainantKind = ComplainantKind.Other,
            Summary = "Arrived late.", IdempotencyKey = "race-key",
        }, Ct);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(winner.Id, Assert.IsType<ApiResponse<ComplaintDto>>(ok.Value).Data!.Id);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        Assert.Equal(1, await check.Complaints.CountAsync(c => c.TenantId == tenant && c.IdempotencyKey == "race-key", Ct));
    }
}
