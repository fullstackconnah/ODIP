using ClosedXML.Excel;
using Xunit;

namespace Odip.Tests.Catalogue;

/// <summary>The committed fixtures are what their names say, and stay inside the size budgets the generator promises.</summary>
public class CatalogueFixtureTests
{
    private static List<(string Name, int DataRows, bool Visible)> Sheets(string file)
    {
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(file));
        return wb.Worksheets
            .Select(w => (w.Name, (w.LastRowUsed()?.RowNumber() ?? 1) - 1, w.Visibility == XLWorksheetVisibility.Visible))
            .ToList();
    }

    [Fact]
    public void The_2026_27_fixture_is_the_official_NDIA_workbook_unmodified()
    {
        Assert.Equal(128_678, new FileInfo(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27)).Length);

        var sheets = Sheets(CatalogueFixtures.File2026_27);
        Assert.Equal(new[] { "Current Support Items", "Legacy Support Items" }, sheets.Select(s => s.Name));
        Assert.Equal(976, sheets[0].DataRows);
        Assert.Equal(41, sheets[1].DataRows);
        Assert.All(sheets, s => Assert.True(s.Visible));
    }

    [Fact]
    public void The_2026_27_fixture_has_National_Remote_and_VeryRemote_price_columns_and_no_state_columns()
    {
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2026_27));
        var header = wb.Worksheet("Current Support Items").Row(1).Cells().Select(c => c.GetString()).ToList();
        Assert.Contains("National", header);
        Assert.Contains("Remote", header);
        Assert.Contains("Very Remote", header);
        Assert.DoesNotContain("VIC", header);
    }

    [Fact]
    public void The_2025_26_fixture_is_under_100KB_with_only_the_two_visible_sheets()
    {
        Assert.True(new FileInfo(CatalogueFixtures.PathOf(CatalogueFixtures.File2025_26Trimmed)).Length < 100 * 1024);

        var sheets = Sheets(CatalogueFixtures.File2025_26Trimmed);
        Assert.Equal(new[] { "Current Support Items", "Legacy Support Items" }, sheets.Select(s => s.Name));
        Assert.All(sheets, s => Assert.True(s.Visible));
        Assert.Equal(31, sheets[1].DataRows);
    }

    [Fact]
    public void The_2025_26_fixture_has_the_eight_state_columns_and_no_National_column()
    {
        using var wb = new XLWorkbook(CatalogueFixtures.PathOf(CatalogueFixtures.File2025_26Trimmed));
        var header = wb.Worksheet("Current Support Items").Row(1).Cells().Select(c => c.GetString()).ToList();
        foreach (var state in new[] { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA", "Remote", "Very Remote" })
            Assert.Contains(state, header);
        Assert.DoesNotContain("National", header);
    }
}
