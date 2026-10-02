using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// An older catalogue imported after a newer one is history: it must not leave behind rows that look current. The live finding: after the 2026-27 file
/// the 2025-26 file was imported for history, and the codes it lists that the 2026-27 catalogue does NOT hold (nothing newer to end them) stayed
/// open-ended and active. Each is ended the day before the newer catalogue starts and is no longer current, however the two files were imported.
/// </summary>
public class CatalogueHistoryImportTests
{
    private static readonly DateOnly Jun30_2026 = new(2026, 6, 30);
    private static readonly DateOnly Probe = new(2026, 10, 5);

    /// <summary>The two Current-sheet codes of the trimmed 2025-26 file that the 2026-27 file does not list (open-ended, End Date 99991231).</summary>
    private static readonly string[] OpenEndedDropped = { "14_799_0127_8_3", "15_222400911_0124_1_3" };

    private static readonly string[] CommunityAccessCodes =
    {
        "04_102_0125_6_1", "04_103_0125_6_1", "04_104_0125_6_1", "04_105_0125_6_1", "04_106_0125_6_1",
        "04_450_0125_1_1", "04_451_0125_1_1", "04_452_0125_1_1", "04_453_0125_1_1", "04_454_0125_1_1",
    };

    /// <summary>What a file lists, read by the importer's reader on an empty database (no planning involved).</summary>
    private static async Task<List<CatalogueImportRowDto>> FileRowsAsync(string fixture)
    {
        await using var db = CreateDb();
        return (await PreviewAsync(db, fixture)).Rows.ToList();
    }

