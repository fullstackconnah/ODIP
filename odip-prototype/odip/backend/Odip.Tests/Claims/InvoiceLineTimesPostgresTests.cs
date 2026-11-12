using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>The two time columns on a real PostgreSQL: set, overnight (finish earlier than start) and null round-trip. Skipped, never failed, without POSTGRES_CONNECTION_STRING.</summary>
public class InvoiceLineTimesPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public InvoiceLineTimesPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task TheTimes_RoundTripThroughPostgres()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        await using var _ = db;
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);
        var invoiceId = Guid.NewGuid();
        InvoiceLine Line(TimeOnly? start, TimeOnly? end) => new() { Id = Guid.NewGuid(), TenantId = tenantId, SupportItemCode = "04_104_0125_6_1", ServiceFrom = new DateOnly(2026, 10, 2), ServiceTo = new DateOnly(2026, 10, 2), Hours = 1m, UnitPrice = 100m, LineTotal = 100m, ServiceStartTime = start, ServiceEndTime = end };
        var lines = new[] { Line(new TimeOnly(9, 0), new TimeOnly(15, 0)), Line(new TimeOnly(22, 0), new TimeOnly(7, 0)), Line(null, null) };
        db.Invoices.Add(new Invoice
        {
            Id = invoiceId, TenantId = tenantId, Kind = InvoiceKind.Invoice, Number = 1, DisplayNumber = "INV-T", Status = InvoiceStatus.Issued, ClaimReference = "TC-1", ParticipantId = Guid.NewGuid(),
            ParticipantName = "P Test", BillToName = "P Test", SellerOrganisationName = "Org", IssueDate = new DateOnly(2026, 10, 20), PayerKind = PlanType.SelfManaged, Total = 300m, Lines = lines,
        });
        await db.SaveChangesAsync();

        db.ChangeTracker.Clear();   // read back from the database, not the tracker
        var back = await db.InvoiceLines.IgnoreQueryFilters().AsNoTracking().Where(l => l.InvoiceId == invoiceId).ToDictionaryAsync(l => l.Id);
        foreach (var l in lines)
            Assert.Equal((l.ServiceStartTime, l.ServiceEndTime), (back[l.Id].ServiceStartTime, back[l.Id].ServiceEndTime));
    }
}
