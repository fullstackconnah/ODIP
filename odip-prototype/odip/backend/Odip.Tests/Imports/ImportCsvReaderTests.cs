using System.Text;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

public class ImportCsvReaderTests
{
    private static IEnumerable<string> Rows(byte[] content) => ImportCsvReader.Read(content).Records.Select(r => string.Join("|", r));
    private static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);

    [Fact]
    public void Reads_rows_ending_in_CRLF_or_LF_and_a_last_row_with_no_newline()
    {
        Assert.Equal(new[] { "First name|Last name", "Ava|Stone", "Ben|Lee", "Cal|Wu" }, Rows(Utf8("First name,Last name\r\nAva,Stone\nBen,Lee\r\nCal,Wu")));
    }

    [Fact]
    public void Drops_a_UTF8_byte_order_mark()
    {
        var rows = ImportCsvReader.Read([0xEF, 0xBB, 0xBF, .. Utf8("First name,Last name\r\nAva,Stone\r\n")]).Records;
        Assert.Equal("First name", rows[0][0]);
    }

    [Fact]
    public void Keeps_commas_quotes_and_line_breaks_inside_a_quoted_field()
    {
        var rows = ImportCsvReader.Read(Utf8("Name,Note,Address\r\n\"Stone, Ava\",\"Said \"\"hi\"\"\",\"1 Main St\r\nSydney\"\r\nBen,x,y\r\n")).Records;
        Assert.Equal(3, rows.Count);
        Assert.Equal(new[] { "Stone, Ava", "Said \"hi\"", "1 Main St\r\nSydney" }, rows[1]);
        Assert.Equal(new[] { "Ben", "x", "y" }, rows[2]);
    }

    [Fact]
    public void Keeps_empty_cells_including_a_trailing_one()
    {
        Assert.Equal(new[] { "a||c|" }, Rows(Utf8("a,,c,\n")));
    }

    [Fact]
    public void Refuses_an_unclosed_quote_naming_the_line_it_starts_on()
    {
        var ex = Assert.Throws<ImportException>(() => ImportCsvReader.Read(Utf8("a,b\n\"unclosed,c\nd,e\n")));
        Assert.Equal("Line 2 has an opening quote with no closing quote.", ex.Message);
    }

    [Fact]
    public void Refuses_text_that_is_not_UTF8()
    {
        // "Zoë" as Windows-1252, which is what Excel's plain "CSV" writes on Windows.
        var ex = Assert.Throws<ImportException>(() => ImportCsvReader.Read([0x5A, 0x6F, 0xEB, 0x0D, 0x0A]));
        Assert.Equal("The file isn't UTF-8 text. In Excel, save it as \"CSV UTF-8\", or upload the .xlsx file.", ex.Message);
    }

    [Fact]
    public void Stores_at_most_the_header_and_the_row_limit_but_counts_every_non_blank_record()
    {
        var csv = "First name,Last name\n" + string.Concat(Enumerable.Range(0, 10_000).Select(i => $"A{i},B{i}\n"));
        var read = ImportCsvReader.Read(Utf8(csv));
        Assert.Equal(10_001, read.NonBlankRecords);
        Assert.Equal(1 + ImportFileReader.MaxRows, read.Records.Count);
    }

    [Fact]
    public void Blank_records_share_one_empty_list_instance()
    {
        var records = ImportCsvReader.Read(Utf8("a\n\n,\nb\n")).Records;
        Assert.Equal(4, records.Count);
        Assert.Same(records[1], records[2]);
        Assert.Empty(records[1]);
    }

    [Fact]
    public void An_unclosed_quote_after_the_row_limit_still_names_its_line()
    {
        var csv = "First name,Last name\n" + string.Concat(Enumerable.Range(0, 2001).Select(i => $"A{i},B{i}\n")) + "\"unclosed,c\n";
        var ex = Assert.Throws<ImportException>(() => ImportCsvReader.Read(Utf8(csv)));
        Assert.Equal("Line 2003 has an opening quote with no closing quote.", ex.Message);
    }
}
