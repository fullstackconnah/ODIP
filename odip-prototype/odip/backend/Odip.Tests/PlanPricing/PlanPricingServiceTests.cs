using Odip.Domain.Billing.Pricing;
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
}
