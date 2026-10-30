using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>A claim line with everything the checks and the file need, loaded once. It decides nothing.</summary>
public sealed record BprRow(
    ClaimLineItem Line, TripClaim Claim, Participant? Participant, PlanType? PlanType,
    SupportCatalogueItem? Item, SupportCatalogueItem? CancelledItem, string State, ProviderSettings? Settings);

/// <summary>One row of the file, as it is written.</summary>
public sealed record BprRowOut(
    string Registration, string NdisNumber, DateOnly From, DateOnly To, string SupportNumber, string Reference,
    decimal? Quantity, decimal? Hours, decimal UnitPrice, string Gst, string ClaimType, string CancellationReason, string Abn);

public class BprCsvService(OdipDbContext db)
{
    // 16 columns: NDIS BPR spec Nov 2025, applies to all providers. The order is the NDIA's.
    public const string Header = "RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,AuthorisedBy,ParticipantApproved,InKindFundingProgram,ClaimType,CancellationReason,ABNofSupportProvider";

    /// <summary>The cancellation item the NDIA wants for a short-notice cancellation: the item's code plus this.</summary>
    public const string CancellationSuffix = "_CA";

    /// <summary>
    /// Loads the lines of ONE organisation, with their claim, participant (a trip line's through its booking, a shift line's through its shift), catalogue rows and settings. A line of another
    /// organisation is simply not returned, so the caller can compare the counts. TripClaim has no query filter, so the claim is scoped here by its trip or participant, as ExportTables.Claims does.
    /// </summary>
    public async Task<List<BprRow>> LoadRowsAsync(Guid tenantId, IReadOnlyCollection<Guid> lineIds, CancellationToken ct)
    {
        var lines = await db.ClaimLineItems.AsNoTracking()
            .Include(l => l.TripClaim).Include(l => l.ParticipantBooking).Include(l => l.Shift)
            .Where(l => lineIds.Contains(l.Id)
                && (db.TripInstances.Any(t => t.Id == l.TripClaim.TripInstanceId && t.TenantId == tenantId)
                    || db.Participants.Any(p => p.Id == l.TripClaim.ParticipantId && p.TenantId == tenantId)))
            .ToListAsync(ct);

        var participantIds = lines.Select(l => l.ParticipantBooking?.ParticipantId ?? l.Shift?.ParticipantId).OfType<Guid>().Distinct().ToList();
        var participants = await db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && participantIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var settings = await db.ProviderSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);

        var codes = lines.Select(l => l.SupportItemCode).Distinct().ToList();
        var cancelCodes = codes.Select(c => c + CancellationSuffix).ToList();
        var catalogue = await db.SupportCatalogueItems.AsNoTracking().Where(i => codes.Contains(i.ItemNumber) || cancelCodes.Contains(i.ItemNumber)).ToListAsync(ct);

