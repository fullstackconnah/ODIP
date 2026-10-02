using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The demo seed's catalogue (phase A item 6): the real 2026-27 RG 0125 standard items, not the invented 04_210..04_214 codes that exist in
/// no NDIA catalogue. A database seeded this way and then given the real file must end up with no duplicate and no changed row.
/// </summary>
public class CatalogueSeedTests
{
    // NDIS-CODES section 4.2: Access Community, Social and Rec Activities - Standard (RG 0125), 2026-27 National / MM6 / MM7 per hour.
    private static readonly (string Code, ClaimDayType Day, decimal National, decimal Remote, decimal VeryRemote)[] Expected =
    {
        ("04_104_0125_6_1", ClaimDayType.Weekday, 73.58m, 103.01m, 110.37m),
        ("04_103_0125_6_1", ClaimDayType.WeekdayEvening, 81.07m, 113.50m, 121.61m),
        ("04_105_0125_6_1", ClaimDayType.Saturday, 103.54m, 144.96m, 155.31m),
        ("04_106_0125_6_1", ClaimDayType.Sunday, 133.50m, 186.90m, 200.25m),
        ("04_102_0125_6_1", ClaimDayType.PublicHoliday, 163.46m, 228.84m, 245.19m),
    };

    [Fact]
    public async Task The_seed_creates_the_community_access_group_with_the_five_real_standard_items_and_none_of_the_invented_ones()
    {
        await using var db = CreateDb();

        await DbSeeder.SeedNdisDataAsync(db);

        var group = await db.SupportActivityGroups.Include(g => g.Items).SingleAsync();
        Assert.Equal(("GRP_COMMUNITY_ACCESS", "Group Community Access", 4, true), (group.GroupCode, group.DisplayName, group.SupportCategory, group.IsActive));
        Assert.Equal(Expected.Select(e => e.Code).OrderBy(c => c), group.Items.Select(i => i.ItemNumber).OrderBy(c => c));
        foreach (var invented in new[] { "04_210_0125_6_1", "04_212_0125_6_1", "04_213_0125_6_1", "04_214_0125_6_1" })
            Assert.DoesNotContain(group.Items, i => i.ItemNumber == invented);
    }

    [Fact]
    public async Task Each_seeded_item_has_the_2026_27_national_remote_and_very_remote_prices_and_dates()
    {
        await using var db = CreateDb();
        await DbSeeder.SeedNdisDataAsync(db);

        var items = await db.SupportCatalogueItems.AsNoTracking().ToListAsync();

        foreach (var (code, day, national, remote, veryRemote) in Expected)
        {
            var item = items.Single(i => i.ItemNumber == code);
            Assert.Equal((day, false, "H"), (item.DayType, item.IsIntensive, item.Unit));
            Assert.Equal((national, remote, veryRemote), (item.PriceNational, item.PriceRemote, item.PriceVeryRemote));
            Assert.Equal(new[] { national, national, national, national, national, national, national, national },
                new[] { item.PriceLimit_ACT, item.PriceLimit_NSW, item.PriceLimit_NT, item.PriceLimit_QLD, item.PriceLimit_SA, item.PriceLimit_TAS, item.PriceLimit_VIC, item.PriceLimit_WA });
            Assert.Equal((remote, veryRemote), (item.PriceLimit_Remote, item.PriceLimit_VeryRemote));
            Assert.Equal(("2026-27", new DateOnly(2026, 7, 1), (DateOnly?)null, true, false), (item.CatalogueVersion, item.EffectiveFrom, item.EffectiveTo, item.IsActive, item.IsLegacy));
            Assert.Equal(("0125", 4, 4, 6, 1, CatalogueItemType.Priced), (item.RegistrationGroup, item.SupportCategoryNumber, item.PaceSupportCategoryNumber, item.OutcomeDomain, item.SupportPurpose, item.CatalogueType));
            Assert.False(string.IsNullOrWhiteSpace(item.SourceDocument));
        }
    }

    [Fact]
    public async Task Importing_the_real_2026_27_file_over_the_seed_adds_the_rest_and_leaves_the_five_seeded_rows_exactly_as_they_are()
    {
        await using var db = CreateDb();
        await DbSeeder.SeedNdisDataAsync(db);
        var seeded = (await db.SupportCatalogueItems.AsNoTracking().ToListAsync()).ToDictionary(i => i.Id);

        var result = await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal(new CatalogueImportResultDto(1012, 0, 5, 0), result);   // the seeded rows are what the file says: nothing added twice, nothing changed
        Assert.Equal(1017, await db.SupportCatalogueItems.CountAsync());
        foreach (var (id, before) in seeded)
        {
            var after = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.Id == id);
            Assert.Equal((before.ItemNumber, before.PriceNational, before.EffectiveFrom, before.IsActive), (after.ItemNumber, after.PriceNational, after.EffectiveFrom, after.IsActive));
        }
        Assert.Equal(1, await db.SupportActivityGroups.CountAsync(g => g.GroupCode == "GRP_COMMUNITY_ACCESS"));
    }

    [Fact]
    public async Task Seeding_does_nothing_when_a_group_already_exists_so_a_live_database_keeps_what_it_has()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        db.SupportCatalogueItems.Add(LegacyRow(Guid.Parse("c0000000-0000-0000-0000-000000000001"), "04_212_0125_6_1", ClaimDayType.Saturday, 94.91m, new DateOnly(2024, 7, 1), version: "2024-25"));
        await db.SaveChangesAsync();

        await DbSeeder.SeedNdisDataAsync(db);

        var item = await db.SupportCatalogueItems.SingleAsync();
        Assert.Equal("04_212_0125_6_1", item.ItemNumber);   // untouched: the admin's import end-dates it, the seed never rewrites live data
        Assert.Equal(1, await db.SupportActivityGroups.CountAsync());
    }

    [Fact]
    public async Task Seeding_twice_changes_nothing()
    {
        await using var db = CreateDb();
        await DbSeeder.SeedNdisDataAsync(db);
        var before = await SnapshotAsync(db);

        await DbSeeder.SeedNdisDataAsync(db);

        Assert.Equal(before, await SnapshotAsync(db));
    }

    [Fact]
    public async Task The_seeded_items_are_found_by_the_date_effective_lookup_on_and_after_the_catalogue_start()
    {
        await using var db = CreateDb();
        await DbSeeder.SeedNdisDataAsync(db);

        var result = await Odip.Infrastructure.Services.CatalogueLookupExtensions.FindCatalogueItemAsync(db, "04_104_0125_6_1", new DateOnly(2026, 10, 5), PriceZone.National);

        Assert.True(result.Found);
        Assert.Equal(73.58m, result.Price);
    }
}
