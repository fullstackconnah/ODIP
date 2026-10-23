using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>GET claims/{id}/invoices (D19): what the claim's Invoices section shows, said by the server: the state, the rows, the payers and the agency count.</summary>
public class ClaimInvoicesEndpointTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static UpdateClaimDto Submit => new() { Status = TripClaimStatus.Submitted };

    private static (InvoiceKit Kit, TripClaim Claim) ThreePayers(TripClaimStatus status = TripClaimStatus.Draft)
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, status,
            kit.Book(trip, kit.Person("Alex", "Able", PlanType.PlanManaged, planManager: PlanManager())), kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)), kit.Book(trip, kit.Person("Cal", "Cee", PlanType.AgencyManaged)));
        return (kit, claim);
    }

    [Fact]
    public async Task ADraftClaim_IsPreview_WithItsPayersAndAgencyCount()
    {
        var (kit, claim) = ThreePayers();

        var dto = DataOf(await kit.Controller().GetClaimInvoices(claim.Id, Ct));

        Assert.Equal("preview", dto.InvoiceState);
        Assert.Empty(dto.Invoices);
        Assert.Equal(new[] { "Pat Manager — Plan Co", "Bea Bee" }, dto.Groups.Select(g => g.BillToName));
        Assert.Equal(new[] { PlanType.PlanManaged, PlanType.SelfManaged }, dto.Groups.Select(g => g.PayerKind));
        Assert.Equal(1, dto.AgencyCount);
    }

    [Fact]
    public async Task ASubmittedClaim_IsIssued_WithItsRows()
    {
        var (kit, claim) = ThreePayers();
        await kit.Controller().UpdateClaim(claim.Id, Submit, Ct);

        var dto = DataOf(await kit.Controller().GetClaimInvoices(claim.Id, Ct));

        Assert.Equal("issued", dto.InvoiceState);
        Assert.Equal(new[] { "INV-0001", "INV-0002" }, dto.Invoices.Select(i => i.DisplayNumber));
        var first = dto.Invoices[0];
        Assert.Equal(("Alex Able", "Pat Manager — Plan Co", InvoiceStatus.Issued, new DateOnly(2026, 10, 23), (DateOnly?)new DateOnly(2026, 11, 6), 100m, false),
            (first.ParticipantName, first.BillToName, first.Status, first.IssueDate, first.DueDate, first.Total, first.PaymentRecorded));
    }

    [Fact]
    public async Task AnAgencyOnlyClaim_IsNone_DraftOrSubmitted()
    {
        var kit = Create();
        var trip = kit.Trip();
        var draft = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Ann", "Agency", PlanType.AgencyManaged)));
        var submitted = kit.TripClaim(trip, TripClaimStatus.Submitted, kit.Book(trip, kit.Person("Abe", "Agency", PlanType.AgencyManaged)));

        Assert.Equal("none", DataOf(await kit.Controller().GetClaimInvoices(draft.Id, Ct)).InvoiceState);
        var dto = DataOf(await kit.Controller().GetClaimInvoices(submitted.Id, Ct));
        Assert.Equal(("none", 1), (dto.InvoiceState, dto.AgencyCount));
    }

    [Fact]
    public async Task AClaimSubmittedBeforeNumbering_IsLegacy()
    {
        var (kit, claim) = ThreePayers(TripClaimStatus.Submitted);

        var dto = DataOf(await kit.Controller().GetClaimInvoices(claim.Id, Ct));

        Assert.Equal("legacy", dto.InvoiceState);
        Assert.Equal(2, dto.Groups.Count);
    }

    [Fact]
    public async Task ACreditNote_SitsDirectlyUnderTheInvoiceItCredits()
    {
        var (kit, claim) = ThreePayers();
        await kit.Controller().UpdateClaim(claim.Id, Submit, Ct);
        var first = kit.Db.Invoices.Single(i => i.Number == 1);
        first.Status = InvoiceStatus.Credited;
        kit.Db.Invoices.Add(new Invoice
        {
            Id = Guid.NewGuid(), TenantId = TenantA, Kind = InvoiceKind.CreditNote, Number = 1, DisplayNumber = "CN-0001", Status = InvoiceStatus.Issued, TripClaimId = claim.Id, ClaimReference = claim.ClaimReference,
            ParticipantId = first.ParticipantId, ParticipantBookingId = first.ParticipantBookingId, CreditsInvoiceId = first.Id, CreditsDisplayNumber = first.DisplayNumber, Total = first.Total, IssueDate = first.IssueDate,
        });
        kit.Db.SaveChanges();

        var dto = DataOf(await kit.Controller().GetClaimInvoices(claim.Id, Ct));

        Assert.Equal(new[] { "INV-0001", "CN-0001", "INV-0002" }, dto.Invoices.Select(i => i.DisplayNumber));
        Assert.Equal(("INV-0001", InvoiceKind.CreditNote), (dto.Invoices[1].CreditsDisplayNumber, dto.Invoices[1].Kind));
        Assert.Equal("CN-0001", dto.Invoices[0].CreditedByDisplayNumber);
    }

    [Fact]
    public async Task AnotherOrganisationsInvoiceAndClaim_Are404()
    {
        var name = Guid.NewGuid().ToString();
        var theirs = Create(TenantB, database: name);
        theirs.Settings(TenantB);
        var trip = theirs.Trip(TenantB);
        var claim = theirs.TripClaim(trip, TripClaimStatus.Draft, theirs.Book(trip, theirs.Person("Bea", "Bee", PlanType.SelfManaged, TenantB)));
        await theirs.Controller().UpdateClaim(claim.Id, Submit, Ct);
        var invoiceId = theirs.Db.Invoices.Single().Id;
        var kit = Create(TenantA, database: name);

        Assert.IsType<NotFoundObjectResult>(await kit.Controller().DownloadIssuedInvoice(invoiceId, Ct));
        Assert.Equal(404, StatusOf(await kit.Controller().GetClaimInvoices(claim.Id, Ct)));
    }
}