        return lines.Select(l =>
        {
            var participantId = l.ParticipantBooking?.ParticipantId ?? l.Shift?.ParticipantId;
            var participant = participantId is { } id && participants.TryGetValue(id, out var p) ? p : null;
            // A trip line follows its booking's plan type, else the participant's; a shift has no override.
            PlanType? planType = participant is null ? null : l.ParticipantBooking?.PlanTypeOverride ?? participant.PlanType;
            // Each engine priced its line in its own state, so the limit is read in the same one.
            var state = l.ShiftId != null
                ? ShiftPriceEstimator.StateFor(participant?.AddressState, settings?.State)
                : HolidayCalendar.Normalise(settings?.State) is { Length: > 0 } s ? s : "VIC";
            return new BprRow(l, l.TripClaim, participant, planType,
                RowFor(catalogue, l.SupportItemCode, l.SupportsDeliveredFrom), RowFor(catalogue, l.SupportItemCode + CancellationSuffix, l.SupportsDeliveredFrom), state, settings);
        }).ToList();
    }

    // shortcut: temporary, until the batch service builds the file (step 5 removes it).
    public async Task<(byte[] Content, string FileName)> GenerateBprCsvAsync(Guid claimId, CancellationToken ct = default)
    {
        var claim = await db.TripClaims.Include(c => c.TripInstance).Include(c => c.Participant).FirstOrDefaultAsync(c => c.Id == claimId, ct)
            ?? throw new KeyNotFoundException($"Claim {claimId} not found");
        var tenantId = claim.TripInstance?.TenantId ?? claim.Participant?.TenantId ?? throw new KeyNotFoundException($"Claim {claimId} not found");
        ProviderSettingsGuard.Require(await db.ProviderSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct));
        var ids = await db.ClaimLineItems.Where(l => l.TripClaimId == claimId).Select(l => l.Id).ToListAsync(ct);
        var rows = (await LoadRowsAsync(tenantId, ids, ct)).Where(r => r.PlanType == PlanType.AgencyManaged);
        return (Write(rows.Select(r => ToOut(r, 1))), $"BPR-{claim.ClaimReference}-{DateTime.UtcNow:yyyyMMdd}.csv");
    }

    /// <summary>The catalogue row valid on a date for a code; the newest version when more than one is valid.</summary>
    private static SupportCatalogueItem? RowFor(List<SupportCatalogueItem> catalogue, string code, DateOnly on)
    {
        var valid = catalogue.Where(i => i.ItemNumber == code && EffectiveCatalogueResolver.IsValidOn(i, on)).ToList();
        return EffectiveCatalogueResolver.NewestVersion(valid).FirstOrDefault();
    }

    /// <summary>{20 hex of the line id}A{attempt}: the NDIA echoes it back in the results file, so a resubmission gets a new one.</summary>
    public static string RowReference(Guid lineId, int attempt) => lineId.ToString("N")[..20] + "A" + attempt.ToString(CultureInfo.InvariantCulture);

    /// <summary>What goes in the row for a loaded line. Exactly one of Quantity and Hours is filled, by the catalogue's unit.</summary>
    public static BprRowOut ToOut(BprRow row, int attempt)
    {
        var l = row.Line;
        var isCancellation = l.ClaimType == ClaimType.Cancellation;
        // A short-notice cancellation can have its own "_CA" item, which already says it is a cancellation: ClaimType is then blank.
        var useCancelItem = isCancellation && row.CancelledItem != null;
        var perHour = (row.Item?.Unit ?? "H") == "H";
        return new BprRowOut(
            row.Settings?.RegistrationNumber ?? "", row.Participant?.NdisNumber ?? "", l.SupportsDeliveredFrom, l.SupportsDeliveredTo,
            useCancelItem ? row.CancelledItem!.ItemNumber : l.SupportItemCode, RowReference(l.Id, attempt),
            perHour ? null : l.Hours, perHour ? l.Hours : null, l.UnitPrice, MapGstCode(l.GSTCode),
            isCancellation && !useCancelItem ? "CANC" : "",
            isCancellation ? (l.CancellationReason ?? "").Trim().ToUpperInvariant() : "", "");
    }

    /// <summary>The bytes of the file: the header and one row per line, every line ended CRLF (RFC 4180, and what a spreadsheet writes).</summary>
    public static byte[] Write(IEnumerable<BprRowOut> rows)
    {
        var sb = new StringBuilder(Header).Append("\r\n");
        foreach (var r in rows)
        {
            // AuthorisedBy, ParticipantApproved, InKindFundingProgram (cols 11-13) are legacy: always blank. The ABN (col 16) is blank for agency-managed claims.
            sb.Append(string.Join(',',
                CsvEscape(r.Registration), CsvEscape(r.NdisNumber), r.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), r.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                CsvEscape(r.SupportNumber), r.Reference,
                r.Quantity?.ToString("0.##", CultureInfo.InvariantCulture) ?? "", r.Hours is { } h ? FormatHours(h) : "",
                r.UnitPrice.ToString("0.00", CultureInfo.InvariantCulture), r.Gst, "", "", "", r.ClaimType, CsvEscape(r.CancellationReason), CsvEscape(r.Abn))).Append("\r\n");
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    private static string MapGstCode(GSTCode code) => code switch
    {
        GSTCode.P1 => "P1",
        GSTCode.P2 => "P2",
        GSTCode.P5 => "P5",
        _ => "P2"  // a legacy enum value; the GstCode check refuses it before a file is written
    };

    /// <summary>Decimal hours as H:MM, not padded: 2.5 is "2:30", 10 is "10:00".</summary>
    public static string FormatHours(decimal hours)
    {
        var totalMinutes = (int)Math.Round(hours * 60, MidpointRounding.AwayFromZero);
        return $"{totalMinutes / 60}:{totalMinutes % 60:D2}";
    }

    private static string CsvEscape(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}
