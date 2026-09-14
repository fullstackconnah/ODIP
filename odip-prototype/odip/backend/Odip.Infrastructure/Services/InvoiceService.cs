using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class InvoiceService
{
    private readonly OdipDbContext _db;

    public InvoiceService(OdipDbContext db)
    {
        _db = db;
        QuestPDF.Settings.License = LicenseType.Community;
    }

    /// <summary>
    /// Generates a PDF invoice for one participant booking within a claim.
    /// Returns the PDF bytes and a suggested filename.
    /// </summary>
    public async Task<(byte[] Content, string FileName)> GenerateInvoiceAsync(
        Guid claimId, Guid bookingId, CancellationToken ct = default)
    {
        var claim = await _db.TripClaims
            .Include(c => c.TripInstance)
            .Include(c => c.LineItems)
                .ThenInclude(l => l.ParticipantBooking)
                    .ThenInclude(b => b.Participant)
                        .ThenInclude(p => p.PlanManagerContact)
            .FirstOrDefaultAsync(c => c.Id == claimId, ct)
            ?? throw new InvalidOperationException("Claim not found.");

        // Nullability audit (shift-completion design spec, delivery PR 3): Kind == Shift claim
        // lines have ParticipantBooking == null — filter those out before the id comparison so
        // this NotFound-shaped lookup doesn't NRE on a shift-kind claim's line items.
        var booking = claim.LineItems
            .Select(l => l.ParticipantBooking)
            .FirstOrDefault(b => b != null && b.Id == bookingId)
            ?? throw new InvalidOperationException("Booking not found in this claim.");

        var planType = booking.PlanTypeOverride ?? booking.Participant.PlanType;
        if (planType == PlanType.AgencyManaged)
            throw new InvalidOperationException("Agency-managed participants use the BPR CSV, not invoices.");

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings not configured.");

        var lineItems = claim.LineItems
            .Where(l => l.ParticipantBookingId == bookingId)
            .ToList();

        var participant = booking.Participant;
        var invoiceNumber = $"INV-{claim.ClaimReference}-{booking.Id.ToString("N")[..8].ToUpper()}";
        var invoiceDate = DateTime.UtcNow;

        // Bill-to details
        string billToName;
        string billToAddress;

        if (planType == PlanType.PlanManaged && participant.PlanManagerContact != null)
        {
            var pm = participant.PlanManagerContact;
            var pmName = pm.FullName;
            var pmOrg = pm.Organisation;
            billToName = pmOrg != null ? $"{pmName} — {pmOrg}" : pmName;
            billToAddress = BuildContactAddress(pm);
        }
        else
        {
            billToName = participant.FullName;
            billToAddress = string.Empty;
        }

        var subtotal = lineItems.Sum(l => l.TotalAmount);
        var gstAmount = settings.GSTRegistered ? subtotal * 0.1m : 0m;
        var total = subtotal + gstAmount;

        var pdfBytes = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.DefaultTextStyle(x => x.FontSize(10));

                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(settings.OrganisationName).Bold().FontSize(16);
                            c.Item().Text(settings.Address).FontSize(9);
                            c.Item().Text($"ABN: {settings.ABN}").FontSize(9);
                            c.Item().Text($"NDIS Registration: {settings.RegistrationNumber}").FontSize(9);
                        });
                        row.ConstantItem(120).AlignRight().Column(c =>
                        {
                            c.Item().Text("TAX INVOICE").Bold().FontSize(14);
                            c.Item().Text(invoiceNumber).FontSize(9);
                            c.Item().Text(invoiceDate.ToString("dd MMM yyyy")).FontSize(9);
                        });
                    });
                    col.Item().PaddingTop(8).LineHorizontal(1);
                });

                page.Content().PaddingTop(16).Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Bill To:").Bold();
                            c.Item().Text(billToName);
                            if (!string.IsNullOrWhiteSpace(billToAddress))
                                c.Item().Text(billToAddress);
                        });
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Participant:").Bold();
                            c.Item().Text(participant.FullName);
                            if (!string.IsNullOrWhiteSpace(participant.NdisNumber))
                                c.Item().Text($"NDIS: {participant.NdisNumber}");
                            c.Item().Text($"Trip: {claim.TripInstance.TripName}");
                        });
                    });

                    col.Item().PaddingTop(16).Table(table =>
                    {
                        table.ColumnsDefinition(cols =>
                        {
                            cols.RelativeColumn(3);
                            cols.RelativeColumn(2);
                            cols.RelativeColumn(1);
                            cols.RelativeColumn(1);
                            cols.RelativeColumn(1);
                        });

                        table.Header(header =>
                        {
                            header.Cell().Background("#e2e8f0").Padding(4).Text("Support Item").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).Text("Date Range").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Hours").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Rate").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Amount").Bold();
                        });

                        foreach (var item in lineItems)
                        {
                            var dateRange = item.SupportsDeliveredFrom == item.SupportsDeliveredTo
                                ? item.SupportsDeliveredFrom.ToString("dd/MM/yyyy")
                                : $"{item.SupportsDeliveredFrom:dd/MM/yyyy} – {item.SupportsDeliveredTo:dd/MM/yyyy}";

                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(item.SupportItemCode);
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(dateRange);
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text(item.Hours.ToString("F2"));
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text($"${item.UnitPrice:F2}");
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text($"${item.TotalAmount:F2}");
                        }
                    });

                    col.Item().PaddingTop(8).AlignRight().Column(c =>
                    {
                        c.Item().Text($"Subtotal: ${subtotal:F2}");
                        if (settings.GSTRegistered)
                            c.Item().Text($"GST (10%): ${gstAmount:F2}");
                        c.Item().Text($"Total: ${total:F2}").Bold().FontSize(12);
                    });

                    if (settings.BankAccountName != null || settings.BSB != null)
                    {
                        col.Item().PaddingTop(16).Column(c =>
                        {
                            c.Item().Text("Payment Details:").Bold();
                            if (settings.BankAccountName != null) c.Item().Text($"Account Name: {settings.BankAccountName}");
                            if (settings.BSB != null) c.Item().Text($"BSB: {settings.BSB}");
                            if (settings.AccountNumber != null) c.Item().Text($"Account: {settings.AccountNumber}");
                        });
                    }

                    if (!string.IsNullOrWhiteSpace(settings.InvoiceFooterNotes))
                        col.Item().PaddingTop(16).Text(settings.InvoiceFooterNotes).FontSize(8).Italic();
                });
            });
        }).GeneratePdf();

        var fileName = $"{invoiceNumber}.pdf";
        return (pdfBytes, fileName);
    }

    private static string BuildContactAddress(Odip.Domain.Entities.Contact c)
    {
        return string.Join(", ", new[] { c.Address, c.Suburb, c.State, c.Postcode }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
    }
}
