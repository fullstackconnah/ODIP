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
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>The register's payment filter and column as SQL (InMemory cannot show that the expression translates). Skipped, never failed, without POSTGRES_CONNECTION_STRING.</summary>
public class InvoicePaymentStatusPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public InvoicePaymentStatusPostgresTests(PostgresFixture pg) => _pg = pg;

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    [SkippableFact]
    public async Task TheFilterAndTheColumn_TranslateToSql_AndAgree()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        await using var _ = db;
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        var person = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "P", LastName = "Test", IsActive = true, PlanType = PlanType.SelfManaged };
        var claim = new TripClaim { TenantId = tenantId, Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = person.Id, PeriodFrom = new DateOnly(2026, 10, 1), PeriodTo = new DateOnly(2026, 10, 14), Status = TripClaimStatus.Submitted, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 300m };
        db.AddRange(person, claim);
        var expected = new Dictionary<string, InvoicePaymentStatus?>();
        var n = 0;
        foreach (var (status, paid, invoiceStatus, label) in new[]
        {
            (ClaimLineItemStatus.Submitted, 0m, InvoiceStatus.Issued, "out"), (ClaimLineItemStatus.Approved, 5m, InvoiceStatus.Issued, "part"),
            (ClaimLineItemStatus.Paid, 10m, InvoiceStatus.Issued, "paid"), (ClaimLineItemStatus.Paid, 10m, InvoiceStatus.Voided, "void"),
        })
        {
            n++;
            var shift = new Shift { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = person.Id, ServiceDate = new DateOnly(2026, 10, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(10, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed };
            var line = new ClaimLineItem { TenantId = tenantId, Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = new DateOnly(2026, 10, 2), SupportsDeliveredTo = new DateOnly(2026, 10, 2), Hours = 1m, UnitPrice = 100m, TotalAmount = 100m, GSTCode = GSTCode.P2, Status = status, PaidAmount = paid };
            var inv = new Invoice
            {
                Id = Guid.NewGuid(), TenantId = tenantId, Kind = InvoiceKind.Invoice, Number = n, DisplayNumber = "INV-" + label, Status = invoiceStatus, TripClaimId = claim.Id, ClaimReference = claim.ClaimReference,
                ParticipantName = "P Test", BillToName = "P Test", SellerOrganisationName = "Org", IssueDate = new DateOnly(2026, 10, 20), PayerKind = PlanType.SelfManaged, Total = 100m,
                Lines = [new InvoiceLine { Id = Guid.NewGuid(), TenantId = tenantId, ClaimLineItemId = line.Id, SupportItemCode = "04_104_0125_6_1", ServiceFrom = new DateOnly(2026, 10, 2), ServiceTo = new DateOnly(2026, 10, 2), Hours = 1m, UnitPrice = 100m, LineTotal = 100m }],
            };
            db.AddRange(shift, line, inv);
            expected[inv.DisplayNumber] = invoiceStatus == InvoiceStatus.Issued ? (label == "out" ? InvoicePaymentStatus.Outstanding : label == "part" ? InvoicePaymentStatus.PartPaid : InvoicePaymentStatus.Paid) : null;
        }
        await db.SaveChangesAsync();

        var tenant = TenantOf(tenantId);
        await using var own = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, tenant);
        var controller = new ClaimsController(own, new ClaimGenerationService(own), new ShiftClaimGenerationService(own), new BprCsvService(own), new InvoiceService(own), new BudgetLedgerService(own, TimeProvider.System), tenant);
        async Task<PagedResult<InvoiceRegisterRowDto>> Get(InvoicePaymentStatus? filter) =>
            Assert.IsType<ApiResponse<PagedResult<InvoiceRegisterRowDto>>>(Assert.IsType<OkObjectResult>((await controller.GetInvoiceRegister(null, null, filter, null, null, null, false, 1, 50, CancellationToken.None)).Result).Value).Data!;

        var all = await Get(null);
        Assert.Equal(4, all.TotalCount);
        foreach (var row in all.Items) Assert.Equal(expected[row.DisplayNumber], row.PaymentStatus);
        foreach (var value in Enum.GetValues<InvoicePaymentStatus>())
        {
            var page = await Get(value);
            Assert.Equal(expected.Where(e => e.Value == value).Select(e => e.Key), page.Items.Select(i => i.DisplayNumber));
            Assert.Equal(1, page.TotalCount);
        }
    }
}