    private static Task<CatalogueImportResultDto> ConfirmAsync(OdipDbContext db, CatalogueImportPreviewDto preview, TimeProvider? clock = null) =>
        NewImporter(db, clock).CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = preview.DetectedVersion, Rows = preview.Rows });

    /// <summary>The catalogue as stored, without ids, versions or file names: two imports that agree on this left the same catalogue.</summary>
    private static async Task<List<string>> CatalogueAsync(OdipDbContext db) =>
        (await RowsAsync(db)).Select(r => $"{r.ItemNumber}|{r.EffectiveFrom:yyyy-MM-dd}|{r.EffectiveTo:yyyy-MM-dd}|{r.IsActive}|{r.IsLegacy}|{r.PriceNational}|{r.ActivityGroup.GroupCode}").ToList();

    /// <summary>The item number inside one row of <see cref="CatalogueImportTestSupport.SnapshotAsync"/> ("Id=...|ActivityGroupId=...|ItemNumber=...|...").</summary>
    private static string ItemNumberOf(string snapshotRow) =>
        snapshotRow.Split('|').Single(part => part.StartsWith("ItemNumber=", StringComparison.Ordinal))["ItemNumber=".Length..];

    [Fact]
    public async Task The_fixtures_hold_the_open_ended_codes_the_live_import_left_active()
    {
        var newer = (await FileRowsAsync(CatalogueFixtures.File2026_27)).Select(r => r.ItemNumber).ToHashSet();
        var older = await FileRowsAsync(CatalogueFixtures.File2025_26Trimmed);

        var openEnded = older.Where(r => !newer.Contains(r.ItemNumber) && r.EffectiveTo is null).Select(r => r.ItemNumber).OrderBy(c => c).ToList();

        Assert.Equal(OpenEndedDropped, openEnded);   // so the tests below exercise the case, instead of passing over nothing
    }

    [Fact]
    public async Task An_older_file_imported_after_the_newer_one_ends_the_codes_the_newer_catalogue_does_not_hold_the_day_before_it_starts()
    {
        var newer = (await FileRowsAsync(CatalogueFixtures.File2026_27)).Select(r => r.ItemNumber).ToHashSet();
        var dropped = (await FileRowsAsync(CatalogueFixtures.File2025_26Trimmed)).Where(r => !newer.Contains(r.ItemNumber)).Select(r => r.ItemNumber).Distinct().ToList();
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2025_26Trimmed);
        await ConfirmAsync(db, preview);

        var rows = await RowsAsync(db);
        foreach (var code in dropped)
        {
            var stored = rows.Where(r => r.ItemNumber == code).ToList();
            Assert.NotEmpty(stored);
            Assert.All(stored, r => Assert.True(r.EffectiveTo <= Jun30_2026, $"{code} ends {r.EffectiveTo:yyyy-MM-dd}, after the day before the 2026-27 catalogue starts"));
            Assert.All(stored, r => Assert.False(r.IsActive, $"{code} is still marked current"));
            Assert.Equal(CatalogueLookupFailure.NotFound, (await db.FindCatalogueItemAsync(code, Probe, PriceZone.National)).Failure);
        }
        foreach (var code in OpenEndedDropped)
            Assert.Equal(Jun30_2026, rows.Single(r => r.ItemNumber == code).EffectiveTo);
        Assert.Equal(995, rows.Count(r => r.IsActive));   // the 2026-27 catalogue's own rows; the history added none
        foreach (var code in OpenEndedDropped)
            Assert.Contains(preview.Warnings, w => w.Contains(code) && w.Contains("not in the newer catalogue (from 2026-07-01)") && w.Contains("ends it on 2026-06-30"));
    }

    [Fact]
    public async Task Importing_the_two_files_in_either_order_leaves_the_same_catalogue()
    {
        await using var olderFirst = CreateDb();
        await ImportAsync(olderFirst, CatalogueFixtures.File2025_26Trimmed);
        await ImportAsync(olderFirst, CatalogueFixtures.File2026_27);
        await using var newerFirst = CreateDb();
        await ImportAsync(newerFirst, CatalogueFixtures.File2026_27);
        await ImportAsync(newerFirst, CatalogueFixtures.File2025_26Trimmed);

        Assert.Equal(await CatalogueAsync(olderFirst), await CatalogueAsync(newerFirst));
    }

    [Fact]
    public async Task Importing_the_older_file_again_ends_rows_an_earlier_import_left_open_and_changes_nothing_else()
    {
        await using var db = CreateDb();
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        // The table as the live database was after the first import of the older file: its rows for the codes the newer catalogue does not hold, open-ended and active.
        foreach (var row in await db.SupportCatalogueItems.Where(i => OpenEndedDropped.Contains(i.ItemNumber)).ToListAsync())
        {
            row.EffectiveTo = null;
            row.IsActive = true;
        }
        await db.SaveChangesAsync();
        var before = await SnapshotAsync(db);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2025_26Trimmed);
        var result = await ConfirmAsync(db, preview);

        Assert.Equal(new CatalogueImportResultDto(0, 2, 279, 0), result);   // the two open rows are updated (shortened); the other 279 are untouched
        var after = await SnapshotAsync(db);
        Assert.Equal(before.Count, after.Count);
        var changed = before.Zip(after).Where(p => p.First != p.Second).Select(p => ItemNumberOf(p.First)).OrderBy(c => c).ToList();
        Assert.Equal(OpenEndedDropped, changed);   // exactly those two rows differ from the snapshot; no other row of the table was touched
        foreach (var code in OpenEndedDropped)
        {
            var row = await db.SupportCatalogueItems.AsNoTracking().SingleAsync(i => i.ItemNumber == code);
            Assert.Equal((Jun30_2026, false), (row.EffectiveTo, row.IsActive));
        }
        var again = await ImportAsync(db, CatalogueFixtures.File2025_26Trimmed);
        Assert.Equal(new CatalogueImportResultDto(0, 0, 281, 0), again);   // and once capped, importing it again changes nothing
    }

    [Fact]
    public async Task A_file_older_than_a_republication_of_its_own_year_is_not_an_older_catalogue()
    {
        // NDIA republishes a COMPLETE catalogue in which unchanged rows keep their 1 July start and changed rows start on the day the new prices apply. The July
        // file imported again after the December set is the same year's catalogue: every code is still held by what is stored, so nothing is ended or deactivated.
        var community = new HashSet<string>(CommunityAccessCodes);
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);
        await ImportAsync(db, CatalogueFixtures.File2026_27);
        await using var december = Workbook(CatalogueFixtures.File2026_27, wb => SetStartDates(wb, community.Contains, 20261201));
        var decemberPreview = await PreviewAsync(db, december, "republished.xlsx", ClockOn(2026, 12, 10));
        await ConfirmAsync(db, decemberPreview, ClockOn(2026, 12, 10));
        var before = await SnapshotAsync(db);
        var activeBefore = (await RowsAsync(db)).Count(r => r.IsActive);

        var preview = await PreviewAsync(db, CatalogueFixtures.File2026_27, ClockOn(2026, 12, 10));
        var result = await ConfirmAsync(db, preview, ClockOn(2026, 12, 10));

        Assert.Equal(new CatalogueImportResultDto(0, 0, 1017, 0), result);
        Assert.Equal(before, await SnapshotAsync(db));
        Assert.Equal(activeBefore, (await RowsAsync(db)).Count(r => r.IsActive));
        // the rows nothing replaced are still the ones that price December services
        Assert.Equal(CatalogueLookupFailure.NotPriced, (await db.FindCatalogueItemAsync("01_003_0107_1_1", new DateOnly(2026, 12, 5), PriceZone.National)).Failure);   // found, a quotable item
        Assert.Equal(73.58m, (await db.FindCatalogueItemAsync("04_104_0125_6_1", new DateOnly(2026, 11, 20), PriceZone.National)).Price);
    }
}
