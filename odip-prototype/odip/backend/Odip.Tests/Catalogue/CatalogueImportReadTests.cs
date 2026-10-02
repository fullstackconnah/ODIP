using System.Text.Json;
using ClosedXML.Excel;
using Odip.Api.Serialization;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Catalogue.CatalogueImportTestSupport;

namespace Odip.Tests.Catalogue;

/// <summary>
/// The importer's reading half (phase A item 3): the format is told from the header row, BOTH catalogue formats are read, every row is read
/// (Current and Legacy sheets, not only RG 0125), and every date and price comes from the file. Expected values are the figures in the NDIA
/// workbooks and in NDIS-CODES section 4, not recomputed from the code under test.
/// </summary>
public class CatalogueImportReadTests
{
    private static async Task<CatalogueImportPreviewDto> Preview2026_27() { await using var db = CreateDb(); return await PreviewAsync(db, CatalogueFixtures.File2026_27); }
    private static async Task<CatalogueImportPreviewDto> Preview2025_26() { await using var db = CreateDb(); return await PreviewAsync(db, CatalogueFixtures.File2025_26Trimmed); }

    private static CatalogueImportRowDto Row(CatalogueImportPreviewDto preview, string code) => preview.Rows.Single(r => r.ItemNumber == code);

    // ── The 2026-27 format ────────────────────────────────────────────────────────

    [Fact]
    public async Task The_2026_27_file_is_detected_from_its_header_and_every_row_of_both_sheets_is_read()
    {
        var preview = await Preview2026_27();

        Assert.Equal(CatalogueFileFormat.NationalRemote, preview.DetectedFormat);
        Assert.Equal(976 + 41, preview.Rows.Count);
        Assert.Equal(41, preview.LegacyItems);
        Assert.Equal(41, preview.Rows.Count(r => r.IsLegacy));
        Assert.Equal("2026-27", preview.DetectedVersion);
        Assert.Equal(new DateOnly(2026, 7, 1), preview.EffectiveFrom);
        Assert.Equal("support-catalogue-2026-27.xlsx", preview.SourceDocument);
        Assert.All(preview.Rows, r => Assert.Equal("support-catalogue-2026-27.xlsx", r.SourceDocument));
        Assert.Empty(preview.Warnings);
    }

    [Fact]
    public async Task Rows_outside_RG_0125_are_imported_not_only_community_access()
    {
        var preview = await Preview2026_27();

        Assert.Equal(36, preview.Rows.Select(r => r.RegistrationGroup).Distinct().Count());
        foreach (var code in new[] { "01_011_0107_1_1", "01_200_0115_1_1", "04_102_0136_6_1", "01_400_0104_1_1", "01_010_0107_1_1", "01_799_0107_1_1", "04_599_0136_6_1", "05_043306003_0103_1_2" })
            Assert.Contains(preview.Rows, r => r.ItemNumber == code);
    }

    [Fact]
    public async Task A_standard_hourly_row_carries_everything_the_2026_27_file_holds()
    {
        var row = Row(await Preview2026_27(), "04_104_0125_6_1");

        Assert.Equal("Access Community Social and Rec Activ - Standard - Weekday Daytime", row.Description);
        Assert.Equal("0125", row.RegistrationGroup);
        Assert.Equal((4, 4), (row.SupportCategoryNumber, row.PaceSupportCategoryNumber));
        Assert.Equal((6, 1), (row.OutcomeDomain, row.SupportPurpose));
        Assert.Equal("H", row.Unit);
        Assert.Equal(CatalogueItemType.Priced, row.CatalogueType);
        Assert.Equal(
            new[] { CatalogueClaimFlag.Yes, CatalogueClaimFlag.Yes, CatalogueClaimFlag.Yes, CatalogueClaimFlag.No, CatalogueClaimFlag.No },
            new[] { row.NonFaceToFace, row.ProviderTravel, row.ShortNoticeCancellation, row.NdiaRequestedReports, row.IrregularSil }.Select(f => f!.Value));
        Assert.False(row.IsLegacy);
        Assert.Equal(new DateOnly(2026, 7, 1), row.EffectiveFrom);
        Assert.Null(row.EffectiveTo);   // 99991231 = open-ended
        Assert.Equal((73.58m, 103.01m, 110.37m), (row.PriceNational, row.PriceRemote, row.PriceVeryRemote));
        Assert.Equal(ClaimDayType.Weekday, row.DayType);
        Assert.False(row.IsIntensive);
        Assert.Equal(("CommunityAccess", "GRP_COMMUNITY_ACCESS"), (row.Family, row.GroupCode));
    }

