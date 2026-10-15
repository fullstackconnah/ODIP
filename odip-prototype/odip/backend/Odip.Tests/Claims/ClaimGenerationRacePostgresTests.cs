using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
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
/// Generating a claim checks "no active claim for this trip" (for shifts, "no line references this shift") and saves afterwards. Two requests at the same moment both passed the check
/// and made two draft claims over the same trip or shifts: the second used to be stopped, by accident, by the same-day claim reference colliding on its unique index. Each generation
/// now takes an advisory lock first (the participant's or trip's), so whoever comes second waits, reads what the first one saved and is refused. Needs a real PostgreSQL (InMemory
/// has no concurrent transactions); skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class ClaimGenerationRacePostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private const int AtOnce = 4;

    private readonly PostgresFixture _pg;
    public ClaimGenerationRacePostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    /// <summary>A kit over a fresh tenant of the fixture's migrated database (provider in NSW, the community access catalogue in).</summary>
    private async Task<LedgerKit> KitAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        return kit;
    }

    /// <summary>Runs <paramref name="generate"/> <see cref="AtOnce"/> times at once, each on a context (and so a connection) of its own, and returns the refusal each one got, or null for the one that made a claim.</summary>
    private async Task<string?[]> AtTheSameMomentAsync(Guid tenantId, Func<Infrastructure.Data.OdipDbContext, Task> generate)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return await Task.WhenAll(Enumerable.Range(0, AtOnce).Select(async _ =>
        {
            await using var db = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
            try { await generate(db); return null; }
            catch (InvalidOperationException refused) { return refused.Message; }
        }));
    }

    [SkippableFact(DisplayName = "Postgres: two trip claims generated at once make one claim")]
    public async Task TwoTripClaimsAtOnce_MakeOneClaim()
    {
        RequirePostgres();
        using var kit = await KitAsync();
        var person = kit.SeedParticipant();
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        kit.SeedBooking(trip, person, BookingStatus.Confirmed);

        var refusals = await AtTheSameMomentAsync(kit.TenantId, db => new ClaimGenerationService(db).GenerateDraftClaimAsync(trip.Id, null, Ct));

        Assert.Equal(AtOnce - 1, refusals.Count(r => r == "An active claim already exists for this trip."));
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(c => c.TripInstanceId == trip.Id, Ct));
    }

    [SkippableFact(DisplayName = "Postgres: two shift claims generated at once make one claim, and each shift is on it once")]
    public async Task TwoShiftClaimsAtOnce_MakeOneClaim_AndEachShiftIsClaimedOnce()
    {
        RequirePostgres();
        using var kit = await KitAsync();
        var person = kit.SeedParticipant();
        var shifts = new[] { kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed), kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed) };

        var refusals = await AtTheSameMomentAsync(kit.TenantId, db => new ShiftClaimGenerationService(db).GenerateAsync(person.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 14), Ct));

        Assert.Equal(AtOnce - 1, refusals.Count(r => r == "No completed, unclaimed shifts found in this date range."));
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == person.Id, Ct));
        foreach (var shift in shifts) Assert.Equal(1, await kit.Db.ClaimLineItems.CountAsync(l => l.ShiftId == shift.Id, Ct));
    }

    [SkippableFact(DisplayName = "Postgres: a claim generation that cannot get the trip's lock is answered 409, not 400")]
    public async Task AGenerationThatWaitsOutTheLock_IsAnswered409()
    {
        RequirePostgres();
        using var kit = await KitAsync();
        var person = kit.SeedParticipant();
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        kit.SeedBooking(trip, person, BookingStatus.Confirmed);
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(kit.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        await using var holder = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        await using var held = await RosterGenerationLock.AcquireAsync(holder, trip.Id, Ct, scope: "claim-generate");   // another generation of the same trip, still running
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString!, tenant.Object);
        var controller = new ClaimsController(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), kit.Ledger, tenant.Object);

        var result = await controller.GenerateClaim(trip.Id, null, Ct);   // waits the lock's 10 s, then gives up

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(0, await kit.Db.TripClaims.CountAsync(c => c.TripInstanceId == trip.Id, Ct));
    }
}
