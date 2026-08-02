using System.Globalization;
using System.Text;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Services;

/// <summary>
/// One row of an NDIA bulk payment request file, in the order defined by the
/// "Bulk_File_Upload_Information" spec: RegistrationNumber, NDISNumber,
/// SupportsDeliveredFrom, SupportsDeliveredTo, SupportNumber, ClaimReference,
/// Quantity, Hours, UnitPrice, GSTCode, AuthorisedBy, ParticipantApproved,
/// InKindFundingProgram, ClaimType, CancellationReason, ABNofSupportProvider.
/// Exactly one of <see cref="Quantity"/> / <see cref="Hours"/> must be set.
/// </summary>
public sealed record ProdaClaimRow(
    string RegistrationNumber,
    string NdisNumber,
    DateOnly SupportsDeliveredFrom,
    DateOnly SupportsDeliveredTo,
    string SupportNumber,
    string ClaimReference,
    decimal? Quantity,
    TimeSpan? Hours,
    decimal UnitPrice,
    GSTCode GstCode,
    string AuthorisedBy,
    bool ParticipantApproved,
    string? InKindFundingProgram,
    string ClaimTypeCode,
    string? CancellationReason,
    string? Abn);

/// <summary>
/// Generates the NDIA bulk payment request CSV file per the official
/// "Bulk_File_Upload_Information" spec, and the Oassist file-naming convention
/// (NDISUPLOADddMMyy.csv). Pure — no I/O, no dependencies.
/// </summary>
public static class ProdaBulkFileWriter
{
    /// <summary>NDIA hard cap on records per bulk upload file.</summary>
    public const int MaxRecordsPerFile = 5000;

    private static readonly string[] Header =
    {
        "RegistrationNumber", "NDISNumber", "SupportsDeliveredFrom", "SupportsDeliveredTo",
        "SupportNumber", "ClaimReference", "Quantity", "Hours", "UnitPrice", "GSTCode",
        "AuthorisedBy", "ParticipantApproved", "InKindFundingProgram", "ClaimType",
        "CancellationReason", "ABNofSupportProvider"
    };

    private static readonly HashSet<string> ValidClaimTypeCodes =
        new(StringComparer.Ordinal) { "", "CANC", "REPW", "TRAN", "NF2F" };

    private static readonly HashSet<string> ValidCancellationReasons =
        new(StringComparer.Ordinal) { "NSDH", "NSDF", "NSDT", "NSDO" };

    /// <summary>NDISUPLOADddMMyy.csv, the Oassist bulk-file naming convention.</summary>
    public static string FileName(DateOnly d) => $"NDISUPLOAD{d:ddMMyy}.csv";

    /// <summary>
    /// Renders <paramref name="rows"/> as a complete bulk payment request CSV
    /// (header + rows, CRLF line endings). Throws <see cref="ArgumentException"/>
    /// if there are more than <see cref="MaxRecordsPerFile"/> rows, or a row fails
    /// validation (date order, Quantity/Hours XOR, cancellation-reason rules).
    /// </summary>
    public static string Write(IReadOnlyList<ProdaClaimRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        if (rows.Count > MaxRecordsPerFile)
            throw new ArgumentException(
                $"Bulk file cannot contain more than {MaxRecordsPerFile} records (got {rows.Count}).",
                nameof(rows));

        var sb = new StringBuilder();
        sb.Append(string.Join(",", Header)).Append("\r\n");

        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            ValidateRow(row, i);
            sb.Append(FormatRow(row)).Append("\r\n");
        }