    [Fact]
    public async Task The_eight_state_columns_are_filled_with_the_National_price_and_the_remote_columns_with_the_remote_prices()
    {
        var row = Row(await Preview2026_27(), "04_104_0125_6_1");

        foreach (var statePrice in new[] { row.PriceLimit_ACT, row.PriceLimit_NSW, row.PriceLimit_NT, row.PriceLimit_QLD, row.PriceLimit_SA, row.PriceLimit_TAS, row.PriceLimit_VIC, row.PriceLimit_WA })
            Assert.Equal(73.58m, statePrice);
        Assert.Equal(103.01m, row.PriceLimit_Remote);
        Assert.Equal(110.37m, row.PriceLimit_VeryRemote);
    }

    [Theory]
    [InlineData("01_002_0107_1_1", 82.57)]    // ASC weekday night
    [InlineData("01_205_0115_1_1", 82.57)]    // STA weekday night
    [InlineData("01_405_0104_1_1", 89.32)]    // ASC high intensity weekday night
    [InlineData("01_254_0115_1_1", 89.32)]    // STA high intensity weekday night
    public async Task The_night_items_are_WeekdayNight(string code, double price)
    {
        var row = Row(await Preview2026_27(), code);

        Assert.Equal(ClaimDayType.WeekdayNight, row.DayType);
        Assert.Equal((decimal)price, row.PriceNational);
    }

    [Fact]
    public async Task A_sleepover_is_an_Each_item_with_its_own_family()
    {
        var row = Row(await Preview2026_27(), "01_010_0107_1_1");

        Assert.Equal("E", row.Unit);
        Assert.Equal(311.79m, row.PriceNational);
        Assert.Equal(436.51m, row.PriceRemote);
        Assert.Equal(467.69m, row.PriceVeryRemote);
        Assert.Equal(("Sleepover", "GRP_SLEEPOVER"), (row.Family, row.GroupCode));
    }

    [Fact]
    public async Task A_quotable_item_has_no_price_and_NA_flags_whether_the_cell_is_blank_or_an_empty_string()
    {
        var preview = await Preview2026_27();

        foreach (var code in new[] { "01_003_0107_1_1", "01_022_0120_1_1" })   // the second one's price cells hold an empty string
        {
            var row = Row(preview, code);
            Assert.Equal(CatalogueItemType.Quotable, row.CatalogueType);
            Assert.Null(row.PriceNational);
            Assert.Null(row.PriceRemote);
            Assert.Null(row.PriceVeryRemote);
            Assert.Equal(0m, row.PriceLimit_VIC);
            Assert.Equal(CatalogueClaimFlag.NotApplicable, row.NonFaceToFace);
            Assert.Equal(CatalogueClaimFlag.NotApplicable, row.IrregularSil);
        }
    }

    [Fact]
    public async Task A_Unit_Price_1_item_keeps_its_type_and_its_one_dollar_prices()
    {
        var row = Row(await Preview2026_27(), "01_799_0107_1_1");

        Assert.Equal(CatalogueItemType.UnitPriceOne, row.CatalogueType);
        Assert.Equal("E", row.Unit);
        Assert.Equal((1m, 1m, 1m), (row.PriceNational, row.PriceRemote, row.PriceVeryRemote));
        Assert.Equal(("ProviderTravel", "GRP_PROVIDER_TRAVEL"), (row.Family, row.GroupCode));
    }

    [Fact]
    public async Task An_item_the_file_gives_no_Type_keeps_a_null_type_and_is_not_filed_with_community_access()
    {
        var row = Row(await Preview2026_27(), "04_210_0125_6_1");

        Assert.Null(row.CatalogueType);
        Assert.Equal("E", row.Unit);
        Assert.Null(row.PriceNational);
        Assert.Equal("GRP_OTHER", row.GroupCode);
    }

    [Fact]
    public async Task A_legacy_row_has_the_legacy_flag_its_own_end_date_and_a_per_day_unit()
    {
        var preview = await Preview2026_27();
        var row = Row(preview, "01_058_0115_1_1");

        Assert.True(row.IsLegacy);
        Assert.Equal("D", row.Unit);
        Assert.Equal(2178.57m, row.PriceNational);
        Assert.Equal(new DateOnly(2026, 7, 1), row.EffectiveFrom);
        Assert.Equal(new DateOnly(2027, 6, 30), row.EffectiveTo);
        Assert.Equal(16, preview.Rows.Count(r => r.IsLegacy && r.EffectiveTo == new DateOnly(2027, 6, 30)));
        Assert.Equal(22, preview.Rows.Count(r => r.IsLegacy && r.EffectiveTo == new DateOnly(2026, 9, 30)));
    }

