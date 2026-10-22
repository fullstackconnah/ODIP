using System.Globalization;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>One payer of a claim: a booking of a trip claim, or the participant of a shift claim. <see cref="GroupId"/> is that booking's or participant's id.</summary>
public sealed record PayerGroup(Guid GroupId, Guid? BookingId, Participant Participant, PlanType PlanType, IReadOnlyList<ClaimLineItem> Lines);

public class InvoiceService
{
    private readonly OdipDbContext _db;

    public InvoiceService(OdipDbContext db)
    {
        _db = db;
        QuestPDF.Settings.License = LicenseType.Community;
    }

    /// <summary>
    /// The derived invoice of a claim submitted before ODIP numbered its invoices (and of any claim through this name, as before): today's text,
    /// number <c>INV-{ClaimReference}-{group8}</c> and the claim's own date. Returns the PDF bytes and a suggested filename.
    /// </summary>
    public async Task<(byte[] Content, string FileName)> GenerateInvoiceAsync(
        Guid claimId, Guid bookingId, CancellationToken ct = default)
    {
        var (claim, group, settings) = await GroupForRenderAsync(claimId, bookingId, ct);
        var invoice = BuildSnapshot(claim, group, settings);
        invoice.DisplayNumber = $"INV-{claim.ClaimReference}-{group.GroupId.ToString("N")[..8].ToUpper()}";
        invoice.IssueDate = Heading(settings.GSTRegistered, claim, settings.State).Date;
        return (Render(invoice, legacy: true), $"{invoice.DisplayNumber}.pdf");
    }

    /// <summary>The "DRAFT – not issued" preview of a claim not yet submitted: the invoice submitting would issue, with no number and no dates.</summary>
    public async Task<(byte[] Content, string FileName)> PreviewAsync(Guid claimId, Guid groupId, CancellationToken ct = default)
    {
        var (claim, group, settings) = await GroupForRenderAsync(claimId, groupId, ct);
        return (Render(BuildSnapshot(claim, group, settings)), $"DRAFT-{claim.ClaimReference}.pdf");
    }

    /// <summary>The invoice each plan- or self-managed payer would get if the claim were submitted now: never saved, never numbered.</summary>
    public async Task<List<Invoice>> PreviewSnapshotsAsync(Guid claimId, CancellationToken ct = default)
    {
        var claim = await LoadClaimAsync(claimId, ct) ?? throw new InvalidOperationException("Claim not found.");
        var settings = await SettingsForAsync(TenantOf(claim), ct) ?? throw new InvalidOperationException("Provider settings not configured.");
        return GroupsOf(claim).Where(g => IsInvoiced(g.PlanType)).Select(g => BuildSnapshot(claim, g, settings)).ToList();
    }

    /// <summary>The claim with everything a snapshot reads: its trip or participant, each line's booking, participant and plan manager.</summary>
    internal Task<TripClaim?> LoadClaimAsync(Guid claimId, CancellationToken ct) => _db.TripClaims
        .Include(c => c.TripInstance)
        .Include(c => c.Participant).ThenInclude(p => p!.PlanManagerContact)
        .Include(c => c.LineItems).ThenInclude(l => l.ParticipantBooking).ThenInclude(b => b!.Participant).ThenInclude(p => p.PlanManagerContact)
        .FirstOrDefaultAsync(c => c.Id == claimId, ct);

    /// <summary>The claim's organisation: its trip's (a trip claim) or its participant's (a shift claim). Never the caller's: a SuperAdmin may have none, or their own.</summary>
    public static Guid? TenantOf(TripClaim claim) => claim.TripInstance?.TenantId ?? claim.Participant?.TenantId;

    /// <summary>The organisation's settings row, read by that organisation (the filter is off for a SuperAdmin, so an unscoped read could land on another's).</summary>
    internal async Task<ProviderSettings?> SettingsForAsync(Guid? tenantId, CancellationToken ct) => tenantId is { } t
        ? await _db.ProviderSettings.Where(s => s.TenantId == t).OrderBy(s => s.Id).FirstOrDefaultAsync(ct)
        : null;

