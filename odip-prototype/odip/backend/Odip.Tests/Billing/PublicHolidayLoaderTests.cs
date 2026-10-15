using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Billing;

/// <summary>
/// <see cref="PublicHolidayLoader"/>, the one place public holidays are read for pricing and the roster (the 2026-10-08 review, L3-01 and L3-05): the synced feed and the override table together,
/// every state, whole-day rows only unless the part-day ones are asked for (the plan quote), and the state matched in memory, in any case.
/// </summary>
public class PublicHolidayLoaderTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static OdipDbContext CreateDb() => TestDb.Create();

    private static void Feed(OdipDbContext db, DateOnly date, string? state, string name) =>
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = date, State = state, Name = name });

    private static void Override(OdipDbContext db, DateOnly date, string? state, string name, TimeOnly? from = null, TimeOnly? to = null) =>
        db.PublicHolidayOverrides.Add(new PublicHolidayOverride { Id = Guid.NewGuid(), Date = date, State = state, Name = name, StartTime = from, EndTime = to, Source = "NDIS-CODES 5.3" });

    private static readonly DateOnly D1 = new(2026, 12, 24);
    private static readonly DateOnly D2 = new(2026, 12, 25);
    private static readonly DateOnly D3 = new(2026, 12, 26);

    [Fact]
    public async Task ReadsTheFeedAndTheWholeDayOverridesTogether_FeedFirst_ForEveryState()
    {
        await using var db = CreateDb();
        Feed(db, D2, null, "Christmas Day");
        Feed(db, D3, "VIC", "Boxing Day");
        Override(db, D3, "NSW", "Boxing Day");
        await db.SaveChangesAsync();

        var entries = await PublicHolidayLoader.LoadAsync(db, D1, D3, includePartDay: false, Ct);

        Assert.Equal(
            new[] { (D2, (string?)null, "Christmas Day", "Nager.Date feed"), (D3, "VIC", "Boxing Day", "Nager.Date feed"), (D3, "NSW", "Boxing Day", "NDIS-CODES 5.3") },
            entries.Select(e => (e.Date, e.State, e.Name, e.Source)));
    }

    [Fact]
    public async Task LeavesPartDayRowsOutUnlessTheyAreAskedFor()
    {
        await using var db = CreateDb();
        Override(db, D1, "SA", "Christmas Eve (evening)", from: new TimeOnly(19, 0));
        Override(db, D1, "QLD", "Christmas Eve (to midnight)", to: new TimeOnly(23, 59));
        Override(db, D2, "NSW", "Christmas Day");
        await db.SaveChangesAsync();

        var claims = await PublicHolidayLoader.LoadAsync(db, D1, D3, includePartDay: false, Ct);
        var quote = await PublicHolidayLoader.LoadAsync(db, D1, D3, includePartDay: true, Ct);

        Assert.Equal(new[] { "Christmas Day" }, claims.Select(e => e.Name));
        Assert.All(claims, e => Assert.True(e.IsWholeDay));
        Assert.Equal(3, quote.Count);
        Assert.Equal(2, quote.Count(e => !e.IsWholeDay));
    }

    [Fact]
    public async Task ReadsBothEndsOfTheWindowAndNothingBeyond()
    {
        await using var db = CreateDb();
        Feed(db, D1.AddDays(-1), null, "Before");
        Feed(db, D1, null, "First day");
        Feed(db, D3, null, "Last day");
        Feed(db, D3.AddDays(1), null, "After");
        await db.SaveChangesAsync();

        var entries = await PublicHolidayLoader.LoadAsync(db, D1, D3, includePartDay: false, Ct);

        Assert.Equal(new[] { "First day", "Last day" }, entries.Select(e => e.Name));
    }

    [Fact]
    public async Task TheCalendarMatchesTheStateInAnyCaseAndCountsANationalRowForEveryState()
    {
        await using var db = CreateDb();
        Feed(db, D1, "nsw", "Lower case feed row");
        Override(db, D2, " Nsw ", "Padded override row");
        Feed(db, D3, null, "National");
        Feed(db, new DateOnly(2026, 12, 28), "VIC", "Victorian");
        await db.SaveChangesAsync();
        var calendar = PublicHolidayLoader.WholeDayCalendarOf(await PublicHolidayLoader.LoadAsync(db, D1, new DateOnly(2026, 12, 31), includePartDay: false, Ct));

        Assert.Equal(new[] { D1, D2, D3 }, calendar.For("NSW").OrderBy(d => d));
        Assert.Equal(new[] { D1, D2, D3 }, calendar.For("nsw").OrderBy(d => d));
        Assert.Equal(new[] { D3, new DateOnly(2026, 12, 28) }, calendar.For("VIC").OrderBy(d => d));
        Assert.Equal(new[] { D3 }, calendar.For("QLD"));
    }

    [Fact]
    public async Task TheRosterGetsOneRefForEachDateOfTheProvidersState_TheFeedsNameFirst_AndBlankMeansVictoria()
    {
        await using var db = CreateDb();
        Feed(db, D1, "NSW", "Feed name");
        Override(db, D1, "NSW", "Override name");
        Override(db, D2, "nsw", "Boxing Day");
        Feed(db, D3, "VIC", "Victorian");
        await db.SaveChangesAsync();
        var entries = await PublicHolidayLoader.LoadAsync(db, D1, D3, includePartDay: false, Ct);

        var nsw = PublicHolidayLoader.RosterRefsFor(entries, "NSW");
        var blank = PublicHolidayLoader.RosterRefsFor(entries, "  ");
        var unset = PublicHolidayLoader.RosterRefsFor(entries, null);

        Assert.Equal(new[] { (D1, "Feed name"), (D2, "Boxing Day") }, nsw.Select(r => (r.Date, r.Name)));
        Assert.Equal(new[] { (D3, "Victorian") }, blank.Select(r => (r.Date, r.Name)));
        Assert.Equal(blank.Select(r => (r.Date, r.Name)), unset.Select(r => (r.Date, r.Name)));
    }

    // ── As the NPGSQL provider translates it (EF InMemory runs any LINQ in memory; ToQueryString only builds SQL, so this needs no database) ──

    [Fact]
    public void TheOverrideQueryTranslatesToTheDateWindowAndWholeDayRowsOnly_WithNoFilterOnTheState()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        using var db = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres").Options, tenant.Object);

        var wholeDay = PublicHolidayLoader.OverridesQuery(db, D1, D3, includePartDay: false).ToQueryString();
        var all = PublicHolidayLoader.OverridesQuery(db, D1, D3, includePartDay: true).ToQueryString();

        Assert.Contains("\"PublicHolidayOverrides\"", wholeDay);
        Assert.Contains("\"Date\" >=", wholeDay);
        Assert.Contains("\"Date\" <=", wholeDay);
        Assert.Contains("\"StartTime\" IS NULL", wholeDay);
        Assert.Contains("\"EndTime\" IS NULL", wholeDay);
        Assert.DoesNotContain("\"State\" =", wholeDay);       // the state is matched in memory, in any case: a database comparison would be exact
        Assert.DoesNotContain("IS NULL", all);                // the quote asks for the part-day rows as well
        Assert.DoesNotContain("\"State\" =", all);
    }

    [Fact]
    public async Task AnEmptyWindowOrAnEmptyDatabaseReadsNothing()
    {
        await using var db = CreateDb();

        Assert.Empty(await PublicHolidayLoader.LoadAsync(db, D1, D3, includePartDay: true, Ct));
        Assert.Empty(PublicHolidayLoader.WholeDayCalendarOf(Array.Empty<HolidayEntry>()).For("NSW"));
    }
}
