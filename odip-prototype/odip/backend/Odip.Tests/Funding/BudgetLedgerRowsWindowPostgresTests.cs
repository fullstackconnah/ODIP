using System.Data.Common;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Domain.Rostering;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// ONE regression against the UNCHANGED <see cref="BudgetLedgerService.GetRowsAsync"/>, on the single defect this lane owns: the page for one pool period is produced by
/// reading the participant's whole ledger over the plan window (<c>PlanStart .. PlanEnd + MaxPlanDays</c>), so the executed <c>Shifts</c> read is far wider than the
/// period whose rows were asked for. This is expected to FAIL on the base service; it is not a product acceptance claim.
/// </summary>
public class BudgetLedgerRowsWindowPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private readonly PostgresFixture _pg;
    public BudgetLedgerRowsWindowPostgresTests(PostgresFixture pg) => _pg = pg;

    /// <summary>An executed command and the parameters Npgsql actually bound to it.</summary>
    private sealed record CommandCapture(string CommandText, IReadOnlyList<(string Name, string DbType, string? Value)> Parameters);

    /// <summary>The async read path only: the ledger's loaders use <c>ToListAsync</c>, so a synchronous hook would never see them.</summary>
    private sealed class AsyncCommandSpy : DbCommandInterceptor
    {
        public List<CommandCapture> Reads { get; } = new();

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Reads.Add(new CommandCapture(
                command.CommandText,
                command.Parameters.Cast<NpgsqlParameter>()
                    .Select(p => (p.ParameterName.TrimStart('@'), p.DbType.ToString(), p.Value?.ToString())).ToList()));
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    /// <summary>The parameter EF bound for one side of the <c>ServiceDate</c> predicate, or null when that side is not parameterised.</summary>
    private static string? BoundDateName(string commandText, string op)
    {
        var m = Regex.Match(commandText, $@"ServiceDate""\s*{Regex.Escape(op)}\s*@(?<p>\w+)", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups["p"].Value.TrimStart('@') : null;
    }

    /// <summary>The parameter EF bound for one side of the trip <c>StartDate</c> predicate of the booking read, or null when that side is not parameterised.</summary>
    private static string? BoundStartDateName(string commandText, string op)
    {
        var m = Regex.Match(commandText, $@"StartDate""\s*{Regex.Escape(op)}\s*@(?<p>\w+)", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups["p"].Value.TrimStart('@') : null;
    }

    private static DateOnly AsDate(string name, string? value)
    {
        if (value is not null && DateOnly.TryParse(value, out var only)) return only;
        if (value is not null && DateTime.TryParse(value, out var at)) return DateOnly.FromDateTime(at);
        throw new Xunit.Sdk.XunitException($"Shifts parameter {name} is not a date value (got '{value ?? "<null>"}').");
    }

    [SkippableFact]
    public async Task GetRowsPageForOnePeriod_ReadsShiftsOnlyInsideThatPeriodsDateBounds()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

        // ── control: a real Npgsql provider over a scratch database this fixture owns ──
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs))
        {
            await migrate.Database.MigrateAsync();
        }

        var tenantId = Guid.NewGuid();
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.Add(new Tenant { Id = tenantId, Name = "Rows Window Tenant", EmailDomain = $"{tenantId:N}.example.com" });
            await admin.SaveChangesAsync();
        }

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var spy = new AsyncCommandSpy();
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(spy).Options;
        await using var db = new OdipDbContext(options, tenant.Object);
        Skip.IfNot((db.Database.ProviderName ?? string.Empty).Contains("Npgsql", StringComparison.OrdinalIgnoreCase), "Provider is not Npgsql.");

        // ── control: real clock, dates and plan semantics through the real kit ──
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var plan = kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 1234.56m), Q(2, 1234.56m), Q(3, 1234.56m), Q(4, 1234.56m)));
        var pool = plan.Pools.First();
        var period = pool.Periods.ElementAt(1);                          // Q2: 2026-10-01 .. 2026-12-31
        kit.SeedShift(person, D(2026, 10, 15), ShiftStatus.Published);  // a row of the requested period

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 10, Ct);

        // ── control: the page returned is the requested period's, and has rows in it ──
        Assert.NotNull(page);
        Assert.True(page!.Total >= 1, $"Expected the seeded shift to be a row of the period, but Total was {page.Total}.");
        Assert.NotEmpty(page.Rows);

        // ── control: the async read path was intercepted, nonempty, and carried a Shifts read ──
        Assert.NotEmpty(spy.Reads);
        var shifts = spy.Reads.Where(r => r.CommandText.Contains("\"Shifts\"", StringComparison.Ordinal)).ToList();
        Assert.True(shifts.Count > 0, "No executed Shifts command was intercepted on the async read path.");

        var shift = shifts[shifts.Count - 1];
        var lowerName = BoundDateName(shift.CommandText, ">=");
        var upperName = BoundDateName(shift.CommandText, "<=");
        Assert.NotNull(lowerName);
        Assert.NotNull(upperName);
        var lower = AsDate(lowerName!, shift.Parameters.First(p => p.Name == lowerName!).Value);
        var upper = AsDate(upperName!, shift.Parameters.First(p => p.Name == upperName!).Value);

        var evidence =
            $"GetRowsAsync(pool={pool.Id}, period={period.Id}) period bounds [{period.PeriodStart}, {period.PeriodEnd}]\n" +
            $"executed Shifts ServiceDate >= {lowerName} = {lower}   and   ServiceDate <= {upperName} = {upper}\n\n" +
            $"{shift.CommandText}\n\nparameters:\n" +
            string.Join(Environment.NewLine, shift.Parameters.Select(p => $"  {p.Name} {p.DbType} = {p.Value}")) + Environment.NewLine;

        var evidenceDir = Environment.GetEnvironmentVariable("ODIP_ROWS_RED_EVIDENCE");
        if (!string.IsNullOrWhiteSpace(evidenceDir))
        {
            Directory.CreateDirectory(evidenceDir!);
            await File.WriteAllTextAsync(Path.Combine(evidenceDir!, "sql-evidence.txt"), evidence);
        }

        // ── THE ASSERTION: the executed Shifts read must stay inside the requested period's date bounds ──
        Assert.True(lower >= period.PeriodStart && upper <= period.PeriodEnd,
            $"GetRowsAsync for period {period.Id} ({period.PeriodStart}..{period.PeriodEnd}) read shifts over [{lower}, {upper}] - outside that period's date bounds.{Environment.NewLine}{Environment.NewLine}{evidence}");
    }

    /// <summary>
    /// A trip booking is a row of the period its trip STARTS in, so a page for one period must read only the bookings that could start inside it. This is the read scope
    /// itself, off the executed SQL rather than off the amounts, because an earlier period's booking is invisible in the amounts - the calculator drops it from this
    /// period either way - while it still costs the page real work and, through the range the page reads its pricing resources over, real money.
    ///
    /// On the defective draft this page for Q3 read bookings from TODAY, so its booking read started months before Q3 does and carried the whole rest of the plan with it.
    /// </summary>
    [SkippableFact]
    public async Task GetRowsPageForOneFuturePeriod_ReadsBookingsOnlyFromInsideThatPeriod()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

        // ── control: a real Npgsql provider over a scratch database this fixture owns ──
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs))
        {
            await migrate.Database.MigrateAsync();
        }

        var tenantId = Guid.NewGuid();
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.Add(new Tenant { Id = tenantId, Name = "Rows Booking Window Tenant", EmailDomain = $"{tenantId:N}.example.com" });
            await admin.SaveChangesAsync();
        }

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var spy = new AsyncCommandSpy();
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(spy).Options;
        await using var db = new OdipDbContext(options, tenant.Object);
        Skip.IfNot((db.Database.ProviderName ?? string.Empty).Contains("Npgsql", StringComparison.OrdinalIgnoreCase), "Provider is not Npgsql.");

        // ── control: real clock, dates and plan semantics through the real kit ──
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var plan = kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 1234.56m), Q(2, 1234.56m), Q(3, 1234.56m), Q(4, 1234.56m)));
        var pool = plan.Pools.First();
        var periods = pool.Periods.OrderBy(p => p.Position).ToList();
        var period = periods[2];                               // Q3: 2027-01-01 .. 2027-03-31, entirely after today
        Assert.True(period.PeriodStart > LedgerKit.Today, $"Period {period.Id} was expected to lie entirely after today ({LedgerKit.Today}).");

        // A booking of an earlier period, and one of the requested period, so both sides of the predicate are exercised against real data.
        kit.SeedBooking(kit.SeedTrip(D(2026, 11, 20), 2), person, BookingStatus.Confirmed);
        kit.SeedBooking(kit.SeedTrip(D(2027, 2, 2), 2), person, BookingStatus.Confirmed);

        var page = await kit.Ledger.GetRowsAsync(tenantId, person.Id, pool.Id, period.Id, 0, 10, Ct);

        // ── control: the async read path was intercepted and carried a booking read ──
        Assert.NotNull(page);
        Assert.NotEmpty(spy.Reads);
        var bookings = spy.Reads.Where(r => r.CommandText.Contains("\"ParticipantBookings\"", StringComparison.Ordinal)).ToList();
        Assert.True(bookings.Count > 0, "No executed ParticipantBookings command was intercepted on the async read path.");

        var booking = bookings[bookings.Count - 1];
        var lowerName = BoundStartDateName(booking.CommandText, ">=");
        var upperName = BoundStartDateName(booking.CommandText, "<=");
        Assert.NotNull(lowerName);
        Assert.NotNull(upperName);
        var lower = AsDate(lowerName!, booking.Parameters.First(p => p.Name == lowerName!).Value);
        var upper = AsDate(upperName!, booking.Parameters.First(p => p.Name == upperName!).Value);

        var evidence =
            $"GetRowsAsync(pool={pool.Id}, period={period.Id}) period bounds [{period.PeriodStart}, {period.PeriodEnd}], today {LedgerKit.Today}\n" +
            $"executed booking read TripInstances.StartDate >= {lowerName} = {lower}   and   StartDate <= {upperName} = {upper}\n\n" +
            $"{booking.CommandText}\n\nparameters:\n" +
            string.Join(Environment.NewLine, booking.Parameters.Select(p => $"  {p.Name} {p.DbType} = {p.Value}")) + Environment.NewLine;

        var evidenceDir = Environment.GetEnvironmentVariable("ODIP_ROWS_RED_EVIDENCE");
        if (!string.IsNullOrWhiteSpace(evidenceDir))
        {
            Directory.CreateDirectory(evidenceDir!);
            await File.WriteAllTextAsync(Path.Combine(evidenceDir!, "sql-evidence-bookings.txt"), evidence);
        }

        // ── THE ASSERTION: a booking read for one period must not reach before that period's own start ──
        // Today is still a floor (a trip that has already left is booked ahead no more), but the period is too: the requested-period/plan intersection, never the plan's.
        Assert.True(lower >= period.PeriodStart,
            $"GetRowsAsync for period {period.Id} ({period.PeriodStart}..{period.PeriodEnd}) read bookings from {lower} - earlier than that period begins.{Environment.NewLine}{Environment.NewLine}{evidence}");
        Assert.True(upper <= period.PeriodEnd,
            $"GetRowsAsync for period {period.Id} ({period.PeriodStart}..{period.PeriodEnd}) read bookings up to {upper} - later than that period ends.{Environment.NewLine}{Environment.NewLine}{evidence}");
    }
}
