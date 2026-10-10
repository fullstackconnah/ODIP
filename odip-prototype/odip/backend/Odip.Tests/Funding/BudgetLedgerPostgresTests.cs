using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget ledger against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is unset, so these run in CI and not on a machine
/// without a server). EF InMemory cannot show that the ledger's queries translate to SQL and return the same rows, that the joins through shifts and bookings reach a claim line's participant,
/// that numeric(18,2) sums come out to the cent, that another organisation's claims (which have no tenant column) stay out, or that the order of the rows does not depend on the database.
/// The same builders and the same fixed clock as <see cref="BudgetLedgerServiceTests"/>, over a scratch database of their own, so a figure read off a test is the one InMemory gave.
/// </summary>
public class BudgetLedgerPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private readonly PostgresFixture _pg;
    public BudgetLedgerPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    /// <summary>A migrated scratch database and a kit over a tenant of it (its provider in NSW, the community access catalogue in, a plan-managed participant with a plan).</summary>
    private async Task<(LedgerKit Kit, string ConnectionString)> SetUpAsync(string? connectionString = null)
    {
        var cs = connectionString;
        if (cs is null)
        {
            cs = await _pg.CreateDatabaseAsync();
            await using var migrate = PostgresFixture.NewContext(cs);
            await migrate.Database.MigrateAsync();
        }
        var (db, tenantId) = await _pg.NewTenantContextAsync(cs);
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        return (kit, cs);
    }

    private static PoolSpec CoreQuarters(decimal each = 1234.56m, decimal? setAside = null) =>
        Core(PlanType.PlanManaged, Q(1, each, setAside), Q(2, each, setAside), Q(3, each, setAside), Q(4, each, setAside));

    private static PeriodLedger Q2Of(PlanLedger ledger) => ledger.Pools[0].Periods[1];

    [SkippableFact]
    public async Task ClaimLinesReachTheirParticipantThroughShiftsAndBookings_AndTheFiguresAreExactToTheCentOnNumericColumns()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters(1234.56m, 999.99m));

        // Shift-kind claim lines: a submitted one and a paid one (paid less than billed), and a draft.
        var s1 = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        var s2 = kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed);
        var s3 = kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed);
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 490.96m, s1);
        var paid = kit.SeedShiftClaim(person, TripClaimStatus.Paid, 61.37m, s2);
        kit.Db.ClaimLineItems.Single(l => l.TripClaimId == paid.Id).PaidAmount = 50.10m;
        await kit.Db.SaveChangesAsync(Ct);
        kit.SeedShiftClaim(person, TripClaimStatus.Draft, 111.11m, s3);
        // A trip-kind claim line, reached through the booking.
        var trip = kit.SeedTrip(new DateOnly(2026, 9, 28), 6, TripStatus.Completed);
        var booking = kit.SeedBooking(trip, person);
        kit.SeedTripClaim(trip, booking, TripClaimStatus.Approved, 333.33m, new DateOnly(2026, 10, 1));

        var ledger = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id].Ledger!;
        var q2 = Q2Of(ledger);

        Assert.Equal(490.96m + 50.10m + 333.33m, q2.Claimed);
        Assert.Equal(111.11m, q2.Pending);
        Assert.Equal(490.96m + 50.10m + 333.33m + 111.11m, q2.Used);
        Assert.Equal(999.99m + 999.99m, q2.Available);        // the set-aside, and Q1's unused set-aside carried
        Assert.Equal(4, q2.Items.Count);
    }

    [SkippableFact]
    public async Task ShiftsAndBookingsThatAreNotClaimedYetArePricedAndPlacedAsInMemory_CompletedUnclaimedFutureAndTripBookings()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters(100000m));
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);                                    // pending: 8 h x $60
        kit.SeedShiftClaim(person, TripClaimStatus.Draft, 480m, kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));   // a line has taken it: counted once
        kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Published);                                    // past, never resolved: pending and flagged
        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Published);                                    // booked ahead
        kit.SeedShift(person, new DateOnly(2026, 10, 7), ShiftStatus.Cancelled);                                    // nothing
        kit.SeedBooking(kit.SeedTrip(new DateOnly(2026, 10, 20), 3), person);                                       // booked ahead: 3 x 8 h x $60
        kit.SeedBooking(kit.SeedTrip(new DateOnly(2026, 11, 3), 2, TripStatus.Cancelled), person);                  // a cancelled trip: nothing

        var q2 = Q2Of((await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id].Ledger!);

        Assert.Equal(480m + 480m + 480m, q2.Pending);
        Assert.Equal(1, q2.PastUnresolvedCount);
        Assert.Equal(480m + 1440m, q2.BookedAhead);
        Assert.Equal(q2.Used + q2.BookedAhead, q2.Forecast);
    }

    [SkippableFact]
    public async Task AnotherOrganisationsClaimsNeverReachTheLedger_AndItsParticipantIsAbsent()
    {
        RequirePostgres();
        var (a, cs) = await SetUpAsync();
        using var _a = a;
        var (b, _) = await SetUpAsync(cs);
        using var _b = b;
        var mine = a.SeedParticipant(last: "Mine");
        a.SeedPlan(mine, CoreQuarters(100000m));
        a.SeedShiftClaim(mine, TripClaimStatus.Submitted, 100m, a.SeedShift(mine, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        var theirs = b.SeedParticipant(last: "Theirs");
        b.SeedPlan(theirs, CoreQuarters(100000m));
        b.SeedShiftClaim(theirs, TripClaimStatus.Submitted, 9999m, b.SeedShift(theirs, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        var theirTrip = b.SeedTrip(new DateOnly(2026, 10, 20), 3);
        var theirBooking = b.SeedBooking(theirTrip, theirs);
        b.SeedTripClaim(theirTrip, theirBooking, TripClaimStatus.Submitted, 8888m, new DateOnly(2026, 10, 1));

        var asked = await a.Ledger.ComputeAsync(a.TenantId, new[] { mine.Id, theirs.Id }, Ct);

        Assert.Equal(new[] { mine.Id }, asked.Keys);
        var q2 = Q2Of(asked[mine.Id].Ledger!);
        Assert.Equal(100m, q2.Claimed);
        Assert.Single(q2.Items);
        Assert.Null(await a.Ledger.GetLedgerAsync(a.TenantId, theirs.Id, Ct));
        var theirClaim = await b.Db.TripClaims.FirstAsync(c => c.ParticipantId == theirs.Id, Ct);
        Assert.Null(await a.Ledger.ForClaimAsync(a.TenantId, theirClaim.Id, Ct));   // a claim reached by its id alone shows no figure of another organisation
    }

    [SkippableFact]
    public async Task ManyParticipantsAreOneBatch_EveryOneGetsItsOwnFigures()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var ids = new List<Guid>();
        for (var i = 1; i <= 25; i++)
        {
            var person = kit.SeedParticipant(last: $"P{i:00}");
            kit.SeedPlan(person, CoreQuarters(100000m));
            kit.SeedShiftClaim(person, TripClaimStatus.Submitted, i * 10m, kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
            ids.Add(person.Id);
        }

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, ids, Ct);

        Assert.Equal(25, all.Count);
        for (var i = 0; i < 25; i++) Assert.Equal((i + 1) * 10m, Q2Of(all[ids[i]].Ledger!).Claimed);
    }

    [SkippableFact]
    public async Task TheRowsOfAPeriodComeBackInTheSameOrderEveryTime()
    {
        RequirePostgres();
        var (kit, _) = await SetUpAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters(100000m));
        for (var i = 0; i < 30; i++) kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);   // thirty identical rows: only the id tells them apart

        var first = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;
        var second = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;
        var pool = first.Pools[0];
        var period = pool.Periods[1];

        Assert.Equal(30, period.RowCount);
        Assert.Equal(first.Pools[0].Periods[1].Rows.Select(r => r.Id), second.Pools[0].Periods[1].Rows.Select(r => r.Id));   // the same order on every run
        Assert.Equal(30, period.Rows.Select(r => r.Id).Distinct().Count());
    }
}