    [Fact]
    public async Task Every_row_takes_its_own_start_date_from_the_file()
    {
        var preview = await Preview2026_27();

        Assert.Equal(1013, preview.Rows.Count(r => r.EffectiveFrom == new DateOnly(2026, 7, 1)));
        Assert.Equal(1, preview.Rows.Count(r => r.EffectiveFrom == new DateOnly(2026, 7, 2)));
        Assert.Equal(3, preview.Rows.Count(r => r.EffectiveFrom == new DateOnly(2026, 7, 3)));
        Assert.Equal(new DateOnly(2026, 7, 3), Row(preview, "01_700_0118_1_3_CA2").EffectiveFrom);
    }

    [Fact]
    public async Task Suffixed_codes_and_the_one_row_with_no_structured_code_are_kept_as_published()
    {
        var preview = await Preview2026_27();

        var travel = Row(preview, "01_650_0118_1_3_PT");
        Assert.Equal((97m, 135.80m, 145.50m), (travel.PriceNational, travel.PriceRemote, travel.PriceVeryRemote));
        Assert.Equal((1, 3), (travel.OutcomeDomain, travel.SupportPurpose));

        var bereavement = Row(preview, "Bereavement");
        Assert.Equal("0127", bereavement.RegistrationGroup);   // from the registration group column: the code has no parts
        Assert.Equal(14, bereavement.SupportCategoryNumber);
        Assert.Equal("MON", bereavement.Unit);
        Assert.Equal(104.45m, bereavement.PriceNational);
        Assert.Null(bereavement.OutcomeDomain);
        Assert.Null(bereavement.SupportPurpose);
        Assert.Equal("GRP_OTHER", bereavement.GroupCode);
    }

    [Fact]
    public async Task The_registration_group_column_is_what_is_stored_even_where_it_disagrees_with_the_code()
    {
        var row = Row(await Preview2026_27(), "05_222903111_0103_1_2");   // the code says 0103, the column says 0123

        Assert.Equal("0123", row.RegistrationGroup);
    }

    [Fact]
    public async Task Every_row_with_a_National_price_has_all_eight_state_columns_equal_to_it_and_the_remote_columns_mirror_the_zone_prices()
    {
        var preview = await Preview2026_27();

        var priced = preview.Rows.Where(r => r.PriceNational is not null).ToList();
        Assert.Equal(632 + 160, priced.Count);   // 632 Priced + 160 Unit Price = $1; the 56 Quotable and 165 untyped rows have none
        foreach (var r in priced)
        {
            var national = r.PriceNational!.Value;
            Assert.Equal(new[] { national, national, national, national, national, national, national, national },
                new[] { r.PriceLimit_ACT, r.PriceLimit_NSW, r.PriceLimit_NT, r.PriceLimit_QLD, r.PriceLimit_SA, r.PriceLimit_TAS, r.PriceLimit_VIC, r.PriceLimit_WA });
            Assert.Equal(r.PriceRemote ?? 0m, r.PriceLimit_Remote);
            Assert.Equal(r.PriceVeryRemote ?? 0m, r.PriceLimit_VeryRemote);
        }
    }

    // ── The 2025-26 format ────────────────────────────────────────────────────────

    [Fact]
    public async Task The_2025_26_file_is_detected_from_its_header_and_read_with_both_sheets()
    {
        var preview = await Preview2025_26();

        Assert.Equal(CatalogueFileFormat.StateColumns, preview.DetectedFormat);
        Assert.Equal(250 + 31, preview.Rows.Count);
        Assert.Equal(31, preview.LegacyItems);
        Assert.Equal("2025-26", preview.DetectedVersion);
        Assert.Equal(new DateOnly(2025, 7, 1), preview.EffectiveFrom);
        Assert.Equal("support-catalogue-2025-26-trimmed.xlsx", preview.SourceDocument);
        Assert.Empty(preview.Warnings);
    }

