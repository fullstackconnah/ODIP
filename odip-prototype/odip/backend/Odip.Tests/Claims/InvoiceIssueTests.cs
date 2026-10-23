using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;
using static Odip.Tests.PlanPricing.DraftSigningAndPdfTests;

namespace Odip.Tests.Claims;

/// <summary>Spec 5.1 and 5.8 #2, #4, #8, #10: Mark as Submitted issues one numbered invoice per plan- or self-managed payer, in the same save, or nothing at all.</summary>
[Collection(InvoicePdfs.Name)]
public class InvoiceIssueTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static UpdateClaimDto Submit => new() { Status = TripClaimStatus.Submitted };

    private static List<Invoice> InvoicesOf(InvoiceKit kit, Guid claimId) =>
        kit.Db.Invoices.AsNoTracking().Include(i => i.Lines).Where(i => i.TripClaimId == claimId).OrderBy(i => i.Number).ToList();

    [Fact]
    public async Task TripClaim_ThreePlanTypes_IssuesTwoInvoices()
    {
        var kit = Create();
        kit.Settings(gst: true);
        var trip = kit.Trip();
        var plan = kit.Book(trip, kit.Person("Alex", "Able", PlanType.PlanManaged, planManager: PlanManager()));
        var self = kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged));
        var agency = kit.Book(trip, kit.Person("Cal", "Cee", PlanType.AgencyManaged));
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, (plan, 1m, 100m, 100m, GSTCode.P1), (self, 7.5m, 57.41m, 430.58m, GSTCode.P2), (agency, 1m, 50m, 50m, GSTCode.P2));

        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, Submit, Ct)));

        var rows = InvoicesOf(kit, claim.Id);
        Assert.Equal(2, rows.Count);
        var (first, second) = (rows[0], rows[1]);
        Assert.Equal(("INV-0001", plan.Id, "Pat Manager — Plan Co", "2 Plan St, Sydney, NSW, 2000", "pat@plan.example"),
            (first.DisplayNumber, first.ParticipantBookingId, first.BillToName, first.BillToAddress, first.BillToEmail));
        Assert.Equal(("INV-0002", self.Id, "Bea Bee", ""), (second.DisplayNumber, second.ParticipantBookingId, second.BillToName, second.BillToAddress));
        Assert.Equal((100m, 10m, 110m), (first.Subtotal, first.Gst, first.Total));
        Assert.Equal((430.58m, 0m, 430.58m), (second.Subtotal, second.Gst, second.Total));
        Assert.DoesNotContain(rows, r => r.ParticipantBookingId == agency.Id);
        Assert.All(rows, r => Assert.Equal((TenantA, InvoiceKind.Invoice, InvoiceStatus.Issued, ActorId), (r.TenantId, r.Kind, r.Status, r.CreatedById!.Value)));
        Assert.Equal(TripClaimStatus.Submitted, (await kit.Db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id)).Status);
    }

    [Fact]
    public async Task ShiftClaim_PlanManagedGetsOne_AgencyManagedGetsNone()
    {
        var kit = Create();
        kit.Settings();
        var planned = kit.Person("Sam", "Lee", PlanType.PlanManaged, planManager: PlanManager());
        var claim = kit.ShiftClaim(planned, TripClaimStatus.Draft, 120m, 80m);
        var agencyPerson = kit.Person("Ann", "Agency", PlanType.AgencyManaged);
        var agencyClaim = kit.ShiftClaim(agencyPerson, TripClaimStatus.Draft, 90m);

        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, Submit, Ct)));
        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(agencyClaim.Id, Submit, Ct)));

        var row = Assert.Single(InvoicesOf(kit, claim.Id));
        Assert.Null(row.ParticipantBookingId);
        Assert.Equal(planned.Id, row.ParticipantId);
        Assert.StartsWith("Period:", row.ServiceReference);
        Assert.Equal(2, row.Lines.Count);
        Assert.Equal(200m, row.Total);
        Assert.Empty(InvoicesOf(kit, agencyClaim.Id));
    }

    [Fact]
    public async Task Submit_IsRefused_WhenTheOrganisationHasNoSettings_AndNothingIsWritten()
    {
        var kit = Create();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Alex", "Able", PlanType.PlanManaged)));

        var result = await kit.Controller().UpdateClaim(claim.Id, Submit, Ct);

        Assert.Equal(409, StatusOf(result));
        Assert.Equal("Set up your organisation's invoice details in Settings first.", RefusalOf(result));
        kit.Db.ChangeTracker.Clear();
        var stored = await kit.Db.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claim.Id);
        Assert.Equal((TripClaimStatus.Draft, (DateTime?)null), (stored.Status, stored.SubmittedDate));
        Assert.Equal(0, await kit.Db.Invoices.CountAsync());
        Assert.Equal(0, await kit.Db.InvoiceNumberCounters.CountAsync());
    }

    [Fact]
    public async Task AnAgencyOnlyClaim_StillSubmits_WithoutSettings()
    {
        var kit = Create();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Ann", "Agency", PlanType.AgencyManaged)));

        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, Submit, Ct)));
        Assert.Equal(0, await kit.Db.Invoices.CountAsync());
    }

    [Fact]
    public async Task TheFirstIssuedNumber_IsTheStartNumber()
    {
        var kit = Create();
        kit.Settings(start: 1043);
        var trip = kit.Trip();
        var first = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Alex", "Able", PlanType.SelfManaged)));
        var second = kit.TripClaim(trip, TripClaimStatus.Ready, kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)));

        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(first.Id, Submit, Ct)));
        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(second.Id, Submit, Ct)));

        var a = Assert.Single(InvoicesOf(kit, first.Id));
        Assert.Equal((1043, "INV-1043"), (a.Number, a.DisplayNumber));
        Assert.Equal(1044, Assert.Single(InvoicesOf(kit, second.Id)).Number);
    }

    [Fact]
    public async Task TheSnapshotHolds_AfterSettingsChange_AndARefusedLineEdit()
    {
        var kit = Create();
        var settings = kit.Settings(abn: "11111111111", bsb: "062-000", account: "12345678");
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)));
        await kit.Controller().UpdateClaim(claim.Id, Submit, Ct);
        var invoice = Assert.Single(InvoicesOf(kit, claim.Id));

        settings.ABN = "99999999999"; settings.BSB = "999-999"; settings.AccountNumber = "87654321";
        kit.Db.SaveChanges();
        var line = kit.Db.ClaimLineItems.First(l => l.TripClaimId == claim.Id);
        Assert.Equal(409, StatusOf(await kit.Controller().UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Hours = 9m }, Ct)));

        var file = Assert.IsType<FileContentResult>(await kit.Controller().DownloadIssuedInvoice(invoice.Id, Ct));
        var text = TextOf(file.FileContents);
        Assert.Contains("11111111111", text);
        Assert.Contains(Skeleton("BSB: 062-000"), text);
        Assert.Contains("12345678", text);
        Assert.Contains(Skeleton("INV-0001"), text);
        Assert.Contains(Skeleton("Total: $100.00"), text);
        Assert.DoesNotContain("99999999999", text);
        Assert.DoesNotContain("999999", text);
        Assert.Equal("INV-0001.pdf", file.FileDownloadName);
    }

    [Fact]
    public async Task AnIssuedPdf_SaysDueDateAndTerms()
    {
        var kit = Create();   // 13:30 UTC on 22 Oct is 23 Oct in NSW
        kit.Settings();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)));
        await kit.Controller().UpdateClaim(claim.Id, Submit, Ct);

        var invoice = Assert.Single(InvoicesOf(kit, claim.Id));
        Assert.Equal((new DateOnly(2026, 10, 23), (DateOnly?)new DateOnly(2026, 11, 6)), (invoice.IssueDate, invoice.DueDate));
        var text = TextOf(Assert.IsType<FileContentResult>(await kit.Controller().DownloadIssuedInvoice(invoice.Id, Ct)).FileContents);
        Assert.Contains(Skeleton("Due 06 Nov 2026"), text);
        Assert.Contains(Skeleton("Payment terms: 14 days"), text);
    }

    [Fact]
    public async Task Resubmitting_WhileItsInvoicesLive_IssuesNothingNew()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Alex", "Able", PlanType.SelfManaged)), kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)));
        await kit.Controller().UpdateClaim(claim.Id, Submit, Ct);
        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Rejected }, Ct);

        Assert.Equal(200, StatusOf(await kit.Controller().UpdateClaim(claim.Id, Submit, Ct)));

        Assert.Equal(2, InvoicesOf(kit, claim.Id).Count);
    }
}

