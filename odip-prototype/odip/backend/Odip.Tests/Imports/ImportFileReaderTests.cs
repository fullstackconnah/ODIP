using System.Text;
using ClosedXML.Excel;
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
}
