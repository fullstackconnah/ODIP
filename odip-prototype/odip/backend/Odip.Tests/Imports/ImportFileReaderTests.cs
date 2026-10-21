using System.IO.Compression;
using System.Text;
using ClosedXML.Excel;
using Moq;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportFileReaderTests
{
    private static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);
    private static string Refusal(byte[] content, string fileName) => Assert.Throws<ImportException>(() => ImportFileReader.Read(content, fileName)).Message;

    [Theory]
    [InlineData("people.xls")]
    [InlineData("people.txt")]
    public void Refuses_anything_but_csv_and_xlsx(string fileName) =>
        Assert.Equal("Upload a .csv or .xlsx file. An older .xls workbook can be saved as .xlsx from Excel.", Refusal(Utf8("a,b\n1,2\n"), fileName));

    [Fact]
    public void Refuses_an_empty_file_and_one_over_5_MB()
    {
        Assert.Equal("The file is empty.", Refusal([], "people.csv"));
        Assert.Equal("The file is over 5 MB. Split it into smaller files and import each one.", Refusal(new byte[ImportFileReader.MaxBytes + 1], "people.csv"));
    }

    [Fact]
    public void Refuses_a_file_with_no_header_row_or_no_data_rows()
    {
        Assert.Equal("The file has no header row. Put the column names in the first row.", Refusal(Utf8("\r\n,,\r\n"), "people.csv"));
        Assert.Equal("The file has a header row but no data rows.", Refusal(Utf8("First name,Last name\r\n,\r\n"), "people.csv"));
    }

    [Fact]
    public void Refuses_more_than_2000_data_rows()
    {
        var csv = "First name,Last name\n" + string.Concat(Enumerable.Range(0, 2001).Select(i => $"A{i},B{i}\n"));
        Assert.Equal("The file has 2,001 rows. Import at most 2,000 at a time: split the file and import each part.", Refusal(Utf8(csv), "people.csv"));
    }

    [Fact]
    public void Trims_cells_drops_blank_rows_and_numbers_rows_as_the_spreadsheet_does()
    {
        var table = ImportFileReader.Read(Utf8(" First name ,Last name\n  Ava , Stone \n,\nBen\n"), "people.csv");
        Assert.Equal(new[] { "First name", "Last name" }, table.Headers);
        Assert.Equal(new[] { (2, "Ava", "Stone"), (4, "Ben", "") }, table.Rows.Select(r => (r.RowNumber, table.Cell(r, 0), table.Cell(r, 1))));
    }

    [Fact]
    public void Reads_xlsx_date_cells_as_iso_and_other_cells_as_Excel_shows_them()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("People");
        sheet.Cell(1, 1).Value = "Date of birth"; sheet.Cell(1, 2).Value = "Phone"; sheet.Cell(1, 3).Value = "Postcode";
        sheet.Cell(2, 1).Value = new DateTime(1990, 4, 3);
        sheet.Cell(2, 2).Value = "0412 345 678";
        sheet.Cell(2, 3).Value = 800;
        sheet.Cell(2, 3).Style.NumberFormat.Format = "0000";
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        var table = ImportFileReader.Read(stream.ToArray(), "people.xlsx");

        Assert.Equal(new[] { "1990-04-03", "0412 345 678", "0800" }, table.Rows.Single().Cells);
    }

    [Fact]
    public void Refuses_an_xlsx_that_is_not_a_workbook() =>
        Assert.Equal("The file could not be read as an Excel (.xlsx) workbook.", Refusal(Utf8("not a zip"), "people.xlsx"));

    private static byte[] Xlsx(Action<IXLWorksheet> fill)
    {
        using var workbook = new XLWorkbook();
        fill(workbook.Worksheets.Add("People"));
        using var stream = new MemoryStream();
        // Saved with the formulas worked out, as Excel saves them, so a formula cell carries its value.
        workbook.SaveAs(stream, new SaveOptions { EvaluateFormulasBeforeSaving = true });
        return stream.ToArray();
    }

    [Fact]
    public void Refuses_a_sparse_xlsx_whose_last_cell_is_far_away()
    {
        var file = Xlsx(sheet => { sheet.Cell(1, 1).Value = "First name"; sheet.Cell(1048576, 16384).Value = "x"; });
        var refusal = Refusal(file, "people.xlsx");
        Assert.Equal("The file has 1,048,575 rows. Import at most 2,000 at a time: split the file and import each part.", refusal);
    }

    [Theory]
    [InlineData(1048576, 16384, "The file has 1,048,575 rows. Import at most 2,000 at a time: split the file and import each part.")]
    [InlineData(2, 201, "This file has more than 200 columns. Remove the extra columns and try again.")]
    public void Refuses_oversized_worksheet_bounds_before_reading_any_cell(int lastRow, int lastColumn, string expected)
    {
        using var workbook = new XLWorkbook();
        var range = workbook.Worksheets.Add("People").Range(1, 1, lastRow, lastColumn);
        var sheet = new Mock<IXLWorksheet>(MockBehavior.Strict);
        sheet.Setup(s => s.RangeUsed(XLCellsUsedOptions.Contents)).Returns(range);

        var refusal = Assert.Throws<ImportException>(() => ImportFileReader.ReadWorksheet(sheet.Object));

        Assert.Equal(expected, refusal.Message);
        sheet.Verify(s => s.Cell(It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public void Reads_cells_within_worksheet_bounds()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("People");
        sheet.Cell(1, 1).Value = "First name";
        sheet.Cell(1, 2).Value = "Last name";
        sheet.Cell(2, 1).Value = "Ava";
        sheet.Cell(2, 2).Value = "Stone";

        var lines = ImportFileReader.ReadWorksheet(sheet);

        Assert.Equal(2, lines.Count);
        Assert.Equal(new[] { "First name", "Last name" }, lines[0]);
        Assert.Equal(new[] { "Ava", "Stone" }, lines[1]);
    }

    [Fact]
    public void An_absent_or_empty_worksheet_has_no_rows()
    {
        using var workbook = new XLWorkbook();
        Assert.Empty(ImportFileReader.ReadWorksheet(null));
        Assert.Empty(ImportFileReader.ReadWorksheet(workbook.Worksheets.Add("People")));
    }

    [Fact]
    public void Refuses_more_than_200_columns_in_an_xlsx_or_a_csv()
    {
        const string tooWide = "This file has more than 200 columns. Remove the extra columns and try again.";
        Assert.Equal(tooWide, Refusal(Xlsx(sheet => { sheet.Cell(1, 1).Value = "First name"; sheet.Cell(2, 201).Value = "x"; }), "people.xlsx"));
        Assert.Equal(tooWide, Refusal(Utf8(string.Join(",", Enumerable.Range(1, 201).Select(i => $"C{i}")) + "\na\n"), "people.csv"));
        Assert.Equal(200, ImportFileReader.Read(Utf8(string.Join(",", Enumerable.Range(1, 200).Select(i => $"C{i}")) + "\na\n"), "people.csv").Headers.Count);
    }

    [Fact]
    public void Refuses_an_xlsx_that_unpacks_to_more_than_20_MB()
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        using (var entry = zip.CreateEntry("xl/worksheets/sheet1.xml").Open())
            entry.Write(new byte[21 * 1024 * 1024]);
        Assert.Equal("This file is too large once unpacked.", Refusal(stream.ToArray(), "people.xlsx"));
    }

    /// <summary>A zip whose headers say its 21 MB sheet is 1 KB: the unpacked-size check reads the headers, so it must be .NET's zip reader
    /// (which ClosedXML's package reader also uses) that refuses to inflate past the declared size.</summary>
    private static byte[] ZipThatUnderstatesItsSize()
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        using (var entry = zip.CreateEntry("xl/worksheets/sheet1.xml").Open())
            entry.Write(new byte[21 * 1024 * 1024]);
        var bytes = stream.ToArray();
        // Uncompressed size: offset 22 in the local header (PK 3 4), offset 24 in the central directory header (PK 1 2).
        for (var i = 0; i < bytes.Length - 4; i++)
        {
            if (bytes[i] != 0x50 || bytes[i + 1] != 0x4B) continue;
            if (bytes[i + 2] == 3 && bytes[i + 3] == 4) BitConverter.GetBytes(1024).CopyTo(bytes, i + 22);
            if (bytes[i + 2] == 1 && bytes[i + 3] == 2) BitConverter.GetBytes(1024).CopyTo(bytes, i + 24);
        }
        return bytes;
    }

    [Fact]
    public void A_zip_that_understates_its_size_is_not_inflated_past_what_it_declares()
    {
        var file = ZipThatUnderstatesItsSize();
        using var zip = new ZipArchive(new MemoryStream(file), ZipArchiveMode.Read);
        Assert.Equal(1024, zip.Entries.Single().Length);
        long read = 0;
        try
        {
            using var entry = zip.Entries.Single().Open();
            var buffer = new byte[81920];
            for (int n; (n = entry.Read(buffer)) > 0;) read += n;
        }
        catch (InvalidDataException) { }
        Assert.True(read <= 1024, $"inflated {read:N0} bytes");
        Assert.Throws<ImportException>(() => ImportFileReader.Read(file, "people.xlsx"));
    }

    [Fact]
    public void Reads_a_formula_cell_as_its_saved_value_without_working_it_out()
    {
        var file = Xlsx(sheet => { sheet.Cell(1, 1).Value = "Postcode"; sheet.Cell(2, 1).FormulaA1 = "=1000+1000"; });
        Assert.Equal("2000", ImportFileReader.Read(file, "people.xlsx").Rows.Single().Cells[0]);
    }

    [Theory]
    [InlineData("=200+34", "0000", 0, "0234")]
    [InlineData("=DATE(1990,4,3)", "", 14, "1990-04-03")]
    [InlineData("=DATE(1990,4,3)", "dd/mm/yyyy", 0, "1990-04-03")]
    [InlineData("=1000+1000", "", 0, "2000")]
    public void A_formula_cell_shows_its_saved_value_in_the_cells_number_format(string formula, string format, int formatId, string expected)
    {
        var file = Xlsx(sheet =>
        {
            sheet.Cell(1, 1).Value = "Postcode";
            var cell = sheet.Cell(2, 1);
            cell.FormulaA1 = formula;
            if (format.Length > 0) cell.Style.NumberFormat.Format = format;
            if (formatId > 0) cell.Style.NumberFormat.NumberFormatId = formatId;
        });
        Assert.Equal(expected, ImportFileReader.Read(file, "people.xlsx").Rows.Single().Cells[0]);
    }
}
