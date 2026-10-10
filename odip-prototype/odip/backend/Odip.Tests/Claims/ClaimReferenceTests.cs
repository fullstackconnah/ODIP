using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Claims;

/// <summary>
/// ClaimReference is unique (OdipDbContext), and a claim's reference used to be only "TC-{code}-{date}": a second claim for the same participant or trip on the same day
/// gave the same reference and failed on the index with a raw 500. Two shift claims over different date ranges, or a rejected trip claim made again, are both valid, so each claim
/// now carries a piece of its own id. The InMemory facts show the references differ; the PostgreSQL facts (skipped, never failed, without POSTGRES_CONNECTION_STRING) show both
/// claims actually save, which InMemory cannot because it does not enforce unique indexes.
/// </summary>
public class ClaimReferenceTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private readonly PostgresFixture _pg;
    public ClaimReferenceTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static LedgerKit InMemoryKit()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        return kit;
    }

    private async Task<LedgerKit> PostgresKitAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);   // so an InMemory run can never satisfy the PostgreSQL facts
        return kit;
    }

    /// <summary>Two draft shift claims for one participant, over the first and second half of October, generated on the same day.</summary>
    private static async Task<(TripClaim First, TripClaim Second)> GenerateTwoShiftClaimsAsync(LedgerKit kit)
    {
        var person = kit.SeedParticipant();
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        kit.SeedShift(person, new DateOnly(2026, 10, 15), ShiftStatus.Completed);
        var service = new ShiftClaimGenerationService(kit.Db);

        var first = await service.GenerateDraftClaimAsync(person.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 14), Ct);
        var second = await service.GenerateDraftClaimAsync(person.Id, new DateOnly(2026, 10, 15), new DateOnly(2026, 10, 31), Ct);
        return (first, second);
    }

    /// <summary>A trip claim that was rejected, then generated again on the same day (the only way to a second claim for one trip).</summary>
    private static async Task<(TripClaim First, TripClaim Second)> GenerateRejectedThenAgainAsync(LedgerKit kit)
    {
        var person = kit.SeedParticipant();
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        kit.SeedBooking(trip, person, BookingStatus.Confirmed);
        var generator = new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var first = await generator.GenerateDraftClaimAsync(trip.Id, null, Ct);
        first.Status = TripClaimStatus.Rejected;
        await kit.Db.SaveChangesAsync(Ct);
        var second = await generator.GenerateDraftClaimAsync(trip.Id, null, Ct);
        return (first, second);
    }

    [Fact]
    public async Task TwoShiftClaimsMadeTheSameDay_GetDifferentReferences()
    {
        using var kit = InMemoryKit();

        var (first, second) = await GenerateTwoShiftClaimsAsync(kit);

        Assert.NotEqual(first.ClaimReference, second.ClaimReference);
        Assert.All(new[] { first, second }, c => Assert.Matches(@"^TC-4301\d{5}-\d{8}-[0-9A-F]{6}$", c.ClaimReference));
    }

    [Fact]
    public async Task ARejectedTripClaimMadeAgainTheSameDay_GetsADifferentReference()
    {
        using var kit = InMemoryKit();

        var (first, second) = await GenerateRejectedThenAgainAsync(kit);

        Assert.NotEqual(first.ClaimReference, second.ClaimReference);
    }

    [Fact]
    public async Task TheLongestNdisNumber_StillGivesAReferenceInsideTheFiftyCharacterColumn()
    {
        using var kit = InMemoryKit();
        var person = kit.SeedParticipant(ndisNumber: new string('9', 20));   // Participant.NdisNumber is at most 20 characters
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var claim = await new ShiftClaimGenerationService(kit.Db).GenerateDraftClaimAsync(person.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 14), Ct);

        Assert.InRange(claim.ClaimReference.Length, 1, 50);
        Assert.StartsWith("TC-" + new string('9', 20) + "-", claim.ClaimReference);
    }

    [SkippableFact(DisplayName = "Postgres: two shift claims made the same day both save, with different references")]
    public async Task TwoShiftClaimsMadeTheSameDay_BothSaveOnPostgres()
    {
        RequirePostgres();
        using var kit = await PostgresKitAsync();

        var (first, second) = await GenerateTwoShiftClaimsAsync(kit);

        Assert.NotEqual(first.ClaimReference, second.ClaimReference);
        Assert.Equal(2, await kit.Db.TripClaims.CountAsync(c => c.Id == first.Id || c.Id == second.Id, Ct));
    }

    [SkippableFact(DisplayName = "Postgres: a rejected trip claim made again the same day saves, with a different reference")]
    public async Task ARejectedTripClaimMadeAgainTheSameDay_SavesOnPostgres()
    {
        RequirePostgres();
        using var kit = await PostgresKitAsync();

        var (first, second) = await GenerateRejectedThenAgainAsync(kit);

        Assert.NotEqual(first.ClaimReference, second.ClaimReference);
        Assert.Equal(2, await kit.Db.TripClaims.CountAsync(c => c.Id == first.Id || c.Id == second.Id, Ct));
    }
}
