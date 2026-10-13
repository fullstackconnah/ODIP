using System.Text;

namespace Odip.Infrastructure.Services;

/// <summary>
/// A small RFC 4180 reader for the onboarding import: comma-separated; a field in double quotes may hold commas, line breaks and "" for one quote;
/// CRLF, LF or CR ends a record; a UTF-8 byte order mark is dropped. The bytes must be UTF-8: Windows-1252 (Excel's plain "CSV") would turn
/// accented names into replacement characters, so it is refused rather than guessed.
/// </summary>
public static class ImportCsvReader
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    public static List<List<string>> Read(byte[] content)
    {
        string text;
        try { text = StrictUtf8.GetString(content); }
        catch (DecoderFallbackException) { throw new ImportException("The file isn't UTF-8 text. In Excel, save it as \"CSV UTF-8\", or upload the .xlsx file."); }
        if (text.Length > 0 && text[0] == '\uFEFF') text = text[1..];

        var records = new List<List<string>>();
        var record = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;
        var line = 1;
        var recordLine = 1;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (inQuotes)
            {
                if (c != '"') { if (c == '\n') line++; field.Append(c); }
                else if (i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else inQuotes = false;
                continue;
            }
            if (c == '"' && field.Length == 0) { inQuotes = true; continue; }
            if (c == ',') { record.Add(field.ToString()); field.Clear(); continue; }
            if (c is '\r' or '\n')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                record.Add(field.ToString());
                field.Clear();
                records.Add(record);
                record = new List<string>();
                recordLine = ++line;
                continue;
            }
            field.Append(c);
        }
        if (inQuotes) throw new ImportException($"Line {recordLine} has an opening quote with no closing quote.");
        if (field.Length > 0 || record.Count > 0) { record.Add(field.ToString()); records.Add(record); }
        return records;
    }
}
