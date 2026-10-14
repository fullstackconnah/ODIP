using Odip.Infrastructure.DataExport;
using Xunit;

namespace Odip.Tests.DataExport;

public class CsvCellTests
{
    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("", "")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("line one\r\nline two", "\"line one\r\nline two\"")]
    [InlineData("cr\ronly", "\"cr\ronly\"")]
    [InlineData("-12.50", "-12.50")]
    public void Quote_follows_rfc_4180_and_nothing_else(string value, string expected) => Assert.Equal(expected, CsvCell.Quote(value));

    [Theory]
    [InlineData("=SUM(A1:A9)", "'=SUM(A1:A9)")]
    [InlineData("+61 400 000 000", "'+61 400 000 000")]
    [InlineData("-cmd", "'-cmd")]
    [InlineData("@SUM(1)", "'@SUM(1)")]
    [InlineData("\tindent", "'\tindent")]
    [InlineData("\rreturn", "\"'\rreturn\"")]
    [InlineData("=HYPERLINK(\"http://x\",\"y\")", "\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"")]
    [InlineData("a = b", "a = b")]
    [InlineData("O'Brien", "O'Brien")]
    [InlineData("", "")]
    public void Text_guards_a_leading_formula_character_then_quotes(string value, string expected) => Assert.Equal(expected, CsvCell.Text(value));
}
