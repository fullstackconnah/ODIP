using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The booking/claim double count against a real PostgreSQL, driven by the real <see cref="ClaimGenerationService"/>. <see cref="BudgetLedgerClaimReplacesBookingTests"/> proves the
/// rule on EF InMemory, which evaluates LINQ in memory: it cannot show that <c>BookingsQuery</c>'s correlated <c>NOT EXISTS</c> over <c>ClaimLineItems</c> translates to SQL, returns the
/// same rows, and leaves a booking standing when the claim over it is rejected or cancelled - nor that a line reached through <c>ParticipantBooking</c> comes back off
/// <c>numeric(18,2)</c> at the cent. Nothing here hand-inserts a claim: every claim comes out of the generator, so these fail the moment the persisted rows stop matching what
/// generation produces.
///
/// The same builders and the same fixed clock as the InMemory class (<see cref="LedgerKit.Today"/> is Sunday 4 Oct 2026, so one 8-hour NSW community-access day is
/// 8 x $108 = $864), over scratch databases of their own. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class BudgetLedgerGeneratedTripPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private readonly PostgresFixture _pg;
    public BudgetLedgerGeneratedTripPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    /// <summary>The fixture's own migrated scratch database and a kit over a fresh tenant of it (its provider in NSW, the community access catalogue in). Given a database's
    /// connection string, the tenant is put on that same server state instead - which is how the two-organisation case gets one server and two tenants.</summary>
    private async Task<(LedgerKit Kit, string ConnectionString)> SetUpAsync(string? connectionString = null)
    {
        var cs = connectionString ?? _pg.ConnectionString;      // the fixture's own migrated scratch database; each test works on its own rows
        var (db, tenantId) = await _pg.NewTenantContextAsync(cs);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        return (kit, cs);
    }

    private static PoolSpec Quarters(decimal each = 100000m) => Core(PlanType.PlanManaged, Q(1, each), Q(2, each), Q(3, each), Q(4, each));

    /// <summary>A participant, their plan, and a completed one-day trip starting on <see cref="LedgerKit.Today"/> that they hold a confirmed booking for.</summary>
    private static (Participant Person, TripInstance Trip, ParticipantBooking Booking) ArrangeTripStartingToday(LedgerKit kit, string last = "Brown")
    {
        var person = kit.SeedParticipant(last: last);
        kit.SeedPlan(person, Quarters());
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        var booking = kit.SeedBooking(trip, person, BookingStatus.Confirmed);
        return (person, trip, booking);
    }

    private static async Task<LedgerPeriodDto> CurrentPeriodAsync(LedgerKit kit, Participant person) =>
        (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!.Pools.Single().Periods.Single(p => p.IsCurrent);

    /// <summary>The generator over this kit's real context. The kit was wrapped, so it carries no tenant of its own and the generator's own budget block is left out; the money
    /// comes off the rows the generator persists and the ledger reads back.</summary>
    private static ClaimGenerationService Generator(LedgerKit kit) => new(kit.Db, kit.Ledger, kit.Tenant);

    /// <summary>The real generator's own claim for the trip, with the single line it persisted for the one booking.</summary>
    private static async Task<ClaimLineItem> GenerateAsync(LedgerKit kit, TripInstance trip, ParticipantBooking booking)
    {
        var claim = await Generator(kit).GenerateDraftClaimAsync(trip.Id, null, Ct);
        Assert.Equal(TripClaimStatus.Draft, claim.Status);
        var line = await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.TripClaimId == claim.Id, Ct);
        Assert.Equal(booking.Id, line.ParticipantBookingId);
        Assert.True(line.TotalAmount > 0m, "the generator must price the trip, else there is nothing to count");
        Assert.Equal(line.TotalAmount, claim.TotalAmount);
        return line;
    }

    // ── R1: the double count itself ──

    [SkippableFact(DisplayName = "PR193 (PostgreSQL): a generated claim for a trip starting today is counted once, not also as booked ahead")]
    public async Task GeneratedClaimForTripStartingToday_ReplacesTheBookingOnPostgres()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var (person, trip, booking) = ArrangeTripStartingToday(kit);

        // BEFORE: the undelivered booking is "booked ahead", and nothing is pending or used.
        var before = await CurrentPeriodAsync(kit, person);
        Assert.Equal(864m, before.BookedAhead);                     // the figure BudgetLedgerClaimReplacesBookingTests reads off its InMemory run
        Assert.Equal(0m, before.Pending);
        Assert.Equal(0m, before.Used);
        Assert.Contains(before.Rows, r => r.Id == booking.Id);

        // GENERATE: the real service, over the real database.
        var line = await GenerateAsync(kit, trip, booking);

        // AFTER: the persisted ledger read.
        var after = await CurrentPeriodAsync(kit, person);

        Console.WriteLine(
            $"PR193-PG-GENERATED provider={kit.Db.Database.ProviderName} today={Today} bookingDollars={before.BookedAhead} claimDollars={line.TotalAmount} " +
            $"pendingAfter={after.Pending} usedAfter={after.Used} bookedAheadAfter={after.BookedAhead} forecastAfter={after.Forecast} rows={after.RowCount}");

        // The claim's counted line takes the booking's place: the same dollars once, in the claim's own bucket.
        Assert.Equal(0m, after.BookedAhead);
        Assert.Equal(line.TotalAmount, after.Pending);
        Assert.Equal(line.TotalAmount, after.Used);
        Assert.Equal(line.TotalAmount, after.Forecast);
        Assert.Equal(1, after.RowCount);
        Assert.DoesNotContain(after.Rows, r => r.Id == booking.Id);
        Assert.Contains(after.Rows, r => r.Id == line.Id);

        // The claim's own budget block (the claim detail page) counts the same dollars once too.
        var forClaim = (await kit.Ledger.ForClaimAsync(kit.TenantId, line.TripClaimId, Ct))!.Participants.Single().Rows.Single();
        Assert.Equal(line.TotalAmount, forClaim.ThisClaim);
        Assert.Equal(after.Used, forClaim.UsedAfter);
    }

    // ── R2: an ignored claim, or an ignored line, replaces nothing ──

    [SkippableFact(DisplayName = "PR193 (PostgreSQL): a cancelled claim leaves its booking booked ahead again")]
    public async Task ACancelledClaimHeader_LeavesTheBookingCountedAsBookedAhead()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var (person, trip, booking) = ArrangeTripStartingToday(kit);
        var bookingDollars = (await CurrentPeriodAsync(kit, person)).BookedAhead;
        var line = await GenerateAsync(kit, trip, booking);

        var claim = await kit.Db.TripClaims.SingleAsync(c => c.Id == line.TripClaimId, Ct);
        claim.Status = TripClaimStatus.Cancelled;
        await kit.Db.SaveChangesAsync(Ct);

        var after = await CurrentPeriodAsync(kit, person);
        Assert.Equal(bookingDollars, after.BookedAhead);
        Assert.Equal(0m, after.Pending);
        Assert.Equal(0m, after.Claimed);
        Assert.Equal(0m, after.Used);
        Assert.Contains(after.Rows, r => r.Id == booking.Id);
    }

    [SkippableFact(DisplayName = "PR193 (PostgreSQL): a rejected claim header leaves its booking booked ahead again")]
    public async Task ARejectedClaimHeader_LeavesTheBookingCountedAsBookedAhead()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var (person, trip, booking) = ArrangeTripStartingToday(kit);
        var bookingDollars = (await CurrentPeriodAsync(kit, person)).BookedAhead;
        var line = await GenerateAsync(kit, trip, booking);

        var claim = await kit.Db.TripClaims.SingleAsync(c => c.Id == line.TripClaimId, Ct);
        claim.Status = TripClaimStatus.Rejected;
        await kit.Db.SaveChangesAsync(Ct);

        var after = await CurrentPeriodAsync(kit, person);
        Assert.Equal(bookingDollars, after.BookedAhead);
        Assert.Equal(0m, after.Pending);
        Assert.Equal(0m, after.Claimed);
        Assert.Equal(0m, after.Used);
        Assert.Contains(after.Rows, r => r.Id == booking.Id);
    }

    [SkippableFact(DisplayName = "PR193 (PostgreSQL): a rejected claim line leaves its booking booked ahead again")]
    public async Task ARejectedRelevantLine_LeavesTheBookingCountedAsBookedAhead()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var (person, trip, booking) = ArrangeTripStartingToday(kit);
        var bookingDollars = (await CurrentPeriodAsync(kit, person)).BookedAhead;
        var lineId = (await GenerateAsync(kit, trip, booking)).Id;

        var line = await kit.Db.ClaimLineItems.SingleAsync(l => l.Id == lineId, Ct);
        line.Status = ClaimLineItemStatus.Rejected;
        await kit.Db.SaveChangesAsync(Ct);

        var after = await CurrentPeriodAsync(kit, person);
        Assert.Equal(bookingDollars, after.BookedAhead);
        Assert.Equal(0m, after.Pending);
        Assert.Equal(0m, after.Claimed);
        Assert.Equal(0m, after.Used);
        Assert.Contains(after.Rows, r => r.Id == booking.Id);
        Assert.DoesNotContain(after.Rows, r => r.Id == line.Id);
    }

    // ── R3: another organisation ──

    [SkippableFact(DisplayName = "PR193 (PostgreSQL): another tenant's generated claim reaches nothing here and suppresses nothing here")]
    public async Task AnotherTenantsGeneratedClaim_ReachesNothingAndSuppressesNothing()
    {
        RequirePostgres();
        var (mine, cs) = await SetUpAsync();
        using var _m = mine;
        var (person, trip, booking) = ArrangeTripStartingToday(mine, last: "Mine");

        // A second organisation on the same server, with its own participant, trip, booking and - generated - claim.
        var (theirs, _) = await SetUpAsync(cs);
        using var _t = theirs;
        var (other, theirTrip, theirBooking) = ArrangeTripStartingToday(theirs, last: "Theirs");
        await GenerateAsync(theirs, theirTrip, theirBooking);
        var theirClaimId = await theirs.Db.ClaimLineItems.AsNoTracking().Where(l => l.ParticipantBookingId == theirBooking.Id).Select(l => (Guid?)l.TripClaimId).SingleAsync(Ct);

        // That claim did take THEIR booking over, so the generator really did move one - the foreign claim exists and works.
        var theirPeriod = await CurrentPeriodAsync(theirs, other);
        Assert.Equal(0m, theirPeriod.BookedAhead);
        Assert.True(theirPeriod.Pending > 0m);

        // From here it is invisible: this booking is still this participant's own booked-ahead estimate.
        var after = await CurrentPeriodAsync(mine, person);
        Assert.Equal(864m, after.BookedAhead);
        Assert.Equal(0m, after.Pending);
        Assert.Equal(0m, after.Used);
        Assert.Contains(after.Rows, r => r.Id == booking.Id);

        // The real service boundary: a foreign participant has no ledger here, named alone or in a batch, and a foreign claim shows no figure.
        Assert.Null(await mine.Ledger.GetLedgerAsync(mine.TenantId, other.Id, Ct));
        var asked = await mine.Ledger.ComputeAsync(mine.TenantId, new[] { person.Id, other.Id }, Ct);
        Assert.Equal(new[] { person.Id }, asked.Keys);
        Assert.Null(await mine.Ledger.ForClaimAsync(mine.TenantId, theirClaimId!.Value, Ct));
    }
}
