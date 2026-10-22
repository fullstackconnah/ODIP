using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Claims;

/// <summary>
/// Editing a line re-adds the claim's total. Two edits to two lines of one claim at the same moment each used to read the other lines before the other had saved, so the last writer's total
/// missed the first's edit. An edit now takes an advisory lock on the claim first, so the second waits and reads what the first saved. Needs a real PostgreSQL (InMemory has no concurrent
/// transactions); skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class ClaimEditRacePostgresTests : IClassFixture<PostgresFixture>
{
    private const int Lines = 6;

    private readonly PostgresFixture _pg;
    public ClaimEditRacePostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact(DisplayName = "Postgres: lines of one claim edited at once leave a total equal to the sum of the stored lines")]
    public async Task LinesEditedAtOnce_LeaveTheClaimTotalEqualToTheSumOfItsStoredLines()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        var person = kit.SeedParticipant();
        var firstShift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 80m, firstShift);
        for (var i = 1; i < Lines; i++) kit.AddShiftLine(claim, kit.SeedShift(person, new DateOnly(2026, 10, 1 + i), ShiftStatus.Completed), 80m);
        var ids = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).Select(l => l.Id).ToListAsync();
        Assert.Equal(Lines, ids.Count);

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var results = await Task.WhenAll(ids.Select(async (id, i) =>
        {
            await using var own = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
            var controller = new ClaimsController(own, new ClaimGenerationService(own), new ShiftClaimGenerationService(own), new BprCsvService(own), new InvoiceService(own), new BudgetLedgerService(own, TimeProvider.System), tenant.Object);
            return (await controller.UpdateLineItem(claim.Id, id, new UpdateClaimLineItemDto { Hours = i + 1 }, CancellationToken.None)).Result;
        }));

        Assert.All(results, r => Assert.IsType<OkObjectResult>(r));
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var stored = await check.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claim.Id).ToListAsync();
        Assert.Equal(stored.Sum(l => l.TotalAmount), (await check.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).TotalAmount);
    }

    // A status change and a delete take the same per-claim lock as a line edit, so neither can cross a line edit or each other. The lock is held here by another connection: they must wait for it.
    [SkippableTheory(DisplayName = "Postgres: a status change and a delete wait for the claim-edit lock")]
    [InlineData("status")]
    [InlineData("delete")]
    public async Task AStatusChangeAndADelete_WaitForTheClaimEditLock(string action)
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 80m, kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        await using var holder = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var held = await RosterGenerationLock.AcquireAsync(holder, claim.Id, CancellationToken.None, scope: "claim-edit");
        await using var own = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var controller = new ClaimsController(own, new ClaimGenerationService(own), new ShiftClaimGenerationService(own), new BprCsvService(own), new InvoiceService(own), new BudgetLedgerService(own, TimeProvider.System), tenant.Object);
        var call = Task.Run(async () => action == "status"
            ? (await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, CancellationToken.None)).Result
            : (await controller.DeleteClaim(claim.Id, CancellationToken.None)).Result);

        await Task.Delay(1500);
        Assert.False(call.IsCompleted);   // still waiting for the lock
        await held.DisposeAsync();
        Assert.IsType<OkObjectResult>(await call.WaitAsync(TimeSpan.FromSeconds(20)));
    }
}