/// <summary>GET claims/{id}/invoices/{groupId} (D18): the issued snapshot when there is one, else the preview of an unsubmitted claim, else the legacy render.</summary>
[Collection(InvoicePdfs.Name)]
public class DownloadPrecedenceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static string Text(IActionResult result) => TextOf(Assert.IsType<FileContentResult>(result).FileContents);

    [Fact]
    public async Task ATripPayer_MovesFromPreview_ToSnapshot_ToVoided()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, booking);

        Assert.Contains(Skeleton("DRAFT – not issued"), Text(await kit.Controller().DownloadInvoice(claim.Id, booking.Id, Ct)));

        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);
        var issued = Text(await kit.Controller().DownloadInvoice(claim.Id, booking.Id, Ct));
        Assert.Contains(Skeleton("INV-0001"), issued);
        Assert.DoesNotContain(Skeleton("DRAFT"), issued);

        var invoice = kit.Db.Invoices.Single();
        invoice.Status = InvoiceStatus.Voided;
        invoice.VoidedAt = Now.UtcDateTime;
        kit.Db.SaveChanges();
        var voided = Text(await kit.Controller().DownloadInvoice(claim.Id, booking.Id, Ct));
        Assert.Contains(Skeleton("VOID"), voided);
        Assert.Contains(Skeleton("INV-0001"), voided);
    }

    [Fact]
    public async Task AClaimSubmittedBeforeNumbering_GetsTheLegacyRender()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Submitted, booking);

        Assert.Contains(Skeleton($"INV-{claim.ClaimReference}-"), Text(await kit.Controller().DownloadInvoice(claim.Id, booking.Id, Ct)));
    }

    [Fact]
    public async Task AnAgencyBooking_IsStill400()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var booking = kit.Book(trip, kit.Person("Ann", "Agency", PlanType.AgencyManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, booking);

        var result = Assert.IsType<BadRequestObjectResult>(await kit.Controller().DownloadInvoice(claim.Id, booking.Id, Ct));
        Assert.Equal("Agency-managed participants use the BPR CSV, not invoices.", Assert.Single(Assert.IsType<Odip.Application.Common.ApiResponse<bool>>(result.Value).Errors!));
    }

    [Fact]
    public async Task AShiftClaim_ByParticipant_MovesFromPreview_ToSnapshot()
    {
        var kit = Create();
        kit.Settings();
        var person = kit.Person("Sam", "Lee", PlanType.SelfManaged);
        var claim = kit.ShiftClaim(person, TripClaimStatus.Draft, 120m);

        Assert.Contains(Skeleton("DRAFT – not issued"), Text(await kit.Controller().DownloadInvoice(claim.Id, person.Id, Ct)));
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);
        Assert.Contains(Skeleton("INV-0001"), Text(await kit.Controller().DownloadInvoice(claim.Id, person.Id, Ct)));
    }
}
