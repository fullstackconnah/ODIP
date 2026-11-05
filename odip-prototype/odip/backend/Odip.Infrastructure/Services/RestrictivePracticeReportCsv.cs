using System.Globalization;
using System.Text;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.DataExport;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The monthly restrictive practice report as a CSV, for keying into the Commission portal or filing. One row per use of an as-needed practice; a routine practice, or
/// an as-needed one with no uses, gets one row with the use columns blank. Typed text goes through <see cref="CsvCell.Text"/>, so a leading = + - @ is not run by a spreadsheet.
/// UTF-8 with a byte-order mark and CRLF line ends, as the data export writes them.
/// </summary>
public static class RestrictivePracticeReportCsv
{
    private const string Header = "Participant,Practice type,Description,Use,Authorised from,Authorised to,Month,Due by,Status,Report type,Varied,Also unauthorised,Use date,Use time,Lodged on,Lodged by,Note";

    public static byte[] Build(IEnumerable<RestrictivePracticeReportLineDto> lines)
    {
        var text = new StringBuilder(Header).Append("\r\n");
        foreach (var line in lines)
        {
            var uses = line.Uses.Count == 0 ? new List<DateTime?> { null } : line.Uses.Select(u => (DateTime?)u.LocalDateTime).ToList();
            foreach (var use in uses)
            {
                var r = line.Report;
                string[] cells =
                [
                    CsvCell.Text(line.ParticipantName), CsvCell.Quote(TypeLabel(line.PracticeType)), CsvCell.Text(line.PracticeDescription),
                    line.UseKind == RestrictivePracticeUseKind.Prn ? "As needed" : "Routine",
                    Date(line.AuthorisationDate), Date(line.AuthorisationEndDate), line.Month.ToString("MMMM yyyy", CultureInfo.InvariantCulture), Date(line.DueOn), line.State.ToString(),
                    r == null ? "" : ReportLabel(r.ReportType), r?.VariedKind?.ToString() ?? "", r?.VariedAlsoUnauthorised is { } also ? (also ? "Yes" : "No") : "",
                    use?.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) ?? "", use?.ToString("HH:mm", CultureInfo.InvariantCulture) ?? "",
                    r == null ? "" : Date(r.LodgedOn), CsvCell.Text(r?.LodgedByName ?? ""), CsvCell.Text(r?.Note ?? ""),
                ];
                text.Append(string.Join(',', cells)).Append("\r\n");
            }
        }
        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true);
        return [.. utf8.GetPreamble(), .. utf8.GetBytes(text.ToString())];
    }

    private static string Date(DateOnly? d) => d?.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) ?? "";

    private static string TypeLabel(RestrictivePracticeType t) => t switch
    {
        RestrictivePracticeType.Seclusion => "Seclusion",
        RestrictivePracticeType.ChemicalRestraint => "Chemical restraint",
        RestrictivePracticeType.MechanicalRestraint => "Mechanical restraint",
        RestrictivePracticeType.PhysicalRestraint => "Physical restraint",
        RestrictivePracticeType.EnvironmentalRestraint => "Environmental restraint",
        _ => "Unclassified",
    };

    private static string ReportLabel(RestrictivePracticeReportType t) => t switch
    {
        RestrictivePracticeReportType.UsedAsPerPlan => "Used as per plan",
        RestrictivePracticeReportType.VariedUse => "Varied use",
        RestrictivePracticeReportType.NotUsed => "Not used",
        RestrictivePracticeReportType.Eliminated => "Eliminated",
        RestrictivePracticeReportType.NoServiceProvided => "No service provided",
        RestrictivePracticeReportType.ServiceCeased => "Service provision has ceased",
        _ => "Uses reported",
    };
}
