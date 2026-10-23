using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>Spec 5.5 and 5.8 #5: void (no payment recorded) or a full credit note (a payment is recorded), with a reason, an audit row on the claim, and numbers never used again.</summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceVoidCreditTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static InvoiceReasonDto Why(string reason = "Wrong rate") => new() { Reason = reason };

    /// <summary>A submitted self-managed trip claim with one invoice per booking given ("Alex Able", "Bea Bee", ...), numbered from 1.</summary>
    internal static async Task<(InvoiceKit Kit, TripClaim Claim)> Issued(int payers = 1, InvoiceKit? kit = null, string state = "NSW")
    {
        kit ??= Create();
        if (!kit.Db.ProviderSettings.Any()) kit.Settings(state: state, bsb: "062-000", account: "12345678");
        var trip = kit.Trip();
        var names = new[] { ("Alex", "Able"), ("Bea", "Bee"), ("Cal", "Cee") };
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, names.Take(payers).Select(n => kit.Book(trip, kit.Person(n.Item1, n.Item2, PlanType.SelfManaged))).ToArray());
        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));
        return (kit, claim);
    }

    private static Invoice Row(InvoiceKit kit, string number) => kit.Db.Invoices.AsNoTracking().Single(i => i.DisplayNumber == number);

    [Fact]
    public async Task Void_RecordsWhoWhenWhy_AndAuditsOnTheClaim()
    {
        var (kit, claim) = await Issued();
        var invoice = Row(kit, "INV-0001");

        var result = await kit.Controller().VoidInvoice(invoice.Id, Why("  Wrong rate  "), Ct);

        Assert.Equal((InvoiceStatus.Voided, "INV-0001"), (DataOf(result).Status, DataOf(result).DisplayNumber));
        var stored = Row(kit, "INV-0001");
        Assert.Equal((InvoiceStatus.Voided, (DateTime?)Now.UtcDateTime, (Guid?)ActorId, "Wrong rate"), (stored.Status, stored.VoidedAt, stored.VoidedById, stored.VoidReason));
        var audit = Assert.Single(kit.Db.AuditLogs.AsNoTracking().Where(a => a.EntityType == "TripClaim" && a.EntityId == claim.Id).ToList());
        var change = JsonSerializer.Deserialize<JsonElement>(audit.Changes).EnumerateArray().Single();
        Assert.Equal("Invoice INV-0001", change.GetProperty("Field").GetString());
        Assert.StartsWith("Void:", change.GetProperty("New").GetString());
        Assert.DoesNotContain("062", audit.Changes);
        Assert.DoesNotContain("12345678", audit.Changes);
    }

    [Theory]
    [InlineData("a: a covered line paid")]
    [InlineData("b: a covered line part paid, no amount")]
    [InlineData("c: the claim marked paid, its lines unpaid")]
    [InlineData("d: nothing paid")]
    public async Task PaymentRecorded_DecidesVoidOrCreditNote(string payment)
    {
        var (kit, claim) = await Issued();
        var line = kit.Db.ClaimLineItems.AsNoTracking().Single(l => l.TripClaimId == claim.Id);
        var controller = kit.Controller();
        switch (payment[0])
        {
            case 'a': await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct); break;
            case 'b': await controller.UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.PartiallyPaid }, Ct); break;
            case 'c': await controller.UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Paid }, Ct); break;
        }
        kit.Db.ChangeTracker.Clear();

        var recorded = Assert.Single(DataOf(await kit.Controller().GetClaimInvoices(claim.Id, Ct)).Invoices).PaymentRecorded;
        var result = await kit.Controller().VoidInvoice(Row(kit, "INV-0001").Id, Why(), Ct);

        if (payment[0] == 'd')
        {
            Assert.False(recorded);
            Assert.Equal(200, StatusOf(result));
        }
        else
        {
            Assert.True(recorded);
            Assert.Equal(409, StatusOf(result));
            Assert.Equal("A payment is recorded, so issue a credit note instead.", RefusalOf(result));
            Assert.Equal(InvoiceStatus.Issued, Row(kit, "INV-0001").Status);
        }
    }

    [Fact]
    public async Task ACreditNote_CreditsTheInvoiceInFull()
    {
        var (kit, claim) = await Issued();
        var line = kit.Db.ClaimLineItems.AsNoTracking().Single(l => l.TripClaimId == claim.Id);
        await kit.Controller().UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = ClaimLineItemStatus.Paid }, Ct);
        var original = Row(kit, "INV-0001");

        var result = await kit.Controller().IssueCreditNote(original.Id, Why(), Ct);

        Assert.Equal("CN-0001", DataOf(result).DisplayNumber);
        var credit = kit.Db.Invoices.AsNoTracking().Include(i => i.Lines).Single(i => i.Kind == InvoiceKind.CreditNote);
        Assert.Equal(("CN-0001", 1, (Guid?)original.Id, "INV-0001", InvoiceStatus.Issued, claim.Id), (credit.DisplayNumber, credit.Number, credit.CreditsInvoiceId, credit.CreditsDisplayNumber, credit.Status, credit.TripClaimId!.Value));
        Assert.Equal((original.Subtotal, original.Gst, original.Total, original.BillToName), (credit.Subtotal, credit.Gst, credit.Total, credit.BillToName));
        Assert.Equal(100m, Assert.Single(credit.Lines).LineTotal);
        Assert.Equal(InvoiceStatus.Credited, Row(kit, "INV-0001").Status);
        Assert.Contains(kit.Db.AuditLogs.AsNoTracking().ToList(), a => a.Changes.Contains("Credited by CN-0001"));
    }

    [Fact]
    public async Task VoidedAndCreditedNumbers_AreNeverReissued()
    {
        var (kit, _) = await Issued(payers: 3);
        await kit.Controller().VoidInvoice(Row(kit, "INV-0003").Id, Why(), Ct);   // the HIGHEST: a MAX+1 scheme would give 0003 again
        await kit.Controller().IssueCreditNote(Row(kit, "INV-0002").Id, Why(), Ct);

        await Issued(kit: kit);

        Assert.Equal(4, kit.Db.Invoices.AsNoTracking().Where(i => i.Kind == InvoiceKind.Invoice).Max(i => i.Number));
        Assert.Single(kit.Db.Invoices.AsNoTracking().Where(i => i.DisplayNumber == "INV-0004"));
        Assert.Single(kit.Db.Invoices.AsNoTracking().Where(i => i.DisplayNumber == "INV-0003"));
    }

    [Fact]
    public async Task VoidAndCredit_AsSuperAdminWithoutViewAs_KeepTheOrganisation()
    {
        var name = Guid.NewGuid().ToString();
        var theirs = Create(TenantB, database: name);
        theirs.Settings(TenantB);
        await Issued(payers: 2, kit: theirs);
        var kit = Create(TenantA, superAdmin: true, database: name);

        Assert.Equal(200, StatusOf(await kit.Controller("SuperAdmin").IssueCreditNote(Row(kit, "INV-0001").Id, Why(), Ct)));
        Assert.Equal(200, StatusOf(await kit.Controller("SuperAdmin").VoidInvoice(Row(kit, "INV-0002").Id, Why(), Ct)));

        var credit = kit.Db.Invoices.IgnoreQueryFilters().AsNoTracking().Include(i => i.Lines).Single(i => i.Kind == InvoiceKind.CreditNote);
        Assert.Equal(TenantB, credit.TenantId);
        Assert.All(credit.Lines, l => Assert.Equal(TenantB, l.TenantId));
        Assert.DoesNotContain(kit.Db.Invoices.IgnoreQueryFilters().AsNoTracking(), i => i.TenantId == Guid.Empty);
        Assert.DoesNotContain(kit.Db.InvoiceLines.IgnoreQueryFilters().AsNoTracking(), l => l.TenantId == Guid.Empty);
        Assert.Single(kit.Db.InvoiceNumberCounters.IgnoreQueryFilters().AsNoTracking().Where(c => c.TenantId == TenantB && c.Kind == InvoiceKind.CreditNote));
    }

    [Fact]
    public async Task TheVoidedOnDay_UsesTheSnapshotsState()
    {
        var (kit, _) = await Issued(state: "NSW");
        kit.Db.ProviderSettings.Single().State = "WA";
        kit.Db.SaveChanges();
        kit.Clock.Now = new DateTimeOffset(2026, 10, 22, 14, 30, 0, TimeSpan.Zero);   // 23 Oct in NSW, 22 Oct in WA
        var invoice = Row(kit, "INV-0001");

        await kit.Controller().VoidInvoice(invoice.Id, Why(), Ct);

        var text = TextOf(Assert.IsType<FileContentResult>(await kit.Controller().DownloadIssuedInvoice(invoice.Id, Ct)).FileContents);
        Assert.Contains(Skeleton("Voided on 23 Oct 2026"), text);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("long")]
    [InlineData("control")]
    public async Task Reason_IsRequired(string reason)
    {
        var (kit, _) = await Issued();
        var invoice = Row(kit, "INV-0001");
        var sent = reason switch { "long" => new string('a', 501), "control" => "Wrong\u0000rate", _ => reason };

        Assert.Equal(400, StatusOf(await kit.Controller().VoidInvoice(invoice.Id, Why(sent), Ct)));
        Assert.Equal(400, StatusOf(await kit.Controller().IssueCreditNote(invoice.Id, Why(sent), Ct)));
        Assert.Equal(InvoiceStatus.Issued, Row(kit, "INV-0001").Status);
        Assert.Empty(kit.Db.AuditLogs.AsNoTracking());
    }

    [Fact]
    public async Task Void_OnAVoidedOrACreditNote_Is409()
    {
        var (kit, claim) = await Issued(payers: 2);
        await kit.Controller().VoidInvoice(Row(kit, "INV-0001").Id, Why(), Ct);
        await kit.Controller().IssueCreditNote(Row(kit, "INV-0002").Id, Why(), Ct);

        var again = await kit.Controller().VoidInvoice(Row(kit, "INV-0001").Id, Why(), Ct);
        Assert.Equal((409, "INV-0001 is already void."), (StatusOf(again), RefusalOf(again)));
        var credited = await kit.Controller().VoidInvoice(Row(kit, "INV-0002").Id, Why(), Ct);
        Assert.Equal((409, "INV-0002 is already credited."), (StatusOf(credited), RefusalOf(credited)));
        var note = await kit.Controller().VoidInvoice(Row(kit, "CN-0001").Id, Why(), Ct);
        Assert.Equal((409, "CN-0001 is a credit note, so it stands as issued."), (StatusOf(note), RefusalOf(note)));
    }

    [Fact]
    public async Task Void_OnAVoidedInvoice_AfterItsClaimWasDeleted_Is409()
    {
        var kit = Create();
        var orphan = new Invoice { Id = Guid.NewGuid(), TenantId = TenantA, Kind = InvoiceKind.Invoice, Number = 1, DisplayNumber = "INV-0001", Status = InvoiceStatus.Voided, ClaimReference = "TC-1", ParticipantId = Guid.NewGuid() };
        var live = new Invoice { Id = Guid.NewGuid(), TenantId = TenantA, Kind = InvoiceKind.Invoice, Number = 2, DisplayNumber = "INV-0002", Status = InvoiceStatus.Issued, ClaimReference = "TC-2", ParticipantId = Guid.NewGuid() };
        kit.Db.Invoices.AddRange(orphan, live);
        kit.Db.SaveChanges();

        Assert.Equal(409, StatusOf(await kit.Controller().VoidInvoice(orphan.Id, Why(), Ct)));
        var noClaim = await kit.Controller().VoidInvoice(live.Id, Why(), Ct);
        Assert.Equal((409, "INV-0002 has no claim any more."), (StatusOf(noClaim), RefusalOf(noClaim)));
    }

    [Fact]
    public async Task AnotherOrganisationsInvoice_Is404()
    {
        var name = Guid.NewGuid().ToString();
        var theirs = Create(TenantB, database: name);
        theirs.Settings(TenantB);
        await Issued(kit: theirs);
        var invoiceId = theirs.Db.Invoices.Single().Id;
        var kit = Create(TenantA, database: name);

        Assert.Equal(404, StatusOf(await kit.Controller().VoidInvoice(invoiceId, Why(), Ct)));
        Assert.Equal(404, StatusOf(await kit.Controller().IssueCreditNote(invoiceId, Why(), Ct)));
    }

    [Fact]
    public async Task VoidAndCreditedPdfs_HaveTheBand_AndNoPaymentBlock()
    {
        var (kit, _) = await Issued(payers: 2);
        var voided = Row(kit, "INV-0001");
        var credited = Row(kit, "INV-0002");
        await kit.Controller().VoidInvoice(voided.Id, Why(), Ct);
        await kit.Controller().IssueCreditNote(credited.Id, Why(), Ct);

        var voidText = TextOf(Assert.IsType<FileContentResult>(await kit.Controller().DownloadIssuedInvoice(voided.Id, Ct)).FileContents);
        var creditedText = TextOf(Assert.IsType<FileContentResult>(await kit.Controller().DownloadIssuedInvoice(credited.Id, Ct)).FileContents);

        Assert.Contains(Skeleton("VOID"), voidText);
        Assert.Contains(Skeleton("CREDITED"), creditedText);
        Assert.Contains(Skeleton("Credited in full by CN-0001"), creditedText);
        foreach (var text in new[] { voidText, creditedText })
        {
            Assert.DoesNotContain("BSB", text);
            Assert.DoesNotContain(Skeleton("Payment terms"), text);
        }
    }

    [Fact]
    public async Task CreditNotePdf_IsNegative()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, (kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)), 7.5m, 57.41m, 430.58m, GSTCode.P2));
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);
        await kit.Controller().IssueCreditNote(Row(kit, "INV-0001").Id, Why(), Ct);

        var pdf = Assert.IsType<FileContentResult>(await kit.Controller().DownloadIssuedInvoice(Row(kit, "CN-0001").Id, Ct)).FileContents;

        Assert.Contains(Skeleton("CREDIT NOTE"), TextOf(pdf));
        Assert.Contains(Skeleton("Credits INV-0001"), TextOf(pdf));
        Assert.Contains("-$430.58", RawTextOf(pdf));
        Assert.DoesNotContain("$-", RawTextOf(pdf));
    }
}

