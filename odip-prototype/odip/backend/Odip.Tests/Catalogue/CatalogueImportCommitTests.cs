using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
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
        var unrelated = LegacyRow(group.Id, "99_999_9999_9_9", ClaimDayType.Weekday, 10m, new DateOnly(2026, 7, 1), version: "2026-27");
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

    // ── The preview says what the commit will do ──────────────────────────────────

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
    public async Task The_preview_warns_when_the_catalogue_starts_after_today()
    {
        await using var db = CreateDb();

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27, ClockOn(2026, 6, 1));

        Assert.Contains(preview.Warnings, w => w.Contains("2026-07-01") && w.Contains("after today", StringComparison.OrdinalIgnoreCase));
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