/// <summary>Spec 5.8 #3: an invoice is the claim's organisation's: its seller block, its counter and the TenantId of every row, whoever submits it.</summary>
public class InvoiceTenantScopeTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (InvoiceKit Kit, TripClaim Claim) TwoOrganisations(Guid? scopeTenant, bool superAdmin)
    {
        var name = Guid.NewGuid().ToString();
        var seed = Create(noTenant: true, superAdmin: true, database: name);
        seed.Settings(TenantA, abn: "11111111111");
        seed.Settings(TenantB, abn: "22222222222");
        var trip = seed.Trip(TenantB);
        var claim = seed.TripClaim(trip, TripClaimStatus.Draft, seed.Book(trip, seed.Person("Bea", "Bee", PlanType.SelfManaged, TenantB)), seed.Book(trip, seed.Person("Ben", "Bee", PlanType.SelfManaged, TenantB)));
        return (Create(scopeTenant, superAdmin, database: name), claim);
    }

    [Fact]
    public async Task ViewAsTenantB_StampsBsSellerBlock_AndBsCounter()
    {
        var (kit, claim) = TwoOrganisations(TenantB, superAdmin: false);   // what view-as produces

        Assert.Equal(200, StatusOf(await kit.Controller("SuperAdmin").UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));

        Assert.All(kit.Db.Invoices.IgnoreQueryFilters().AsNoTracking().ToList(), i => Assert.Equal(("22222222222", TenantB), (i.SellerAbn, i.TenantId)));
        Assert.Single(kit.Db.InvoiceNumberCounters.IgnoreQueryFilters().AsNoTracking().Where(c => c.TenantId == TenantB && c.Kind == InvoiceKind.Invoice));
        Assert.Empty(kit.Db.InvoiceNumberCounters.IgnoreQueryFilters().AsNoTracking().Where(c => c.TenantId == TenantA));
    }

    [Fact]
    public async Task SuperAdminWithoutViewAs_StillStampsTheClaimsOrganisation()
    {
        var (kit, claim) = TwoOrganisations(TenantA, superAdmin: true);

        Assert.Equal(200, StatusOf(await kit.Controller("SuperAdmin").UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct)));

        var invoices = kit.Db.Invoices.IgnoreQueryFilters().AsNoTracking().ToList();
        var lines = kit.Db.InvoiceLines.IgnoreQueryFilters().AsNoTracking().ToList();
        Assert.Equal(2, invoices.Count);
        Assert.Equal(2, lines.Count);
        Assert.All(invoices, i => Assert.Equal(("22222222222", TenantB), (i.SellerAbn, i.TenantId)));
        Assert.All(lines, l => Assert.Equal(TenantB, l.TenantId));
        Assert.Single(kit.Db.InvoiceNumberCounters.IgnoreQueryFilters().AsNoTracking().Where(c => c.TenantId == TenantB));
        Assert.Empty(kit.Db.InvoiceNumberCounters.IgnoreQueryFilters().AsNoTracking().Where(c => c.TenantId != TenantB));
    }
}

