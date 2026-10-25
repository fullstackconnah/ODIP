using System.Text;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>Spec 5.8 #9: the numbered invoice adds up exactly as the invoice did before numbering (sum of the stored line totals, GST from GstFor).</summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceTotalsRegressionTests
{
    [Fact]
    public async Task TheSnapshotTotals_EqualTodaysInvoice()
    {
        var kit = InvoiceKit.Create();
        kit.Settings(gst: true);
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Jane", "Doe", PlanType.SelfManaged));
        // 7.5 h x $57.41 is stored as 430.58 (never the unrounded 430.575), twice, plus a $100 P1 line.
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, (booking, 7.5m, 57.41m, 430.58m, GSTCode.P2), (booking, 7.5m, 57.41m, 430.58m, GSTCode.P2), (booking, 1m, 100m, 100m, GSTCode.P1));

        var text = TextOf((await kit.Service.GenerateInvoiceAsync(claim.Id, booking.Id)).Content);
        Assert.Contains(Skeleton("Subtotal: $961.16"), text);
        Assert.Contains(Skeleton("GST: $10.00"), text);
        Assert.Contains(Skeleton("Total: $971.16"), text);

        var snapshot = Assert.Single(await kit.Service.PreviewSnapshotsAsync(claim.Id));
        var lines = kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToList();
        Assert.Equal((961.16m, 10.00m, 971.16m), (snapshot.Subtotal, snapshot.Gst, snapshot.Total));
        Assert.Equal(lines.Sum(l => l.TotalAmount), snapshot.Subtotal);
        Assert.Equal(InvoiceService.GstFor(lines, true), snapshot.Gst);
        Assert.Equal(new[] { 100m, 430.58m, 430.58m }, snapshot.Lines.Select(l => l.LineTotal).Order());
    }
}

