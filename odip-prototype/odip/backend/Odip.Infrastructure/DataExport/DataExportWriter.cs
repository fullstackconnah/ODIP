using System.Data;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DataExport;

/// <summary>
/// Writes one organisation's data export as a ZIP straight onto <c>output</c>, one entry at a time. Neither the archive nor any table is held in
/// memory: rows stream from the database (AsAsyncEnumerable) into a CSV entry, and the stream is flushed after each file.
/// The order:
/// - a CSV per table (UTF-8 with a BOM, CRLF, RFC 4180);
/// - the intake PDFs under documents/;
/// - README.txt;
/// - manifest.csv LAST. The manifest needs the counts, so a ZIP that holds one is complete.
/// The central directory is written only after the manifest, so a failure part-way leaves bytes that no tool opens as a whole ZIP.
/// </summary>
public static class DataExportWriter
{
    public const string ManifestName = "manifest.csv";
    public const string ReadmeName = "README.txt";
    private static readonly UTF8Encoding Utf8WithBom = new(encoderShouldEmitUTF8Identifier: true);

    public static async Task WriteAsync(Stream output, OdipDbContext db, Guid tenantId, IReadOnlyList<ExportTable> tables,
        DateTime generatedAtUtc, string build, CancellationToken ct)
    {
        // One snapshot for every file, so they agree with each other and with the manifest (a row added mid-export is in all of them or none).
        await using var snapshot = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct) : null;

