using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements page (PR A): the derived price list of an agreement, and which newer list is on offer.</summary>
public class AgreementPriceListsTests
{
    private static readonly DateOnly Jul25 = new(2025, 7, 1), Jul26 = new(2026, 7, 1), Oct26 = new(2026, 10, 1);

    [Fact]
    public void A_revisions_price_list_is_the_version_of_its_latest_dated_line_a_tie_goes_to_the_greater_version_and_blank_is_ignored()
    {
        Assert.Equal("2026-27", AgreementPriceLists.VersionOf(new[] { ("2025-26", Jul25), ("2026-27", Jul26) }));
        Assert.Equal("2026-27", AgreementPriceLists.VersionOf(new[] { ("2026-27", Jul26), ("2025-26", Jul26) }));
        Assert.Equal("2025-26", AgreementPriceLists.VersionOf(new[] { ("", Jul26), ("2025-26", Jul25) }));
        Assert.Null(AgreementPriceLists.VersionOf(new[] { ("", Jul26) }));
        Assert.Null(AgreementPriceLists.VersionOf(Array.Empty<(string, DateOnly)>()));
    }

    [Fact]
    public void A_newer_list_must_start_after_the_current_one_and_on_or_before_the_agreements_end()
    {
        var lists = new[] { new PriceListRef("2026-27", Jul26), new PriceListRef("2025-26", Jul25) };
        Assert.Equal("2026-27", AgreementPriceLists.Newer(lists, "2025-26", Jul26)?.Version);          // start == end is on offer
        Assert.Null(AgreementPriceLists.Newer(lists, "2025-26", Jul26.AddDays(-1)));                   // starts the day after the end
        Assert.Null(AgreementPriceLists.Newer(lists, "2026-27", Oct26));                               // nothing newer
        Assert.Null(AgreementPriceLists.Newer(lists, "2024-25", Oct26));                               // current not listed
        Assert.Null(AgreementPriceLists.Newer(lists, null, Oct26));
    }

    [Fact]
    public async Task Every_imported_version_is_listed_newest_first()
    {
        await using var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2025_26Trimmed);
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);

        var lists = await AgreementPriceLists.ListAsync(f.Db, CancellationToken.None);

        Assert.Equal(new[] { "2026-27", "2025-26" }, lists.Select(l => l.Version));
        Assert.True(lists[0].Start > lists[1].Start);
        Assert.DoesNotContain(lists, l => l.Version == "");
    }
}
