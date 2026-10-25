using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Claims.InvoiceKit;

namespace Odip.Tests.Claims;

/// <summary>GET invoices (the register): every invoice and credit note of the organisation in scope, deleted claims' included, filtered and paged in the query.</summary>
public class InvoiceRegisterTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static int _next;

    private static Invoice Row(Guid tenant, string org = "Org", InvoiceKind kind = InvoiceKind.Invoice, int? number = null, string date = "2026-10-20", InvoiceStatus status = InvoiceStatus.Issued,
        Guid? claimId = null, string participant = "Alex Able", string billTo = "Plan Co", string reference = "TC-1", decimal total = 100m, string? credits = null)
    {
        var n = number ?? Interlocked.Increment(ref _next);
        return new Invoice
        {
            Id = Guid.NewGuid(), TenantId = tenant, Kind = kind, Number = n, DisplayNumber = (kind == InvoiceKind.Invoice ? "INV-" : "CN-") + n.ToString("D4"), Status = status,
            TripClaimId = claimId, ClaimReference = reference, ParticipantName = participant, BillToName = billTo, SellerOrganisationName = org, IssueDate = DateOnly.Parse(date),
            DueDate = DateOnly.Parse(date).AddDays(14), PayerKind = PlanType.PlanManaged, Total = total, CreditsDisplayNumber = credits,
            BankAccountName = "Secret Pty Ltd", Bsb = "062-000", AccountNumber = "12345678", VoidReason = "Wrong rate",
        };
    }

    private static InvoiceKit Seed(params Invoice[] rows)
    {
        var db = Guid.NewGuid().ToString();
        var kit = Create(database: db);
        kit.Db.Invoices.AddRange(rows);
        kit.Db.SaveChanges();
        return Create(database: db);
    }

    private static Task<ActionResult<ApiResponse<PagedResult<InvoiceRegisterRowDto>>>> List(InvoiceKit kit, string role = "Admin", InvoiceKind? kind = null, InvoiceStatus? status = null,
        DateOnly? from = null, DateOnly? to = null, string? search = null, bool deletedClaimOnly = false, int page = 1, int pageSize = 50) =>
        kit.Controller(role).GetInvoiceRegister(kind, status, from, to, search, deletedClaimOnly, page, pageSize, Ct);

    private static List<string> Numbers(ActionResult<ApiResponse<PagedResult<InvoiceRegisterRowDto>>> r) => DataOf(r).Items.Select(i => i.DisplayNumber).ToList();

    [Fact]
    public async Task AnOrganisation_NeverSeesAnotherOnesRows()
    {
        var kit = Seed(Row(TenantA, number: 1), Row(TenantB, number: 1, org: "Other Org"));
        var rows = DataOf(await List(kit)).Items;
        Assert.Equal(["INV-0001"], rows.Select(r => r.DisplayNumber));
        Assert.All(rows, r => Assert.Equal("Org", r.OrganisationName));
    }

    [Fact]
    public async Task ASuperAdminWithNoOrganisation_SeesEveryOrganisation_AndViewAsSeesOne()
    {
        var db = Guid.NewGuid().ToString();
        var seed = Create(database: db);
        seed.Db.Invoices.AddRange(Row(TenantA, org: "Alpha", number: 1, date: "2026-10-21"), Row(TenantB, org: "Beta", number: 1, date: "2026-10-20"));
        seed.Db.SaveChanges();

        var all = DataOf(await List(Create(database: db, superAdmin: true, noTenant: true), "SuperAdmin")).Items;
        Assert.Equal(["Alpha", "Beta"], all.Select(r => r.OrganisationName));

        var viewAs = DataOf(await List(Create(TenantB, database: db), "SuperAdmin")).Items;
        Assert.Equal(["Beta"], viewAs.Select(r => r.OrganisationName));
    }

    [Fact]
    public async Task ADeletedClaimsInvoice_AppearsWithNoClaim_AndTheFlagReturnsOnlySuchRows()
    {
        var kit = Seed(Row(TenantA, number: 1, claimId: Guid.NewGuid()), Row(TenantA, number: 2, status: InvoiceStatus.Voided, claimId: null));
        var all = DataOf(await List(kit)).Items;
        Assert.Equal(2, all.Count);
        var voided = all.Single(r => r.Status == InvoiceStatus.Voided);
        Assert.Equal(("INV-0002", (Guid?)null), (voided.DisplayNumber, voided.TripClaimId));
        Assert.Equal(["INV-0002"], Numbers(await List(kit, deletedClaimOnly: true)));
    }

    [Fact]
    public async Task ACreditNote_ShowsTheInvoiceItCredits_AndItsTotalSignedAsThePdfPrintsIt()
    {
        var original = Row(TenantA, number: 1, status: InvoiceStatus.Credited, total: 430.58m);
        var note = Row(TenantA, kind: InvoiceKind.CreditNote, number: 1, total: 430.58m, credits: "INV-0001");
        note.CreditsInvoiceId = original.Id;
        var kit = Seed(original, note);
        var rows = DataOf(await List(kit)).Items;
        var cn = rows.Single(r => r.Kind == InvoiceKind.CreditNote);
        var inv = rows.Single(r => r.Kind == InvoiceKind.Invoice);
        Assert.Equal(("INV-0001", -430.58m), (cn.CreditsDisplayNumber, cn.Total));
        Assert.Equal(("CN-0001", 430.58m), (inv.CreditedByDisplayNumber, inv.Total));
    }

    [Fact]
    public async Task Filters_KindStatusAndInclusiveDates()
    {
        var kit = Seed(
            Row(TenantA, number: 1, date: "2026-10-01"), Row(TenantA, number: 2, date: "2026-10-10", status: InvoiceStatus.Voided),
            Row(TenantA, number: 3, date: "2026-10-20"), Row(TenantA, kind: InvoiceKind.CreditNote, number: 1, date: "2026-10-20"));
        Assert.Equal(["CN-0001"], Numbers(await List(kit, kind: InvoiceKind.CreditNote)));
        Assert.Equal(["INV-0002"], Numbers(await List(kit, status: InvoiceStatus.Voided)));
        Assert.Equal(["INV-0002", "INV-0001"], Numbers(await List(kit, kind: InvoiceKind.Invoice, from: new DateOnly(2026, 10, 1), to: new DateOnly(2026, 10, 10))));
        Assert.Equal(["CN-0001", "INV-0003"], Numbers(await List(kit, from: new DateOnly(2026, 10, 20))).Order());
    }

    [Theory]
    [InlineData("inv-0007")]
    [InlineData("zelda")]
    [InlineData("MEGACORP")]
    [InlineData("tc-777")]
    public async Task Search_MatchesEachOfTheFourFields_IgnoringCase(string term)
    {
        var kit = Seed(Row(TenantA, number: 7, participant: "Zelda Zed", billTo: "Megacorp Pty", reference: "TC-777"), Row(TenantA, number: 8));
        Assert.Equal(["INV-0007"], Numbers(await List(kit, search: "  " + term + " ")));
    }

    [Fact]
    public async Task Paging_IsClamped_AndTheSortIsStableOnEqualDates()
    {
        var kit = Seed(Enumerable.Range(1, 5).Select(n => Row(TenantA, number: n, date: n <= 3 ? "2026-10-20" : "2026-10-19")).ToArray());
        var first = DataOf(await List(kit, pageSize: 2));
        var second = DataOf(await List(kit, page: 2, pageSize: 2));
        var third = DataOf(await List(kit, page: 3, pageSize: 2));
        Assert.Equal(5, first.TotalCount);
        Assert.Equal(["INV-0003", "INV-0002"], first.Items.Select(i => i.DisplayNumber));
        Assert.Equal(["INV-0001", "INV-0005"], second.Items.Select(i => i.DisplayNumber));
        Assert.Equal(["INV-0004"], third.Items.Select(i => i.DisplayNumber));
        var clamped = DataOf(await List(kit, page: 0, pageSize: 100_000));
        Assert.Equal((1, 200), (clamped.Page, clamped.PageSize));
    }

    [Fact]
    public void TheClassGate_IsSuperAdminAdminCoordinator_AndTheActionAddsNone()
    {
        var gate = typeof(ClaimsController).GetCustomAttribute<AuthorizeAttribute>()!;
        Assert.Equal(["Admin", "Coordinator", "SuperAdmin"], gate.Roles!.Split(',').Order());
        var action = typeof(ClaimsController).GetMethod(nameof(ClaimsController.GetInvoiceRegister))!;
        Assert.Null(action.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Null(action.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("invoices", action.GetCustomAttribute<HttpGetAttribute>()!.Template);
    }

    [Fact]
    public async Task ACoordinator_GetsOk()
    {
        Assert.Equal(200, StatusOf(await List(Seed(Row(TenantA)), "Coordinator")));
    }

    [Fact]
    public async Task TheJson_CarriesNoBankDetailsAndNoVoidReason()
    {
        var result = await List(Seed(Row(TenantA, status: InvoiceStatus.Voided)));
        var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result.Result).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"displayNumber\"", json);
        foreach (var banned in new[] { "bank", "bsb", "accountNumber", "voidReason", "Secret Pty", "062-000", "12345678", "Wrong rate" })
            Assert.DoesNotContain(banned, json, StringComparison.OrdinalIgnoreCase);
    }
}
