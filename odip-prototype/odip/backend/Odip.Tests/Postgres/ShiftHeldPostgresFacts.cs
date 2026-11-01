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
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// Shift billing PR2 fix 1 on a real PostgreSQL: the unique index IX_ClaimLineItems_ShiftId_Counting refuses a second counting line for a shift, and each place that can hit it says so in a sentence
/// instead of a 500 or a raw database error. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class ShiftHeldPostgresFacts : IClassFixture<PostgresFixture>
{
    private static readonly DateOnly From = new(2026, 10, 1), To = new(2026, 10, 31);
    private readonly PostgresFixture _pg;
    public ShiftHeldPostgresFacts(PostgresFixture pg) => _pg = pg;

    private static Mock<ICurrentTenant> TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    /// <summary>Right before the claim run's own save, another claim takes the shift (as a second request would): the only deterministic way past the run's two guards to the index.</summary>
    private sealed class RivalClaimInterceptor(string connectionString, Mock<ICurrentTenant> tenant, Guid participantId, Guid shiftId) : SaveChangesInterceptor
    {
        private bool _done;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (_done || !eventData.Context!.ChangeTracker.Entries<TripClaim>().Any(e => e.State == EntityState.Added)) return result;
            _done = true;
            await using var rival = PostgresFixture.NewContext(connectionString, tenant.Object);
            var claim = new TripClaim { Id = Guid.NewGuid(), TenantId = tenant.Object.TenantId!.Value, Kind = ClaimKind.Shift, ParticipantId = participantId, Status = TripClaimStatus.Submitted, ClaimReference = "TC-RIVAL-" + Guid.NewGuid().ToString("N")[..6] };
            rival.TripClaims.Add(claim);
            rival.ClaimLineItems.Add(new ClaimLineItem
            {
                Id = Guid.NewGuid(), TenantId = claim.TenantId, TripClaimId = claim.Id, ShiftId = shiftId, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = From, SupportsDeliveredTo = From, Hours = 1m, UnitPrice = 100m, TotalAmount = 100m, Status = ClaimLineItemStatus.Submitted,
            });
            await rival.SaveChangesAsync(ct);
            return result;
        }
    }

    private async Task<(ShiftClaimGenerationService Engine, OdipDbContext Own, Guid TenantId, Participant Person)> ArrangeRaceAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed);
        var tenant = TenantOf(tenantId);
        var own = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(new RivalClaimInterceptor(_pg.ConnectionString, tenant, person.Id, shift.Id)).Options, tenant.Object);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", own.Database.ProviderName);   // so an InMemory run can never satisfy this class
        return (new ShiftClaimGenerationService(own), own, tenantId, person);
    }

    [SkippableFact(DisplayName = "Postgres: a shift another claim takes between the read and the save is refused with the plain sentence")]
    public async Task GenerateAsync_WhenAnotherClaimTakesTheShiftFirst_ThrowsTheShiftTakenMessage()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (engine, own, _, person) = await ArrangeRaceAsync();
        await using var _ = own;

        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => engine.GenerateAsync(person.Id, From, To));
        Assert.Equal(ShiftClaimGenerationService.ShiftTakenMessage, e.Message);
    }

    [SkippableFact(DisplayName = "Postgres: a claim run reports that participant Skipped, not Failed, with the shift-taken sentence")]
    public async Task RunAsync_WhenAnotherClaimTakesTheShiftFirst_ReportsTheParticipantSkippedNotFailed()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (engine, own, tenantId, person) = await ArrangeRaceAsync();
        await using var _ = own;

        var run = await engine.RunAsync(tenantId, From, To);

        var skipped = Assert.Single(run.Skipped);
        Assert.Equal(person.Id, skipped.ParticipantId);
        Assert.Equal(ShiftClaimGenerationService.ShiftTakenMessage, skipped.Reason);
        Assert.False(skipped.Failed);
        Assert.Equal(0, run.ClaimsMade);
    }

    [SkippableFact(DisplayName = "Postgres: taking back a rejected line whose shift sits on a hand-rejected claim gives the 409 sentence, not a 500")]
    public async Task TakingBackARejectedLine_WhoseShiftIsHeldByAHandRejectedClaim_Gives409()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);
        var person = kit.SeedParticipant();
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed);
        // A: sent, and the NDIA rejected the line. B then took the shift, and B was marked Rejected by hand (its line stays Submitted, so the index still holds the shift).
        var a = kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 400m, shift);
        var lineA = await kit.Db.ClaimLineItems.SingleAsync(l => l.TripClaimId == a.Id);
        lineA.Status = ClaimLineItemStatus.Rejected;
        await kit.Db.SaveChangesAsync();
        var b = kit.SeedShiftClaim(person, TripClaimStatus.Rejected, 400m, shift);
        var lineB = await kit.Db.ClaimLineItems.SingleAsync(l => l.TripClaimId == b.Id);
        lineB.Status = ClaimLineItemStatus.Submitted;
        await kit.Db.SaveChangesAsync();

        var tenant = TenantOf(tenantId);
        await using var own = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var controller = new ClaimsController(own, new ClaimGenerationService(own), new ShiftClaimGenerationService(own), new BprCsvService(own), new InvoiceService(own), new BudgetLedgerService(own, TimeProvider.System), tenant.Object);

        var result = (await controller.UpdateLineItem(a.Id, lineA.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Submitted }, CancellationToken.None)).Result;

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var body = Assert.IsType<ApiResponse<bool>>(conflict.Value);
        Assert.Contains(ClaimSubmission.ShiftHeldMessage, body.Errors!);
    }
}