/// <summary>The submit confirm's preview (lead G1, D16): what submitting would issue now, for one claim or a selection, without taking a number.</summary>
public class SubmitPreviewTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static SubmitPreviewRequestDto Ask(params Guid[] ids) => new() { ClaimIds = ids.ToList() };

    [Fact]
    public async Task ADraftTripClaim_PreviewsItsTwoInvoices_AndTakesNoNumber()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft,
            kit.Book(trip, kit.Person("Alex", "Able", PlanType.PlanManaged, planManager: PlanManager())), kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)), kit.Book(trip, kit.Person("Cal", "Cee", PlanType.AgencyManaged)));

        var preview = DataOf(await kit.Controller().SubmitPreview(Ask(claim.Id), Ct));

        var one = Assert.Single(preview.Claims);
        Assert.Equal(2, preview.InvoiceCount);
        Assert.Equal((0, false), (one.AlreadyIssued, one.MissingSettings));
        Assert.Equal(new[] { "INV-0001", "INV-0002" }, one.ToIssue.Select(p => p.PredictedNumber));
        Assert.Equal(new[] { "Pat Manager — Plan Co", "Bea Bee" }, one.ToIssue.Select(p => p.BillToName));
        Assert.Equal(0, await kit.Db.InvoiceNumberCounters.CountAsync());

        await kit.Controller().UpdateClaim(claim.Id, new UpdateClaimDto { Status = TripClaimStatus.Submitted }, Ct);
        Assert.Equal(one.ToIssue.Select(p => p.GroupId).Order(), kit.Db.Invoices.Select(i => i.ParticipantBookingId!.Value).ToList().Order());
    }

    [Fact]
    public async Task NoSettings_SaysMissingSettings_AndPredictsNoNumber()
    {
        var kit = Create();
        var trip = kit.Trip();
        var claim = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)));

        var one = Assert.Single(DataOf(await kit.Controller().SubmitPreview(Ask(claim.Id), Ct)).Claims);

        Assert.True(one.MissingSettings);
        Assert.Null(Assert.Single(one.ToIssue).PredictedNumber);
    }

    [Fact]
    public async Task AClaimThatIsNotAMoveToSubmitted_PreviewsNothing()
    {
        var kit = Create();
        kit.Settings();
        var trip = kit.Trip();
        var legacy = kit.TripClaim(trip, TripClaimStatus.Submitted, kit.Book(trip, kit.Person("Old", "One", PlanType.SelfManaged)));
        var paid = kit.TripClaim(trip, TripClaimStatus.Paid, kit.Book(trip, kit.Person("Paid", "One", PlanType.SelfManaged)));
        var draft = kit.TripClaim(trip, TripClaimStatus.Draft, kit.Book(trip, kit.Person("Alex", "Able", PlanType.SelfManaged)), kit.Book(trip, kit.Person("Bea", "Bee", PlanType.SelfManaged)));

        var preview = DataOf(await kit.Controller().SubmitPreview(Ask(legacy.Id, paid.Id), Ct));
        Assert.All(preview.Claims, c => Assert.Empty(c.ToIssue));
        Assert.Equal(0, preview.InvoiceCount);

        Assert.Equal(2, DataOf(await kit.Controller().SubmitPreview(Ask(draft.Id, legacy.Id), Ct)).InvoiceCount);
    }

    [Fact]
    public async Task AnotherOrganisationsClaim_Is404()
    {
        var name = Guid.NewGuid().ToString();
        var seed = Create(TenantB, database: name);
        var trip = seed.Trip(TenantB);
        var theirs = seed.TripClaim(trip, TripClaimStatus.Draft, seed.Book(trip, seed.Person("Bea", "Bee", PlanType.SelfManaged, TenantB)));
        var kit = Create(TenantA, database: name);

        Assert.Equal(404, StatusOf(await kit.Controller().SubmitPreview(Ask(theirs.Id), Ct)));
    }
}