    [Fact]
    public async Task A_2025_26_row_keeps_its_state_columns_and_gets_the_common_value_as_its_National_price()
    {
        var row = Row(await Preview2025_26(), "04_104_0125_6_1");

        foreach (var statePrice in new[] { row.PriceLimit_ACT, row.PriceLimit_NSW, row.PriceLimit_NT, row.PriceLimit_QLD, row.PriceLimit_SA, row.PriceLimit_TAS, row.PriceLimit_VIC, row.PriceLimit_WA })
            Assert.Equal(70.23m, statePrice);
        Assert.Equal((70.23m, 98.32m, 105.35m), (row.PriceNational, row.PriceRemote, row.PriceVeryRemote));
        Assert.Equal((98.32m, 105.35m), (row.PriceLimit_Remote, row.PriceLimit_VeryRemote));
        Assert.Equal(CatalogueItemType.Priced, row.CatalogueType);   // 2025-26 calls it "Price Limited Supports"
        Assert.Equal(new DateOnly(2025, 7, 1), row.EffectiveFrom);
        Assert.Null(row.EffectiveTo);   // the end date is the TEXT "99991231" in this file
        Assert.Equal(("0125", ClaimDayType.Weekday, "GRP_COMMUNITY_ACCESS"), (row.RegistrationGroup, row.DayType, row.GroupCode));
        Assert.Equal(CatalogueClaimFlag.Yes, row.ProviderTravel);
    }

    [Fact]
    public async Task The_2025_26_community_access_rows_are_the_ten_the_old_importer_kept_with_the_same_day_types_and_prices()
    {
        var preview = await Preview2025_26();

        var expected = new (string Code, ClaimDayType Day, bool Intensive, decimal Price)[]
        {
            ("04_104_0125_6_1", ClaimDayType.Weekday, false, 70.23m), ("04_103_0125_6_1", ClaimDayType.WeekdayEvening, false, 77.38m),
            ("04_105_0125_6_1", ClaimDayType.Saturday, false, 98.83m), ("04_106_0125_6_1", ClaimDayType.Sunday, false, 127.43m),
            ("04_102_0125_6_1", ClaimDayType.PublicHoliday, false, 156.03m),
            ("04_450_0125_1_1", ClaimDayType.Weekday, true, 75.98m), ("04_451_0125_1_1", ClaimDayType.WeekdayEvening, true, 83.72m),
            ("04_452_0125_1_1", ClaimDayType.Saturday, true, 106.93m), ("04_453_0125_1_1", ClaimDayType.Sunday, true, 137.87m),
            ("04_454_0125_1_1", ClaimDayType.PublicHoliday, true, 168.81m),
        };
        var inGroup = preview.Rows.Where(r => r.GroupCode == "GRP_COMMUNITY_ACCESS").ToList();

        Assert.Equal(expected.Select(e => e.Code).OrderBy(c => c), inGroup.Select(r => r.ItemNumber).OrderBy(c => c));
        foreach (var (code, day, intensive, price) in expected)
        {
            var row = Row(preview, code);
            Assert.Equal((day, intensive, price), (row.DayType, row.IsIntensive, row.PriceLimit_VIC));
        }
    }

    [Fact]
    public async Task Start_and_end_dates_stored_as_text_or_numbers_both_parse_and_trailing_spaces_in_codes_are_trimmed()
    {
        var preview = await Preview2025_26();

        Assert.Equal(new DateOnly(2025, 7, 1), Row(preview, "10_054_0128_5_3").EffectiveFrom);   // the start date is the text "20250701"
        Assert.Contains(preview.Rows, r => r.ItemNumber == "05_121221811_0109_1_2");              // the cell holds "05_121221811_0109_1_2 "
        Assert.DoesNotContain(preview.Rows, r => r.ItemNumber != r.ItemNumber.Trim());
    }

    [Fact]
    public async Task Odd_flag_cells_are_read_as_published_N_A_is_not_applicable_and_a_zero_is_unknown()
    {
        var preview = await Preview2025_26();

        var bereavement = Row(preview, "Bereavement");
        Assert.Equal(CatalogueClaimFlag.NotApplicable, bereavement.NonFaceToFace);
        Assert.Equal(CatalogueClaimFlag.NotApplicable, bereavement.IrregularSil);
        Assert.Equal(104.45m, bereavement.PriceNational);

        var zeros = Row(preview, "05_121221811_0109_1_2");
        Assert.Null(zeros.NonFaceToFace);
        Assert.Null(zeros.ProviderTravel);
    }

    [Fact]
    public async Task A_2025_26_legacy_row_has_its_own_start_and_end_dates()
    {
        var row = Row(await Preview2025_26(), "05_122409171_0105_1_2");

        Assert.True(row.IsLegacy);
        Assert.Equal(new DateOnly(2024, 7, 1), row.EffectiveFrom);
        Assert.Equal(new DateOnly(2025, 9, 30), row.EffectiveTo);
    }

