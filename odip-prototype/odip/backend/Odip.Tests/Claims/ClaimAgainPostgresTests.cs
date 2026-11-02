using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// "Claim again" on a real PostgreSQL, where the transaction and the locks are real (InMemory has neither). A failure after the delete rolls the delete back, so the old claim and its hold come back;
/// two calls at once make exactly one new claim; a claim again racing a claim run leaves one counting line per shift; a busy lock is a 409. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class ClaimAgainPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day1 = new(2026, 10, 20);
    private static readonly DateOnly Day3 = new(2026, 10, 22);
    private static readonly DateOnly Now = new(2026, 10, 30);

    private readonly PostgresFixture _pg;
    public ClaimAgainPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private async Task<(Guid TenantId, Participant Person, TripClaim Old, List<Shift> Shifts)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var shifts = Enumerable.Range(0, 3).Select(i => kit.SeedShift(person, Day1.AddDays(i), ShiftStatus.Completed)).ToList();
        var old = (await new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).GenerateAsync(person.Id, Day1, Day3, Ct)).Claim;
        await kit.Db.TripClaims.Where(c => c.Id == old.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, TripClaimStatus.Rejected), Ct);
        await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == old.Id).ExecuteUpdateAsync(s => s.SetProperty(l => l.Status, ClaimLineItemStatus.Submitted), Ct);
        return (tenantId, person, old, shifts);
    }

    private static Mock<ICurrentTenant> TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    private OdipDbContext NewDb(Guid tenantId, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, TenantOf(tenantId).Object);

    /// <summary>Throws when a save carries a new claim: after the delete has already been saved in the same transaction.</summary>
    private sealed class ThrowOnNewClaimSave : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<TripClaim>().Any(e => e.State == EntityState.Added))
                throw new InvalidOperationException("The save failed.");
            return base.SavingChangesAsync(eventData, result, ct);
        }
    }

    [SkippableFact(DisplayName = "Postgres: a failure after the delete rolls it back, the shifts stay held by the old claim, and claiming again then succeeds")]
    public async Task D_AFailureAfterTheDelete_KeepsTheOldClaimAndItsHold_AndASecondTrySucceeds()
    {
        RequirePostgres();
        var (tenantId, person, old, shifts) = await SeedAsync();

        await using (var db = NewDb(tenantId, new ThrowOnNewClaimSave()))
            await Assert.ThrowsAsync<InvalidOperationException>(() => new ShiftClaimGenerationService(db).ClaimAgainAsync(old.Id, tenantId, Now, Ct));

        await using (var check = NewDb(tenantId))
        {
            Assert.Equal(TripClaimStatus.Rejected, (await check.TripClaims.AsNoTracking().SingleAsync(c => c.Id == old.Id, Ct)).Status);
            Assert.Equal(3, await check.ClaimLineItems.CountAsync(l => l.TripClaimId == old.Id, Ct));
            // The shifts are still held by the old claim: a date-range preview names it.
            var preview = await new ShiftClaimGenerationService(check).PreviewRunAsync(tenantId, Day1, Day3, Ct);
            Assert.Equal(shifts.Select(s => s.Id).Order(), preview.LeftOut.Where(l => l.HeldByClaimId == old.Id).Select(l => l.ShiftId).Order());
        }

        await using var again = NewDb(tenantId);
        var made = await new ShiftClaimGenerationService(again).ClaimAgainAsync(old.Id, tenantId, Now, Ct);
        Assert.Equal(3, made.ShiftCount);
        Assert.False(await again.TripClaims.AnyAsync(c => c.Id == old.Id, Ct));
    }

    [SkippableFact(DisplayName = "Postgres: two Claim again calls at once make exactly one new claim and one counting line per shift")]
    public async Task D_TwoCallsAtOnce_MakeOneNewClaim_AndOneCountingLinePerShift()
    {
        RequirePostgres();
        var (tenantId, _, old, shifts) = await SeedAsync();

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            await using var db = NewDb(tenantId);
            try { await new ShiftClaimGenerationService(db).ClaimAgainAsync(old.Id, tenantId, Now, Ct); return (string?)null; }
            catch (InvalidOperationException refused) { return refused.Message; }
        }));

        Assert.Equal(1, outcomes.Count(o => o is null));
        Assert.Equal("This claim has already been claimed again or deleted. Refresh to see the new claim.", outcomes.Single(o => o is not null));
        await using var check = NewDb(tenantId);
        Assert.Equal(1, await check.TripClaims.CountAsync(Ct));
        var counting = await check.ClaimLineItems.AsNoTracking().Where(BudgetLedgerService.ClaimLineStillCounts).ToListAsync(Ct);
        Assert.Equal(shifts.Select(s => s.Id).Order(), counting.Select(l => l.ShiftId!.Value).Order());
    }

    [SkippableFact(DisplayName = "Postgres: Claim again racing a claim run leaves one counting line per shift")]
    public async Task ClaimAgainRacingTheRun_LeavesOneCountingLinePerShift()
    {
        RequirePostgres();
        var (tenantId, _, old, shifts) = await SeedAsync();

        await Task.WhenAll(
            Task.Run(async () => { await using var db = NewDb(tenantId); try { await new ShiftClaimGenerationService(db).ClaimAgainAsync(old.Id, tenantId, Now, Ct); } catch (InvalidOperationException) { } }),
            Task.Run(async () => { await using var db = NewDb(tenantId); await new ShiftClaimGenerationService(db).RunAsync(tenantId, Day1, Day3, Ct); }));

        await using var check = NewDb(tenantId);
        var counting = await check.ClaimLineItems.AsNoTracking().Where(BudgetLedgerService.ClaimLineStillCounts).ToListAsync(Ct);
        Assert.Equal(shifts.Select(s => s.Id).Order(), counting.Select(l => l.ShiftId!.Value).Order());
    }

    [SkippableFact(DisplayName = "Postgres: Claim again answers 409 while another claim for the participant holds the lock")]
    public async Task ABusyLock_IsA409_AndNothingIsDeleted()
    {
        RequirePostgres();
        var (tenantId, person, old, _) = await SeedAsync();
        var tenant = TenantOf(tenantId);

        await using var holder = NewDb(tenantId);
        var held = await RosterGenerationLock.AcquireAsync(holder, person.Id, Ct, scope: "claim-generate");
        await using var own = NewDb(tenantId);
        var controller = new ClaimsController(own, new ClaimGenerationService(own), new ShiftClaimGenerationService(own), new BprCsvService(own), new InvoiceService(own), new BudgetLedgerService(own, TimeProvider.System), tenant.Object);

        var result = (await controller.ClaimAgain(old.Id, Ct)).Result;   // waits the lock's 10 seconds, then gives up

        await held.DisposeAsync();
        Assert.Equal(409, Assert.IsAssignableFrom<ObjectResult>(result).StatusCode);
        Assert.Equal("Another claim is still being generated for this trip or participant. Wait a moment, then try again.", Assert.IsType<ApiResponse<ShiftClaimGeneratedDto>>(((ObjectResult)result!).Value).Errors!.Single());
        await using var check = NewDb(tenantId);
        Assert.Equal(3, await check.ClaimLineItems.CountAsync(l => l.TripClaimId == old.Id, Ct));
    }
}
