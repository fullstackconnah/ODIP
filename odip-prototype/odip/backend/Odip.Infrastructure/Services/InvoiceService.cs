using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
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

/// <summary>Issuing refused (no settings, say): the status change is refused with these words and nothing is written.</summary>
public sealed class InvoiceRefusedException(string message) : InvalidOperationException(message);

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
        var settings = ProviderSettingsGuard.Require(await SettingsForAsync(TenantOf(claim), ct));
        return (claim, group, settings);
    }

    /// <summary>Every payer of the claim, agency-managed ones included, in participant-name order: one per booking (trip claim) or the claim's participant (shift claim).</summary>
    public static List<PayerGroup> GroupsOf(TripClaim claim)
    {
        if (claim.Kind == ClaimKind.Shift)
            // A claim with no lines has no payer to bill.
            return claim.Participant is { } p && claim.LineItems.Count > 0 ? [new PayerGroup(p.Id, null, p, p.PlanType, claim.LineItems.ToList())] : [];

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
                ? ("VOID", $"Voided on {Day(ProviderLocalTime.TodayIn(inv.VoidedAt ?? DateTime.UtcNow, ProviderTimeZoneResolver.ForInvoiceState(inv.SellerState).Zone))}. This invoice is not payable.", "#ba1a1a")
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
                            if (!string.IsNullOrWhiteSpace(inv.SellerRegistrationNumber))
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

    // ── Reads ──────────────────────────────────────────────────

    /// <summary>
    /// A payment is recorded against an invoice (lead S5) when a line it covers has a paid amount, or is Paid or Partially paid, or the claim itself was
    /// marked Paid or Partially paid (that sets no line). Such an invoice can only be credited, never voided.
    /// </summary>
    public static bool PaymentRecorded(Invoice invoice, IReadOnlyDictionary<Guid, ClaimLineItem> claimLines, TripClaimStatus claimStatus) =>
        claimStatus is TripClaimStatus.Paid or TripClaimStatus.PartiallyPaid
        || invoice.Lines.Any(l => l.ClaimLineItemId is { } id && claimLines.TryGetValue(id, out var line)
            && (line.PaidAmount > 0 || line.Status is ClaimLineItemStatus.Paid or ClaimLineItemStatus.PartiallyPaid));

    public static InvoiceSummaryDto Summary(Invoice i, string? creditedBy, bool paymentRecorded) => new()
    {
        Id = i.Id, Kind = i.Kind, Number = i.Number, DisplayNumber = i.DisplayNumber, Status = i.Status, GroupId = i.ParticipantBookingId ?? i.ParticipantId,
        ParticipantName = i.ParticipantName, BillToName = i.BillToName, PayerKind = i.PayerKind, IssueDate = i.IssueDate, DueDate = i.DueDate, Total = i.Total,
        CreditsDisplayNumber = i.CreditsDisplayNumber, CreditedByDisplayNumber = creditedBy, PaymentRecorded = paymentRecorded,
    };

    /// <summary>The claim's Invoices section (D19): its rows (each credit note under the invoice it credits), its payers, its agency count and its state.</summary>
    public async Task<ClaimInvoicesDto> ClaimInvoicesAsync(Guid claimId, CancellationToken ct)
    {
        var claim = await LoadClaimAsync(claimId, ct) ?? throw new InvalidOperationException("Claim not found.");
        var rows = await _db.Invoices.AsNoTracking().Include(i => i.Lines).Where(i => i.TripClaimId == claimId).ToListAsync(ct);
        var groups = GroupsOf(claim);
        var invoiced = groups.Where(g => IsInvoiced(g.PlanType)).ToList();
        var settings = invoiced.Count == 0 ? null : await SettingsForAsync(TenantOf(claim), ct);
        var claimLines = claim.LineItems.ToDictionary(l => l.Id);
        var creditNotes = rows.Where(r => r.Kind == InvoiceKind.CreditNote && r.CreditsInvoiceId != null).ToLookup(r => r.CreditsInvoiceId!.Value);

        var ordered = rows.Where(r => r.Kind == InvoiceKind.Invoice).OrderBy(r => r.Number)
            .SelectMany(r => new[] { r }.Concat(creditNotes[r.Id].OrderBy(c => c.Number)))
            .Select(r => Summary(r, creditNotes[r.Id].Select(c => c.DisplayNumber).FirstOrDefault(),
                r.Kind == InvoiceKind.Invoice && PaymentRecorded(r, claimLines, claim.Status)))
            .ToList();

        return new ClaimInvoicesDto
        {
            InvoiceState = rows.Count > 0 ? "issued"
                : invoiced.Count == 0 ? "none"
                : claim.Status is TripClaimStatus.Draft or TripClaimStatus.Ready ? "preview"
                : "legacy",
            Invoices = ordered,
            Groups = invoiced.Select(g =>
            {
                var snapshot = BuildSnapshot(claim, g, settings ?? new ProviderSettings());
                return new PayerGroupDto { GroupId = g.GroupId, ParticipantName = snapshot.ParticipantName, BillToName = snapshot.BillToName, PayerKind = g.PlanType, Total = snapshot.Total };
            }).ToList(),
            AgencyCount = groups.Where(g => g.PlanType == PlanType.AgencyManaged).Select(g => g.Participant.Id).Distinct().Count(),
        };
    }

    /// <summary>
    /// The PDF of one payer of a claim (D18): its issued invoice (the standing one, else the newest) from the snapshot; else the preview of a claim not yet
    /// submitted; else the legacy derived render of a claim submitted before numbering.
    /// </summary>
    public async Task<(byte[] Content, string FileName)> DownloadForGroupAsync(Guid claimId, Guid groupId, CancellationToken ct)
    {
        var row = await _db.Invoices.AsNoTracking()
            .Where(i => i.TripClaimId == claimId && i.Kind == InvoiceKind.Invoice && (i.ParticipantBookingId ?? i.ParticipantId) == groupId)
            .OrderBy(i => i.Status == InvoiceStatus.Issued ? 0 : 1).ThenByDescending(i => i.CreatedAt)
            .Select(i => (Guid?)i.Id).FirstOrDefaultAsync(ct);
        if (row is { } id && await RenderStoredAsync(id, ct) is { } stored) return stored;

        var status = await _db.TripClaims.Where(c => c.Id == claimId).Select(c => c.Status).FirstAsync(ct);
        return status is TripClaimStatus.Draft or TripClaimStatus.Ready
            ? await PreviewAsync(claimId, groupId, ct)
            : await GenerateInvoiceAsync(claimId, groupId, ct);
    }

    // ── Issue (Mark as Submitted) ──────────────────────────────

    /// <summary>The claim's invoices that stand (Kind Invoice, Issued).</summary>
    private Task<List<Invoice>> LiveInvoicesAsync(Guid claimId, CancellationToken ct) =>
        _db.Invoices.Where(i => i.TripClaimId == claimId && i.Kind == InvoiceKind.Invoice && i.Status == InvoiceStatus.Issued).ToListAsync(ct);

    /// <summary>The plan- and self-managed payers with no invoice standing: all of them on a first submit; on a resubmit only those whose invoice was voided or credited.</summary>
    public static List<PayerGroup> DueGroups(TripClaim claim, IReadOnlyCollection<Invoice> live) =>
        GroupsOf(claim).Where(g => IsInvoiced(g.PlanType) && !live.Any(i => (i.ParticipantBookingId ?? i.ParticipantId) == g.GroupId)).ToList();

    /// <summary>
    /// Issues the invoices of a claim that is being marked as submitted, inside the caller's claim-edit lock and transaction: settings checked first,
    /// then one number per payer from the counter, then the rows. The caller saves once; a refusal throws <see cref="InvoiceRefusedException"/> before
    /// anything is added, and a rolled-back save hands the numbers back.
    /// </summary>
    public async Task<List<Invoice>> IssueForSubmitAsync(Guid claimId, DateTime now, ClaimsPrincipal? actor, CancellationToken ct)
    {
        var claim = await LoadClaimAsync(claimId, ct) ?? throw new InvalidOperationException("Claim not found.");
        var due = DueGroups(claim, await LiveInvoicesAsync(claimId, ct));
        if (due.Count == 0) return [];

        var tenantId = TenantOf(claim) ?? throw new InvalidOperationException("The claim has no organisation.");
        var settings = await SettingsForAsync(tenantId, ct) ?? throw new InvoiceRefusedException("Set up your organisation's invoice details in Settings first.");
        var issueDate = ProviderLocalTime.TodayIn(now, ProviderTimeZoneResolver.For(settings.TimeZoneId, settings.State).Zone);
        Guid? actorId = Guid.TryParse(actor?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        var issued = new List<Invoice>();
        foreach (var group in due)
        {
            var number = await TakeNumberAsync(tenantId, InvoiceKind.Invoice, settings.InvoiceStartNumber, ct);
            var invoice = BuildSnapshot(claim, group, settings);
            // Explicit: SaveChanges stamps a TenantId only when one is in scope, and a SuperAdmin not viewing as an organisation has none.
            invoice.TenantId = tenantId;
            foreach (var line in invoice.Lines) line.TenantId = tenantId;
            invoice.Number = number;
            invoice.DisplayNumber = FormatNumber(settings.InvoiceNumberPrefix, number);
            invoice.IssueDate = issueDate;
            invoice.DueDate = issueDate.AddDays(settings.PaymentTermsDays);
            invoice.CreatedAt = now;
            invoice.CreatedById = actorId;
            _db.Invoices.Add(invoice);
            issued.Add(invoice);
        }
        return issued;
    }

    /// <summary>
    /// Takes the organisation's next number of a kind. On PostgreSQL one statement does it atomically and its row lock is held to commit, so a second
    /// issue in the organisation waits, and a rolled-back issue gives its number back. The unique index (TenantId, Kind, Number) is the backstop.
    /// </summary>
    internal async Task<int> TakeNumberAsync(Guid tenantId, InvoiceKind kind, int start, CancellationToken ct)
    {
        if (_db.Database.IsNpgsql())
            // ToListAsync, not SingleAsync: EF composes SingleAsync into a sub-select, and an INSERT cannot sit inside one.
            return (await _db.Database.SqlQuery<int>($"""
                INSERT INTO "InvoiceNumberCounters" ("TenantId", "Kind", "NextNumber") VALUES ({tenantId}, {(int)kind}, {start + 1})
                ON CONFLICT ("TenantId", "Kind") DO UPDATE SET "NextNumber" = "InvoiceNumberCounters"."NextNumber" + 1
                RETURNING "NextNumber" - 1 AS "Value"
                """).ToListAsync(ct)).Single();

        // InMemory (unit tests): one writer at a time; the tracked row is saved with the invoices, or dropped with them.
        var row = await _db.InvoiceNumberCounters.FindAsync(new object[] { tenantId, kind }, ct)
            ?? _db.InvoiceNumberCounters.Add(new InvoiceNumberCounter { TenantId = tenantId, Kind = kind, NextNumber = start }).Entity;
        return row.NextNumber++;
    }

    /// <summary>
    /// A full credit note for an issued invoice (D11): its own number from the organisation's credit note counter, the invoice's seller, bill-to, lines and
    /// amounts copied (stored positive; the PDF prints them negative), dated today in the invoice's own state. The invoice becomes Credited. The caller
    /// holds the claim's lock and saves.
    /// </summary>
    public async Task<Invoice> CreditAsync(Invoice original, DateTime now, ClaimsPrincipal? actor, CancellationToken ct)
    {
        var prefix = (await SettingsForAsync(original.TenantId, ct))?.CreditNotePrefix ?? "CN-";
        var number = await TakeNumberAsync(original.TenantId, InvoiceKind.CreditNote, 1, ct);
        var note = new Invoice
        {
            Id = Guid.NewGuid(), TenantId = original.TenantId, Kind = InvoiceKind.CreditNote, Number = number, DisplayNumber = FormatNumber(prefix, number), Status = InvoiceStatus.Issued,
            TripClaimId = original.TripClaimId, ClaimReference = original.ClaimReference, ParticipantBookingId = original.ParticipantBookingId, ParticipantId = original.ParticipantId,
            ParticipantName = original.ParticipantName, NdisNumber = original.NdisNumber, ServiceReference = original.ServiceReference,
            IssueDate = ProviderLocalTime.TodayIn(now, ProviderTimeZoneResolver.ForInvoiceState(original.SellerState).Zone),
            PayerKind = original.PayerKind, BillToName = original.BillToName, BillToAddress = original.BillToAddress, BillToEmail = original.BillToEmail,
            SellerOrganisationName = original.SellerOrganisationName, SellerAbn = original.SellerAbn, SellerRegistrationNumber = original.SellerRegistrationNumber,
            SellerAddress = original.SellerAddress, SellerState = original.SellerState, GstRegistered = original.GstRegistered,
            BankAccountName = original.BankAccountName, Bsb = original.Bsb, AccountNumber = original.AccountNumber, FooterNotes = original.FooterNotes, PaymentTermsDays = original.PaymentTermsDays,
            Subtotal = original.Subtotal, Gst = original.Gst, Total = original.Total,
            CreditsInvoiceId = original.Id, CreditsDisplayNumber = original.DisplayNumber,
            CreatedAt = now, CreatedById = Guid.TryParse(actor?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null,
            // Explicit TenantId on every row: a SuperAdmin with no organisation in scope stamps none.
            Lines = original.Lines.Select(l => new InvoiceLine
            {
                Id = Guid.NewGuid(), TenantId = original.TenantId, ClaimLineItemId = l.ClaimLineItemId, SupportItemCode = l.SupportItemCode, ServiceFrom = l.ServiceFrom, ServiceTo = l.ServiceTo,
                Hours = l.Hours, UnitPrice = l.UnitPrice, LineTotal = l.LineTotal, GSTCode = l.GSTCode,
            }).ToList(),
        };
        original.Status = InvoiceStatus.Credited;
        _db.Invoices.Add(note);
        return note;
    }

    /// <summary>What marking the claim as submitted would issue now (the same <see cref="DueGroups"/>, no number taken): nothing unless it is Draft, Ready or Rejected.</summary>
    public async Task<ClaimSubmitPreviewDto> SubmitPreviewAsync(Guid claimId, CancellationToken ct)
    {
        var claim = await LoadClaimAsync(claimId, ct) ?? throw new InvalidOperationException("Claim not found.");
        var live = await LiveInvoicesAsync(claimId, ct);
        if (claim.Status is not (TripClaimStatus.Draft or TripClaimStatus.Ready or TripClaimStatus.Rejected))
            return new ClaimSubmitPreviewDto { ClaimId = claimId, AlreadyIssued = live.Count };

        var due = DueGroups(claim, live);
        var tenantId = TenantOf(claim);
        var settings = due.Count == 0 ? null : await SettingsForAsync(tenantId, ct);
        var next = settings == null ? 0
            : await _db.InvoiceNumberCounters.IgnoreQueryFilters([TenantFilter.Name]).Where(c => c.TenantId == tenantId && c.Kind == InvoiceKind.Invoice)
                .Select(c => (int?)c.NextNumber).FirstOrDefaultAsync(ct) ?? settings.InvoiceStartNumber;
        return new ClaimSubmitPreviewDto
        {
            ClaimId = claimId, AlreadyIssued = live.Count, MissingSettings = due.Count > 0 && settings == null,
            ToIssue = due.Select((g, i) =>
            {
                var snapshot = BuildSnapshot(claim, g, settings ?? new ProviderSettings());
                return new PendingInvoiceDto
                {
                    GroupId = g.GroupId, ParticipantName = snapshot.ParticipantName, BillToName = snapshot.BillToName, Total = snapshot.Total,
                    PredictedNumber = settings == null ? null : FormatNumber(settings.InvoiceNumberPrefix, next + i),
                };
            }).ToList(),
        };
    }

    /// <summary>An issued invoice or credit note's PDF, drawn from its snapshot only; null when the caller's organisation has no such row.</summary>
    public async Task<(byte[] Content, string FileName)?> RenderStoredAsync(Guid invoiceId, CancellationToken ct)
    {
        var invoice = await _db.Invoices.AsNoTracking().Include(i => i.Lines).FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
        if (invoice == null) return null;
        invoice.Lines = invoice.Lines.OrderBy(l => l.ServiceFrom).ThenBy(l => l.SupportItemCode, StringComparer.Ordinal).ThenBy(l => l.Id).ToList();
        var creditNote = invoice.Status == InvoiceStatus.Credited
            ? await _db.Invoices.AsNoTracking().Where(c => c.CreditsInvoiceId == invoice.Id).Select(c => new { c.DisplayNumber, c.IssueDate }).FirstOrDefaultAsync(ct)
            : null;
        return (Render(invoice, creditedBy: creditNote?.DisplayNumber, creditedOn: creditNote?.IssueDate), $"{invoice.DisplayNumber}.pdf");
    }

    /// <summary>"TAX INVOICE" only for a GST-registered provider; the date is the claim's own (submitted, else created) in the zone of the State on the document (never the zone setting), so a re-download never moves it.</summary>
    public static (string Title, DateOnly Date) Heading(bool gstRegistered, TripClaim claim, string? state) =>
        (gstRegistered ? "TAX INVOICE" : "INVOICE",
         ProviderLocalTime.TodayIn(claim.SubmittedDate ?? claim.CreatedAt, ProviderTimeZoneResolver.ForInvoiceState(state).Zone));

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
        var next = await db.InvoiceNumberCounters.IgnoreQueryFilters([TenantFilter.Name])
            .Where(c => c.TenantId == s.TenantId && c.Kind == InvoiceKind.Invoice).Select(c => (int?)c.NextNumber).FirstOrDefaultAsync(ct);
        var issued = await db.Invoices.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(i => i.TenantId == s.TenantId && i.Kind == InvoiceKind.Invoice, ct);
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
