using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureInquiriesAndAgreements(ModelBuilder modelBuilder)
    {
        // ── Participant lifecycle foundation ───────────────────────
        modelBuilder.Entity<ParticipantInquiry>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100);
            entity.Property(e => e.Phone).HasMaxLength(50);
            entity.Property(e => e.Email).HasMaxLength(200);
            // The main contact and the participant details: the Person and Participant lengths, so Start intake never truncates.
            entity.Property(e => e.ContactFirstName).HasMaxLength(100);
            entity.Property(e => e.ContactLastName).HasMaxLength(100);
            entity.Property(e => e.ContactRelationship).HasMaxLength(100);
            entity.Property(e => e.NdisNumber).HasMaxLength(20);
            entity.Property(e => e.AddressStreet).HasMaxLength(200);
            entity.Property(e => e.AddressSuburb).HasMaxLength(100);
            entity.Property(e => e.AddressState).HasMaxLength(10);
            entity.Property(e => e.AddressPostcode).HasMaxLength(4);
            entity.Property(e => e.Source).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Provenance).HasMaxLength(2000);
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId });
            entity.Property(e => e.IntakeLocation).HasMaxLength(300);
            entity.Property(e => e.IntakeNotes).HasMaxLength(1000);
            entity.Property(e => e.IntakeInviteError).HasMaxLength(20);
            entity.Property(e => e.IntakeUid).HasMaxLength(100);
            // Concurrency tokens: every revision of a booking changes one of them, so a cancel and a reschedule (or a slow send's outcome) racing
            // each other cannot interleave into a booked row with no UID; the loser gets a 409 or drops its write.
            entity.Property(e => e.IntakeIcsSequence).IsConcurrencyToken();
            entity.Property(e => e.IntakeUid).IsConcurrencyToken();
            // The enquiry's version (deep review S1/S2): every write bumps it, so an edit from a form loaded before another save, or a contacts save racing
            // Start intake, matches no row and gets a 409. The entity keeps it in whole microseconds, as PostgreSQL stores it.
            entity.Property(e => e.UpdatedAt).IsConcurrencyToken();
            // Closed: Close and Reopen bump UpdatedAt too, so a write that loaded the enquiry before a close gets the same 409.
            entity.Property(e => e.CloseNote).HasMaxLength(500);
            // SetNull: whoever closed an enquiry never blocks deleting their user; the audit trail keeps who it was.
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.ClosedByUserId).OnDelete(DeleteBehavior.SetNull);
            // Restrict: a staff member booked for a visit is never deleted out from under it (ImportUntouched.StaffBlockersAsync lists it).
            entity.HasOne(e => e.IntakeStaffUser).WithMany().HasForeignKey(e => e.IntakeStaffUserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.IntakeBookedByUser).WithMany().HasForeignKey(e => e.IntakeBookedByUserId).OnDelete(DeleteBehavior.Restrict);
            // Restrict: a source is only ever hidden, never deleted, so no enquiry loses its label.
            entity.HasOne(e => e.ReferralSource).WithMany().HasForeignKey(e => e.ReferralSourceId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ReferralSourceId);
            // The schedule views read visits by organisation and start.
            entity.HasIndex(e => new { e.TenantId, e.IntakeStartsAt });
        });
        // Pending contacts on an enquiry (spec 2026-10-16, D3). The lengths are Person's and ParticipantContactRole's, so the move at Start intake never truncates.
        modelBuilder.Entity<InquiryContact>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.Relationship).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            // Cascade: pending contacts live and die with their enquiry (owner decision 5).
            entity.HasOne<ParticipantInquiry>().WithMany().HasForeignKey(e => e.InquiryId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.TenantId, e.InquiryId });
        });
        modelBuilder.Entity<ParticipantOnboarding>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProfileCompletedBy).HasMaxLength(200);
            entity.Property(e => e.ServiceTypeConfirmedBy).HasMaxLength(200);
            entity.Property(e => e.ServiceAgreementSignedBy).HasMaxLength(200);
            entity.Property(e => e.NoAgreementReason).HasMaxLength(500);
            entity.Property(e => e.AgreementRecordedBy).HasMaxLength(200);
            entity.Property(e => e.ExplainedRecordedBy).HasMaxLength(200);
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ParticipantId).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId }).IsUnique();
        });
        modelBuilder.Entity<ParticipantIntakeSnapshot>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CompletedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(e => e.CompletedBy).HasMaxLength(200).IsRequired();
            entity.Property(e => e.RequestId).HasMaxLength(100).IsRequired();
            entity.Property(e => e.ContentHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.SnapshotJson).IsRequired();
            entity.Property(e => e.PdfContent).IsRequired();
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.Revision }).IsUnique();
            entity.HasIndex(e => new { e.ParticipantId, e.RequestId }).IsUnique();
        });
        modelBuilder.Entity<ServiceAgreementDraft>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.State).HasMaxLength(3).IsRequired();
            entity.Property(e => e.ServiceTypesJson).HasMaxLength(4000).IsRequired();
            entity.Property(e => e.Representative).HasMaxLength(500);
            entity.Property(e => e.AgreementName).HasMaxLength(80);
            entity.Property(e => e.ParticipantNameSnapshot).HasMaxLength(300).IsRequired();
            entity.Property(e => e.NdisNumberSnapshot).HasMaxLength(100);
            entity.Property(e => e.CreatedBy).HasMaxLength(200).IsRequired();
            entity.Property(e => e.PricingJson).HasColumnType("jsonb");
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.AgreementId, e.Version }).IsUnique().HasDatabaseName(ServiceAgreementDraft.VersionIndexName);
        });
        modelBuilder.Entity<ServiceAgreementDraftBlock>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.BlockKey).HasMaxLength(64).IsRequired();
            entity.Property(e => e.BlockJson).HasColumnType("jsonb").IsRequired();
            entity.Property(e => e.RequirementsJson).HasColumnType("jsonb").IsRequired();
            entity.HasOne(e => e.Draft).WithMany(e => e.Blocks).HasForeignKey(e => e.DraftId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.DraftId, e.Position }).IsUnique();
            entity.HasIndex(e => new { e.DraftId, e.BlockKey }).IsUnique();
        });
        // One row for each approved revision (plan builder, phase D): the unique DraftId is what makes approving twice, or two approvals racing, one approval.
        modelBuilder.Entity<ServiceAgreementDraftApproval>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ApprovedByName).HasMaxLength(300).IsRequired();
            entity.Property(e => e.AgreedByName).HasMaxLength(200);
            entity.Property(e => e.ApprovedByRoles).HasMaxLength(200);
            entity.Property(e => e.ApproverRolesInForce).HasMaxLength(200);
            entity.HasOne(e => e.Draft).WithMany().HasForeignKey(e => e.DraftId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.DraftId).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId });
        });
        // An emailed read-only link to a revision (agreement PR 3). The token hash is unique; deleting the revision takes its links with it.
        modelBuilder.Entity<ServiceAgreementShare>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TokenHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.RecipientName).HasMaxLength(300).IsRequired();
            entity.Property(e => e.RecipientEmail).HasMaxLength(254).IsRequired();
            entity.Property(e => e.SentByName).HasMaxLength(300).IsRequired();
            entity.Property(e => e.SendError).HasMaxLength(30);
            entity.HasOne(e => e.Draft).WithMany().HasForeignKey(e => e.DraftId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.TokenHash).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.DraftId, e.SentAt });
        });
        modelBuilder.Entity<ServiceAgreementDraftLine>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ServiceType).HasMaxLength(200).IsRequired();
            entity.Property(e => e.ItemCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.CatalogueVersion).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(12, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(12, 2);
            entity.Property(e => e.BlockKey).HasMaxLength(64);
            entity.Property(e => e.Band).HasMaxLength(100);
            entity.Property(e => e.Unit).HasMaxLength(1).IsRequired().HasDefaultValue("H");
            entity.Property(e => e.Total).HasPrecision(14, 2);
            entity.Property(e => e.Occurrences).HasDefaultValue(0);
            entity.Property(e => e.Flags).HasDefaultValue(0);
            entity.Property(e => e.Position).HasDefaultValue(0);
            entity.HasOne(e => e.Draft).WithMany(e => e.Lines).HasForeignKey(e => e.DraftId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.DraftId);
        });
        modelBuilder.Entity<ElectronicSigningSnapshot>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.DocumentJson).IsRequired();
            entity.Property(e => e.DocumentHash).HasMaxLength(64).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.DraftId, e.DraftVersion }).IsUnique();
        });
        modelBuilder.Entity<ElectronicSigningEvidence>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.IdempotencyKey).HasMaxLength(200).IsRequired();
            entity.Property(e => e.SignerName).HasMaxLength(300).IsRequired();
            entity.Property(e => e.SignerCapacity).HasMaxLength(200).IsRequired();
            entity.Property(e => e.EvidenceHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.PreviousEvidenceHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(50).IsRequired();
            entity.HasOne(e => e.Snapshot).WithMany(e => e.Evidence).HasForeignKey(e => e.SnapshotId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.SnapshotId, e.IdempotencyKey }).IsUnique();
        });
    }
}
