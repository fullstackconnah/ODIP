using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The service that loads what the engine needs (settings, the catalogue rows that can price the period, the holidays), run over a real catalogue in an
/// in-memory database. The engine tests hand the pure engine the whole catalogue, so only a test through the service can show what the service leaves out.
/// </summary>
public class PlanPricingServiceTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    // ── Review M2: the catalogue is loaded to the day after the period ────────────

    [Fact]
    public async Task An_occurrence_on_the_last_day_that_runs_into_the_next_days_price_change_is_priced_from_the_row_that_starts_then()
    {
        // The agreement ends on Monday 30 November 2026. The Monday 22:00 to Tuesday 02:00 support has a Tuesday part on 1 December, when a December price set starts
        // (the July rows end on 30 November). A service that loads rows only to the period's last day finds nothing valid for that part.
        await using var db = await DecemberDatabaseAsync(code => code.StartsWith("01_0", StringComparison.Ordinal) && code.Contains("_0107_", StringComparison.Ordinal));
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(2));
        var monday = new DateOnly(2026, 11, 30);

        var quote = await new PlanPricingService(db).QuoteAsync(Tenant, new[] { block }, new DateOnly(2026, 10, 1), monday);

        var last = quote.Lines.Where(l => l.ServiceDate >= monday).ToList();
        Assert.Equal(new[] { ("01_015_0107_1_1", 2m, 81.07m, 162.14m), ("01_002_0107_1_1", 2m, 83.57m, 167.14m) }, last.Select(Row));
        Assert.Equal(new[] { monday, monday.AddDays(1) }, last.Select(l => l.ServiceDate));
        Assert.DoesNotContain(quote.Lines, l => !l.IsPriced);
        Assert.Empty(quote.Issues);
    }

    // ── Review M4: the service says what the holiday calendar covers ──────────────

    [Fact]
    public async Task The_service_reports_the_years_with_no_holiday_rows_for_the_state_and_where_the_overrides_end()
    {
        await using var db = Odip.Tests.Catalogue.CatalogueImportTestSupport.CreateDb();
        await db.Database.EnsureCreatedAsync();   // the seeded overrides run to 25 April 2027
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2027, 10, 4), Name = "Labour Day", State = "NSW" });
        await db.SaveChangesAsync();
        var block = Block("x", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var quote = await new PlanPricingService(db).QuoteAsync(Tenant, new[] { block }, new DateOnly(2027, 7, 1), new DateOnly(2028, 6, 30));

        var calendar = Assert.Single(quote.Notices, n => n.Code == "holiday-calendar-missing");
        Assert.Contains("NSW 2028", calendar.Message);
        Assert.DoesNotContain("NSW 2027", calendar.Message);        // 2027 has a row
        Assert.Contains("2027-04-25", Assert.Single(quote.Notices, n => n.Code == "holiday-overrides-end").Message);
    }

    [Fact]
    public async Task A_national_row_and_a_period_inside_the_overrides_leave_the_service_with_no_holiday_notice()
    {
        await using var db = Odip.Tests.Catalogue.CatalogueImportTestSupport.CreateDb();
        await db.Database.EnsureCreatedAsync();
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 12, 25), Name = "Christmas Day", State = null });
        await db.SaveChangesAsync();
        var block = Block("x", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var quote = await new PlanPricingService(db).QuoteAsync(Tenant, new[] { block }, new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31));

        Assert.DoesNotContain(quote.Notices, n => n.Code is "holiday-calendar-missing" or "holiday-overrides-end");
    }

    [Fact]
    public async Task With_no_override_rows_at_all_the_service_says_there_are_none()
    {
        await using var db = Odip.Tests.Catalogue.CatalogueImportTestSupport.CreateDb();   // not created through the model: no seed
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 12, 25), Name = "Christmas Day", State = null });
        await db.SaveChangesAsync();
        var block = Block("x", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var quote = await new PlanPricingService(db).QuoteAsync(Tenant, new[] { block }, new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31));

        Assert.Contains("no public holiday overrides", Assert.Single(quote.Notices, n => n.Code == "holiday-overrides-end").Message);
    }
}
