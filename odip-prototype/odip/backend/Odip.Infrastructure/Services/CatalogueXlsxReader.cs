using System.Globalization;
using ClosedXML.Excel;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>What one NDIA support catalogue workbook holds, read but not yet compared with the database.</summary>
public sealed record ParsedCatalogue(
    CatalogueFileFormat Format,
    string DetectedVersion,
    DateOnly EffectiveFrom,
    string SourceDocument,
    IReadOnlyList<CatalogueImportRowDto> Rows,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Reads an NDIA support catalogue workbook in either of the two formats NDIA has published, told apart by the header row alone:
/// <list type="bullet">
/// <item><b>2026-27</b>: National, Remote and Very Remote price columns. Remote and Very Remote are blank where the item is not eligible for the loading.</item>
/// <item><b>2025-26</b>: one price column per state (ACT, NSW, NT, QLD, SA, TAS, VIC, WA) plus Remote and Very Remote. The eight state columns are identical
/// on every row of the real file, so the common value is the National price.</item>
/// </list>
/// Every visible sheet with a catalogue header is read (Current and Legacy; NDIA's 2025-26 file also carries two hidden working sheets, which are
/// not catalogue data), every row is kept, and each row's start and end dates come from the file. Numbers, dates and text are read by the type of the
/// cell, never through its display format, so the same figures come out under any culture.
/// </summary>
public static class CatalogueXlsxReader
{
    private static readonly string[] States = { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" };
    private const int MaxWarningLines = 12;

    public static ParsedCatalogue Read(Stream xlsx, string? sourceDocument)
    {
        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(xlsx);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new InvalidOperationException("The file could not be read as an Excel (.xlsx) workbook.", ex);
        }

        using (workbook)
        {
            var rows = new List<CatalogueImportRowDto>();
            var warnings = new List<string>();
            CatalogueFileFormat? format = null;

            foreach (var sheet in workbook.Worksheets)
            {
                if (sheet.Visibility != XLWorksheetVisibility.Visible) continue;
                var layout = SheetLayout.Detect(sheet);
                if (layout is null)
                {
                    warnings.Add($"Sheet \"{sheet.Name}\" was skipped: it has no header row with \"Support Item Number\", \"Start date\", \"End Date\" and National / Remote / Very Remote or per-state price columns.");
                    continue;
                }
                format ??= layout.Format;
                try
                {
                    ReadSheet(sheet, layout, sheet.Name.Contains("Legacy", StringComparison.OrdinalIgnoreCase), rows, warnings);
                }
                catch (Exception ex) when (ex is not OperationCanceledException and not InvalidOperationException)
                {
                    // A damaged cell or a workbook feature the library cannot read: the upload is refused with a message, not a server error.
                    throw new InvalidOperationException($"Sheet \"{sheet.Name}\" could not be read as a support catalogue ({ex.Message}).", ex);
                }
            }

            if (rows.Count == 0)
                throw new InvalidOperationException(
                    "No support items found. Upload the NDIS Support Catalogue .xlsx (the 2026-27 or 2025-26 file): a sheet whose header row has " +
                    "\"Support Item Number\", \"Start date\", \"End Date\" and either National / Remote / Very Remote or per-state price columns.");

            rows = DropDuplicates(rows, warnings);
            var currentStarts = rows.Where(r => !r.IsLegacy).Select(r => r.EffectiveFrom).ToList();
            var effectiveFrom = (currentStarts.Count > 0 ? currentStarts : rows.Select(r => r.EffectiveFrom).ToList()).Min();
            var version = FinancialYear(effectiveFrom);
            var source = SafeFileName(sourceDocument) ?? $"Support Catalogue {version}";

            return new ParsedCatalogue(format!.Value, version, effectiveFrom, source, rows.Select(r => r with { SourceDocument = source }).ToList(), Limit(warnings));
        }
    }

    // ── Sheets ────────────────────────────────────────────────────────────────────

    private sealed class SheetLayout
    {
        public int HeaderRow { get; }
        public CatalogueFileFormat Format { get; }
        private readonly Dictionary<string, int> _columns;

        private SheetLayout(int headerRow, CatalogueFileFormat format, Dictionary<string, int> columns)
        {
            HeaderRow = headerRow;
            Format = format;
            _columns = columns;
        }

        /// <summary>The first listed header that exists, as a 1-based column index; 0 when none does.</summary>
        public int Col(params string[] names)
        {
            foreach (var name in names)
                if (_columns.TryGetValue(name, out var index)) return index;
            return 0;
        }

        public static SheetLayout? Detect(IXLWorksheet sheet)
        {
            for (var r = 1; r <= 10; r++)
            {
                var first = Text(sheet.Cell(r, 1));
                if (!first.Contains("Support Item Number", StringComparison.OrdinalIgnoreCase) && !first.Contains("SupportItemNumber", StringComparison.OrdinalIgnoreCase))
                    continue;

                var columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                var lastColumn = sheet.LastColumnUsed()?.ColumnNumber() ?? 30;
                for (var c = 1; c <= lastColumn; c++)
                {
                    var header = Text(sheet.Cell(r, c));
                    if (header.Length > 0 && !columns.ContainsKey(header)) columns[header] = c;
                }
                if (!columns.ContainsKey("Start date") || (!columns.ContainsKey("Support Item Number") && !columns.ContainsKey("SupportItemNumber"))) return null;
                if (columns.ContainsKey("National")) return new SheetLayout(r, CatalogueFileFormat.NationalRemote, columns);
                if (States.All(columns.ContainsKey)) return new SheetLayout(r, CatalogueFileFormat.StateColumns, columns);
                return null;
            }
            return null;
        }
    }

    private static void ReadSheet(IXLWorksheet sheet, SheetLayout layout, bool isLegacy, List<CatalogueImportRowDto> rows, List<string> warnings)
    {
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? layout.HeaderRow;
        var colCode = layout.Col("Support Item Number", "SupportItemNumber");
        var unknownTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var r = layout.HeaderRow + 1; r <= lastRow; r++)
        {
            var code = Text(sheet.Cell(r, colCode));
            if (code.Length == 0) continue;

            IXLCell At(params string[] headers) => sheet.Cell(r, layout.Col(headers) is var c and > 0 ? c : 1);
            string Opt(params string[] headers) => layout.Col(headers) > 0 ? Text(At(headers)) : string.Empty;
            decimal? Price(string header) => layout.Col(header) > 0 ? ReadPrice(At(header)) : null;

            var start = ReadDate(At("Start date"));
            var endRead = layout.Col("End Date") > 0 ? ReadDate(At("End Date")) : null;
            DateOnly? end = endRead is { Year: >= 9999 } ? null : endRead;
            if (start is null)
            {
                warnings.Add($"Row {r} ({code}) on sheet \"{sheet.Name}\" was skipped: its start date could not be read.");
                continue;
            }
            if (end is { } e && e < start)
            {
                warnings.Add(FormattableString.Invariant($"Row {r} ({code}) on sheet \"{sheet.Name}\" was skipped: its end date {e:yyyy-MM-dd} is before its start date {start:yyyy-MM-dd}."));
                continue;
            }

            // Prices. 2026-27 has National / Remote / Very Remote; 2025-26 has eight state columns, Remote and Very Remote. The eight state
            // limits stay on the row because the claim screens still read them: a 2026-27 import fills all eight with the National price.
            decimal? national, remote = Price("Remote"), veryRemote = Price("Very Remote");
            var states = new decimal[8];
            if (layout.Format == CatalogueFileFormat.NationalRemote)
            {
                national = Price("National");
                Array.Fill(states, national ?? 0m);
            }
            else
            {
                var read = States.Select(s => Price(s)).ToArray();
                for (var i = 0; i < states.Length; i++) states[i] = read[i] ?? 0m;
                var present = read.Where(p => p is not null).Select(p => p!.Value).ToList();
                national = present.Count == 0 ? null : present.All(p => p == present[0]) ? present[0] : read[Array.IndexOf(States, "VIC")] ?? present[0];
                if (present.Count > 0 && !present.All(p => p == present[0]))
                    warnings.Add($"{code}: the state prices differ; the National price was taken from VIC.");
            }

            var registrationGroup = Opt("Registration Group Number");
            if (registrationGroup.Length is > 0 and < 4 && registrationGroup.All(char.IsDigit)) registrationGroup = registrationGroup.PadLeft(4, '0');
            if (registrationGroup.Length == 0) registrationGroup = code.Split('_') is { Length: >= 3 } parts ? parts[2] : string.Empty;

            var classification = CatalogueClassifier.Classify(code, registrationGroup);
            var group = CatalogueGroups.For(classification);
            var (outcomeDomain, supportPurpose) = ReadOutcomeAndPurpose(code);
            var unit = Opt("Unit");

            var typeText = Opt("Type");
            var type = ReadType(typeText, Opt("Quote"));
            if (type is null && typeText.Length > 0 && typeText != "0") unknownTypes.Add(typeText);

            rows.Add(new CatalogueImportRowDto
            {
                ItemNumber = code,
                Description = Truncate(Opt("Support Item Name", "Item Name", "Description") is { Length: > 0 } name ? name : code, 500),
                DayType = classification.DayType ?? ClaimDayType.Weekday,
                IsIntensive = classification.IsIntensive,
                PriceLimit_ACT = states[0], PriceLimit_NSW = states[1], PriceLimit_NT = states[2], PriceLimit_QLD = states[3],
                PriceLimit_SA = states[4], PriceLimit_TAS = states[5], PriceLimit_VIC = states[6], PriceLimit_WA = states[7],
                PriceLimit_Remote = remote ?? 0m,
                PriceLimit_VeryRemote = veryRemote ?? 0m,
                Unit = unit.Length == 0 ? "H" : Truncate(unit, 10),
                RegistrationGroup = registrationGroup.Length == 0 ? null : Truncate(registrationGroup, 4),
                SupportCategoryNumber = layout.Col("Support Category Number") > 0 ? ReadInt(At("Support Category Number")) : null,
                PaceSupportCategoryNumber = layout.Col("Support Category Number (PACE)") > 0 ? ReadInt(At("Support Category Number (PACE)")) : null,
                OutcomeDomain = outcomeDomain,
                SupportPurpose = supportPurpose,
                CatalogueType = type,
                NonFaceToFace = ReadFlag(Opt("Non-Face-to-Face Support Provision")),
                ProviderTravel = ReadFlag(Opt("Provider Travel")),
                ShortNoticeCancellation = ReadFlag(Opt("Short Notice Cancellations.", "Short Notice Cancellations")),
                NdiaRequestedReports = ReadFlag(Opt("NDIA Requested Reports")),
                IrregularSil = ReadFlag(Opt("Irregular SIL Supports")),
                IsLegacy = isLegacy,
                EffectiveFrom = start.Value,
                EffectiveTo = end,
                PriceNational = national,
                PriceRemote = remote,
                PriceVeryRemote = veryRemote,
                Family = classification.Family.ToString(),
                GroupCode = group.GroupCode,
            });
        }

        foreach (var unknown in unknownTypes)
            warnings.Add($"Sheet \"{sheet.Name}\" has the Type \"{unknown}\", which is not one of Priced Supports, Quotable Supports or Unit Price = $1; those rows have no type.");
    }

    /// <summary>One row per code and start date: the first one read (the Current sheet comes before Legacy) wins.</summary>
    private static List<CatalogueImportRowDto> DropDuplicates(List<CatalogueImportRowDto> rows, List<string> warnings)
    {
        var seen = new HashSet<(string, DateOnly)>();
        var kept = new List<CatalogueImportRowDto>(rows.Count);
        foreach (var row in rows)
        {
            if (seen.Add((row.ItemNumber, row.EffectiveFrom))) kept.Add(row);
            else warnings.Add(FormattableString.Invariant($"{row.ItemNumber} appears more than once with the start date {row.EffectiveFrom:yyyy-MM-dd}; the first row was kept."));
        }
        return kept;
    }

    // ── Cells ─────────────────────────────────────────────────────────────────────

    private static string Text(IXLCell cell)
    {
        var v = cell.Value;
        if (v.IsBlank) return string.Empty;
        if (v.IsText) return v.GetText().Trim();
        if (v.IsNumber) return v.GetNumber().ToString("0.############", CultureInfo.InvariantCulture);
        if (v.IsBoolean) return v.GetBoolean() ? "TRUE" : "FALSE";
        if (v.IsDateTime) return DateOnly.FromDateTime(v.GetDateTime()).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return string.Empty;
    }

    private static decimal? ReadPrice(IXLCell cell)
    {
        var v = cell.Value;
        if (v.IsNumber)
        {
            var number = v.GetNumber();
            return double.IsFinite(number) ? Math.Round((decimal)number, 2, MidpointRounding.AwayFromZero) : null;
        }
        if (v.IsText)
        {
            var text = v.GetText().Replace("$", string.Empty).Replace(",", string.Empty).Trim();
            if (decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
                return Math.Round(parsed, 2, MidpointRounding.AwayFromZero);
        }
        return null;
    }

    private static int? ReadInt(IXLCell cell)
    {
        var v = cell.Value;
        if (v.IsNumber)
        {
            var number = v.GetNumber();
            return double.IsFinite(number) && Math.Abs(number % 1) < 1e-9 && Math.Abs(number) < int.MaxValue ? (int)number : null;
        }
        return v.IsText && int.TryParse(v.GetText().Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    /// <summary>NDIA writes dates as the number or the text yyyyMMdd (99991231 = no end); a real Excel date, ISO text and dd/MM/yyyy text also read.</summary>
    private static DateOnly? ReadDate(IXLCell cell)
    {
        var v = cell.Value;
        if (v.IsBlank) return null;
        if (v.IsDateTime) return DateOnly.FromDateTime(v.GetDateTime());
        if (v.IsNumber)
        {
            var number = v.GetNumber();
            if (!double.IsFinite(number)) return null;
            if (number >= 19000101 && number <= 99991231) return FromYyyyMmDd((long)Math.Round(number));
            return number >= 1 && number < 2958466 ? DateOnly.FromDateTime(DateTime.FromOADate(number)) : null;
        }
        if (v.IsText)
        {
            var text = v.GetText().Trim();
            if (text.Length == 8 && text.All(char.IsDigit)) return FromYyyyMmDd(long.Parse(text, CultureInfo.InvariantCulture));
            if (DateOnly.TryParseExact(text, new[] { "yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return parsed;
        }
        return null;
    }

    private static DateOnly? FromYyyyMmDd(long value)
    {
        var year = (int)(value / 10000);
        var month = (int)(value / 100 % 100);
        var day = (int)(value % 100);
        if (year < 1900 || month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month)) return null;
        return new DateOnly(year, month, day);
    }

    /// <summary>"Priced Supports" (2025-26: "Price Limited Supports"), "Quotable Supports", "Unit Price = $1". A blank Type falls back to the Quote column; anything else is unknown (null).</summary>
    private static CatalogueItemType? ReadType(string type, string quote)
    {
        if (type.Equals("Priced Supports", StringComparison.OrdinalIgnoreCase) || type.Equals("Price Limited Supports", StringComparison.OrdinalIgnoreCase)) return CatalogueItemType.Priced;
        if (type.Equals("Quotable Supports", StringComparison.OrdinalIgnoreCase)) return CatalogueItemType.Quotable;
        if (type.StartsWith("Unit Price", StringComparison.OrdinalIgnoreCase)) return CatalogueItemType.UnitPriceOne;
        if (type.Length == 0 || type == "0") return quote.Equals("Yes", StringComparison.OrdinalIgnoreCase) ? CatalogueItemType.Quotable : null;
        return null;
    }

    private static CatalogueClaimFlag? ReadFlag(string text) => text.ToUpperInvariant() switch
    {
        "Y" => CatalogueClaimFlag.Yes,
        "N" => CatalogueClaimFlag.No,
        "NA" or "N/A" => CatalogueClaimFlag.NotApplicable,
        _ => null,
    };

    /// <summary>The 4th and 5th parts of a structured code (outcome domain, support purpose), as published. Null for a code that does not have them.</summary>
    private static (int? OutcomeDomain, int? SupportPurpose) ReadOutcomeAndPurpose(string code)
    {
        var parts = code.Split('_');
        if (parts.Length < 5) return (null, null);
        return (SingleDigit(parts[3]), SingleDigit(parts[4]));

        static int? SingleDigit(string part) => part.Length == 1 && char.IsDigit(part[0]) ? part[0] - '0' : null;
    }

    // ── Small helpers ─────────────────────────────────────────────────────────────

    private static string FinancialYear(DateOnly date)
    {
        var start = date.Month >= 7 ? date.Year : date.Year - 1;
        return $"{start}-{(start + 1) % 100:D2}";
    }

    private static string? SafeFileName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var file = name.Replace('\\', '/').Split('/').Last().Trim();
        return file.Length == 0 ? null : Truncate(file, 200);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static List<string> Limit(List<string> warnings)
    {
        if (warnings.Count <= MaxWarningLines) return warnings;
        var kept = warnings.Take(MaxWarningLines).ToList();
        kept.Add($"...and {warnings.Count - MaxWarningLines} more.");
        return kept;
    }
}
