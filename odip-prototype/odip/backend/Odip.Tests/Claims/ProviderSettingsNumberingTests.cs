using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// Settings › Billing details: the invoice prefixes, the first invoice number and the payment terms (Xero PR1). Each is applied only when sent and
/// different, and audited as one field change (the row holds bank details); the first number locks once an invoice exists, but an unchanged echo
/// (what every section's save sends) is never refused; the computed fields are the settings row's own organisation's.
/// </summary>
public class ProviderSettingsNumberingTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly Guid AdminId = Guid.NewGuid();
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (OdipDbContext Db, ProviderSettingsController Controller) Create(Guid? tenantId, bool superAdmin, string? database = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(database ?? Guid.NewGuid().ToString()).Options, tenant.Object);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim(ClaimTypes.Role, "Admin")], "Test"));
        return (db, new ProviderSettingsController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static ProviderSettings SeedSettings(OdipDbContext db, Guid tenantId)
    {
        var s = new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "NSW" };
        db.ProviderSettings.Add(s);
        db.SaveChanges();
        return s;
    }

    private static void SeedInvoice(OdipDbContext db, Guid tenantId)
    {
        db.Invoices.Add(new Invoice { Id = Guid.NewGuid(), TenantId = tenantId, Kind = InvoiceKind.Invoice, Number = 1, DisplayNumber = "INV-0001", ClaimReference = "TC-1", ParticipantId = Guid.NewGuid() });
        db.SaveChanges();
    }

    private static UpsertProviderSettingsDto Dto(string? prefix = null, string? cnPrefix = null, int? start = null, int? terms = null, string organisation = "Org") => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = organisation, Address = "1 St", State = "NSW",
        InvoiceNumberPrefix = prefix, CreditNotePrefix = cnPrefix, InvoiceStartNumber = start, PaymentTermsDays = terms,
    };

    private static int StatusOf(ActionResult<ApiResponse<bool>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode ?? 200;
    private static string RefusalOf(ActionResult<ApiResponse<bool>> r) => Assert.Single(Assert.IsType<ApiResponse<bool>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value).Errors!);

    private static async Task<ProviderSettingsDto> GetDto(ProviderSettingsController c) =>
        Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>((await c.Get(Ct)).Result).Value).Data!;

    [Fact]
    public async Task Get_ReturnsTheNumberingFields_AndNextInvoice()
    {
        var (db, c) = Create(TenantA, false);
        SeedSettings(db, TenantA);

        var dto = await GetDto(c);

        Assert.Equal(("INV-", "CN-", 1, 14), (dto.InvoiceNumberPrefix, dto.CreditNotePrefix, dto.InvoiceStartNumber, dto.PaymentTermsDays));
        Assert.Equal("INV-0001", dto.NextInvoiceDisplayNumber);
        Assert.False(dto.InvoicesIssued);
    }

    [Fact]
    public async Task Upsert_ChangesEachNumberingField_OnlyWhenSent_AndAuditsEachOnce()
    {
        var (db, c) = Create(TenantA, false);
        SeedSettings(db, TenantA);

        Assert.Equal(200, StatusOf(await c.Upsert(Dto(prefix: "OASSISTINV", terms: 30), Ct)));

        var stored = await db.ProviderSettings.AsNoTracking().SingleAsync();
        Assert.Equal(("OASSISTINV", "CN-", 1, 30), (stored.InvoiceNumberPrefix, stored.CreditNotePrefix, stored.InvoiceStartNumber, stored.PaymentTermsDays));
        var rows = await db.AuditLogs.AsNoTracking().ToListAsync();
        Assert.Equal(2, rows.Count);
        var fields = rows.Select(r => JsonSerializer.Deserialize<JsonElement>(r.Changes).EnumerateArray().Single()).ToList();
        Assert.Contains(fields, f => f.GetProperty("Field").GetString() == "InvoiceNumberPrefix" && f.GetProperty("Old").GetString() == "INV-" && f.GetProperty("New").GetString() == "OASSISTINV");
        Assert.Contains(fields, f => f.GetProperty("Field").GetString() == "PaymentTermsDays" && f.GetProperty("Old").GetString() == "14" && f.GetProperty("New").GetString() == "30");
        Assert.DoesNotContain(rows, r => r.Changes.Contains("BSB") || r.Changes.Contains("AccountNumber"));

        Assert.Equal(200, StatusOf(await c.Upsert(Dto(organisation: "Org 2"), Ct)));   // a body without the fields leaves them unchanged
        stored = await db.ProviderSettings.AsNoTracking().SingleAsync();
        Assert.Equal(("OASSISTINV", 30), (stored.InvoiceNumberPrefix, stored.PaymentTermsDays));
        Assert.Equal(2, await db.AuditLogs.CountAsync());
    }

    public static TheoryData<UpsertProviderSettingsDto, string> BadValues() => new()
    {
        { Dto(prefix: ""), "Enter a prefix, such as INV-." },
        { Dto(prefix: "IN V"), "No spaces." },
        { Dto(prefix: "INV/"), "Use letters, digits, - _ or . only." },
        { Dto(prefix: "ABCDEFGHIJK"), "10 characters at most." },
        { Dto(cnPrefix: ""), "Enter a prefix, such as CN-." },
        { Dto(start: 0), "Enter a whole number from 1 to 99,999,999." },
        { Dto(start: 100_000_000), "Enter a whole number from 1 to 99,999,999." },
        { Dto(terms: -1), "Enter a whole number of days from 0 to 365." },
        { Dto(terms: 366), "Enter a whole number of days from 0 to 365." },
    };

    [Theory]
    [MemberData(nameof(BadValues))]
    public async Task Upsert_RefusesBadValues_AndWritesNothing(UpsertProviderSettingsDto dto, string words)
    {
        var (db, c) = Create(TenantA, false);
        SeedSettings(db, TenantA);

        var result = await c.Upsert(dto with { OrganisationName = "Changed" }, Ct);

        Assert.Equal(400, StatusOf(result));
        Assert.Equal(words, RefusalOf(result));
        var stored = await db.ProviderSettings.AsNoTracking().SingleAsync();
        Assert.Equal(("Org", "INV-", "CN-", 1, 14), (stored.OrganisationName, stored.InvoiceNumberPrefix, stored.CreditNotePrefix, stored.InvoiceStartNumber, stored.PaymentTermsDays));
    }

    [Fact]
    public async Task StartNumber_IsSettableBeforeTheFirstInvoice_And409After()
    {
        var (db, c) = Create(TenantA, false);
        SeedSettings(db, TenantA);

        Assert.Equal(200, StatusOf(await c.Upsert(Dto(start: 1043), Ct)));
        SeedInvoice(db, TenantA);

        var refused = await c.Upsert(Dto(start: 2000), Ct);
        Assert.Equal(409, StatusOf(refused));
        Assert.Equal("Invoice numbers have started, so the starting number can't change.", RefusalOf(refused));
        Assert.Equal(1043, (await db.ProviderSettings.AsNoTracking().SingleAsync()).InvoiceStartNumber);

        // The echo trap: every section's save sends the whole row, the unchanged start number included.
        Assert.Equal(200, StatusOf(await c.Upsert(Dto(start: 1043, terms: 7, organisation: "Org 2"), Ct)));
        Assert.True((await GetDto(c)).InvoicesIssued);
    }

    [Fact]
    public async Task ComputedFields_AreTheRowsOwnTenant()
    {
        var name = Guid.NewGuid().ToString();
        var (db, c) = Create(TenantB, true, name);
        SeedInvoice(db, TenantA);   // A has issued invoices and no settings row
        SeedSettings(db, TenantB);

        var dto = await GetDto(c);

        Assert.False(dto.InvoicesIssued);
        Assert.Equal("INV-0001", dto.NextInvoiceDisplayNumber);
    }

    [Fact]
    public async Task ViewingAsB_AStartNumberChange_IsNotRefusedByAsInvoices()
    {
        var name = Guid.NewGuid().ToString();
        var (seed, _) = Create(null, true, name);
        SeedSettings(seed, TenantA);
        SeedInvoice(seed, TenantA);
        SeedSettings(seed, TenantB);
        var (db, c) = Create(TenantB, false, name);

        Assert.Equal(200, StatusOf(await c.Upsert(Dto(start: 500), Ct)));
        Assert.Equal(500, (await db.ProviderSettings.IgnoreQueryFilters().AsNoTracking().SingleAsync(s => s.TenantId == TenantB)).InvoiceStartNumber);
        Assert.Equal(1, (await db.ProviderSettings.IgnoreQueryFilters().AsNoTracking().SingleAsync(s => s.TenantId == TenantA)).InvoiceStartNumber);
    }

    [Fact]
    public async Task NumberingNeedsATenantInScope()
    {
        var (db, c) = Create(null, true);
        SeedSettings(db, TenantA);

        var result = await c.Upsert(Dto(prefix: "ABC-"), Ct);

        Assert.Equal(400, StatusOf(result));
        Assert.StartsWith("Choose an organisation to view as", RefusalOf(result));
        Assert.Equal("INV-", (await db.ProviderSettings.AsNoTracking().SingleAsync()).InvoiceNumberPrefix);
    }
}