/// <summary>The one renderer: the "DRAFT – not issued" preview, the legacy render kept as it was, the organisation's own settings, shift periods and the longest values.</summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceRenderTests
{
    [Fact]
    public async Task PreviewPdf_IsMarkedDraft_WithNoNumber()
    {
        var kit = InvoiceKit.Create();
        kit.Settings(bsb: "062-000", account: "12345678");
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Sam", "Lee", PlanType.SelfManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, booking);

        var (pdf, _) = await kit.Service.PreviewAsync(claim.Id, booking.Id);

        var text = TextOf(pdf);
        Assert.Contains(Skeleton("DRAFT – not issued"), text);
        Assert.Contains(Skeleton("Not issued"), text);
        Assert.DoesNotContain("INV-0", RawTextOf(pdf));
        Assert.DoesNotContain(Skeleton("Payment terms: 14 days. Please pay by"), text);
    }

    [Fact]
    public async Task Legacy_KeepsItsDerivedNumberAndDate()
    {
        var kit = InvoiceKit.Create();
        kit.Settings();
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Sam", "Lee", PlanType.SelfManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Submitted, booking);
        claim.SubmittedDate = InvoiceKit.Now.UtcDateTime;   // 23 Oct 2026 in NSW
        kit.Db.SaveChanges();

        var (pdf, fileName) = await kit.Service.GenerateInvoiceAsync(claim.Id, booking.Id);

        var text = TextOf(pdf);
        Assert.Contains(Skeleton($"INV-{claim.ClaimReference}-"), text);
        Assert.Contains(Skeleton("23 Oct 2026"), text);
        Assert.DoesNotContain(Skeleton("Issued 23"), text);
        Assert.DoesNotContain("Due ", RawTextOf(pdf));
        Assert.StartsWith($"INV-{claim.ClaimReference}-", fileName);
    }

    // The old read took the first settings row of any organisation: tenant A's row is seeded FIRST, so it would win for a SuperAdmin.
    [Fact]
    public async Task ScopedSettings_ThePreviewAndLegacyUseTheClaimsOrganisation()
    {
        var name = Guid.NewGuid().ToString();
        var kit = InvoiceKit.Create(noTenant: true, superAdmin: true, database: name);
        kit.Settings(InvoiceKit.TenantA, abn: "11111111111");
        kit.Settings(InvoiceKit.TenantB, abn: "22222222222");
        var trip = kit.Trip(InvoiceKit.TenantB);
        var draftBooking = kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged, InvoiceKit.TenantB));
        var draft = kit.TripClaim(trip, TripClaimStatus.Draft, draftBooking);
        var oldBooking = kit.Book(trip, kit.Person("Old", "Bee", PlanType.SelfManaged, InvoiceKit.TenantB));
        var submitted = kit.TripClaim(trip, TripClaimStatus.Submitted, oldBooking);

        var preview = TextOf((await kit.Service.PreviewAsync(draft.Id, draftBooking.Id)).Content);
        var legacy = TextOf((await kit.Service.GenerateInvoiceAsync(submitted.Id, oldBooking.Id)).Content);

        Assert.Contains("22222222222", preview);
        Assert.DoesNotContain("11111111111", preview);
        Assert.Contains("22222222222", legacy);
        Assert.DoesNotContain("11111111111", legacy);
    }

    [Fact]
    public async Task ShiftPreview_SaysPeriod_NotTrip()
    {
        var kit = InvoiceKit.Create();
        kit.Settings();
        var person = kit.Person("Sam", "Lee", PlanType.PlanManaged, planManager: InvoiceKit.PlanManager());
        var claim = kit.ShiftClaim(person, TripClaimStatus.Draft, 120m);

        var (pdf, _) = await kit.Service.PreviewAsync(claim.Id, person.Id);

        var raw = RawTextOf(pdf);
        Assert.Contains(Skeleton("Period: 01 Oct 2026 – 14 Oct 2026"), TextOf(pdf));
        Assert.Contains("Period:", raw);
        Assert.DoesNotContain("Trip:", raw);
    }

    // New invoices are refused without a registration number (ProviderSettingsGuard), so a blank one reaches the renderer only on an invoice or credit note snapshotted before that.
    [Theory]
    [InlineData("PR001", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void TheNdisRegistrationLine_IsPrintedOnlyWhenARegistrationNumberIsSet(string registration, bool printed)
    {
        var invoice = new Invoice
        {
            Kind = InvoiceKind.Invoice, Status = InvoiceStatus.Issued, DisplayNumber = "INV-1", IssueDate = new DateOnly(2026, 10, 23), DueDate = new DateOnly(2026, 11, 6),
            BillToName = "Sam Lee", ParticipantName = "Sam Lee", ServiceReference = "Trip: Coastal weekend", SellerOrganisationName = "Test Provider", SellerAbn = "12345678901",
            SellerRegistrationNumber = registration, SellerAddress = "1 Test St", SellerState = "NSW", PaymentTermsDays = 14, Subtotal = 100m, Total = 100m,
            Lines = [new InvoiceLine { SupportItemCode = "04_104_0125_6_1", ServiceFrom = new DateOnly(2026, 10, 3), ServiceTo = new DateOnly(2026, 10, 4), Hours = 1m, UnitPrice = 100m, LineTotal = 100m }],
        };

        var text = TextOf(InvoiceService.Render(invoice));

        Assert.Equal(printed, text.Contains(Skeleton("NDIS Registration")));
        Assert.Contains(Skeleton("ABN: 12345678901"), text);   // the lines around it are untouched
    }

    [Fact]
    public void LongestValues_RenderWithoutALayoutException()
    {
        var invoice = new Invoice
        {
            Kind = InvoiceKind.Invoice, Status = InvoiceStatus.Issued, DisplayNumber = "OASSISTINV12345678", IssueDate = new DateOnly(2026, 10, 23), DueDate = new DateOnly(2026, 11, 6),
            BillToName = "Wolfeschlegelsteinhausenbergerdorff Plan Management Services Pty Ltd — Accounts ".PadRight(120, 'X'), BillToAddress = new string('A', 600),
            ParticipantName = "Sam Lee", ServiceReference = "Trip: Coastal weekend", SellerOrganisationName = "Test Provider", SellerAbn = "12345678901", SellerRegistrationNumber = "PR001",
            SellerAddress = "1 Test St", SellerState = "NSW", PaymentTermsDays = 14, Subtotal = 123456.78m, Total = 123456.78m, BankAccountName = "Acct", Bsb = "062-000", AccountNumber = "12345678",
            Lines = [new InvoiceLine { SupportItemCode = "04_104_0125_6_1", ServiceFrom = new DateOnly(2026, 10, 3), ServiceTo = new DateOnly(2026, 10, 4), Hours = 1m, UnitPrice = 123456.78m, LineTotal = 123456.78m }],
        };

        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(InvoiceService.Render(invoice), 0, 5));
        invoice.DisplayNumber = string.Empty;   // the DRAFT title
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(InvoiceService.Render(invoice), 0, 5));
    }
}