    private async Task<(TripClaim Claim, PayerGroup Group, ProviderSettings Settings)> GroupForRenderAsync(Guid claimId, Guid groupId, CancellationToken ct)
    {
        var claim = await LoadClaimAsync(claimId, ct) ?? throw new InvalidOperationException("Claim not found.");
        var group = GroupsOf(claim).FirstOrDefault(g => g.GroupId == groupId)
            ?? throw new InvalidOperationException("Booking not found in this claim.");
        if (group.PlanType == PlanType.AgencyManaged)
            throw new InvalidOperationException("Agency-managed participants use the BPR CSV, not invoices.");
        var settings = await SettingsForAsync(TenantOf(claim), ct)
            ?? throw new InvalidOperationException("Provider settings not configured.");
        return (claim, group, settings);
    }

    /// <summary>Every payer of the claim, agency-managed ones included, in participant-name order: one per booking (trip claim) or the claim's participant (shift claim).</summary>
    public static List<PayerGroup> GroupsOf(TripClaim claim)
    {
        if (claim.Kind == ClaimKind.Shift)
            return claim.Participant is { } p ? [new PayerGroup(p.Id, null, p, p.PlanType, claim.LineItems.ToList())] : [];

        // Shift-kind lines have no booking; a trip claim's lines all do.
        return claim.LineItems.Where(l => l.ParticipantBooking != null)
            .GroupBy(l => l.ParticipantBooking!.Id)
            .Select(g =>
            {
                var booking = g.First().ParticipantBooking!;
                return new PayerGroup(booking.Id, booking.Id, booking.Participant, booking.PlanTypeOverride ?? booking.Participant.PlanType, g.ToList());
            })
            .OrderBy(g => g.Participant.FullName, StringComparer.Ordinal).ThenBy(g => g.GroupId)
            .ToList();
    }

    /// <summary>Plan- and self-managed payers get an invoice; agency-managed ones are claimed in the BPR CSV.</summary>
    public static bool IsInvoiced(PlanType planType) => planType is PlanType.PlanManaged or PlanType.SelfManaged;

    /// <summary>
    /// The invoice of one payer as it stands now: seller and bank from the organisation's settings, bill-to from the plan manager (plan managed) or the
    /// participant, the stored lines copied as they are, and today's arithmetic (sum of the stored totals, GST from <see cref="GstFor"/>). Not saved, not
    /// numbered and not dated: the issue, the preview and the legacy render each add their own.
    /// </summary>
    public static Invoice BuildSnapshot(TripClaim claim, PayerGroup group, ProviderSettings settings)
    {
        var participant = group.Participant;
        var planManager = group.PlanType == PlanType.PlanManaged ? participant.PlanManagerContact : null;
        var subtotal = group.Lines.Sum(l => l.TotalAmount);
        var gst = GstFor(group.Lines, settings.GSTRegistered);
        return new Invoice
        {
            Id = Guid.NewGuid(), Kind = InvoiceKind.Invoice, Status = InvoiceStatus.Issued,
            TripClaimId = claim.Id, ClaimReference = claim.ClaimReference,
            ParticipantBookingId = group.BookingId, ParticipantId = participant.Id, ParticipantName = participant.FullName,
            NdisNumber = string.IsNullOrWhiteSpace(participant.NdisNumber) ? null : participant.NdisNumber,
            ServiceReference = claim.Kind == ClaimKind.Shift
                ? string.Create(CultureInfo.InvariantCulture, $"Period: {claim.PeriodFrom:dd MMM yyyy} – {claim.PeriodTo:dd MMM yyyy}")
                : $"Trip: {claim.TripInstance?.TripName}",
            PayerKind = group.PlanType,
            BillToName = planManager == null ? participant.FullName
                : planManager.Organisation != null ? $"{planManager.FullName} — {planManager.Organisation}" : planManager.FullName,
            BillToAddress = planManager == null ? string.Empty : BuildContactAddress(planManager),
            BillToEmail = planManager?.Email,
            SellerOrganisationName = settings.OrganisationName, SellerAbn = settings.ABN, SellerRegistrationNumber = settings.RegistrationNumber,
            SellerAddress = settings.Address, SellerState = settings.State, GstRegistered = settings.GSTRegistered,
            BankAccountName = settings.BankAccountName, Bsb = settings.BSB, AccountNumber = settings.AccountNumber,
            FooterNotes = settings.InvoiceFooterNotes, PaymentTermsDays = settings.PaymentTermsDays,
            Subtotal = subtotal, Gst = gst, Total = subtotal + gst,
            Lines = group.Lines.Select(l => new InvoiceLine
            {
                Id = Guid.NewGuid(), ClaimLineItemId = l.Id, SupportItemCode = l.SupportItemCode, ServiceFrom = l.SupportsDeliveredFrom, ServiceTo = l.SupportsDeliveredTo,
                Hours = l.Hours, UnitPrice = l.UnitPrice, LineTotal = l.TotalAmount, GSTCode = l.GSTCode,
            }).ToList(),
        };
    }