    // ── Not a catalogue ───────────────────────────────────────────────────────────

    [Fact]
    public async Task A_workbook_with_no_catalogue_sheet_is_refused_with_a_message_that_says_what_was_expected()
    {
        await using var db = CreateDb();
        using var wb = new XLWorkbook();
        wb.AddWorksheet("Notes").Cell(1, 1).Value = "Not a support catalogue";
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        stream.Position = 0;

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => NewImporter(db).PreviewImportAsync(stream, "notes.xlsx"));

        Assert.Contains("Support Item Number", ex.Message);
    }

    [Fact]
    public async Task A_sheet_with_the_header_but_no_recognised_price_columns_is_refused()
    {
        await using var db = CreateDb();
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Current Support Items");
        ws.Cell(1, 1).Value = "Support Item Number";
        ws.Cell(1, 2).Value = "Support Item Name";
        ws.Cell(2, 1).Value = "01_011_0107_1_1";
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        stream.Position = 0;

        await Assert.ThrowsAsync<InvalidOperationException>(() => NewImporter(db).PreviewImportAsync(stream, "x.xlsx"));
    }

    [Fact]
    public async Task A_header_that_only_contains_the_item_number_heading_is_refused_not_crashed_on()
    {
        await using var db = CreateDb();
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Current Support Items");
        ws.Cell(1, 1).Value = "Support Item Number (code)";   // not the heading the importer maps
        ws.Cell(1, 2).Value = "Start date";
        ws.Cell(1, 3).Value = "National";
        ws.Cell(2, 1).Value = "01_011_0107_1_1";
        ws.Cell(2, 2).Value = 20260701;
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        stream.Position = 0;

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => NewImporter(db).PreviewImportAsync(stream, "x.xlsx"));

        Assert.Contains("Support Item Number", ex.Message);
    }

    [Fact]
    public async Task A_cell_the_reader_cannot_make_sense_of_refuses_the_upload_with_a_message_instead_of_a_server_error()
    {
        await using var db = CreateDb();
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27));
        wb.Worksheet("Current Support Items").Cell(2, 13).Value = 1e300;   // a National price no decimal can hold
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        stream.Position = 0;

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => NewImporter(db).PreviewImportAsync(stream, "damaged.xlsx"));

        Assert.Contains("Current Support Items", ex.Message);
        Assert.Contains("could not be read", ex.Message);
    }

    [Fact]
    public async Task Bytes_that_are_not_a_workbook_are_refused_not_crashed_on()
    {
        await using var db = CreateDb();
        using var stream = new MemoryStream(new byte[] { 1, 2, 3, 4, 5 });

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => NewImporter(db).PreviewImportAsync(stream, "x.xlsx"));

        Assert.Contains(".xlsx", ex.Message);
    }

    [Fact]
    public async Task A_hidden_working_sheet_is_not_read()
    {
        await using var db = CreateDb();
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27));
        var hidden = wb.AddWorksheet("Hidden working copy");   // a catalogue-shaped sheet an importer must not read: NDIA's 2025-26 file carries two
        hidden.Cell(1, 1).Value = "Support Item Number";
        hidden.Cell(1, 2).Value = "National";
        hidden.Cell(2, 1).Value = "99_999_9999_9_9";
        hidden.Visibility = XLWorksheetVisibility.Hidden;
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        stream.Position = 0;

        var preview = await NewImporter(db).PreviewImportAsync(stream, "with-hidden-sheet.xlsx");

        Assert.Equal(976 + 41, preview.Rows.Count);
    }

    [Fact]
    public async Task Previewing_writes_nothing()
    {
        await using var db = CreateDb();
        await SeedCommunityAccessGroupAsync(db);

        await PreviewAsync(db, CatalogueFixtures.File2026_27);

        Assert.Empty(db.SupportCatalogueItems);
        Assert.Single(db.SupportActivityGroups);
    }

    [Fact]
    public async Task The_confirm_request_for_the_whole_2026_27_catalogue_stays_under_a_megabyte()
    {
        // The confirm step posts every row back (about 790 KB today), and a reverse proxy in front of the API commonly caps a request body at 1 MB:
        // this fails well before a new field or a bigger catalogue pushes the request over it.
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        var preview = await Preview2026_27();

        var bytes = JsonSerializer.SerializeToUtf8Bytes(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27", Rows = preview.Rows }, options);

        Assert.InRange(bytes.Length, 100_000, 900_000);
    }
}
