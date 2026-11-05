using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The importer's writing half (phase A item 3). A commit is history-safe: a row superseded by a newer version is end-dated the day before the
/// new row starts, a row whose code left the catalogue is end-dated the same way, nothing is deleted, a group is never blanket-deactivated, and
/// importing the same file again changes nothing.
/// </summary>
public class CatalogueImportCommitTests
{
    private static readonly DateOnly Jun30_2026 = new(2026, 6, 30);

    private static readonly string[] CommunityAccessCodes =
    {
        "04_102_0125_6_1", "04_103_0125_6_1", "04_104_0125_6_1", "04_105_0125_6_1", "04_106_0125_6_1",
        "04_450_0125_1_1", "04_451_0125_1_1", "04_452_0125_1_1", "04_453_0125_1_1", "04_454_0125_1_1",
    };

    // ── What a first import writes ────────────────────────────────────────────────

    [Fact]
    public async Task Importing_the_2026_27_file_into_an_empty_database_writes_every_row_filed_by_family()
    {
        await using var db = CreateDb();

        var result = await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal(new CatalogueImportResultDto(1017, 0, 0, 0), result);
        var rows = await RowsAsync(db);
        Assert.Equal(1017, rows.Count);
        var byGroup = rows.GroupBy(r => r.ActivityGroup.GroupCode).ToDictionary(g => g.Key, g => g.Count());
        Assert.Equal(new Dictionary<string, int>
        {
            ["GRP_PERSONAL_CARE"] = 12, ["GRP_COMMUNITY_ACCESS"] = 10, ["GRP_COMMUNITY_ACCESS_HI"] = 5, ["GRP_GROUP_ACTIVITIES"] = 10,
            ["GRP_STA_SUPPORT"] = 12, ["GRP_STA_ACCOMMODATION"] = 2, ["GRP_SLEEPOVER"] = 2, ["GRP_PROVIDER_TRAVEL"] = 6,
            ["GRP_ACTIVITY_BASED_TRANSPORT"] = 3, ["GRP_CENTRE_CAPITAL"] = 2, ["GRP_OTHER"] = 953,
        }, byGroup);
        Assert.Equal(11, await db.SupportActivityGroups.CountAsync());
    }