        return sb.ToString();
    }

    /// <summary>
    /// Maps a <see cref="BillableEvent"/> to a <see cref="ProdaClaimRow"/>.
    /// Throws <see cref="ArgumentException"/> if the event's GSTCode is not
    /// P1/P2/P5, or its ClaimType is Variation/Adjustment (not valid bulk-file
    /// claim types — those must be lodged via the PRODA portal).
    /// </summary>
    /// <param name="e">The billable event to map.</param>
    /// <param name="registrationNumber">Provider's NDIS registration number.</param>
    /// <param name="ndisNumber">Participant's NDIS number.</param>
    /// <param name="abn">Support provider's ABN, if applicable.</param>
    /// <param name="claimTypeCodeOverride">
    /// Overrides the ClaimType-code derivation to produce REPW (report writing),
    /// TRAN (travel) or NF2F (non face-to-face) — codes that have no equivalent
    /// on <see cref="Odip.Domain.Enums.ClaimType"/>.
    /// </param>
    /// <param name="authorisedBy">
    /// Name/id of the person authorising the claim. Not modelled on <see cref="BillableEvent"/>,
    /// so it must be supplied by the caller (e.g. the coordinator submitting the batch).
    /// </param>
    /// <param name="inKindFundingProgram">
    /// In-kind funding program code, if this event is claimed against one. Not modelled on
    /// <see cref="BillableEvent"/>; left empty unless supplied.
    /// </param>
    public static ProdaClaimRow FromBillableEvent(
        BillableEvent e,
        string registrationNumber,
        string ndisNumber,
        string? abn,
        string? claimTypeCodeOverride = null,
        string authorisedBy = "",
        string? inKindFundingProgram = null)
    {
        ArgumentNullException.ThrowIfNull(e);

        var claimTypeCode = claimTypeCodeOverride ?? MapClaimType(e);
        var gstCode = MapGstCode(e.GstCode, e.Id);

        return new ProdaClaimRow(
            registrationNumber,
            ndisNumber,
            e.SupportsDeliveredFrom,
            e.SupportsDeliveredTo,
            e.SupportItemNumber,
            e.ClaimReference,
            e.Quantity,
            e.Hours,
            e.UnitPrice,
            gstCode,
            authorisedBy,
            e.ParticipantApproved,
            inKindFundingProgram,
            claimTypeCode,
            e.CancellationReasonCode,
            abn);
    }

    private static string MapClaimType(BillableEvent e) => e.ClaimType switch
    {
        ClaimType.Standard => string.Empty,
        ClaimType.Cancellation => "CANC",
        ClaimType.Variation => throw new ArgumentException(
            $"BillableEvent {e.Id}: ClaimType.Variation is not a valid NDIA bulk-file claim type; " +
            "variation claims must be lodged through the PRODA portal."),
        ClaimType.Adjustment => throw new ArgumentException(
            $"BillableEvent {e.Id}: ClaimType.Adjustment is not a valid NDIA bulk-file claim type; " +
            "adjustment claims must be lodged through the PRODA portal."),
        _ => throw new ArgumentException($"BillableEvent {e.Id}: unrecognised ClaimType '{e.ClaimType}'.")
    };

    private static GSTCode MapGstCode(GSTCode code, Guid eventId) => code switch
    {
        GSTCode.P1 or GSTCode.P2 or GSTCode.P5 => code,
        GSTCode.GST => throw new ArgumentException(
            $"BillableEvent {eventId}: GSTCode.GST is not valid on an NDIS bulk-file claim (only P1/P2/P5 are)."),
        GSTCode.NoGST => throw new ArgumentException(
            $"BillableEvent {eventId}: GSTCode.NoGST is not valid on an NDIS bulk-file claim (only P1/P2/P5 are)."),
        GSTCode.Exempt => throw new ArgumentException(
            $"BillableEvent {eventId}: GSTCode.Exempt is not valid on an NDIS bulk-file claim (only P1/P2/P5 are)."),
        _ => throw new ArgumentException($"BillableEvent {eventId}: unrecognised GSTCode '{code}'.")
    };

    private static void ValidateRow(ProdaClaimRow row, int index)
    {
        if (row.SupportsDeliveredFrom > row.SupportsDeliveredTo)
            throw new ArgumentException(
                $"Row {index}: SupportsDeliveredFrom ({row.SupportsDeliveredFrom:yyyy-MM-dd}) is after " +
                $"SupportsDeliveredTo ({row.SupportsDeliveredTo:yyyy-MM-dd}).");

        if (row.Quantity.HasValue == row.Hours.HasValue)
            throw new ArgumentException(
                $"Row {index}: exactly one of Quantity or Hours must be set (got Quantity={row.Quantity}, Hours={row.Hours}).");

        if (row.GstCode is not (GSTCode.P1 or GSTCode.P2 or GSTCode.P5))
            throw new ArgumentException(
                $"Row {index}: GSTCode '{row.GstCode}' is not valid on a bulk-file claim (only P1/P2/P5 allowed).");

        var claimTypeCode = row.ClaimTypeCode ?? string.Empty;
        if (!ValidClaimTypeCodes.Contains(claimTypeCode))
            throw new ArgumentException(
                $"Row {index}: ClaimType code '{row.ClaimTypeCode}' is not recognised " +
                "(expected empty, CANC, REPW, TRAN or NF2F).");

        if (claimTypeCode == "CANC")
        {
            if (string.IsNullOrWhiteSpace(row.CancellationReason) ||
                !ValidCancellationReasons.Contains(row.CancellationReason))
                throw new ArgumentException(
                    $"Row {index}: ClaimType CANC requires a CancellationReason of NSDH/NSDF/NSDT/NSDO " +
                    $"(got '{row.CancellationReason}').");
        }
        else if (!string.IsNullOrWhiteSpace(row.CancellationReason))
        {
            throw new ArgumentException(
                $"Row {index}: CancellationReason is only valid when ClaimType is CANC (ClaimType is '{claimTypeCode}').");
        }
    }

    private static string FormatRow(ProdaClaimRow row)
    {
        var fields = new[]
        {
            row.RegistrationNumber,
            row.NdisNumber,
            row.SupportsDeliveredFrom.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            row.SupportsDeliveredTo.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            row.SupportNumber,
            row.ClaimReference,
            row.Quantity?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            row.Hours.HasValue ? FormatHours(row.Hours.Value) : string.Empty,
            row.UnitPrice.ToString("0.00", CultureInfo.InvariantCulture),
            row.GstCode.ToString(),
            row.AuthorisedBy,
            row.ParticipantApproved ? "Y" : string.Empty,
            row.InKindFundingProgram ?? string.Empty,
            row.ClaimTypeCode ?? string.Empty,
            row.CancellationReason ?? string.Empty,
            row.Abn ?? string.Empty
        };

        return string.Join(",", fields.Select(EscapeCsv));
    }

    /// <summary>Zero-padded HHH:MM, e.g. 6.5 hours → "006:30".</summary>
    private static string FormatHours(TimeSpan ts)
    {
        var totalHours = (int)Math.Truncate(ts.TotalHours);
        var minutes = Math.Abs(ts.Minutes);
        return $"{totalHours:000}:{minutes:00}";
    }

    private static string EscapeCsv(string? field)
    {
        if (string.IsNullOrEmpty(field))
            return string.Empty;

        return field.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0
            ? "\"" + field.Replace("\"", "\"\"") + "\""
            : field;
    }
}
