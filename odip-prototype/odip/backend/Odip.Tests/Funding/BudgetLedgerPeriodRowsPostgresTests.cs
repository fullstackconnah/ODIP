using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The page of one pool period against a real PostgreSQL server, as the product reads it: the same rows, the same order and the same total the full ledger shows for that period,
/// bounded to that period's dates.
///
/// The full-ledger comparison is the point. A page computed by any other rule - a wider read filtered afterwards, a re-derived total - could agree with the full ledger on a
/// quiet dataset and still be wrong; these tests put rows in neighbouring periods and in the plan outside them, and ask for the rows of one period only.
/// </summary>
public class BudgetLedgerPeriodRowsPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private readonly PostgresFixture _pg;
    public BudgetLedgerPeriodRowsPostgresTests(PostgresFixture pg) => _pg = pg;

    /// <summary>A scratch database this fixture owns, the tenant in it, and a ledger kit bound to them.</summary>
    private async Task<(LedgerKit Kit, Guid TenantId)> ArrangeAsync(string state = "NSW")
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();

        var tenantId = Guid.NewGuid();
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.Add(new Tenant { Id = tenantId, Name = "Period Rows Tenant", EmailDomain = $"{tenantId:N}.example.com" });
            await admin.SaveChangesAsync();
        }

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).Options;
        var kit = LedgerKit.Wrap(new OdipDbContext(options, tenant.Object), tenantId);
        kit.SeedProvider(state);
        kit.EnsureCommunityAccessCatalogue();
        return (kit, tenantId);
    }

    /// <summary>The rows the FULL ledger shows for that period: the canonical answer a page has to match.</summary>
    private static async Task<List<Odip.Application.DTOs.LedgerRowDto>> CanonicalRowsAsync(LedgerKit kit, Guid tenantId, Guid personId, Guid poolId, Guid periodId)
    {
        var dto = await kit.Ledger.GetLedgerAsync(tenantId, personId, Ct);
        var pool = dto!.Pools.FirstOrDefault(p => p.Id == poolId);
        Assert.NotNull(pool);
        return pool!.Periods.First(p => p.Id == periodId).Rows;
    }

    /// <summary>The one plan with four core quarters, a person on it, and its pool and period at <paramref name="periodIndex"/>.</summary>
    private static (FundingPlan Plan, FundingPool Pool, FundingPeriod Period) Core(LedgerKit kit, Participant person, int periodIndex)
    {
        var plan = kit.SeedPlan(person, LedgerKit.Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var pool = plan.Pools.First();
        return (plan, pool, pool.Periods.OrderBy(p => p.Position).ElementAt(periodIndex));
    }

    [SkippableFact]
    public async Task OnePeriodPageIsTheSameRowsTheWholeLedgerShowsForThatPeriod_AndOnlyThatPeriodsRows()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);                                   // Q2: 2026-10-01 .. 2026-12-31

        // Rows inside the period asked for, and rows that must NOT be in the page: Q1, Q3, and one before the plan begins.
        kit.SeedShift(person, D(2026, 10, 15), ShiftStatus.Published);
        kit.SeedShift(person, D(2026, 12, 20), ShiftStatus.Completed);
        kit.SeedShift(person, D(2026, 11, 2), ShiftStatus.Published);
        kit.SeedShift(person, D(2026, 8, 10), ShiftStatus.Published);                    // Q1
        kit.SeedShift(person, D(2027, 2, 10), ShiftStatus.Published);                    // Q3
        kit.SeedShift(person, D(2026, 6, 1), ShiftStatus.Published);                     // before the plan

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 100, Ct);
        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, period.Id);

        Assert.NotNull(page);
        Assert.Equal(canonical.Count, page!.Total);
        Assert.Equal(canonical.Select(r => r.Id), page.Rows.Select(r => r.Id));          // the canonical order, not merely the canonical members
        Assert.Equal(canonical.Select(r => r.Amount), page.Rows.Select(r => r.Amount));
        Assert.All(page.Rows, r => Assert.InRange(r.Date, period.PeriodStart, period.PeriodEnd));
    }

    [SkippableFact]
    public async Task ThePagesOfAPeriodRunOnFromTheWholeLedgerWithoutGapsOrRepeats_AndPastTheEndIsEmpty()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);
        for (var i = 0; i < 30; i++) kit.SeedShift(person, D(2026, 10, 1).AddDays(i), ShiftStatus.Completed);   // thirty identical rows: only the id tells them apart

        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, period.Id);
        var paged = new List<Guid>();
        for (var skip = 0; ; )
        {
            var page = (await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, skip, 7, Ct))!;
            Assert.Equal(canonical.Count, page.Total);                                    // every page carries the period's true total
            if (page.Rows.Count == 0) break;
            paged.AddRange(page.Rows.Select(r => r.Id));
            skip += page.Rows.Count;
        }

        Assert.Equal(30, canonical.Count);
        Assert.Equal(canonical.Select(r => r.Id), paged);
        Assert.Equal(30, paged.Distinct().Count());

        var past = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 30, 7, Ct);   // one page past the end
        Assert.NotNull(past);
        Assert.Empty(past!.Rows);
        Assert.Equal(30, past.Total);                                                     // and still the period's total, not zero
    }

    [SkippableFact]
    public async Task ANegativeSkipStartsAtTheFirstRow_AndTakeIsClampedToTheAllowedRange()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);
        for (var i = 0; i < 5; i++) kit.SeedShift(person, D(2026, 10, 1).AddDays(i), ShiftStatus.Published);

        var first = (await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 100, Ct))!;
        var negative = (await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, -25, 100, Ct))!;
        Assert.Equal(0, negative.Skip);                                                   // normalises to zero...
        Assert.Equal(first.Rows.Select(r => r.Id), negative.Rows.Select(r => r.Id));      // ...so the first page comes back whole

        var none = (await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 0, Ct))!;
        Assert.NotEmpty(none.Rows);                                                       // take=0 clamps up to 1, it does not return nothing

        // Past the cap and all of it INSIDE the period asked for: dates are wrapped round the period's own length, so the fixture really does outnumber MaxRowsPerPage.
        var span = period.PeriodEnd.DayNumber - period.PeriodStart.DayNumber;
        for (var i = 0; i < BudgetLedgerService.MaxRowsPerPage + 20; i++) kit.SeedShift(person, period.PeriodStart.AddDays(i % (span + 1)), ShiftStatus.Published);
        var capped = (await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 5000, Ct))!;
        Assert.Equal(BudgetLedgerService.MaxRowsPerPage, capped.Rows.Count);              // take clamps down to the cap...
        Assert.True(capped.Total > capped.Rows.Count, $"The fixture seeded only {capped.Total} rows in the period, so the clamp is untested.");
        Assert.Equal(0, capped.Skip);
    }

    [SkippableFact]
    public async Task AnUnknownParticipantPoolOrPeriodIsNotFound_AndAnotherOrganisationStaysNotFound()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);
        kit.SeedShift(person, D(2026, 10, 15), ShiftStatus.Published);

        var here = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 10, Ct);
        Assert.NotNull(here);

        Assert.Null(await kit.Ledger.GetRowsAsync(tenantId, Guid.NewGuid(), pool.Id, period.Id, 0, 10, Ct));            // no such participant
        Assert.Null(await kit.Ledger.GetRowsAsync(tenantId, person.Id, Guid.NewGuid(), period.Id, 0, 10, Ct));            // no such pool
        Assert.Null(await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, Guid.NewGuid(), 0, 10, Ct));            // no such period
        var sibling = pool.Periods.First(p => p.Position != period.Position);
        var siblingPage = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, sibling.Id, 0, 10, Ct);   // another period of the SAME pool is found...
        Assert.NotNull(siblingPage);
        Assert.Empty(siblingPage!.Rows);                                                                  // ...and empty, because the shift is not in it

        // The isolation case that matters: a real participant with a real plan, pool and period, asked for under a tenant that is not theirs.
        var otherTenantId = Guid.NewGuid();
        var foreign = await kit.Ledger.GetRowsAsync(otherTenantId, person.Id, pool.Id, period.Id, 0, 10, Ct);
        Assert.Null(foreign);
        Assert.NotEqual(tenantId, otherTenantId);
    }

    [SkippableFact]
    public async Task ATripStartingInsideThePeriodAndEndingAfterItIsStillPricedOverItsWholeDays()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);                                   // Q2 ends 2026-12-31

        // A trip that starts on the LAST day of the period and runs four days into the next one. Its booking belongs to the period; its pricing does not.
        var trip = kit.SeedTrip(D(2026, 12, 31), 4, activeHours: 8m);
        var booking = kit.SeedBooking(trip, person, BookingStatus.Confirmed);
        // A public holiday on the first day of 2027, after the period: it changes what the trip is worth.
        kit.SeedHoliday(D(2027, 1, 1), "NSW");

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 100, Ct);
        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, period.Id);

        Assert.False(string.IsNullOrWhiteSpace(person.NdisNumber), "This case needs a participant with an NDIS number: only those bookings are priced.");
        var bookingRow = Assert.Single(page!.Rows.Where(r => r.Id == booking.Id));
        Assert.Equal(period.PeriodEnd, bookingRow.Date);                                // counted in the period its trip starts in
        Assert.True(bookingRow.Amount > 0m, $"The booking that starts in the period was priced at {bookingRow.Amount}: its pricing resources were bounded to the period and truncated.");
        Assert.Equal(canonical.Single(r => r.Id == bookingRow.Id).Amount, bookingRow.Amount);   // and it is priced exactly as the whole ledger prices it
        Assert.Equal(canonical.Count, page.Total);
    }

    [SkippableFact]
    public async Task ABookingAllocatedToAnotherPeriodIsNotInThisPeriodsPage()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, _) = Core(kit, person, 1);
        var periods = pool.Periods.OrderBy(p => p.Position).ToList();

        var insideBooking = kit.SeedBooking(kit.SeedTrip(D(2026, 11, 2), 2), person, BookingStatus.Confirmed);
        var laterBooking = kit.SeedBooking(kit.SeedTrip(D(2027, 2, 2), 2), person, BookingStatus.Confirmed);

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, periods[1].Id, 0, 100, Ct);
        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, periods[1].Id);

        Assert.Contains(page!.Rows, r => r.Id == insideBooking.Id);
        Assert.DoesNotContain(page.Rows, r => r.Id == laterBooking.Id);
        Assert.Equal(canonical.Select(r => r.Id), page.Rows.Select(r => r.Id));
    }

    /// <summary>
    /// A future period's page reads that period's own bookings and prices from that period's own dates. The period here begins months after today and holds one shift, on a
    /// public holiday; the plan's only booking belongs to the period before it and ends long before this period even starts.
    ///
    /// On the defective draft the booking read starts at today rather than at the period, so it pulls that earlier booking in, and the booking's end drags the range the
    /// page reads its holidays over back with it - to a month before the period begins, which then reaches backwards to before the period. The shift silently loses its
    /// holiday rate, and the period's rows stop matching the canonical ledger for that same record.
    /// </summary>
    [SkippableFact]
    public async Task AFuturePeriodsPageIsPricedFromItsOwnDates_NotFromAnEarlierPeriodsBooking()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, _) = Core(kit, person, 0);
        var periods = pool.Periods.OrderBy(p => p.Position).ToList();
        var future = periods[2];                                                       // Q3: 2027-01-01 .. 2027-03-31, entirely after today

        // The plan's only booking: Q2's, and it ends 2026-11-21, months before Q3 begins.
        var earlierBooking = kit.SeedBooking(kit.SeedTrip(D(2026, 11, 20), 2), person, BookingStatus.Confirmed);

        // Two shifts in Q3, one of them on a public holiday, both nine to five.
        var holiday = D(2027, 3, 1);                                    // a Monday: an ordinary weekday unless the calendar reaches the holiday
        var onHoliday = kit.SeedShift(person, holiday, ShiftStatus.Published);
        var ordinary = kit.SeedShift(person, D(2027, 3, 2), ShiftStatus.Published);
        kit.SeedHoliday(holiday);

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, future.Id, 0, 100, Ct);
        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, future.Id);

        // What the catalogue says these two shifts are worth: the holiday rate for one, the weekday rate for the other, over the same eight hours.
        var holidayRate = kit.Item(ClaimDayType.PublicHoliday).PriceLimit_NSW;
        var weekdayRate = kit.Item(ClaimDayType.Weekday).PriceLimit_NSW;
        Assert.True(holidayRate > weekdayRate, $"The seeded catalogue cannot tell a holiday shift from an ordinary one ({holidayRate} vs {weekdayRate}).");

        var holidayRow = Assert.Single(page!.Rows.Where(r => r.Id == onHoliday.Id));
        var ordinaryRow = Assert.Single(page.Rows.Where(r => r.Id == ordinary.Id));

        // Priced as the whole ledger prices those same records - and as the catalogue says, not as the unrelated earlier booking's dates imply.
        Assert.Equal(canonical.Single(r => r.Id == holidayRow.Id).Amount, holidayRow.Amount);
        Assert.Equal(canonical.Single(r => r.Id == ordinaryRow.Id).Amount, ordinaryRow.Amount);
        Assert.Equal(8m * holidayRate, holidayRow.Amount);
        Assert.Equal(8m * weekdayRate, ordinaryRow.Amount);

        // The earlier period's booking is that period's row, not this one's, and its own page still holds it.
        Assert.DoesNotContain(page.Rows, r => r.Id == earlierBooking.Id);
        var earlier = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, periods[1].Id, 0, 100, Ct);
        Assert.Contains(earlier!.Rows, r => r.Id == earlierBooking.Id);
        Assert.Equal(canonical.Count, page.Total);
    }

    /// <summary>
    /// A period can hold nothing but shifts, and one of them on a public holiday is worth the holiday rate. The holidays a page reads have to reach every date the period
    /// prices, so a period with no booking at all must still read them across its whole span - otherwise the later shift in it falls back to its ordinary weekday rate and
    /// the period's rows disagree with the canonical ledger's for that same record.
    ///
    /// On the defective draft a window with no bookings priced itself to its own start date, which reaches no holiday that anything later in the period falls on.
    /// </summary>
    [SkippableFact]
    public async Task APeriodWithNoBookingsStillPricesItsHolidayShiftAsTheWholeLedgerPricesIt()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);                                  // Q2: 2026-10-01 .. 2026-12-31

        // No booking anywhere on this plan: the period's rows are shifts only.
        var holiday = D(2026, 11, 2);                                    // a Monday
        var onHoliday = kit.SeedShift(person, holiday, ShiftStatus.Published);        // 09:00-17:00, eight hours
        var ordinary = kit.SeedShift(person, D(2026, 11, 3), ShiftStatus.Published);  // the same eight hours, not a holiday
        kit.SeedHoliday(holiday);

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 100, Ct);
        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, period.Id);

        var holidayRate = kit.Item(ClaimDayType.PublicHoliday).PriceLimit_NSW;
        var weekdayRate = kit.Item(ClaimDayType.Weekday).PriceLimit_NSW;
        Assert.True(holidayRate > weekdayRate, $"The seeded catalogue cannot tell a holiday shift from an ordinary one ({holidayRate} vs {weekdayRate}).");

        var holidayRow = Assert.Single(page!.Rows.Where(r => r.Id == onHoliday.Id));
        var ordinaryRow = Assert.Single(page.Rows.Where(r => r.Id == ordinary.Id));

        // The page and the canonical ledger agree on these same records, and the holiday really was priced as one.
        Assert.Equal(canonical.Single(r => r.Id == holidayRow.Id).Amount, holidayRow.Amount);
        Assert.Equal(canonical.Single(r => r.Id == ordinaryRow.Id).Amount, ordinaryRow.Amount);
        Assert.Equal(8m * holidayRate, holidayRow.Amount);
        Assert.Equal(8m * weekdayRate, ordinaryRow.Amount);
        Assert.NotEqual(ordinaryRow.Amount, holidayRow.Amount);
        Assert.Equal(canonical.Count, page.Total);
    }

    /// <summary>
    /// The same defect with a booking in the period: the range the page read its holidays over used to stop at the last booking's end, so a public holiday later in the same
    /// period cost that period's shift its holiday rate. A booking is not what makes the calendar long enough to price a shift - every date the window holds is a date a
    /// shift can fall on and be priced by.
    /// </summary>
    [SkippableFact]
    public async Task AHolidayShiftAfterTheLastBookingInThePeriodIsStillPricedAsTheWholeLedgerPricesIt()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (kit, tenantId) = await ArrangeAsync();
        using var _k = kit;
        var person = kit.SeedParticipant();
        var (_, pool, period) = Core(kit, person, 1);                                  // Q2 ends 2026-12-31

        // One booking that ends 2026-10-21, and a shift on a public holiday a fortnight later, still well inside the period.
        var booking = kit.SeedBooking(kit.SeedTrip(D(2026, 10, 20), 2), person, BookingStatus.Confirmed);
        var holiday = D(2026, 11, 2);
        var onHoliday = kit.SeedShift(person, holiday, ShiftStatus.Published);
        var ordinary = kit.SeedShift(person, D(2026, 11, 3), ShiftStatus.Published);
        kit.SeedHoliday(holiday);

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 100, Ct);
        var canonical = await CanonicalRowsAsync(kit, tenantId, person.Id, pool.Id, period.Id);

        var holidayRate = kit.Item(ClaimDayType.PublicHoliday).PriceLimit_NSW;
        var holidayRow = Assert.Single(page!.Rows.Where(r => r.Id == onHoliday.Id));
        var ordinaryRow = Assert.Single(page.Rows.Where(r => r.Id == ordinary.Id));

        Assert.Equal(canonical.Single(r => r.Id == holidayRow.Id).Amount, holidayRow.Amount);   // priced exactly as the whole ledger prices it
        Assert.Equal(8m * holidayRate, holidayRow.Amount);                                     // the holiday rate, though the booking ends long before the holiday
        Assert.Equal(canonical.Single(r => r.Id == ordinaryRow.Id).Amount, ordinaryRow.Amount);
        Assert.Equal(8m * kit.Item(ClaimDayType.Weekday).PriceLimit_NSW, ordinaryRow.Amount);
        Assert.Equal(canonical.Count, page.Total);

        // The booking itself is untouched by the wider calendar: still priced as the whole ledger prices it, and still a row of this period.
        var bookingRow = Assert.Single(page.Rows.Where(r => r.Id == booking.Id));
        Assert.Equal(canonical.Single(r => r.Id == bookingRow.Id).Amount, bookingRow.Amount);
        Assert.True(bookingRow.Amount > 0m, $"The booking was priced at {bookingRow.Amount}.");
    }
}