    private static string Day(DateOnly date) => date.ToString("dd MMM yyyy", CultureInfo.InvariantCulture);

    /// <summary>
    /// Draws every invoice PDF from an <see cref="Invoice"/>: an issued one, a credit note, a void or credited one (a band, and no payment block, so it
    /// never invites payment), the never-saved preview (no number: "DRAFT – not issued") and, with <paramref name="legacy"/>, the derived invoice of a
    /// claim submitted before numbering, exactly as it always printed. <paramref name="creditedBy"/> and <paramref name="creditedOn"/> name the credit
    /// note of a credited invoice.
    /// </summary>
    public static byte[] Render(Invoice inv, bool legacy = false, string? creditedBy = null, DateOnly? creditedOn = null)
    {
        var preview = !legacy && inv.DisplayNumber.Length == 0;
        var creditNote = inv.Kind == InvoiceKind.CreditNote;
        var title = creditNote ? "CREDIT NOTE" : preview ? "DRAFT – not issued" : inv.GstRegistered ? "TAX INVOICE" : "INVOICE";
        // A credit note cancels: each amount prints negative ("-$430.58", never "$-430.58"); nothing prints as "-$0.00".
        string Money(decimal amount) => creditNote && amount != 0m
            ? string.Create(CultureInfo.InvariantCulture, $"-${amount:F2}")
            : string.Create(CultureInfo.InvariantCulture, $"${amount:F2}");
        var stands = !legacy && !preview && !creditNote && inv.Status == InvoiceStatus.Issued;
        var hasBank = inv.BankAccountName != null || inv.Bsb != null;
        // A void or credited invoice and a credit note never invite payment; the legacy and preview renders keep today's bank block.
        var paymentBlock = stands || ((legacy || preview) && hasBank);
        var band = preview
            ? ("DRAFT – not issued", "A preview for checking. It has no invoice number and is not a tax invoice.", "#515f74")
            : legacy || creditNote ? (null, null, null)
            : inv.Status == InvoiceStatus.Voided
                ? ("VOID", $"Voided on {Day(ProviderLocalTime.TodayIn(inv.VoidedAt ?? DateTime.UtcNow, ProviderTimeZoneResolver.FromState(inv.SellerState).Zone))}. This invoice is not payable.", "#ba1a1a")
            : inv.Status == InvoiceStatus.Credited
                ? ("CREDITED", $"Credited in full by {creditedBy}{(creditedOn is { } on ? $" on {Day(on)}" : string.Empty)}. Nothing is owed on this invoice.", "#ba1a1a")
            : ((string?)null, (string?)null, (string?)null);

        return Document.Create(container =>
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
                            c.Item().Text(inv.SellerOrganisationName).Bold().FontSize(16);
                            c.Item().Text(inv.SellerAddress).FontSize(9);
                            c.Item().Text($"ABN: {inv.SellerAbn}").FontSize(9);
                            c.Item().Text($"NDIS Registration: {inv.SellerRegistrationNumber}").FontSize(9);
                        });
                        // 170pt: "DRAFT – not issued" and a 10-character prefix with 8 digits each fit on one line.
                        row.ConstantItem(170).AlignRight().Column(c =>
                        {
                            c.Item().Text(title).Bold().FontSize(14);
                            if (legacy)
                            {
                                c.Item().Text(inv.DisplayNumber).FontSize(9);
                                c.Item().Text(Day(inv.IssueDate)).FontSize(9);
                            }
                            else if (preview)
                            {
                                c.Item().Text("Not issued").FontSize(9);
                                c.Item().Text(inv.PaymentTermsDays == 0 ? "Due on issue" : $"Due {inv.PaymentTermsDays} days after issue").FontSize(9);
                            }
                            else
                            {
                                c.Item().Text(inv.DisplayNumber).FontSize(9);
                                c.Item().Text($"Issued {Day(inv.IssueDate)}").FontSize(9);
                                if (creditNote) c.Item().Text($"Credits {inv.CreditsDisplayNumber}").FontSize(9);
                                else if (inv.DueDate is { } due) c.Item().Text($"Due {Day(due)}").FontSize(9);
                            }
                        });
                    });
                    col.Item().PaddingTop(8).LineHorizontal(1);
                });

                page.Content().PaddingTop(16).Column(col =>
                {
                    if (band.Item1 != null)
                    {
                        col.Item().PaddingBottom(12).Border(1.5f).BorderColor(band.Item3!).Padding(8).Column(c =>
                        {
                            c.Item().Text(band.Item1).Bold().FontSize(20).FontColor(band.Item3!);
                            c.Item().Text(band.Item2!).FontSize(9);
                        });
                    }

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Bill To:").Bold();
                            c.Item().Text(inv.BillToName);
                            if (!string.IsNullOrWhiteSpace(inv.BillToAddress))
                                c.Item().Text(inv.BillToAddress);
                        });
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Participant:").Bold();
                            c.Item().Text(inv.ParticipantName);
                            if (!string.IsNullOrWhiteSpace(inv.NdisNumber))
                                c.Item().Text($"NDIS: {inv.NdisNumber}");
                            c.Item().Text(inv.ServiceReference);
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
                            if (inv.GstRegistered) cols.RelativeColumn(1);
                        });

                        table.Header(header =>
                        {
                            header.Cell().Background("#e2e8f0").Padding(4).Text("Support Item").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).Text("Date Range").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Hours").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Rate").Bold();
                            header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("Amount").Bold();
                            if (inv.GstRegistered)
                                header.Cell().Background("#e2e8f0").Padding(4).AlignRight().Text("GST").Bold();
                        });

                        foreach (var item in inv.Lines)
                        {
                            var dateRange = item.ServiceFrom == item.ServiceTo
                                ? item.ServiceFrom.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)
                                : string.Create(CultureInfo.InvariantCulture, $"{item.ServiceFrom:dd/MM/yyyy} – {item.ServiceTo:dd/MM/yyyy}");

                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(item.SupportItemCode);
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).Text(dateRange);
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text(item.Hours.ToString("F2", CultureInfo.InvariantCulture));
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text(string.Create(CultureInfo.InvariantCulture, $"${item.UnitPrice:F2}"));
                            table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text(Money(item.LineTotal));
                            if (inv.GstRegistered)
                                table.Cell().BorderBottom(1).BorderColor("#e2e8f0").Padding(4).AlignRight().Text(GstLabel(item.GSTCode));
                        }
                    });

                    col.Item().PaddingTop(8).AlignRight().Column(c =>
                    {
                        c.Item().Text($"Subtotal: {Money(inv.Subtotal)}");
                        if (inv.GstRegistered)
                            c.Item().Text($"GST: {Money(inv.Gst)}");
                        c.Item().Text($"Total: {Money(inv.Total)}").Bold().FontSize(12);
                    });

                    if (paymentBlock)
                    {
                        col.Item().PaddingTop(16).Column(c =>
                        {
                            if (hasBank) c.Item().Text("Payment Details:").Bold();
                            // The MONEY-12 terms line, on an issued invoice that stands only.
                            if (stands)
                                c.Item().Text(inv.PaymentTermsDays == 0
                                    ? $"Payment terms: due on issue. Please use {inv.DisplayNumber} as the reference."
                                    : $"Payment terms: {inv.PaymentTermsDays} days. Please pay by {Day(inv.DueDate ?? inv.IssueDate)} and use {inv.DisplayNumber} as the reference.");
                            if (inv.BankAccountName != null) c.Item().Text($"Account Name: {inv.BankAccountName}");
                            if (inv.Bsb != null) c.Item().Text($"BSB: {inv.Bsb}");
                            if (inv.AccountNumber != null) c.Item().Text($"Account: {inv.AccountNumber}");
                        });
                    }

                    if (!string.IsNullOrWhiteSpace(inv.FooterNotes))
                        col.Item().PaddingTop(16).Text(inv.FooterNotes).FontSize(8).Italic();
                });
            });
        }).GeneratePdf();
    }

    /// <summary>"TAX INVOICE" only for a GST-registered provider; the date is the claim's own (submitted, else created) in the provider's zone, so a re-download never moves it.</summary>
    public static (string Title, DateOnly Date) Heading(bool gstRegistered, TripClaim claim, string? state) =>
        (gstRegistered ? "TAX INVOICE" : "INVOICE",
         ProviderLocalTime.TodayIn(claim.SubmittedDate ?? claim.CreatedAt, ProviderTimeZoneResolver.FromState(state).Zone));

    /// <summary>
    /// GST on the invoice: 10% of the lines coded P1 (tax claimable), rounded to the cent. P2 (GST-free), P5 (out of scope) and the
    /// legacy codes, which the BPR CSV also sends as P2, add nothing; a provider that is not GST-registered charges none.
    /// </summary>
    public static decimal GstFor(IEnumerable<Odip.Domain.Entities.ClaimLineItem> lines, bool gstRegistered) =>
        gstRegistered ? Math.Round(lines.Where(l => l.GSTCode == GSTCode.P1).Sum(l => l.TotalAmount) * 0.1m, 2, MidpointRounding.AwayFromZero) : 0m;

    /// <summary>The printed number: the prefix, then the number zero-padded to 4 digits (INV-0042); longer numbers grow.</summary>
    public static string FormatNumber(string prefix, int number) => prefix + number.ToString("D4", CultureInfo.InvariantCulture);

    /// <summary>The settings row's own organisation's next invoice number and whether it has issued one (never the query filter's: a SuperAdmin's is off).</summary>
    public static async Task<(string Next, bool Issued)> NumberingOfAsync(OdipDbContext db, ProviderSettings s, CancellationToken ct)
    {
        var next = await db.InvoiceNumberCounters.IgnoreQueryFilters()
            .Where(c => c.TenantId == s.TenantId && c.Kind == InvoiceKind.Invoice).Select(c => (int?)c.NextNumber).FirstOrDefaultAsync(ct);
        var issued = await db.Invoices.IgnoreQueryFilters().AnyAsync(i => i.TenantId == s.TenantId && i.Kind == InvoiceKind.Invoice, ct);
        return (FormatNumber(s.InvoiceNumberPrefix, next ?? s.InvoiceStartNumber), issued);
    }

    private static string GstLabel(GSTCode code) => code switch
    {
        GSTCode.P1 => "10%",
        GSTCode.P5 => "Out of scope",
        _ => "GST-free"
    };

    private static string BuildContactAddress(Odip.Domain.Entities.Contact c)
    {
        return string.Join(", ", new[] { c.Address, c.Suburb, c.State, c.Postcode }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
    }
}
