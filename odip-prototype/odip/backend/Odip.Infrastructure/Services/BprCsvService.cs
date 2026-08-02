using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class BprCsvService(OdipDbContext db)
{
    public async Task<(byte[] Content, string FileName)> GenerateBprCsvAsync(Guid claimId, CancellationToken ct = default)
    {
        var claim = await db.TripClaims
            .Include(c => c.LineItems)
                .ThenInclude(li => li.ParticipantBooking)
                    .ThenInclude(pb => pb.Participant)
            .FirstOrDefaultAsync(c => c.Id == claimId, ct)
            ?? throw new KeyNotFoundException($"Claim {claimId} not found");

        var settings = await db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings not configured");

        var items = claim.LineItems
            .Where(l => (l.ParticipantBooking.PlanTypeOverride ?? l.ParticipantBooking.Participant?.PlanType) == PlanType.AgencyManaged)
            .ToList();

        var sb = new StringBuilder();

        // 16 columns — NDIS BPR spec Nov 2025, applies to all providers
        sb.AppendLine("RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode,AuthorisedBy,ParticipantApproved,InKindFundingProgram,ClaimType,CancellationReason,ABNofSupportProvider");

        foreach (var item in items)
        {
            var ndisNumber = item.ParticipantBooking.Participant?.NdisNumber ?? string.Empty;
            var fromDate = item.SupportsDeliveredFrom.ToString("yyyy-MM-dd");
            var toDate = item.SupportsDeliveredTo.ToString("yyyy-MM-dd");
            var rowRef = item.Id.ToString("N")[..20];
            var hours = FormatHours(item.Hours);
            var unitPrice = item.UnitPrice.ToString("F2");
            var gstCode = MapGstCode(item.GSTCode);
            var claimType = MapClaimType(item.ClaimType);
            var cancellationReason = item.ClaimType == ClaimType.Cancellation
                ? CsvEscape(item.CancellationReason ?? "")
                : "";

            // Quantity (col 7) blank — Hours (col 8) carries duration per NDIS spec
            // AuthorisedBy, ParticipantApproved, InKindFundingProgram (cols 11-13) are legacy — always blank
            // ABNofSupportProvider (col 16) always blank for agency-managed bookings
            sb.AppendLine($"{settings.RegistrationNumber},{ndisNumber},{fromDate},{toDate},{item.SupportItemCode},{rowRef},,{hours},{unitPrice},{gstCode},,,{claimType},{cancellationReason},");
        }

        var fileName = $"BPR-{claim.ClaimReference}-{DateTime.UtcNow:yyyyMMdd}.csv";
        return (Encoding.UTF8.GetBytes(sb.ToString()), fileName);
    }

    private static string MapGstCode(GSTCode code) => code switch
    {
        GSTCode.P1 => "P1",
        GSTCode.P2 => "P2",
        GSTCode.P5 => "P5",
        _ => "P2"  // safe default for legacy enum values not valid in BPR
    };

    private static string MapClaimType(ClaimType type) => type switch
    {
        ClaimType.Cancellation => "CANC",
        _ => ""  // Standard, Variation, Adjustment → blank (Direct Service per NDIS spec)
    };

    // Format decimal hours as HHH:MM — e.g. 8.5 → "008:30"
    private static string FormatHours(decimal hours)
    {
        var totalMinutes = (int)Math.Round(hours * 60);
        var h = totalMinutes / 60;
        var m = totalMinutes % 60;
        return $"{h:D3}:{m:D2}";
    }

    private static string CsvEscape(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}
