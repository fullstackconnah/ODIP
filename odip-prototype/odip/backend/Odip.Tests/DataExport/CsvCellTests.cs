using System.Diagnostics;
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
    [InlineData("+61 400 000 000", "+61 400 000 000")]
    [InlineData("+61 412 345 678", "+61 412 345 678")]
    [InlineData("+61412345678", "+61412345678")]
    [InlineData("+", "'+")]
    [InlineData("+ ", "'+ ")]
    [InlineData("+1+2", "'+1+2")]
    [InlineData("+61-412", "'+61-412")]
    [InlineData("+SUM(A1)", "'+SUM(A1)")]
    [InlineData("+61412\n", "\"'+61412\n\"")]
    [InlineData("+61 412\t", "'+61 412\t")]
    [InlineData("+61 412\r", "\"'+61 412\r\"")]
    [InlineData("+\u0661\u0662", "'+\u0661\u0662")]
    [InlineData("+61 (0) 412", "'+61 (0) 412")]
    [InlineData("+1-555", "'+1-555")]
    [InlineData("+ 5", "+ 5")]
    [InlineData("=1", "'=1")]
    [InlineData("-5", "'-5")]
    [InlineData("@x", "'@x")]
    [InlineData("-cmd", "'-cmd")]
    [InlineData("@SUM(1)", "'@SUM(1)")]
    [InlineData("\tindent", "'\tindent")]
    [InlineData("\rreturn", "\"'\rreturn\"")]
    [InlineData("=HYPERLINK(\"http://x\",\"y\")", "\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"")]
    [InlineData("a = b", "a = b")]
    [InlineData("O'Brien", "O'Brien")]
    [InlineData("", "")]
    public void Text_guards_a_leading_formula_character_then_quotes(string value, string expected) => Assert.Equal(expected, CsvCell.Text(value));

    [Fact]
    public void Text_checks_a_long_near_miss_phone_number_in_linear_time()
    {
        var value = "+" + new string('1', 100_000) + "x";
        var watch = Stopwatch.StartNew();
        var cell = CsvCell.Text(value);
        watch.Stop();
        Assert.Equal("'" + value, cell);
        Assert.True(watch.ElapsedMilliseconds < 1000, $"took {watch.ElapsedMilliseconds} ms");
    }
}
