namespace Odip.Infrastructure.DataExport;

/// <summary>
/// One CSV cell of the data export. Every file in the ZIP goes through this.
/// <see cref="Quote"/> is RFC 4180: a value holding a comma, a double quote, CR or LF is wrapped in quotes, with each quote doubled.
/// <see cref="Text"/> is for text a person typed. A value starting with =, +, -, @, a tab or a CR opens as a formula in Excel or Sheets, so it
/// gets a leading ' first (OWASP CSV injection).
/// Values the export formats itself (numbers, dates, enums) use Quote only, so a negative amount stays a number.
/// BprCsvService keeps its own escaping, because the NDIA's upload format must not change.
/// </summary>
public static class CsvCell
{
    private static readonly char[] NeedsQuotes = [',', '"', '\r', '\n'];

    public static string Quote(string value) =>
        value.IndexOfAny(NeedsQuotes) < 0 ? value : "\"" + value.Replace("\"", "\"\"") + "\"";

    public static string Text(string value) =>
        Quote(value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + value : value);
}
