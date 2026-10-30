using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>The invoice tables (Xero PR1): numbers unique per organisation and kind, rows that outlive their claim, names that never overflow, and no bank snapshot copied into the audit log.</summary>
public class InvoiceModelTests
{
    private static Microsoft.EntityFrameworkCore.Metadata.IModel Model()
    {
        var tenant = new Mock<ICurrentTenant>();
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return db.Model;
    }

    [Fact]
    public void TheModel_KeepsNumbersUniquePerTenantAndKind()
    {
        var model = Model();
        var invoice = model.FindEntityType(typeof(Invoice))!;
        var index = Assert.Single(invoice.GetIndexes(), i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { nameof(Invoice.TenantId), nameof(Invoice.Kind), nameof(Invoice.Number) }));
        Assert.True(index.IsUnique);

        Assert.Equal(DeleteBehavior.SetNull, Assert.Single(invoice.GetForeignKeys(), f => f.Properties.Single().Name == nameof(Invoice.TripClaimId)).DeleteBehavior);
        Assert.DoesNotContain(invoice.GetForeignKeys(), f => f.Properties.Any(p => p.Name is nameof(Invoice.ParticipantBookingId) or nameof(Invoice.ParticipantId)));
        var line = model.FindEntityType(typeof(InvoiceLine))!;
        Assert.Equal(DeleteBehavior.SetNull, Assert.Single(line.GetForeignKeys(), f => f.Properties.Single().Name == nameof(InvoiceLine.ClaimLineItemId)).DeleteBehavior);
    }

    [Fact]
    public void ProviderSettings_NewColumnsDefault()
    {
        var s = new ProviderSettings();
        Assert.Equal(("INV-", "CN-", 1, 14), (s.InvoiceNumberPrefix, s.CreditNotePrefix, s.InvoiceStartNumber, s.PaymentTermsDays));
    }

    [Fact]
    public void BillToAndParticipantName_AreUnbounded()
    {
        var invoice = Model().FindEntityType(typeof(Invoice))!;
        foreach (var name in new[] { nameof(Invoice.BillToName), nameof(Invoice.BillToAddress), nameof(Invoice.ParticipantName) })
            Assert.Null(invoice.FindProperty(name)!.GetMaxLength());
    }

    [Fact]
    public void ClaimBatch_types_are_not_in_AuditedEntities()
    {
        Assert.DoesNotContain(typeof(ClaimBatch), AuditedEntities.Types);
        Assert.DoesNotContain(typeof(ClaimBatchLine), AuditedEntities.Types);
    }

    [Fact]
    public void InvoiceTypes_AreNotAudited()
    {
        Assert.DoesNotContain(typeof(Invoice), AuditedEntities.Types);
        Assert.DoesNotContain(typeof(InvoiceLine), AuditedEntities.Types);
        Assert.DoesNotContain(typeof(InvoiceNumberCounter), AuditedEntities.Types);
    }
}