/// <summary>Spec 5.8 #6 (InMemory half): a claim with an invoice standing can't be deleted; voided, it can, and the invoice rows and numbers stay.</summary>
public class ClaimDeleteInvoiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [Fact]
    public async Task Delete_IsRefused_WhileAnInvoiceIsIssued_AndAllowedAfterVoid()
    {
        var (kit, claim) = await InvoiceVoidCreditTests.Issued(payers: 2);
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Rejected }, Ct);

        var both = await kit.Controller().DeleteClaim(claim.Id, Ct);
        Assert.Equal((409, "Void INV-0001 and INV-0002 first, then delete the claim."), (StatusOf(both), RefusalOf(both)));
        var first = kit.Db.Invoices.AsNoTracking().Single(i => i.Number == 1);
        await kit.Controller().VoidInvoice(first.Id, new InvoiceReasonDto { Reason = "Wrong rate" }, Ct);

        var one = await kit.Controller().DeleteClaim(claim.Id, Ct);
        Assert.Equal((409, "Void INV-0002 first, then delete the claim."), (StatusOf(one), RefusalOf(one)));
        Assert.True(await kit.Db.TripClaims.AnyAsync(c => c.Id == claim.Id));

        var second = kit.Db.Invoices.AsNoTracking().Single(i => i.Number == 2);
        await kit.Controller().VoidInvoice(second.Id, new InvoiceReasonDto { Reason = "Wrong rate" }, Ct);
        Assert.Equal(200, StatusOf(await kit.Controller().DeleteClaim(claim.Id, Ct)));

        Assert.False(await kit.Db.TripClaims.AnyAsync(c => c.Id == claim.Id));
        Assert.Equal(new[] { "INV-0001", "INV-0002" }, kit.Db.Invoices.AsNoTracking().OrderBy(i => i.Number).Select(i => i.DisplayNumber));
    }
}

