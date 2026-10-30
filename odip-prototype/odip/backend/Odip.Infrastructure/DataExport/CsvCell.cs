using System.Text.RegularExpressions;

namespace Odip.Infrastructure.DataExport;

/// <summary>
/// One CSV cell of the data export. Every file in the ZIP goes through this.
/// <see cref="Quote"/> is RFC 4180: a value holding a comma, a double quote, CR or LF is wrapped in quotes, with each quote doubled.
/// <see cref="Text"/> is for text a person typed. A value starting with =, +, -, @, a tab or a CR opens as a formula in Excel or Sheets, so it
/// gets a leading ' first (OWASP CSV injection).
/// A phone number (a + then digits and spaces) is exempt: a spreadsheet reads it as a plain number, never a formula.
/// Values the export formats itself (numbers, dates, enums) use Quote only, so a negative amount stays a number.
/// BprCsvService keeps its own escaping, because the NDIA's upload format must not change.
/// </summary>
public static class CsvCell
{
    private static readonly char[] NeedsQuotes = [',', '"', '\r', '\n'];

    // \z, not $: $ also matches before a trailing newline.
    private static readonly Regex PhoneNumber = new(@"^\+ *[0-9][0-9 ]*\z");

    public static string Quote(string value) =>
        value.IndexOfAny(NeedsQuotes) < 0 ? value : "\"" + value.Replace("\"", "\"\"") + "\"";

    public static string Text(string value) =>
        Quote(value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' && !PhoneNumber.IsMatch(value) ? "'" + value : value);
}
