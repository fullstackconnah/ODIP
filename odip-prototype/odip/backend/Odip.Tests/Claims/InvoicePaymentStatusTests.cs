using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>The derived payment status (spec 2026-11-12): pure, nothing stored. Also pins it to <see cref="InvoiceService.PaymentRecorded"/>, which gates void.</summary>
public class InvoicePaymentStatusTests
{
    private static ClaimLineItem Line(ClaimLineItemStatus status = ClaimLineItemStatus.Approved, decimal paid = 0m) =>
        new() { Id = Guid.NewGuid(), Status = status, PaidAmount = paid };

    private static Invoice Inv(IEnumerable<ClaimLineItem> covers, int extraOrphanLines = 0, InvoiceKind kind = InvoiceKind.Invoice, InvoiceStatus status = InvoiceStatus.Issued)
    {
        var lines = covers.Select(l => new InvoiceLine { Id = Guid.NewGuid(), ClaimLineItemId = l.Id }).ToList();
        lines.AddRange(Enumerable.Range(0, extraOrphanLines).Select(_ => new InvoiceLine { Id = Guid.NewGuid(), ClaimLineItemId = null }));
        return new Invoice { Id = Guid.NewGuid(), Kind = kind, Status = status, Lines = lines };
    }

    private static Dictionary<Guid, ClaimLineItem> Map(params ClaimLineItem[] lines) => lines.ToDictionary(l => l.Id);

    private static InvoicePaymentStatus? Of(Invoice inv, Dictionary<Guid, ClaimLineItem> map, TripClaimStatus? claim) => InvoiceService.PaymentStatusOf(inv, map, claim);

    [Theory]
    [InlineData(InvoiceKind.CreditNote, InvoiceStatus.Issued)]
    [InlineData(InvoiceKind.Invoice, InvoiceStatus.Voided)]
    [InlineData(InvoiceKind.Invoice, InvoiceStatus.Credited)]
    public void ACreditNote_AVoidedAndACreditedInvoice_HaveNoPaymentStatus(InvoiceKind kind, InvoiceStatus status)
    {
        var l = Line(ClaimLineItemStatus.Paid, 50m);
        Assert.Null(Of(Inv([l], kind: kind, status: status), Map(l), TripClaimStatus.Paid));
    }

    [Fact]
    public void AnIssuedInvoice_OnAPaidClaim_IsPaid_EvenWithNoLineMarked()
    {
        var l = Line();
        Assert.Equal(InvoicePaymentStatus.Paid, Of(Inv([l]), Map(l), TripClaimStatus.Paid));
    }

    [Fact]
    public void WhenAllItsLinesArePaid_ItIsPaid_EvenIfTheClaimIsOnlyPartiallyPaid()
    {
        var a = Line(ClaimLineItemStatus.Paid, 10m);
        var b = Line(ClaimLineItemStatus.Paid, 10m);
        Assert.Equal(InvoicePaymentStatus.Paid, Of(Inv([a, b]), Map(a, b, Line()), TripClaimStatus.PartiallyPaid));
    }

    [Fact]
    public void OneLinePaidAndOneSubmitted_IsPartPaid()
    {
        var a = Line(ClaimLineItemStatus.Paid, 10m);
        var b = Line(ClaimLineItemStatus.Submitted);
        Assert.Equal(InvoicePaymentStatus.PartPaid, Of(Inv([a, b]), Map(a, b), TripClaimStatus.Submitted));
    }

    [Fact]
    public void ALineWithAPaidAmountButStatusApproved_IsPartPaid()
    {
        var a = Line(ClaimLineItemStatus.Approved, 5m);
        Assert.Equal(InvoicePaymentStatus.PartPaid, Of(Inv([a]), Map(a), TripClaimStatus.Approved));
    }

    [Fact]
    public void APartiallyPaidClaim_WithNoLineMarked_IsPartPaid()
    {
        var a = Line();
        Assert.Equal(InvoicePaymentStatus.PartPaid, Of(Inv([a]), Map(a), TripClaimStatus.PartiallyPaid));
    }

    [Fact]
    public void NothingPaid_IsOutstanding()
    {
        var a = Line(ClaimLineItemStatus.Submitted);
        Assert.Equal(InvoicePaymentStatus.Outstanding, Of(Inv([a]), Map(a), TripClaimStatus.Submitted));
    }

    [Fact]
    public void AnInvoiceCoveringNoLine_IsNotPaidByTheEmptySet()
    {
        Assert.Equal(InvoicePaymentStatus.Outstanding, Of(Inv([], extraOrphanLines: 2), Map(Line(ClaimLineItemStatus.Paid, 9m)), TripClaimStatus.Submitted));
    }

    [Fact]
    public void ADeletedClaim_IsOutstanding()
    {
        Assert.Equal(InvoicePaymentStatus.Outstanding, Of(Inv([], extraOrphanLines: 1), Map(), null));
    }

    [Fact]
    public void PaymentRecorded_IsTrueExactlyWhenTheStatusIsPaidOrPartPaid()
    {
        var paid = Line(ClaimLineItemStatus.Paid, 10m);
        var part = Line(ClaimLineItemStatus.PartiallyPaid, 3m);
        var amount = Line(ClaimLineItemStatus.Approved, 4m);
        var none = Line(ClaimLineItemStatus.Submitted);
        var map = Map(paid, part, amount, none);
        foreach (var claim in Enum.GetValues<TripClaimStatus>())
            foreach (var covers in new ClaimLineItem[][] { [paid], [part], [amount], [none], [paid, none], [paid, part], [] })
            {
                var inv = Inv(covers);
                var s = Of(inv, map, claim);
                Assert.Equal(InvoiceService.PaymentRecorded(inv, map, claim), s is InvoicePaymentStatus.Paid or InvoicePaymentStatus.PartPaid);
            }
    }
}
