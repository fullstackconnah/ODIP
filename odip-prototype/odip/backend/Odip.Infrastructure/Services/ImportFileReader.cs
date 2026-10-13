using System.Globalization;
using ClosedXML.Excel;

namespace Odip.Infrastructure.Services;

/// <summary>One data row: its spreadsheet row number (the header is row 1) and its trimmed cells.</summary>
public sealed record ImportRow(int RowNumber, IReadOnlyList<string> Cells);

/// <summary>An uploaded file as a header row and data rows.</summary>
public sealed record ImportTable(IReadOnlyList<string> Headers, IReadOnlyList<ImportRow> Rows)
{
    /// <summary>The cell, or "" when the row is shorter than the header.</summary>
    public string Cell(ImportRow row, int column) => column < row.Cells.Count ? row.Cells[column] : "";
}

/// <summary>
/// Reads an onboarding-import upload in memory (it is never written to disk) and applies the file-level rules before any matching: .csv or .xlsx,
/// not empty, at most 5 MB, a header row in the first row, at least one and at most 2,000 data rows. Wholly blank rows are dropped.
/// </summary>
public static class ImportFileReader
{
    public const int MaxRows = 2000;
    public const int MaxBytes = 5 * 1024 * 1024;

    public static ImportTable Read(byte[] content, string fileName)
    {
        if (content.Length == 0) throw new ImportException("The file is empty.");
        if (content.Length > MaxBytes) throw new ImportException("The file is over 5 MB. Split it into smaller files and import each one.");
        var lines = Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".csv" => ImportCsvReader.Read(content),
            ".xlsx" => ReadXlsx(content),
            _ => throw new ImportException("Upload a .csv or .xlsx file. An older .xls workbook can be saved as .xlsx from Excel."),
        };

        if (lines.Count == 0 || lines[0].All(string.IsNullOrWhiteSpace))
            throw new ImportException("The file has no header row. Put the column names in the first row.");
        var headers = lines[0].Select((h, i) => string.IsNullOrWhiteSpace(h) ? $"Column {i + 1}" : h.Trim()).ToList();
        var rows = new List<ImportRow>();
        for (var i = 1; i < lines.Count; i++)
            if (!lines[i].All(string.IsNullOrWhiteSpace))
                rows.Add(new ImportRow(i + 1, lines[i].Select(c => c.Trim()).ToList()));

        if (rows.Count == 0) throw new ImportException("The file has a header row but no data rows.");
        if (rows.Count > MaxRows)
            throw new ImportException(string.Format(CultureInfo.InvariantCulture,
                "The file has {0:N0} rows. Import at most {1:N0} at a time: split the file and import each part.", rows.Count, MaxRows));
        return new ImportTable(headers, rows);
    }

    /// <summary>The first visible sheet, from A1 to its last used cell.</summary>
    private static List<List<string>> ReadXlsx(byte[] content)
    {
        XLWorkbook workbook;
        try { workbook = new XLWorkbook(new MemoryStream(content)); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new ImportException("The file could not be read as an Excel (.xlsx) workbook.");
        }

        using (workbook)
        {
            var sheet = workbook.Worksheets.FirstOrDefault(s => s.Visibility == XLWorksheetVisibility.Visible);
            // Contents only: the template formats whole columns as text, and formatting must not stretch the range to the sheet's last row.
            var used = sheet?.RangeUsed(XLCellsUsedOptions.Contents);
            if (sheet is null || used is null) return new List<List<string>>();
            var lastRow = used.LastRow().RowNumber();
            var lastColumn = used.LastColumn().ColumnNumber();
            var lines = new List<List<string>>(lastRow);
            for (var r = 1; r <= lastRow; r++)
            {
                var cells = new List<string>(lastColumn);
                for (var c = 1; c <= lastColumn; c++) cells.Add(CellText(sheet.Cell(r, c)));
                lines.Add(cells);
            }
            return lines;
        }
    }

    // A date cell becomes yyyy-MM-dd, which ImportValues reads; any other cell is the text Excel shows, so a number formatted to keep its leading
    // zero (a postcode, a phone) keeps it.
    private static string CellText(IXLCell cell) =>
        cell.DataType == XLDataType.DateTime
            ? cell.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : cell.GetFormattedString();
}
