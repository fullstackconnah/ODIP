using System.Globalization;
using System.IO.Compression;
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
/// not empty, at most 5 MB (and 50 MB unpacked), a header row in the first row, at most 200 columns, at least one and at most 2,000 data rows.
/// Wholly blank rows are dropped.
/// </summary>
public static class ImportFileReader
{
    public const int MaxRows = 2000;
    public const int MaxBytes = 5 * 1024 * 1024;
    public const int MaxColumns = 200;
    private const long MaxUnpackedBytes = 50 * 1024 * 1024;
    private const string TooManyColumns = "This file has more than 200 columns. Remove the extra columns and try again.";

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
        if (lines[0].Count > MaxColumns) throw new ImportException(TooManyColumns);
        var headers = lines[0].Select((h, i) => string.IsNullOrWhiteSpace(h) ? $"Column {i + 1}" : h.Trim()).ToList();
        var rows = new List<ImportRow>();
        for (var i = 1; i < lines.Count; i++)
            if (!lines[i].All(string.IsNullOrWhiteSpace))
                rows.Add(new ImportRow(i + 1, lines[i].Select(c => c.Trim()).ToList()));

        if (rows.Count == 0) throw new ImportException("The file has a header row but no data rows.");
        if (rows.Count > MaxRows) throw TooManyRows(rows.Count);
        return new ImportTable(headers, rows);
    }

    private static ImportException TooManyRows(int count) => new(string.Format(CultureInfo.InvariantCulture,
        "The file has {0:N0} rows. Import at most {1:N0} at a time: split the file and import each part.", count, MaxRows));

    /// <summary>The first visible sheet, from A1 to its last used cell.</summary>
    private static List<List<string>> ReadXlsx(byte[] content)
    {
        // A small file can unpack to gigabytes, and ClosedXML loads the whole package, so its unpacked size is checked first.
        long unpacked;
        try
        {
            using var zip = new ZipArchive(new MemoryStream(content), ZipArchiveMode.Read);
            unpacked = zip.Entries.Sum(e => e.Length);
        }
        catch (InvalidDataException) { throw new ImportException("The file could not be read as an Excel (.xlsx) workbook."); }
        if (unpacked > MaxUnpackedBytes) throw new ImportException("This file is too large once unpacked.");

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
            // Checked before reading cells: one value far down or far right would otherwise make the loop below read billions of cells.
            if (lastRow - 1 > MaxRows) throw TooManyRows(lastRow - 1);
            if (lastColumn > MaxColumns) throw new ImportException(TooManyColumns);
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
    // zero (a postcode, a phone) keeps it. A formula cell gives the value Excel saved with it: working a formula out could read the whole sheet.
    private static string CellText(IXLCell cell)
    {
        if (cell.HasFormula)
        {
            var saved = cell.CachedValue;
            return saved.IsDateTime ? saved.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : saved.ToString(CultureInfo.InvariantCulture);
        }
        return cell.DataType == XLDataType.DateTime
            ? cell.GetDateTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : cell.GetFormattedString();
    }
}
