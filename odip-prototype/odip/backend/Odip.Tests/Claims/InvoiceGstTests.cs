using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
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
