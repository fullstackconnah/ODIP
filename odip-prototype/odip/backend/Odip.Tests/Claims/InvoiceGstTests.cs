using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>
/// The invoice charges GST line by line: 10% of the lines coded P1 (tax claimable), nothing on P2 (GST-free) or P5 (out of scope) lines,
/// and nothing at all when the provider is not GST-registered. It used to add 10% of the whole subtotal for every registered provider.
/// </summary>
public class InvoiceGstTests
{
    private static ClaimLineItem Line(decimal amount, GSTCode code) => new() { Id = Guid.NewGuid(), TotalAmount = amount, GSTCode = code };

    [Fact]
    public void All_gst_free_lines_carry_no_gst() =>
        Assert.Equal(0m, InvoiceService.GstFor(new[] { Line(480m, GSTCode.P2), Line(320m, GSTCode.P2) }, gstRegistered: true));

    [Fact]
    public void All_taxable_lines_carry_ten_percent() =>
        Assert.Equal(80m, InvoiceService.GstFor(new[] { Line(480m, GSTCode.P1), Line(320m, GSTCode.P1) }, gstRegistered: true));

    [Fact]
    public void A_mix_charges_gst_on_the_taxable_lines_only() =>
        Assert.Equal(12.35m, InvoiceService.GstFor(new[] { Line(480m, GSTCode.P2), Line(123.45m, GSTCode.P1), Line(200m, GSTCode.P5) }, gstRegistered: true));

    [Fact]
    public void An_unregistered_provider_charges_no_gst_even_on_taxable_lines() =>
        Assert.Equal(0m, InvoiceService.GstFor(new[] { Line(480m, GSTCode.P1) }, gstRegistered: false));

    // The legacy values (GST, NoGST, Exempt) are never written by the claim generators; the BPR CSV sends them as P2, so the invoice treats them as GST-free too.
    [Theory]
    [InlineData(GSTCode.GST)]
    [InlineData(GSTCode.NoGST)]
    [InlineData(GSTCode.Exempt)]
    public void A_legacy_code_is_gst_free_as_the_bpr_csv_sends_it(GSTCode code) =>
        Assert.Equal(0m, InvoiceService.GstFor(new[] { Line(480m, code) }, gstRegistered: true));

    [Fact]
    public void Gst_is_rounded_to_the_cent_half_away_from_zero() =>
        Assert.Equal(0.01m, InvoiceService.GstFor(new[] { Line(0.05m, GSTCode.P1) }, gstRegistered: true));

    [Fact]
    public async Task The_pdf_marks_each_line_and_totals_gst_from_the_taxable_lines_only()
    {
        using var db = TestDb.Create();
        var (claimId, bookingId) = Seed(db, gstRegistered: true, (480m, GSTCode.P2), (100m, GSTCode.P1));

        var (pdf, _) = await new InvoiceService(db).GenerateInvoiceAsync(claimId, bookingId);
        var text = TextOf(pdf);

        Assert.Contains(Skeleton("GST-free"), text);
        Assert.Contains(Skeleton("Subtotal: $580.00"), text);
        Assert.Contains(Skeleton("GST: $10.00"), text);
        Assert.Contains(Skeleton("Total: $590.00"), text);
    }

    [Fact]
    public async Task An_unregistered_providers_pdf_has_no_gst_line()
    {
        using var db = TestDb.Create();
        var (claimId, bookingId) = Seed(db, gstRegistered: false, (100m, GSTCode.P2));

        var (pdf, _) = await new InvoiceService(db).GenerateInvoiceAsync(claimId, bookingId);
        var text = TextOf(pdf);

        Assert.DoesNotContain(Skeleton("GST: $"), text);
        Assert.Contains(Skeleton("Total: $100.00"), text);
    }

    /// <summary>Submits one self-managed claim with the given lines (one payer) and returns the kit and the claim.</summary>
    private static async Task<(InvoiceKit Kit, TripClaim Claim)> Submitted(bool gstRegistered, params (decimal Amount, GSTCode Code)[] lines)
    {
        var kit = Create();
        kit.Settings(gst: gstRegistered, bsb: "062-000", account: "12345678");
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Alex", "Able", PlanType.SelfManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, lines.Select(l => (booking, 1m, l.Amount, l.Amount, l.Code)).ToArray());
        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, CancellationToken.None)));
        return (kit, claim);
    }

    [Fact]
    public async Task A_registered_providers_invoice_and_credit_note_carry_gst_from_the_taxable_lines_exactly()
    {
        var (kit, claim) = await Submitted(gstRegistered: true, (100m, GSTCode.P1), (430.58m, GSTCode.P2));
        var invoice = kit.Db.Invoices.AsNoTracking().Single(i => i.Kind == InvoiceKind.Invoice);
        Assert.Equal((530.58m, 10.00m, 540.58m), (invoice.Subtotal, invoice.Gst, invoice.Total));

        foreach (var line in kit.Db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claim.Id).ToList())
            await kit.Controller().UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, CancellationToken.None);
        Assert.Equal(200, StatusOf(await kit.Controller().IssueCreditNote(invoice.Id, new InvoiceReasonDto { Reason = "Wrong rate" }, CancellationToken.None)));

        var credit = kit.Db.Invoices.AsNoTracking().Single(i => i.Kind == InvoiceKind.CreditNote);
        Assert.Equal((530.58m, 10.00m, 540.58m), (credit.Subtotal, credit.Gst, credit.Total));
    }

    [Fact]
    public async Task An_unregistered_providers_invoice_stores_no_gst_even_for_a_taxable_line()
    {
        var (kit, _) = await Submitted(gstRegistered: false, (100m, GSTCode.P1));
        var invoice = kit.Db.Invoices.AsNoTracking().Single();
        Assert.Equal((100m, 0m, 100m), (invoice.Subtotal, invoice.Gst, invoice.Total));
    }

    private static (Guid ClaimId, Guid BookingId) Seed(OdipDbContext db, bool gstRegistered, params (decimal Amount, GSTCode Code)[] lines)
    {
        var tenantId = Guid.NewGuid();
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test Provider", Address = "1 Test St", State = "VIC", GSTRegistered = gstRegistered });
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Jane", LastName = "Doe", NdisNumber = "43100001234", PlanType = PlanType.SelfManaged };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Test Trip", StartDate = new DateOnly(2026, 1, 5), DurationDays = 1 };
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, Participant = participant, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        var claim = new TripClaim { Id = Guid.NewGuid(), TripInstanceId = trip.Id, Status = TripClaimStatus.Draft, ClaimReference = "CLM-001" };
        db.AddRange(participant, trip, booking, claim);
        foreach (var (amount, code) in lines)
            db.ClaimLineItems.Add(new ClaimLineItem
            {
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
                SupportsDeliveredFrom = new DateOnly(2026, 1, 5), SupportsDeliveredTo = new DateOnly(2026, 1, 5), Hours = 1m, UnitPrice = amount, TotalAmount = amount, GSTCode = code,
            });
        db.SaveChanges();
        return (claim.Id, booking.Id);
    }
}
