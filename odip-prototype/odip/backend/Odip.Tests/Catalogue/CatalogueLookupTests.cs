using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The one date-effective lookup (phase A item 4): (code, service date, zone) gives the single row valid on that date and its price, or a typed
/// failure: none, ambiguous, zone not eligible (or not priced at all). Validity is the row's own dates (EffectiveCatalogueResolver.IsValidOn): an
/// end-dated row is still the right row for the service dates inside its window, whatever its IsActive flag says; only a row that is inactive AND
/// open-ended (withdrawn by hand) is valid on no date.
/// </summary>
public class CatalogueLookupTests
{
    private const string Code = "04_104_0125_6_1";

    private static SupportCatalogueItem Row(DateOnly from, DateOnly? to, decimal? national, decimal? remote = null, decimal? veryRemote = null,
        string code = Code, bool active = true) => new()
    {
        Id = Guid.NewGuid(), ActivityGroupId = Guid.NewGuid(), ItemNumber = code, Description = "Weekday Daytime", Unit = "H",
        EffectiveFrom = from, EffectiveTo = to, IsActive = active, PriceNational = national, PriceRemote = remote, PriceVeryRemote = veryRemote,
        SourceDocument = "support-catalogue.xlsx",
    };

    private static readonly DateOnly Jul1_2025 = new(2025, 7, 1), Jun30_2026 = new(2026, 6, 30), Jul1_2026 = new(2026, 7, 1);

    // ── Finding the row and its price ─────────────────────────────────────────────