        // No `using`: disposing the archive writes its central directory, which must happen only after the manifest, never while an
        // exception unwinds.
        var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);
        var counts = new List<(string File, long Rows)>();
        foreach (var table in tables)
        {
            counts.Add((table.FileName, await WriteTableAsync(zip, db, tenantId, table, ct)));
            await output.FlushAsync(ct);
        }
        counts.Add((ExportTables.DocumentsFolder, await WriteDocumentsAsync(zip, db, tenantId, output, ct)));
        await WriteTextAsync(zip, ReadmeName, Readme(db, tables, generatedAtUtc, build), ct);
        await WriteTextAsync(zip, ManifestName, Manifest(counts, generatedAtUtc, build), ct);
        zip.Dispose();
        // Not ct: the ZIP is whole once Dispose has written its end. A client leaving now must not fail the export (and cost its audit row).
        await output.FlushAsync(CancellationToken.None);
    }

    private static async Task<long> WriteTableAsync(ZipArchive zip, OdipDbContext db, Guid tenantId, ExportTable table, CancellationToken ct)
    {
        var columns = ExportTables.Columns(db.Model, table);
        // Disposed only on success: disposing while a database error unwinds would write to a connection that may be dead, and that
        // exception would replace the real cause in the log.
        var writer = new StreamWriter(zip.CreateEntry(table.FileName).Open(), Utf8WithBom);
        await writer.WriteAsync(string.Join(',', columns.Select(c => CsvCell.Quote(c.Name))) + "\r\n");
        long rows = 0;
        await foreach (var row in table.Rows(db, tenantId).AsAsyncEnumerable().WithCancellation(ct))
        {
            await writer.WriteAsync(string.Join(',', columns.Select(c => c.Cell(row))) + "\r\n");
            rows++;
        }
        await writer.DisposeAsync();
        return rows;
    }

    private static async Task<long> WriteDocumentsAsync(ZipArchive zip, OdipDbContext db, Guid tenantId, Stream output, CancellationToken ct)
    {
        var pdfs = db.ParticipantIntakeSnapshots.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => new { s.ParticipantId, s.Revision, s.PdfContent });
        long files = 0;
        await foreach (var pdf in pdfs.AsAsyncEnumerable().WithCancellation(ct))
        {
            // (TenantId, ParticipantId, Revision) is unique, so the name is too.
            var name = $"{ExportTables.DocumentsFolder}{pdf.ParticipantId:D}-intake-r{pdf.Revision.ToString(CultureInfo.InvariantCulture)}.pdf";
            await using (var entry = zip.CreateEntry(name, CompressionLevel.NoCompression).Open())
                await entry.WriteAsync(pdf.PdfContent, ct);
            await output.FlushAsync(ct);
            files++;
        }
        return files;
    }

    private static async Task WriteTextAsync(ZipArchive zip, string name, string text, CancellationToken ct)
    {
        await using var writer = new StreamWriter(zip.CreateEntry(name).Open(), Utf8WithBom);
        await writer.WriteAsync(text.AsMemory(), ct);
    }

    private static string Manifest(IEnumerable<(string File, long Rows)> counts, DateTime generatedAtUtc, string build)
    {
        var at = ExportValue.Cell(generatedAtUtc, wallClock: false);
        var csv = new StringBuilder("file,rows,generated_at,odip_build\r\n");
        foreach (var (file, rows) in counts)
            csv.Append(CsvCell.Quote(file)).Append(',').Append(rows.ToString(CultureInfo.InvariantCulture)).Append(',').Append(at).Append(',').Append(CsvCell.Text(build)).Append("\r\n");
        return csv.ToString();
    }

    private static string Readme(OdipDbContext db, IReadOnlyList<ExportTable> tables, DateTime generatedAtUtc, string build)
    {
        var text = new StringBuilder();
        text.Append("Bunya Support data export\r\n");
        // First, because the ZIP travels without the Settings tab's warning.
        text.Append("This export holds personal and health information about participants and staff, for example in participants.csv, medications.csv, ");
        text.Append("participant-health-conditions.csv, restrictive-practices.csv, incidents.csv and staff.csv. ");
        text.Append("Store it securely and share it only with people who need it.\r\n");
        text.Append("Made ").Append(ExportValue.Cell(generatedAtUtc, wallClock: false)).Append(" by Bunya Support build ").Append(build).Append(".\r\n\r\n");

        text.Append("FILES\r\n");
        foreach (var table in tables) text.Append(table.FileName).Append(": ").Append(table.Description).Append("\r\n");
        text.Append(ExportTables.DocumentsFolder).Append(": the PDF of each completed intake, named <participant id>-intake-r<revision>.pdf.\r\n");
        text.Append(ManifestName).Append(": each file and how many rows it holds. It is written last, so a ZIP without it is incomplete.\r\n\r\n");

        text.Append("HOW THE FILES ARE WRITTEN\r\n");
        text.Append("Each CSV file is UTF-8 with one header row. A value holding a comma, a quote or a line break is in double quotes (RFC 4180).\r\n");
        text.Append("A value someone typed that starts with =, +, -, @, a tab or a carriage return has a ' added in front, so a spreadsheet shows it as text instead of running it. A phone number such as +61 412 345 678 is left as it is.\r\n");
        text.Append("Times that record when something happened are in UTC and end in Z, for example 2026-10-14T05:04:00Z.\r\n");
        text.Append("Dates are YYYY-MM-DD. Times of day, such as a shift's start and end, are your local time as HH:MM:SS.\r\n");
        text.Append("These columns are your local time as they were typed or scheduled, with no zone:\r\n");
        foreach (var table in tables)
            foreach (var column in ExportTables.Columns(db.Model, table).Where(c => c.WallClock))
                text.Append("  ").Append(table.FileName).Append(": ").Append(column.Name).Append("\r\n");
        text.Append("Ids are the same in every file: a ParticipantId in one file is the Id of a row in participants.csv.\r\n\r\n");

        text.Append("NOT INCLUDED\r\n");
        foreach (var why in ExportTables.LeftOut.Values) text.Append("- ").Append(why).Append("\r\n");
        foreach (var table in tables)
            foreach (var (column, why) in table.Omit)
                text.Append("- ").Append(table.FileName).Append(" leaves out ").Append(column).Append(": ").Append(why).Append(".\r\n");
        text.Append("- Sign-in accounts. They are held by the sign-in service, not in Bunya Support's database.\r\n");
        text.Append("- Agreements, invoices and other PDFs that Bunya Support creates when you open them. Their details are in the CSV files.\r\n");
        return text.ToString();
    }
}
