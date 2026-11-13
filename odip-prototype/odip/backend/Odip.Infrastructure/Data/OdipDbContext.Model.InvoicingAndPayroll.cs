using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureInvoicingAndPayroll(ModelBuilder modelBuilder)
    {
        // ── Invoices (Xero PR1) ────────────────────────────────────
        modelBuilder.Entity<Invoice>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.DisplayNumber).HasMaxLength(30).IsRequired();
            entity.Property(e => e.ClaimReference).HasMaxLength(50).IsRequired();
            // Bill-to and participant names are unbounded: their sources are not capped (a contact's address; "Name — Organisation"), and a too-long
            // copy inside the issuing save would make the claim unsubmittable for good.
            entity.Property(e => e.ParticipantName).HasColumnType("text").IsRequired();
            entity.Property(e => e.BillToName).HasColumnType("text").IsRequired();
            entity.Property(e => e.BillToAddress).HasColumnType("text").IsRequired();
            entity.Property(e => e.NdisNumber).HasMaxLength(20);
            entity.Property(e => e.ServiceReference).HasMaxLength(300).IsRequired();
            entity.Property(e => e.BillToEmail).HasMaxLength(200);
            entity.Property(e => e.SellerOrganisationName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.SellerAbn).HasMaxLength(20).IsRequired();
            entity.Property(e => e.SellerRegistrationNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.SellerAddress).HasMaxLength(500).IsRequired();
            entity.Property(e => e.SellerState).HasMaxLength(10).IsRequired();
            entity.Property(e => e.BankAccountName).HasMaxLength(200);
            entity.Property(e => e.Bsb).HasMaxLength(10);
            entity.Property(e => e.AccountNumber).HasMaxLength(20);
            entity.Property(e => e.FooterNotes).HasMaxLength(2000);
            entity.Property(e => e.CreditsDisplayNumber).HasMaxLength(30);
            entity.Property(e => e.VoidReason).HasMaxLength(500);
            entity.Property(e => e.Subtotal).HasPrecision(18, 2);
            entity.Property(e => e.Gst).HasPrecision(18, 2);
            entity.Property(e => e.Total).HasPrecision(18, 2);
            // The backstop for the counter: a number is never given twice in one organisation.
            entity.HasIndex(e => new { e.TenantId, e.Kind, e.Number }).IsUnique();
            entity.HasIndex(e => e.TripClaimId);
            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.ParticipantBookingId);
            // The voided row and its number outlive the claim. ParticipantId/ParticipantBookingId have no FK on purpose: the snapshot must not
            // stop a booking being removed after its claim was voided and deleted.
            entity.HasOne<TripClaim>().WithMany().HasForeignKey(e => e.TripClaimId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne<Invoice>().WithMany().HasForeignKey(e => e.CreditsInvoiceId).OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(e => e.Lines).WithOne().HasForeignKey(l => l.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<InvoiceLine>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SupportItemCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(18, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(18, 2);
            entity.Property(e => e.LineTotal).HasPrecision(18, 2);
            entity.HasIndex(e => e.ClaimLineItemId);
            entity.HasOne<ClaimLineItem>().WithMany().HasForeignKey(e => e.ClaimLineItemId).OnDelete(DeleteBehavior.SetNull);
        });
        modelBuilder.Entity<ClaimBatch>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(20).IsRequired();
            entity.Property(e => e.CreatedByName).HasMaxLength(200);
            entity.Property(e => e.UploadedByName).HasMaxLength(200);
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.HasIndex(e => new { e.TenantId, e.FileName }).IsUnique().HasDatabaseName("UX_ClaimBatches_TenantId_FileName");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.CreatedAt });
            entity.HasMany(e => e.Lines).WithOne(l => l.Batch).HasForeignKey(l => l.BatchId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<ClaimBatchLine>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RowReference).HasMaxLength(50).IsRequired();
            entity.Property(e => e.RejectCode).HasMaxLength(20);
            entity.Property(e => e.RejectMessage).HasMaxLength(1000);
            entity.Property(e => e.NdisNumber).HasMaxLength(20);
            entity.Property(e => e.SupportNumber).HasMaxLength(60);
            entity.Property(e => e.Amount).HasPrecision(18, 2);
            entity.Property(e => e.ResultAmount).HasPrecision(18, 2);
            entity.HasIndex(e => new { e.BatchId, e.RowReference }).IsUnique();
            // One Pending batch per claim line, even if a path skips the claim-batch lock (Pending = 0).
            entity.HasIndex(e => e.ClaimLineItemId).IsUnique().HasFilter("\"Outcome\" = 0").HasDatabaseName("UX_ClaimBatchLines_OnePendingPerLine");
            entity.HasOne(e => e.ClaimLineItem).WithMany().HasForeignKey(e => e.ClaimLineItemId).OnDelete(DeleteBehavior.SetNull);
        });
        modelBuilder.Entity<InvoiceNumberCounter>(entity =>
        {
            entity.HasKey(e => new { e.TenantId, e.Kind });
        });

        // ── Employment Hero Payroll ────────────────────────────────
        modelBuilder.Entity<EmploymentHeroConnection>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.BusinessId).HasMaxLength(20).IsRequired();
            entity.Property(e => e.BusinessName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.ConnectedByName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.LastSyncError).HasMaxLength(300);
            entity.Property(e => e.WorkTypeStandard).HasMaxLength(20);
            entity.Property(e => e.WorkTypeActiveNight).HasMaxLength(20);
            entity.Property(e => e.WorkTypePassiveNight).HasMaxLength(20);
            entity.Property(e => e.WorkTypeSleepover).HasMaxLength(20);
            entity.Property(e => e.LeaveCategoryAnnual).HasMaxLength(20);
            entity.Property(e => e.LeaveCategorySick).HasMaxLength(20);
            entity.Property(e => e.LeaveCategoryPersonal).HasMaxLength(20);
            entity.Property(e => e.LeaveCategoryOther).HasMaxLength(20);
            // One connection per organisation.
            entity.HasIndex(e => e.TenantId).IsUnique();
        });
        modelBuilder.Entity<EmploymentHeroAttention>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.ExternalEmployeeId).HasMaxLength(50);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
        });
        modelBuilder.Entity<EmploymentHeroSyncLog>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.BusinessId).HasMaxLength(20).IsRequired();
            entity.Property(e => e.ErrorClass).HasMaxLength(50);
            entity.HasIndex(e => new { e.TenantId, e.StartedAt });
        });
        modelBuilder.Entity<EmploymentHeroOutbox>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.LastError).HasMaxLength(300);
            entity.Property(e => e.PayloadHash).HasMaxLength(64);
            entity.Property(e => e.ExternalId).HasMaxLength(50);
            entity.Property(e => e.ExternalEmployeeId).HasMaxLength(20);
            entity.Property(e => e.UpdatedAt).IsConcurrencyToken();
            entity.HasIndex(e => new { e.TenantId, e.Kind, e.EntityId }).IsUnique().HasDatabaseName(Domain.Integrations.EmploymentHeroOutbox.OneRowIndexName);
            entity.HasIndex(e => new { e.Status, e.NextAttemptAt });
            entity.HasIndex(e => e.TenantId);
        });
    }
}