    [Fact]
    public async Task A_stored_row_carries_what_the_preview_showed()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27, "2026-27");

        var row = (await RowsAsync(db)).Single(r => r.ItemNumber == "04_104_0125_6_1");

        Assert.Equal(("2026-27", "support-catalogue-2026-27.xlsx", true, false), (row.CatalogueVersion, row.SourceDocument, row.IsActive, row.IsLegacy));
        Assert.Equal(("0125", 4, 4, 6, 1, "H", CatalogueItemType.Priced), (row.RegistrationGroup, row.SupportCategoryNumber, row.PaceSupportCategoryNumber, row.OutcomeDomain, row.SupportPurpose, row.Unit, row.CatalogueType));
        Assert.Equal((73.58m, 103.01m, 110.37m), (row.PriceNational, row.PriceRemote, row.PriceVeryRemote));
        Assert.Equal((new DateOnly(2026, 7, 1), (DateOnly?)null), (row.EffectiveFrom, row.EffectiveTo));
        Assert.Equal((ClaimDayType.Weekday, false), (row.DayType, row.IsIntensive));
        Assert.Equal((73.58m, 73.58m, 73.58m, 73.58m, 73.58m, 73.58m, 73.58m, 73.58m), (row.PriceLimit_ACT, row.PriceLimit_NSW, row.PriceLimit_NT, row.PriceLimit_QLD, row.PriceLimit_SA, row.PriceLimit_TAS, row.PriceLimit_VIC, row.PriceLimit_WA));
        Assert.Equal((103.01m, 110.37m), (row.PriceLimit_Remote, row.PriceLimit_VeryRemote));
    }

    [Fact]
    public async Task The_community_access_group_keeps_its_name_and_holds_exactly_the_ten_RG_0125_standard_and_ICBS_items()
    {
        await using var db = CreateDb();
        var seeded = await SeedCommunityAccessGroupAsync(db);

        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var group = await db.SupportActivityGroups.SingleAsync(g => g.GroupCode == "GRP_COMMUNITY_ACCESS");
        Assert.Equal((seeded.Id, "Group Community Access", 4), (group.Id, group.DisplayName, group.SupportCategory));
        var inGroup = (await RowsAsync(db)).Where(r => r.ActivityGroupId == group.Id).Select(r => r.ItemNumber).OrderBy(c => c);
        Assert.Equal(CommunityAccessCodes.OrderBy(c => c), inGroup);
        Assert.Equal(11, await db.SupportActivityGroups.CountAsync());
    }

    [Fact]
    public async Task Rows_take_their_dates_from_the_file_never_from_today()
    {
        await using var db = CreateDb();

        await ImportAsync(db, CatalogueFixtures.File2026_27, clock: ClockOn(2026, 11, 15));

        var rows = await RowsAsync(db);
        Assert.DoesNotContain(rows, r => r.EffectiveFrom == new DateOnly(2026, 11, 15) || r.EffectiveTo == new DateOnly(2026, 11, 15));
        Assert.Equal(new DateOnly(2026, 7, 1), rows.Single(r => r.ItemNumber == "04_104_0125_6_1").EffectiveFrom);
        Assert.Equal(new DateOnly(2026, 7, 3), rows.Single(r => r.ItemNumber == "01_700_0118_1_3_CA2").EffectiveFrom);
        Assert.Equal(new DateOnly(2027, 9, 30), rows.Single(r => r.ItemNumber == "01_022_0120_1_1").EffectiveTo);
    }

    [Fact]
    public async Task A_row_is_active_unless_its_own_end_date_has_already_passed()
    {
        await using var late = CreateDb();
        await ImportAsync(late, CatalogueFixtures.File2026_27, clock: ClockOn(2026, 10, 2));   // 22 legacy rows ended on 30 Sep 2026
        await using var early = CreateDb();
        await ImportAsync(early, CatalogueFixtures.File2026_27, clock: ClockOn(2026, 9, 15));

        Assert.Equal(1017 - 22, await late.SupportCatalogueItems.CountAsync(i => i.IsActive));
        Assert.All(await late.SupportCatalogueItems.Where(i => !i.IsActive).ToListAsync(), r => Assert.Equal(new DateOnly(2026, 9, 30), r.EffectiveTo));
        Assert.Equal(1017, await early.SupportCatalogueItems.CountAsync(i => i.IsActive));
    }

    // ── Re-importing ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Importing_the_same_file_again_changes_nothing()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        var before = await SnapshotAsync(db);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var result = await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal((0, 1017, 0, 1017), (preview.ItemsToAdd, preview.ItemsUnchanged, preview.ItemsToDeactivate, preview.Rows.Count(r => r.IsUnchanged && !r.IsNew && !r.PriceChanged)));
        Assert.Empty(preview.Warnings);   // four rows start on 2-3 July: that must not read as "this file is older than rows already imported"
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), result);
        Assert.Equal(before, await SnapshotAsync(db));
        Assert.Equal(11, await db.SupportActivityGroups.CountAsync());
    }

    [Fact]
    public async Task Importing_the_same_file_under_another_version_label_still_changes_nothing()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27, "2026-27");
        var before = await SnapshotAsync(db);

        var result = await ImportAsync(db, CatalogueFixtures.File2026_27, "2026-27 v2");

        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), result);
        Assert.Equal(before, await SnapshotAsync(db));
    }

    [Fact]
    public async Task A_correction_with_the_same_start_date_updates_that_row_in_place()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        var originalId = (await RowsAsync(db)).Single(r => r.ItemNumber == "04_104_0125_6_1").Id;
        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var corrected = preview.Rows.Select(r => r.ItemNumber == "04_104_0125_6_1" ? r with { PriceNational = 74.00m, PriceLimit_VIC = 74.00m } : r).ToList();

        var result = await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = corrected });

        Assert.Equal(new CatalogueImportResultDto(0, 1, 1016, 0), result);
        var row = (await RowsAsync(db)).Single(r => r.ItemNumber == "04_104_0125_6_1");
        Assert.Equal((originalId, 74.00m, 74.00m), (row.Id, row.PriceNational, row.PriceLimit_VIC));
        Assert.Equal(1017, await db.SupportCatalogueItems.CountAsync());
    }

    // ── A newer version arrives ───────────────────────────────────────────────────

    [Fact]
    public async Task A_newer_version_end_dates_what_it_replaces_the_day_before_it_starts_and_deletes_nothing()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        var old = (await RowsAsync(db)).ToDictionary(r => r.Id);
        Assert.Equal(250 + 31, old.Count);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var result = await ImportAsync(db, CatalogueFixtures.File2026_27);

        var after = await RowsAsync(db);
        Assert.Equal(281 + 1017, after.Count);                                   // nothing deleted
        Assert.Equal(1017, result.Added);
        Assert.Equal(250, result.EndDated);                                      // every old row that was still open
        Assert.Equal((result.Added, result.EndDated), (preview.ItemsToAdd, preview.ItemsToDeactivate));
        foreach (var row in after.Where(r => old.ContainsKey(r.Id)))
        {
            var was = old[row.Id];
            if (was.EffectiveTo is null)
            {
                Assert.Equal(Jun30_2026, row.EffectiveTo);                       // the day before the 2026-27 rows start
                Assert.False(row.IsActive);
            }
            else
                Assert.Equal(was.EffectiveTo, row.EffectiveTo);                  // already-ended legacy rows keep their own end date
            Assert.Equal(was.EffectiveFrom, row.EffectiveFrom);
            Assert.Equal(was.PriceLimit_VIC, row.PriceLimit_VIC);                // history keeps its prices
        }

        var weekday = after.Where(r => r.ItemNumber == "04_104_0125_6_1").OrderBy(r => r.EffectiveFrom).ToList();
        Assert.Equal(2, weekday.Count);
        Assert.Equal((new DateOnly(2025, 7, 1), Jun30_2026, false, 70.23m), (weekday[0].EffectiveFrom, weekday[0].EffectiveTo, weekday[0].IsActive, weekday[0].PriceNational));
        Assert.Equal((new DateOnly(2026, 7, 1), (DateOnly?)null, true, 73.58m), (weekday[1].EffectiveFrom, weekday[1].EffectiveTo, weekday[1].IsActive, weekday[1].PriceNational));
    }

    [Fact]
    public async Task A_code_that_is_not_in_the_new_file_is_end_dated_the_same_way()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);

        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var retired = (await RowsAsync(db)).Single(r => r.ItemNumber == "14_799_0127_8_3");   // in the 2025-26 catalogue, not in 2026-27
        Assert.Equal((Jun30_2026, false), (retired.EffectiveTo, retired.IsActive));
    }

    [Fact]
    public async Task After_a_newer_version_the_community_access_group_has_exactly_the_ten_current_items_active()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var active = (await RowsAsync(db)).Where(r => r.ActivityGroup.GroupCode == "GRP_COMMUNITY_ACCESS" && r.IsActive).ToList();

        Assert.Equal(CommunityAccessCodes.OrderBy(c => c), active.Select(r => r.ItemNumber).OrderBy(c => c));
        Assert.All(active, r => Assert.Equal(new DateOnly(2026, 7, 1), r.EffectiveFrom));
    }

    [Fact]
    public async Task The_fake_demo_seed_codes_are_end_dated_and_the_real_ones_take_over()
    {
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        var from = new DateOnly(2024, 7, 1);
        db.SupportCatalogueItems.AddRange(
            LegacyRow(group.Id, "04_210_0125_6_1", ClaimDayType.Weekday, 67.56m, from, version: "2024-25"),
            LegacyRow(group.Id, "04_212_0125_6_1", ClaimDayType.Saturday, 94.91m, from, version: "2024-25"),
            LegacyRow(group.Id, "04_213_0125_6_1", ClaimDayType.Sunday, 122.25m, from, version: "2024-25"),
            LegacyRow(group.Id, "04_214_0125_6_1", ClaimDayType.PublicHoliday, 149.60m, from, version: "2024-25"));
        await db.SaveChangesAsync();

        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var rows = await RowsAsync(db);
        foreach (var fake in rows.Where(r => r.EffectiveFrom == from))
            Assert.Equal((Jun30_2026, false), (fake.EffectiveTo, fake.IsActive));
        Assert.Equal(4 + 1017, rows.Count);
        var active = rows.Where(r => r.ActivityGroupId == group.Id && r.IsActive).Select(r => r.ItemNumber).OrderBy(c => c);
        Assert.Equal(CommunityAccessCodes.OrderBy(c => c), active);
    }

    [Fact]
    public async Task A_row_the_old_importer_stamped_with_a_later_start_date_is_wholly_replaced_not_left_competing()
    {
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        db.SupportCatalogueItems.Add(LegacyRow(group.Id, "04_104_0125_6_1", ClaimDayType.Weekday, 70.23m, new DateOnly(2026, 9, 10)));   // imported on 10 Sep 2026
        await db.SaveChangesAsync();

        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var rows = (await RowsAsync(db)).Where(r => r.ItemNumber == "04_104_0125_6_1").OrderBy(r => r.EffectiveFrom).ToList();
        Assert.Equal(2, rows.Count);
        Assert.Equal((new DateOnly(2026, 7, 1), true), (rows[0].EffectiveFrom, rows[0].IsActive));      // the real 2026-27 row, from 1 July
        var stale = rows[1];
        Assert.False(stale.IsActive);
        Assert.True(stale.EffectiveTo < stale.EffectiveFrom, "its window must hold no date, so it can never be found next to the real row");
    }

    [Fact]
    public async Task A_row_of_a_later_catalogue_version_is_never_touched_by_an_import_of_an_earlier_one()
    {
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        var later = LegacyRow(group.Id, "04_104_0125_6_1", ClaimDayType.Weekday, 76.00m, new DateOnly(2027, 7, 1), version: "2027-28");
        later.SourceDocument = "support-catalogue-2027-28.xlsx";
        var unrelated = LegacyRow(group.Id, "99_999_9999_9_9", ClaimDayType.Weekday, 10m, new DateOnly(2026, 8, 1), version: "2026-27 (2026-08-01)");   // newer than anything the file starts
        unrelated.SourceDocument = "support-catalogue-2026-27.xlsx";
        db.SupportCatalogueItems.AddRange(later, unrelated);
        await db.SaveChangesAsync();

        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var rows = await RowsAsync(db);
        var keptLater = rows.Single(r => r.Id == later.Id);
        Assert.Equal((true, (DateOnly?)null, new DateOnly(2027, 7, 1)), (keptLater.IsActive, keptLater.EffectiveTo, keptLater.EffectiveFrom));
        var keptUnrelated = rows.Single(r => r.Id == unrelated.Id);
        Assert.Equal((true, (DateOnly?)null), (keptUnrelated.IsActive, keptUnrelated.EffectiveTo));
        var imported = rows.Single(r => r.ItemNumber == "04_104_0125_6_1" && r.EffectiveFrom == new DateOnly(2026, 7, 1));
        Assert.Equal((new DateOnly(2027, 6, 30), false), (imported.EffectiveTo, imported.IsActive));   // capped by the later version, no longer the latest
    }

    [Fact]
    public async Task Importing_an_older_file_after_a_newer_one_adds_it_as_history_and_leaves_the_newer_rows_alone()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);

        Assert.Contains(preview.Warnings, w => w.Contains("before", StringComparison.OrdinalIgnoreCase) && w.Contains("2026-07-01"));
        var rows = await RowsAsync(db);
        var current = rows.Where(r => r.SourceDocument == CatalogueFixtures.File2026_27).ToList();
        Assert.Equal(1017, current.Count);
        Assert.All(current.Where(r => !r.IsLegacy), r => Assert.Null(r.EffectiveTo));   // the newer rows are as they were
        var weekday = rows.Where(r => r.ItemNumber == "04_104_0125_6_1").OrderBy(r => r.EffectiveFrom).ToList();
        Assert.Equal((new DateOnly(2025, 7, 1), Jun30_2026, false), (weekday[0].EffectiveFrom, weekday[0].EffectiveTo, weekday[0].IsActive));
        Assert.Equal((new DateOnly(2026, 7, 1), (DateOnly?)null, true), (weekday[1].EffectiveFrom, weekday[1].EffectiveTo, weekday[1].IsActive));
        Assert.Equal(CommunityAccessCodes.OrderBy(c => c), rows.Where(r => r.ActivityGroup.GroupCode == "GRP_COMMUNITY_ACCESS" && r.IsActive).Select(r => r.ItemNumber).OrderBy(c => c));
    }

    [Fact]
    public async Task A_code_of_the_previous_catalogue_that_the_new_one_dropped_ends_the_day_before_the_new_one_starts_even_when_its_legacy_sheet_reaches_back_further()
    {
        // The 2025-26 file's Legacy sheet starts on 1 Jul 2024, a year before the catalogue does. A 2024-25 row whose code is not in the 2025-26 file ended on 30 Jun 2025.
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        var dropped = LegacyRow(group.Id, "04_999_0125_6_1", ClaimDayType.Weekday, 60m, new DateOnly(2024, 7, 1), version: "2024-25");
        dropped.SourceDocument = "support-catalogue-2024-25.xlsx";   // a dated row: its start date is the catalogue's own
        db.SupportCatalogueItems.Add(dropped);
        await db.SaveChangesAsync();

        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);

        var row = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.Id == dropped.Id);
        Assert.Equal((new DateOnly(2025, 6, 30), false), (row.EffectiveTo, row.IsActive));
    }

    [Theory]
    [InlineData("04_105_0125_6_1", "2026-07-01")]       // starts on the catalogue's first day
    [InlineData("01_700_0118_1_3_CA2", "2026-07-03")]   // starts a couple of days after it, like four rows of the official file
    public async Task A_code_dropped_from_a_republished_file_is_end_dated_and_counted_even_when_it_starts_with_that_catalogue(string code, string start)
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        await using var republished = Workbook(CatalogueFixtures.File2026_27, wb => DeleteRows(wb, code));

        var preview = await PreviewAsync(db, republished, "republished.xlsx");
        var result = await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows });

        Assert.Equal((1, 1016), (preview.ItemsToDeactivate, preview.ItemsUnchanged));
        var endedOn = DateOnly.Parse(start).AddDays(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);   // the day before it starts: an empty window
        Assert.Contains(preview.Warnings, w => w.Contains(code) && w.Contains($"is not in the new catalogue and will be end-dated {endedOn}"));
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1016, 1), result);
        var row = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.ItemNumber == code);
        Assert.Equal((DateOnly.Parse(start), false), (row.EffectiveFrom, row.IsActive));
        Assert.True(row.EffectiveTo < row.EffectiveFrom, "its window holds no date, so it can never be found");
        Assert.Equal(CatalogueLookupFailure.NotFound, (await db.FindCatalogueItemAsync(code, new DateOnly(2026, 10, 5), PriceZone.National)).Failure);
    }

    [Theory]
    [InlineData("04_105_0125_6_1", "2026-07-01", 103.54)]       // starts on the catalogue's first day
    [InlineData("01_700_0118_1_3_CA2", "2026-07-03", 0)]        // starts a couple of days after it, like four rows of the official file (0: only check that it is found again)
    public async Task A_code_a_truncated_file_ended_prices_again_when_the_complete_file_is_imported_after_it(string code, string start, double price)
    {
        // A wrong or cut-short workbook is confirmed by mistake: the codes it leaves out are end-dated with an empty window. The right file, imported next, must
        // bring them back; an import never lengthens a row that a newer catalogue shortened, but this window was emptied by the importer itself.
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        await using var truncated = Workbook(CatalogueFixtures.File2026_27, wb => DeleteRows(wb, code));
        var cut = await PreviewAsync(db, truncated, "truncated.xlsx");
        await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = cut.DetectedVersion, Rows = cut.Rows });
        var probe = new DateOnly(2026, 10, 5);
        Assert.Equal(CatalogueLookupFailure.NotFound, (await db.FindCatalogueItemAsync(code, probe, PriceZone.National)).Failure);   // the truncated file did end it

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var result = await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows });

        Assert.Equal((0, 1016, 0), (preview.ItemsToAdd, preview.ItemsUnchanged, preview.ItemsToDeactivate));
        var warning = Assert.Single(preview.Warnings);
        Assert.Contains(code, warning);
        Assert.Contains("reopened", warning);
        Assert.DoesNotContain("never lengthens", warning);
        Assert.Equal(new CatalogueImportResultDto(0, 1, 1016, 0), result);   // the one row is updated in place: no copy is added
        var rows = (await RowsAsync(db)).Where(r => r.ItemNumber == code).ToList();
        var row = Assert.Single(rows);
        Assert.Equal((DateOnly.Parse(start), (DateOnly?)null, true), (row.EffectiveFrom, row.EffectiveTo, row.IsActive));
        var found = await db.FindCatalogueItemAsync(code, probe, PriceZone.National);
        Assert.NotEqual(CatalogueLookupFailure.NotFound, found.Failure);   // the row is valid on that date again
        if (price > 0) Assert.Equal((decimal)price, found.Price);

        var again = await ImportAsync(db, CatalogueFixtures.File2026_27);
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), again);      // and once back, importing again changes nothing
    }

    [Fact]
    public async Task A_row_the_importer_emptied_is_not_reopened_while_another_row_of_the_code_covers_its_start()
    {
        // Not a state the importer itself produces. The rule being pinned: a file that lists a code again brings back only a code nothing else prices; an
        // emptied row whose start another row of the code covers is a shadowed copy, and stays ended.
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        var covering = LegacyRow(group.Id, "04_104_0125_6_1", ClaimDayType.Weekday, 70.23m, new DateOnly(2026, 6, 1));
        covering.SourceDocument = "support-catalogue-earlier.xlsx";
        var emptied = LegacyRow(group.Id, "04_104_0125_6_1", ClaimDayType.Weekday, 73.58m, new DateOnly(2026, 7, 1), active: false, to: Jun30_2026);
        emptied.SourceDocument = "support-catalogue-2026-27.xlsx";
        db.SupportCatalogueItems.AddRange(covering, emptied);
        await db.SaveChangesAsync();

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows });

        Assert.DoesNotContain(preview.Warnings, w => w.Contains("reopened"));
        var row = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.Id == emptied.Id);
        Assert.Equal((new DateOnly(2026, 7, 1), Jun30_2026, false), (row.EffectiveFrom, row.EffectiveTo, row.IsActive));
    }

    [Fact]
    public async Task An_import_heals_a_catalogue_that_was_inserted_twice_by_ending_the_extra_copy_of_every_row()
    {
        // Two confirms that both read an empty table each insert the whole catalogue: every code then has two active rows with the same start date, and the
        // lookup answers Ambiguous. The next import of the same file keeps one copy and ends the other with an empty window.
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        foreach (var original in await db.SupportCatalogueItems.AsNoTracking().ToListAsync())
        {
            var copy = (SupportCatalogueItem)db.Entry(original).CurrentValues.ToObject();
            copy.Id = Guid.NewGuid();
            db.SupportCatalogueItems.Add(copy);
        }
        await db.SaveChangesAsync();
        Assert.Equal(CatalogueLookupFailure.Ambiguous, (await db.FindCatalogueItemAsync("04_104_0125_6_1", new DateOnly(2026, 10, 5), PriceZone.National)).Failure);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var result = await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal((1017, 1017), (preview.ItemsToDeactivate, preview.ItemsUnchanged));
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 1017), result);
        var rows = await RowsAsync(db);
        foreach (var code in rows.Select(r => r.ItemNumber).Distinct())
            Assert.NotEqual(CatalogueLookupFailure.Ambiguous, EffectiveCatalogueResolver.Find(rows, code, new DateOnly(2026, 10, 5), PriceZone.National).Failure);
        Assert.Equal(995, rows.Count(r => r.IsActive));
        Assert.Equal(CommunityAccessCodes.OrderBy(c => c), rows.Where(r => r.ActivityGroup.GroupCode == "GRP_COMMUNITY_ACCESS" && r.IsActive).Select(r => r.ItemNumber).OrderBy(c => c));

        var again = await ImportAsync(db, CatalogueFixtures.File2026_27);
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), again);   // and once healed, importing again changes nothing
    }

    [Fact]
    public async Task A_code_listed_twice_with_a_gap_ends_its_first_version_where_the_file_says_on_the_first_import()
    {
        // The stored 1 July row is open-ended. The file lists the code from 1 July to 27 Oct and again from 1 Dec. The row is updated to end on 27 Oct, and the
        // second version's own plan also ends every earlier row that reaches 1 Dec on 30 Nov: the commit used to apply that end date last, so the row ended on
        // 30 Nov (later than the file says) and only the next import brought it to 27 Oct. A row keeps the earlier of the two dates.
        const string code = "04_104_0125_6_1";
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        await using var twice = Workbook(CatalogueFixtures.File2026_27, wb => ListCodeTwice(wb, code, 20261027, 20261201));

        var preview = await PreviewAsync(db, twice, "twice.xlsx");
        var result = await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows });

        Assert.Equal((1, 1), (result.Added, result.Updated));
        var rows = (await RowsAsync(db)).Where(r => r.ItemNumber == code).OrderBy(r => r.EffectiveFrom).ToList();
        Assert.Equal(2, rows.Count);
        Assert.Equal((new DateOnly(2026, 7, 1), (DateOnly?)new DateOnly(2026, 10, 27), false), (rows[0].EffectiveFrom, rows[0].EffectiveTo, rows[0].IsActive));
        Assert.Equal((new DateOnly(2026, 12, 1), (DateOnly?)null, true), (rows[1].EffectiveFrom, rows[1].EffectiveTo, rows[1].IsActive));
        Assert.Equal(73.58m, (await db.FindCatalogueItemAsync(code, new DateOnly(2026, 10, 27), PriceZone.National)).Price);
        Assert.Equal(CatalogueLookupFailure.NotFound, (await db.FindCatalogueItemAsync(code, new DateOnly(2026, 10, 28), PriceZone.National)).Failure);   // the gap the file leaves
        Assert.Equal(CatalogueLookupFailure.NotFound, (await db.FindCatalogueItemAsync(code, new DateOnly(2026, 11, 30), PriceZone.National)).Failure);
        Assert.Equal(73.58m, (await db.FindCatalogueItemAsync(code, new DateOnly(2026, 12, 1), PriceZone.National)).Price);

        await using var again = Workbook(CatalogueFixtures.File2026_27, wb => ListCodeTwice(wb, code, 20261027, 20261201));
        var second = await PreviewAsync(db, again, "twice.xlsx");
        Assert.Equal((0, 1018), (second.ItemsToAdd, second.ItemsUnchanged));   // the one import already reached what the file says
    }

    [Fact]
    public async Task A_republished_file_that_extends_an_end_date_is_flagged_because_an_import_never_lengthens_a_row()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        await using var republished = Workbook(CatalogueFixtures.File2026_27, wb => SetEndDate(wb, "01_058_0115_1_1", 20280630));   // legacy STA: 30 Jun 2027 -> 30 Jun 2028

        var preview = await PreviewAsync(db, republished, "republished.xlsx");
        var result = await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows });

        var warning = Assert.Single(preview.Warnings);
        Assert.Contains("01_058_0115_1_1", warning);
        Assert.Contains("2028-06-30", warning);   // what the file says
        Assert.Contains("2027-06-30", warning);   // what is stored and kept
        Assert.Contains("never lengthens", warning);
        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), result);
        Assert.Equal(new DateOnly(2027, 6, 30), (await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.ItemNumber == "01_058_0115_1_1")).EffectiveTo);
    }

    [Fact]
    public async Task Importing_an_older_file_over_the_newer_one_flags_only_the_retired_codes_it_would_otherwise_bring_back()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2025_26Trimmed);

        // Codes the newer catalogue replaced are capped at the day before it starts, so the file and the store agree. The two open-ended 2025-26 codes the
        // 2026-27 catalogue dropped are kept ended, and said so.
        var flagged = preview.Warnings.Where(w => w.Contains("never lengthens")).ToList();
        Assert.Equal(2, flagged.Count);
        Assert.Contains(flagged, w => w.Contains("14_799_0127_8_3") && w.Contains("2026-06-30"));
        Assert.Contains(flagged, w => w.Contains("15_222400911_0124_1_3") && w.Contains("2026-06-30"));
    }

    [Fact]
    public async Task Importing_the_older_file_again_after_both_are_in_changes_nothing_either()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        var before = await SnapshotAsync(db);

        var result = await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);   // its rows were end-dated by the newer file; the file still says open-ended

        Assert.Equal(new CatalogueImportResultDto(0, 0, 281, 0), result);
        Assert.Equal(before, await SnapshotAsync(db));
        // in particular the code the newer catalogue dropped is not brought back by the older file that still lists it
        var retired = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.ItemNumber == "14_799_0127_8_3");
        Assert.Equal((Jun30_2026, false), (retired.EffectiveTo, retired.IsActive));
    }

    [Fact]
    public async Task A_row_the_previous_importer_wrote_with_the_same_start_date_is_replaced_by_the_catalogues_own_row_not_held_to_its_artifact_end_date()
    {
        // The previous importer's "end date" is the day a later import deactivated the row: if both ran on 1 Jul 2026 the stale row ends on its own start date.
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        var stale = LegacyRow(group.Id, "04_104_0125_6_1", ClaimDayType.Weekday, 70.23m, new DateOnly(2026, 7, 1), active: false, to: new DateOnly(2026, 7, 1));
        db.SupportCatalogueItems.Add(stale);
        await db.SaveChangesAsync();

        var result = await ImportAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal(1, result.Updated);
        var row = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.Id == stale.Id);
        Assert.Equal((73.58m, (DateOnly?)null, true, "support-catalogue-2026-27.xlsx"), (row.PriceNational, row.EffectiveTo, row.IsActive, row.SourceDocument));
    }

    // ── The preview says what the commit will do ──────────────────────────────────

    [Fact]
    public async Task A_republished_file_is_not_called_older_than_rows_that_it_republishes()
    {
        // The December price set: its changed rows start on 1 Dec. Importing it, then previewing it again, must not warn that it is "added as history".
        await using var db = CreateDb();
        var community = new HashSet<string>(CommunityAccessCodes);
        await using var first = Workbook(CatalogueFixtures.File2026_27, wb => SetStartDates(wb, community.Contains, 20261201));
        var december = await PreviewAsync(db, first, "republished.xlsx", ClockOn(2026, 12, 10));
        await NewImporter(db, ClockOn(2026, 12, 10)).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = december.DetectedVersion, Rows = december.Rows });

        await using var again = Workbook(CatalogueFixtures.File2026_27, wb => SetStartDates(wb, community.Contains, 20261201));
        var preview = await PreviewAsync(db, again, "republished.xlsx", ClockOn(2026, 12, 10));

        Assert.Empty(preview.Warnings);
        Assert.Equal((0, 1017), (preview.ItemsToAdd, preview.ItemsUnchanged));
    }

    [Fact]
    public async Task The_preview_warns_about_active_rows_that_leave_the_catalogue_and_not_about_rows_that_are_merely_superseded()
    {
        await using var db = CreateDb();
        var group = await SeedCommunityAccessGroupAsync(db);
        db.SupportCatalogueItems.AddRange(
            LegacyRow(group.Id, "04_210_0125_6_1", ClaimDayType.Weekday, 67.56m, new DateOnly(2024, 7, 1)),      // the code exists in the 2026-27 file
            LegacyRow(group.Id, "04_212_0125_6_1", ClaimDayType.Saturday, 94.91m, new DateOnly(2024, 7, 1)));     // it does not
        await db.SaveChangesAsync();

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);

        Assert.Equal(2, preview.ItemsToDeactivate);
        Assert.Contains(preview.Warnings, w => w.Contains("04_212_0125_6_1") && w.Contains("2026-06-30"));
        Assert.DoesNotContain(preview.Warnings, w => w.Contains("04_210_0125_6_1"));
    }

    [Fact]
    public async Task Messages_write_dates_the_same_way_under_any_culture()
    {
        // The deploy image runs invariant, the dev machine en-AU; a Buddhist-calendar culture would turn 2026 into 2569 in a current-culture rendering.
        CultureInfo thai;
        try { thai = new CultureInfo("th-TH"); }
        catch (CultureNotFoundException) { return; }   // invariant globalization: there is only one culture to render with
        // The edited workbooks are built before the culture changes: only what the importer renders is under test.
        await using var republished = Workbook(CatalogueFixtures.File2026_27, wb => SetEndDate(wb, "01_058_0115_1_1", 20280630));   // legacy STA: 30 Jun 2027 -> 30 Jun 2028
        await using var truncated = Workbook(CatalogueFixtures.File2026_27, wb => DeleteRows(wb, "04_105_0125_6_1"));
        var original = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = thai;
        try
        {
            await using var db = CreateDb();
            var group = await SeedCommunityAccessGroupAsync(db);
            db.SupportCatalogueItems.Add(LegacyRow(group.Id, "04_212_0125_6_1", ClaimDayType.Saturday, 94.91m, new DateOnly(2024, 7, 1)));
            await db.SaveChangesAsync();

            var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27, ClockOn(2026, 6, 1));

            Assert.Contains(preview.Warnings, w => w.Contains("04_212_0125_6_1") && w.Contains("end-dated 2026-06-30."));
            Assert.Contains(preview.Warnings, w => w.Contains("starts on 2026-07-01, after today (2026-06-01)"));

            // The warning for a file that ends a stored row later than the database keeps it names both dates; so does the one for a row brought back.
            await using var imported = CreateDb();
            await ImportAsync(imported, CatalogueFixtures.File2026_27);
            var held = await PreviewAsync(imported, republished, "republished.xlsx");
            Assert.Contains(held.Warnings, w => w.Contains("01_058_0115_1_1") && w.Contains("ends this row on 2028-06-30, later than the stored 2027-06-30"));
            Assert.Contains(held.Warnings, w => w.Contains("so 2027-06-30 was kept."));

            var cut = await PreviewAsync(imported, truncated, "truncated.xlsx");
            await NewImporter(imported).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = cut.DetectedVersion, Rows = cut.Rows });
            var back = await PreviewAsync(imported, CatalogueFixtures.File2026_27);
            Assert.Contains(back.Warnings, w => w.Contains("04_105_0125_6_1") && w.Contains("is reopened from 2026-07-01."));
        }
        finally { CultureInfo.CurrentCulture = original; }
    }

    [Fact]
    public async Task The_preview_names_each_row_that_starts_after_today_up_to_ten_and_counts_the_rest()
    {
        await using var db = CreateDb();

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27, ClockOn(2026, 6, 1));   // every row of the file starts after this "today"

        var warnings = preview.Warnings.Where(w => w.Contains("after today", StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Equal(11, warnings.Count);
        Assert.StartsWith("01_002_0107_1_1 (", warnings[0], StringComparison.Ordinal);
        Assert.Contains("starts on 2026-07-01, after today (2026-06-01)", warnings[0]);
        Assert.Contains("earlier services keep the row it replaces", warnings[0]);
        Assert.Equal("...and 1007 more rows start after today.", warnings[10]);
    }

    [Fact]
    public async Task A_republished_file_warns_for_the_rows_that_start_later_and_only_for_those()
    {
        await using var db = CreateDb();
        var community = new HashSet<string>(CommunityAccessCodes);
        await using var december = Workbook(CatalogueFixtures.File2026_27, wb => SetStartDates(wb, community.Contains, 20261201));   // ten rows start on 1 Dec, the rest on 1 Jul

        var preview = await PreviewAsync(db, december, "republished.xlsx");   // "today" is 2 Oct 2026

        var warnings = preview.Warnings.Where(w => w.Contains("after today", StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Equal(CommunityAccessCodes.OrderBy(c => c, StringComparer.Ordinal), warnings.Select(w => w.Split(' ')[0]).OrderBy(c => c, StringComparer.Ordinal));
        Assert.All(warnings, w => Assert.Contains("starts on 2026-12-01, after today (2026-10-02)", w));
    }

    [Fact]
    public async Task A_file_whose_rows_all_started_on_or_before_today_has_no_future_start_warning()
    {
        await using var db = CreateDb();

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);   // today is 2 Oct 2026

        Assert.DoesNotContain(preview.Warnings, w => w.Contains("after today", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task The_preview_flags_a_price_change_against_the_row_it_replaces()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);

        var weekday = preview.Rows.Single(r => r.ItemNumber == "04_104_0125_6_1");
        Assert.Equal((true, true, false), (weekday.IsNew, weekday.PriceChanged, weekday.IsUnchanged));   // 70.23 -> 73.58
        Assert.False(preview.Rows.Single(r => r.ItemNumber == "01_700_0118_1_3_CA2").PriceChanged);     // new in 2026-27: nothing to compare with
    }

    // ── Refusals and tampering ────────────────────────────────────────────────────

    [Fact]
    public async Task A_row_posted_without_a_start_date_is_refused_because_an_import_never_stamps_today()
    {
        await using var db = CreateDb();
        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var rows = preview.Rows.Select(r => r.ItemNumber == "04_104_0125_6_1" ? r with { EffectiveFrom = default } : r).ToList();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = rows }));

        Assert.Contains("04_104_0125_6_1", ex.Message);
        Assert.Contains("start date", ex.Message);
        Assert.Empty(db.SupportCatalogueItems);
    }

    [Fact]
    public async Task Two_posted_rows_for_the_same_code_and_start_date_are_refused()
    {
        await using var db = CreateDb();
        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var rows = preview.Rows.Concat(new[] { preview.Rows.First(r => r.ItemNumber == "04_104_0125_6_1") }).ToList();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = rows }));

        Assert.Contains("04_104_0125_6_1", ex.Message);
        Assert.Empty(db.SupportCatalogueItems);
    }

    [Fact]
    public async Task Confirming_no_rows_is_refused()
    {
        await using var db = CreateDb();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = new List<CatalogueImportRowDto>() }));
    }

    [Fact]
    public async Task A_posted_row_cannot_file_itself_under_the_community_access_group()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27);
        var tampered = preview.Rows.Select(r => r.ItemNumber == "04_210_0125_6_1"
            ? r with { GroupCode = "GRP_COMMUNITY_ACCESS", Family = "CommunityAccess", DayType = ClaimDayType.Weekday, IsIntensive = false }
            : r).ToList();

        await NewImporter(db).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = tampered });

        var row = (await RowsAsync(db)).Single(r => r.ItemNumber == "04_210_0125_6_1");
        Assert.Equal("GRP_OTHER", row.ActivityGroup.GroupCode);
        Assert.Equal(10, (await RowsAsync(db)).Count(r => r.ActivityGroup.GroupCode == "GRP_COMMUNITY_ACCESS"));
    }
}
