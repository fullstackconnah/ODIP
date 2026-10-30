using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Odip.Domain.Interfaces;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>[PG] The parts of claim batches only a real PostgreSQL can show: the one-Pending index, the locks, and the rollback. Skipped, never failed, without POSTGRES_CONNECTION_STRING.</summary>
public class ClaimBatchPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ClaimBatchPostgresTests(PostgresFixture pg) => _pg = pg;

    private static ICurrentTenant TenantOf(BatchFixture f)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(f.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private async Task<BatchFixture> NewAsync()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        return new BatchFixture(db, tenantId);
    }

    [SkippableFact(DisplayName = "Postgres: the unique index refuses a second Pending row for one line")]
    public async Task The_index_refuses_a_second_pending_row_for_a_line()
    {
        using var f = await NewAsync();
        var (_, lines, _) = f.AddClaim(shiftLines: true);
        var built = await f.BuildAsync(lines[0].Id);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));

        var other = new ClaimBatch { Id = Guid.NewGuid(), TenantId = f.TenantId, FileName = "BPR261030999.csv", Status = ClaimBatchStatus.Built, Content = [1] };
        var existing = await f.Db.ClaimBatchLines.AsNoTracking().SingleAsync();
        f.Db.ClaimBatches.Add(other);
        f.Db.ClaimBatchLines.Add(new ClaimBatchLine
        {
            Id = Guid.NewGuid(), TenantId = f.TenantId, BatchId = other.Id, ClaimLineItemId = existing.ClaimLineItemId, Attempt = 2, RowReference = "x", NdisNumber = "430000001", Outcome = ClaimBatchLineOutcome.Pending,
            SupportNumber = existing.SupportNumber, SupportsDeliveredFrom = existing.SupportsDeliveredFrom, SupportsDeliveredTo = existing.SupportsDeliveredTo, Amount = existing.Amount,
        });

        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => f.Db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal(("23505", "UX_ClaimBatchLines_OnePendingPerLine"), (pg.SqlState, pg.ConstraintName));
    }

    [SkippableFact(DisplayName = "Postgres: two builds of one line at once leave exactly one Pending row")]
    public async Task Two_builds_of_one_line_at_once_leave_one_pending_row()
    {
        using var f = await NewAsync();
        var (_, lines, _) = f.AddClaim(shiftLines: true);
        await using var second = PostgresFixture.NewContext(_pg.ConnectionString!, TenantOf(f));
        var other = new ClaimBatchService(second, new BprCsvService(second), new InvoiceService(second), f.Clock);
        var request = new BuildRequest([lines[0].Id], [], []);

        var results = await Task.WhenAll(f.Service.BuildAsync(f.TenantId, f.User, request, default), other.BuildAsync(f.TenantId, f.User, request, default));

        Assert.Single(results, r => r.Ok);
        Assert.Single(results, r => !r.Ok && r.Status is 400 or 409);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString!);
        Assert.Equal(1, await check.ClaimBatchLines.CountAsync(l => l.TenantId == f.TenantId && l.Outcome == ClaimBatchLineOutcome.Pending));
    }

    [SkippableFact(DisplayName = "Postgres: a build waits for an edit to the claim and then files what the edit saved")]
    public async Task A_build_waits_for_an_edit_and_reads_what_it_saved()
    {
        using var f = await NewAsync();
        var (claim, lines, _) = f.AddClaim(shiftLines: true);
        await using var editor = PostgresFixture.NewContext(_pg.ConnectionString!, TenantOf(f));
        var held = await RosterGenerationLock.AcquireAsync(editor, claim.Id, CancellationToken.None, scope: "claim-edit");

        var build = Task.Run(() => f.BuildAsync(lines[0].Id));
        await Task.Delay(1500);
        Assert.False(build.IsCompleted);   // waiting for the claim's edit lock
        var line = await editor.ClaimLineItems.SingleAsync(l => l.Id == lines[0].Id);
        line.Hours = 3m;
        line.TotalAmount = 180m;
        await editor.SaveChangesAsync();
        await held.CommitAsync(CancellationToken.None);
        await held.DisposeAsync();

        var built = await build.WaitAsync(TimeSpan.FromSeconds(20));
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        Assert.Equal(180m, built.Value!.Lines.Single().Amount);
    }

    [SkippableFact(DisplayName = "Postgres: Patch waits for a build and then refuses")]
    public async Task Patch_waits_for_a_build_and_then_refuses()
    {
        using var f = await NewAsync();
        var (claim, lines, _) = f.AddClaim(shiftLines: true);
        // A build in flight holds the claim's edit lock until it commits its Pending row.
        await using var builder = PostgresFixture.NewContext(_pg.ConnectionString!, TenantOf(f));
        var held = await RosterGenerationLock.AcquireAsync(builder, claim.Id, CancellationToken.None, scope: "claim-edit");
        await using var own = PostgresFixture.NewContext(_pg.ConnectionString!, TenantOf(f));

        var patch = Task.Run(async () => (await ClaimEditFileGuardTests.ControllerFor(own, f.TenantId)
            .UpdateLineItem(claim.Id, lines[0].Id, new UpdateClaimLineItemDto { Hours = 3m }, CancellationToken.None)).Result);
        await Task.Delay(1500);
        Assert.False(patch.IsCompleted);   // still waiting for the lock
        var batch = new ClaimBatch { Id = Guid.NewGuid(), TenantId = f.TenantId, FileName = "BPR261030001.csv", Status = ClaimBatchStatus.Built, Content = [1] };
        builder.ClaimBatches.Add(batch);
        builder.ClaimBatchLines.Add(new ClaimBatchLine
        {
            Id = Guid.NewGuid(), TenantId = f.TenantId, BatchId = batch.Id, ClaimLineItemId = lines[0].Id, Attempt = 1, RowReference = "r", NdisNumber = "430000001", Outcome = ClaimBatchLineOutcome.Pending,
            SupportNumber = BatchFixture.ItemCode, SupportsDeliveredFrom = lines[0].SupportsDeliveredFrom, SupportsDeliveredTo = lines[0].SupportsDeliveredTo, Amount = 120m,
        });
        await builder.SaveChangesAsync();
        await held.CommitAsync(CancellationToken.None);
        await held.DisposeAsync();

        var result = Assert.IsAssignableFrom<ObjectResult>(await patch.WaitAsync(TimeSpan.FromSeconds(20)));
        Assert.Equal(409, result.StatusCode);
        Assert.Equal(2m, (await f.Db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == lines[0].Id)).Hours);
    }

    [SkippableFact(DisplayName = "Postgres: a failed confirm rolls back and leaves the file Built")]
    public async Task A_refused_confirm_changes_nothing()
    {
        using var f = await NewAsync();
        var (claim, lines, _) = f.AddClaim(shiftLines: true);
        var built = await f.BuildAsync(lines[0].Id);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        claim.Status = TripClaimStatus.Cancelled;
        await f.Db.SaveChangesAsync();

        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value!.Id, default);

        Assert.Equal(409, up.Status);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString!);
        Assert.Equal(ClaimBatchStatus.Built, (await check.ClaimBatches.AsNoTracking().SingleAsync(b => b.Id == built.Value.Id)).Status);
        Assert.Equal(ClaimLineItemStatus.Draft, (await check.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == lines[0].Id)).Status);
    }
}
