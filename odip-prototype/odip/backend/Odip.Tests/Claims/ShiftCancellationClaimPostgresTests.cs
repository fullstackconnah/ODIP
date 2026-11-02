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

namespace Odip.Tests.Claims;

/// <summary>
/// The cancellation claim on a real PostgreSQL: two claims made at once for one cancelled shift make one claim, a CANC line the NDIA rejected frees the shift for a second claim (the unique
/// index holds only the lines that count), and reopening or moving a cancelled shift takes the same per-participant "claim-generate" lock the claim does, so it never reads a claim half-made.
/// Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class ShiftCancellationClaimPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Service = new(2026, 10, 20);
    private static readonly DateOnly Now = new(2026, 10, 22);
    private const int AtOnce = 4;

    private readonly PostgresFixture _pg;
    public ShiftCancellationClaimPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private async Task<(LedgerKit Kit, Participant Person, Shift Shift)> KitAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);
        foreach (var item in kit.Db.SupportCatalogueItems.Where(i => i.ActivityGroupId == kit.CommunityAccess.Id)) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        var person = kit.SeedParticipant();
        var shift = kit.SeedShift(person, Service, ShiftStatus.Cancelled);
        shift.CancelledAt = new DateTime(2026, 10, 16, 1, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();
        return (kit, person, shift);
    }

    private Mock<ICurrentTenant> TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    [SkippableFact(DisplayName = "Postgres: two cancellation claims made at once make one claim, and a rejected CANC line frees the shift for a second")]
    public async Task TwoCancellationClaimsAtOnce_MakeOneClaim_AndARejectedLineFreesTheShift()
    {
        RequirePostgres();
        var (kit, _, shift) = await KitAsync();
        using var _ = kit;
        var tenant = TenantOf(kit.TenantId);

        var refusals = await Task.WhenAll(Enumerable.Range(0, AtOnce).Select(async _ =>
        {
            await using var db = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
            try { await new ShiftClaimGenerationService(db).GenerateCancellationAsync(shift.Id, "NSDH", Now, Ct); return null; }
            catch (InvalidOperationException refused) { return refused.Message; }   // already on a claim, or the lock timed out (RosterBusyException is one)
        }));

        Assert.Equal(1, refusals.Count(r => r is null));
        Assert.Equal(1, await kit.Db.ClaimLineItems.CountAsync(l => l.ShiftId == shift.Id && l.Status != ClaimLineItemStatus.Rejected, Ct));

        // S4: the NDIA rejected the first CANC line; the shift is offered again and a second claim saves.
        await kit.Db.ClaimLineItems.Where(l => l.ShiftId == shift.Id).ExecuteUpdateAsync(s => s.SetProperty(l => l.Status, ClaimLineItemStatus.Rejected), Ct);
        await using var db2 = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var engine = new ShiftClaimGenerationService(db2);
        var offered = await engine.CancellationCandidatesAsync(kit.TenantId, Now, Ct);
        var second = await engine.GenerateCancellationAsync(shift.Id, "NSDH", Now, Ct);

        Assert.Equal(shift.Id, Assert.Single(offered.Shifts).ShiftId);
        Assert.Equal(2, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == shift.ParticipantId, Ct));
        Assert.NotEqual(Guid.Empty, second.Claim.Id);
    }

    [SkippableFact(DisplayName = "Postgres: reopening a cancelled shift takes the claim-generate lock, so it is refused 409 while a claim is being made")]
    public async Task ReopeningACancelledShift_TakesTheClaimGenerateLock()
    {
        RequirePostgres();
        var (kit, person, shift) = await KitAsync();
        using var _ = kit;
        var tenant = TenantOf(kit.TenantId);
        await using var holder = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        await using var held = await RosterGenerationLock.AcquireAsync(holder, person.Id, Ct, scope: "claim-generate");   // a claim for this participant, still running
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var dto = new UpdateShiftDto
        {
            ParticipantId = shift.ParticipantId, StaffId = shift.UserId, ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
            Ratio = shift.Ratio, NightType = shift.NightType, Status = ShiftStatus.Draft,
        };

        var result = await controller.UpdateShift(shift.Id, dto, Ct);   // waits the lock's 10 s, then gives up

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(ShiftStatus.Cancelled, (await kit.Db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id, Ct)).Status);
    }
    [SkippableFact(DisplayName = "Postgres: a claim that waited on the lock refuses when the shift moved to another participant meanwhile")]
    public async Task AClaimThatWaitedOnTheLock_RefusesWhenTheShiftMovedToAnotherParticipant()
    {
        RequirePostgres();
        var (kit, person, shift) = await KitAsync();
        using var _ = kit;
        var other = kit.SeedParticipant(first: "Bea", last: "Moved");
        var tenant = TenantOf(kit.TenantId);
        await using var holder = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var held = await RosterGenerationLock.AcquireAsync(holder, person.Id, Ct, scope: "claim-generate");
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var claim = new ShiftClaimGenerationService(db).GenerateCancellationAsync(shift.Id, "NSDH", Now, Ct);   // read the participant, now waits on the lock
        await Task.Delay(1500, Ct);

        await kit.Db.Shifts.Where(s => s.Id == shift.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ParticipantId, other.Id), Ct);
        await held.DisposeAsync();
        var refused = await Assert.ThrowsAsync<InvalidOperationException>(() => claim);

        Assert.Equal(ShiftClaimGenerationService.ShiftChangedMessage, refused.Message);
        Assert.Equal(0, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == person.Id || c.ParticipantId == other.Id, Ct));
    }
}
