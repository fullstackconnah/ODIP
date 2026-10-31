using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>
/// The organisation's time zone setting moves "today" for a NEW invoice, but never re-dates a document that already exists: a credit note and the legacy
/// derived invoice follow the State on the document. Every case uses an NSW organisation set to Perth, at 14:30 UTC on 31 Oct 2026, which is
/// 1 Nov in Sydney (the State's zone) and 31 Oct in Perth (the setting).
/// </summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceTimeZoneTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateTimeOffset Instant = new(2026, 10, 31, 14, 30, 0, TimeSpan.Zero);

    private static (InvoiceKit Kit, TripClaim Claim, ParticipantBooking Booking) PerthOrganisation()
    {
        var kit = Create(now: Instant);
        kit.Settings(gst: true).TimeZoneId = "Australia/Perth";
        kit.Db.SaveChanges();
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Alex", "Able", PlanType.PlanManaged, planManager: PlanManager()));
        return (kit, kit.TripClaim(trip, TripClaimStatus.Draft, booking), booking);
    }

    // Red first: the new invoice's issue date followed the State (1 Nov) before the setting existed.
    [Fact]
    public async Task A_new_invoice_is_issued_on_the_organisations_today_in_its_zone_setting()
    {
        var (kit, claim, _) = PerthOrganisation();

        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);

        Assert.Equal(new DateOnly(2026, 10, 31), (await kit.Db.Invoices.AsNoTracking().SingleAsync()).IssueDate);
    }

    // Guard, not red-first: it passes on the old code too, and fails if CreditAsync is pointed at the setting.
    [Fact]
    public async Task A_credit_note_is_dated_in_the_zone_of_the_State_on_the_original()
    {
        var (kit, claim, _) = PerthOrganisation();
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);
        var original = await kit.Db.Invoices.Include(i => i.Lines).SingleAsync();

        var note = await kit.Service.CreditAsync(original, Instant.UtcDateTime, null, Ct);

        Assert.Equal("NSW", original.SellerState);
        Assert.Equal(new DateOnly(2026, 11, 1), note.IssueDate);
    }

    // Guard, as above: the legacy derived invoice re-downloads with the same date whatever the setting says.
    [Fact]
    public async Task The_legacy_derived_invoice_keeps_the_date_of_the_State_not_the_setting()
    {
        var (kit, claim, booking) = PerthOrganisation();
        claim.SubmittedDate = Instant.UtcDateTime;
        kit.Db.SaveChanges();

        var text = TextOf((await kit.Service.GenerateInvoiceAsync(claim.Id, booking.Id)).Content);

        Assert.Contains(Skeleton("01 Nov 2026"), text);
    }
}