    [Fact]
    public void Finds_the_single_row_valid_on_the_service_date_and_its_National_price()
    {
        var row = Row(Jul1_2026, null, 73.58m, 103.01m, 110.37m);

        var result = EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 10, 5), PriceZone.National);

        Assert.True(result.Found);
        Assert.Same(row, result.Item);
        Assert.Equal(73.58m, result.Price);
        Assert.Null(result.Failure);
    }

    [Theory]
    [InlineData(PriceZone.National, 73.58)]
    [InlineData(PriceZone.Remote, 103.01)]
    [InlineData(PriceZone.VeryRemote, 110.37)]
    public void Each_zone_reads_its_own_price(PriceZone zone, double expected)
    {
        var result = EffectiveCatalogueResolver.Find(new[] { Row(Jul1_2026, null, 73.58m, 103.01m, 110.37m) }, Code, new DateOnly(2026, 8, 1), zone);

        Assert.Equal((decimal)expected, result.Price);
    }

    [Fact]
    public void A_row_is_valid_on_its_first_and_its_last_day_and_not_the_day_before_or_after()
    {
        var row = Row(new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), 2178.57m);

        Assert.True(EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 7, 1), PriceZone.National).Found);
        Assert.True(EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2027, 6, 30), PriceZone.National).Found);
        Assert.Equal(CatalogueLookupFailure.NotFound, EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 6, 30), PriceZone.National).Failure);
        Assert.Equal(CatalogueLookupFailure.NotFound, EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2027, 7, 1), PriceZone.National).Failure);
    }

    [Fact]
    public void An_open_ended_row_is_valid_for_every_later_date()
    {
        var row = Row(Jul1_2026, null, 73.58m);

        Assert.True(EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2031, 1, 1), PriceZone.National).Found);
    }

    [Fact]
    public void Across_a_version_change_each_service_date_gets_the_price_of_its_own_year()
    {
        var items = new[]
        {
            Row(Jul1_2025, Jun30_2026, 70.23m, active: false),   // end-dated by the 2026-27 import
            Row(Jul1_2026, null, 73.58m),
        };

        Assert.Equal(70.23m, EffectiveCatalogueResolver.Find(items, Code, Jul1_2025, PriceZone.National).Price);
        Assert.Equal(70.23m, EffectiveCatalogueResolver.Find(items, Code, Jun30_2026, PriceZone.National).Price);
        Assert.Equal(73.58m, EffectiveCatalogueResolver.Find(items, Code, Jul1_2026, PriceZone.National).Price);
    }

    [Fact]
    public void An_inactive_row_is_still_the_right_row_inside_its_window_because_validity_is_the_dates_alone()
    {
        var ended = Row(Jul1_2025, Jun30_2026, 70.23m, active: false);

        var result = EffectiveCatalogueResolver.Find(new[] { ended }, Code, new DateOnly(2026, 3, 1), PriceZone.National);

        Assert.True(result.Found);
        Assert.Equal(70.23m, result.Price);
    }

    [Fact]
    public void A_row_withdrawn_by_hand_inactive_and_open_ended_is_found_on_no_date()
    {
        // An import always end-dates what it deactivates, so an inactive row with no end date can only have been switched off by hand.
        var withdrawn = Row(Jul1_2026, null, 73.58m, active: false);

        Assert.Equal(CatalogueLookupFailure.NotFound, EffectiveCatalogueResolver.Find(new[] { withdrawn }, Code, new DateOnly(2026, 10, 5), PriceZone.National).Failure);
    }

    [Fact]
    public void Codes_are_matched_exactly_the_same_digits_in_another_registration_group_are_another_item()
    {
        var items = new[] { Row(Jul1_2026, null, 103.54m, code: "04_104_0136_6_1"), Row(Jul1_2026, null, 73.58m, code: "04_104_0125_6_1") };

        Assert.Equal(73.58m, EffectiveCatalogueResolver.Find(items, "04_104_0125_6_1", new DateOnly(2026, 8, 1), PriceZone.National).Price);
        Assert.Equal(103.54m, EffectiveCatalogueResolver.Find(items, "04_104_0136_6_1", new DateOnly(2026, 8, 1), PriceZone.National).Price);
        Assert.Equal(CatalogueLookupFailure.NotFound, EffectiveCatalogueResolver.Find(items, "04_104", new DateOnly(2026, 8, 1), PriceZone.National).Failure);
    }

    // ── Typed failures ────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("2026-06-30")]   // the day before it starts
    [InlineData("2020-01-01")]
    public void No_row_valid_on_the_date_is_NotFound(string date)
    {
        var result = EffectiveCatalogueResolver.Find(new[] { Row(Jul1_2026, null, 73.58m) }, Code, DateOnly.Parse(date), PriceZone.National);

        Assert.False(result.Found);
        Assert.Equal(CatalogueLookupFailure.NotFound, result.Failure);
        Assert.Null(result.Item);
        Assert.Null(result.Price);
        Assert.Contains(Code, result.Message);
        Assert.Contains(date, result.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("99_999_9999_9_9")]
    public void An_unknown_or_blank_code_is_NotFound(string code)
    {
        var result = EffectiveCatalogueResolver.Find(new[] { Row(Jul1_2026, null, 73.58m) }, code, new DateOnly(2026, 8, 1), PriceZone.National);

        Assert.Equal(CatalogueLookupFailure.NotFound, result.Failure);
    }

    [Fact]
    public void Two_rows_valid_on_the_same_date_are_Ambiguous_and_name_neither()
    {
        var items = new[] { Row(Jul1_2025, null, 70.23m), Row(Jul1_2026, null, 73.58m) };   // an open-ended older row left behind

        var result = EffectiveCatalogueResolver.Find(items, Code, new DateOnly(2026, 8, 1), PriceZone.National);

        Assert.Equal(CatalogueLookupFailure.Ambiguous, result.Failure);
        Assert.Null(result.Item);
        Assert.Null(result.Price);
        Assert.Contains("2", result.Message);   // says how many
    }

    [Theory]
    [InlineData(PriceZone.Remote)]
    [InlineData(PriceZone.VeryRemote)]
    public void A_zone_the_row_lists_no_price_for_is_ZoneNotEligible_and_still_returns_the_row(PriceZone zone)
    {
        var row = Row(Jul1_2026, null, 73.58m, remote: null, veryRemote: null);   // "not listed" = not eligible for the loading

        var result = EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 8, 1), zone);

        Assert.Equal(CatalogueLookupFailure.ZoneNotEligible, result.Failure);
        Assert.Same(row, result.Item);
        Assert.Null(result.Price);
        Assert.Contains(zone.ToString(), result.Message);
    }

    [Fact]
    public void Remote_can_be_eligible_while_VeryRemote_is_not()
    {
        var row = Row(Jul1_2026, null, 73.58m, remote: 103.01m, veryRemote: null);

        Assert.Equal(103.01m, EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 8, 1), PriceZone.Remote).Price);
        Assert.Equal(CatalogueLookupFailure.ZoneNotEligible, EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 8, 1), PriceZone.VeryRemote).Failure);
    }

    [Fact]
    public void A_row_with_no_National_price_is_NotPriced_whatever_zone_is_asked()
    {
        // A quotable item (no price limit), or a row written before the zone prices existed.
        var row = Row(Jul1_2026, null, national: null);

        foreach (var zone in new[] { PriceZone.National, PriceZone.Remote, PriceZone.VeryRemote })
        {
            var result = EffectiveCatalogueResolver.Find(new[] { row }, Code, new DateOnly(2026, 8, 1), zone);
            Assert.Equal(CatalogueLookupFailure.NotPriced, result.Failure);
            Assert.Same(row, result.Item);
        }
    }

    [Fact]
    public void A_null_catalogue_is_a_programming_error_not_a_lookup_failure()
    {
        Assert.Throws<ArgumentNullException>(() => EffectiveCatalogueResolver.Find(null!, Code, Jul1_2026, PriceZone.National));
    }

    // ── Against the real catalogues ───────────────────────────────────────────────

    [Fact]
    public async Task After_importing_2025_26_then_2026_27_the_lookup_gives_each_date_its_own_years_price()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal(70.23m, (await db.FindCatalogueItemAsync(Code, new DateOnly(2026, 6, 30), PriceZone.National)).Price);   // NDIS-CODES 4.2: 2025-26 national
        Assert.Equal(73.58m, (await db.FindCatalogueItemAsync(Code, new DateOnly(2026, 7, 1), PriceZone.National)).Price);    // 2026-27 national
        Assert.Equal(103.01m, (await db.FindCatalogueItemAsync(Code, new DateOnly(2026, 10, 5), PriceZone.Remote)).Price);
        Assert.Equal(110.37m, (await db.FindCatalogueItemAsync(Code, new DateOnly(2026, 10, 5), PriceZone.VeryRemote)).Price);
        Assert.Equal(CatalogueLookupFailure.NotFound, (await db.FindCatalogueItemAsync(Code, new DateOnly(2025, 6, 30), PriceZone.National)).Failure);
        Assert.Equal(CatalogueLookupFailure.NotPriced, (await db.FindCatalogueItemAsync("01_003_0107_1_1", new DateOnly(2026, 10, 5), PriceZone.National)).Failure);
    }

    [Fact]
    public async Task After_two_versions_no_code_is_ambiguous_on_any_probe_date_in_either_import_order()
    {
        var probes = new[] { new DateOnly(2025, 7, 1), new DateOnly(2025, 12, 31), new DateOnly(2026, 6, 30), new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 3), new DateOnly(2026, 10, 2), new DateOnly(2027, 6, 30), new DateOnly(2028, 1, 1) };

        foreach (var order in new[] { new[] { CatalogueFixtures.File2025_26Trimmed, CatalogueFixtures.File2026_27 }, new[] { CatalogueFixtures.File2026_27, CatalogueFixtures.File2025_26Trimmed } })
        {
            await using var db = CreateDb();
            foreach (var file in order) await ImportAsync(db, file);
            var rows = await RowsAsync(db);

            foreach (var code in rows.Select(r => r.ItemNumber).Distinct())
                foreach (var date in probes)
                    Assert.NotEqual(CatalogueLookupFailure.Ambiguous, EffectiveCatalogueResolver.Find(rows, code, date, PriceZone.National).Failure);

            // and the 2026-27 price wins from 1 July 2026 whichever file went in first
            Assert.Equal(73.58m, EffectiveCatalogueResolver.Find(rows, Code, new DateOnly(2026, 7, 1), PriceZone.National).Price);
            Assert.Equal(70.23m, EffectiveCatalogueResolver.Find(rows, Code, new DateOnly(2026, 6, 30), PriceZone.National).Price);
        }
    }
}