/// <summary>Spec 5.8 #7: Rejected then Submitted again issues only for the payers whose invoice was voided or credited.</summary>
public class ResubmitTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    [Fact]
    public async Task RejectedThenSubmitted_IssuesOnlyForVoidedOrCreditedGroups()
    {
        var (kit, claim) = await InvoiceVoidCreditTests.Issued(payers: 2);
        var groupA = kit.Db.Invoices.AsNoTracking().Single(i => i.Number == 1);
        var groupB = kit.Db.Invoices.AsNoTracking().Single(i => i.Number == 2);
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Rejected }, Ct);
        await kit.Controller().VoidInvoice(groupA.Id, new InvoiceReasonDto { Reason = "Wrong rate" }, Ct);

        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);

        var fresh = Assert.Single(kit.Db.Invoices.AsNoTracking().Where(i => i.Number > 2).ToList());
        Assert.Equal((3, groupA.ParticipantBookingId), (fresh.Number, fresh.ParticipantBookingId));
        Assert.Equal(InvoiceStatus.Issued, kit.Db.Invoices.AsNoTracking().Single(i => i.Id == groupB.Id).Status);

        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Rejected }, Ct);
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);
        Assert.Equal(3, kit.Db.Invoices.Count());
    }
}

/// <summary>Only an Admin (or a SuperAdmin) voids or credits; Coordinators still submit and download.</summary>
public class InvoiceRoleTests
{
    [Theory]
    [InlineData(nameof(ClaimsController.VoidInvoice))]
    [InlineData(nameof(ClaimsController.IssueCreditNote))]
    public void VoidAndCredit_AreAdminOnly(string action)
    {
        var roles = typeof(ClaimsController).GetMethod(action)!.GetCustomAttributes<AuthorizeAttribute>().Select(a => a.Roles).ToList();
        Assert.Equal(new[] { "Admin,SuperAdmin" }, roles);
    }

    [Fact]
    public void TheClassStillLetsCoordinatorsIn()
    {
        Assert.Contains("Coordinator", typeof(ClaimsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
    }
}
