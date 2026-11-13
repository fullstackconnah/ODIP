using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureIncidentsAndUsers(ModelBuilder modelBuilder)
    {
        // ── IncidentReport ───────────────────────────────────────
        modelBuilder.Entity<IncidentReport>(e =>
        {
            e.HasKey(i => i.Id);
            e.Property(i => i.Title).HasMaxLength(300).IsRequired();
            e.Property(i => i.UpdatedAt).IsConcurrencyToken(); // the version a form carries as ExpectedUpdatedAt; two saves that both loaded first cannot both win
            e.Property(i => i.ReportableClassReason).HasMaxLength(500);
            e.Property(i => i.PoliceOfficerName).HasMaxLength(100);
            e.Property(i => i.AmbulanceOfficerName).HasMaxLength(100);
            e.Property(i => i.FireOfficerName).HasMaxLength(100);
            e.Property(i => i.PoliceReference).HasMaxLength(50);
            e.Property(i => i.AmbulanceReference).HasMaxLength(50);
            e.Property(i => i.FireReference).HasMaxLength(50);
            // Retried submits: unique per tenant over NON-NULL keys only, so every existing row (all NULL) is outside the index.
            e.Property(i => i.IdempotencyKey).HasMaxLength(100);
            e.HasIndex(i => new { i.TenantId, i.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(IncidentReport.IdempotencyIndexName)
                .HasFilter("\"IdempotencyKey\" IS NOT NULL");

            e.HasOne(i => i.TripInstance).WithMany(t => t.IncidentReports).HasForeignKey(i => i.TripInstanceId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(i => i.InvolvedParticipant).WithMany().HasForeignKey(i => i.InvolvedParticipantId);
            e.HasOne(i => i.InvolvedUser).WithMany().HasForeignKey(i => i.InvolvedUserId);
            e.HasOne(i => i.ReportedByUser).WithMany().HasForeignKey(i => i.ReportedByUserId);
            e.HasOne(i => i.ReviewedByUser).WithMany().HasForeignKey(i => i.ReviewedByUserId);
            e.HasOne(i => i.ParticipantBooking).WithMany().HasForeignKey(i => i.ParticipantBookingId);

            // INC-05: SetNull, same idiom as RestrictivePractice → ParticipantMedication — a
            // hard-deleted register entry (the CRUD API does allow it) should not be blocked by, or
            // cascade into, an incident that once linked to it; the incident just loses the link.
            e.HasOne(i => i.RestrictivePractice).WithMany().HasForeignKey(i => i.RestrictivePracticeId).OnDelete(DeleteBehavior.SetNull);

            // Connection-map source links (Deliverable 1): same SetNull idiom as
            // RestrictivePractice above — no back-nav collection on the source entity (out of
            // scope; later deliverables add their own reverse-link queries).
            e.HasOne(i => i.MedicationAdministration).WithMany().HasForeignKey(i => i.MedicationAdministrationId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(i => i.Shift).WithMany().HasForeignKey(i => i.ShiftId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(i => i.ShiftNote).WithMany().HasForeignKey(i => i.ShiftNoteId).OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(i => i.Status);
            e.HasIndex(i => i.Severity);
            e.HasIndex(i => i.QscReportingStatus);
            e.HasIndex(i => i.IsActive);
            e.HasIndex(i => i.RestrictivePracticeId);
            e.HasIndex(i => i.MedicationAdministrationId);
            e.HasIndex(i => i.ShiftId);
            e.HasIndex(i => i.ShiftNoteId);
        });

        // ── IncidentInjury (IN-5) ────────────────────────────────
        modelBuilder.Entity<IncidentInjury>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Description).HasMaxLength(2000).IsRequired();

            // Cascade: unlike IncidentReport.TripInstanceId's Restrict (which protects a
            // still-meaningful trip from deletion), an injury row has no meaning once its parent
            // incident is gone.
            e.HasOne(x => x.IncidentReport)
                .WithMany(i => i.Injuries)
                .HasForeignKey(x => x.IncidentReportId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(x => x.IncidentReportId);
        });

        // ── IncidentWitness (IN-7) ───────────────────────────────
        modelBuilder.Entity<IncidentWitness>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.WitnessName).HasMaxLength(300).IsRequired();
            e.Property(x => x.StatementText).HasMaxLength(IncidentWitness.StatementMaxLength);

            // Cascade: same as IncidentInjury — a witness row has no meaning once its parent
            // incident is gone.
            e.HasOne(x => x.IncidentReport)
                .WithMany(i => i.Witnesses)
                .HasForeignKey(x => x.IncidentReportId)
                .OnDelete(DeleteBehavior.Cascade);

            // Restrict: mirrors MedicationAdministration.WitnessUserId's own FK behaviour — don't
            // cascade-delete a witness record if a user row is ever removed.
            e.HasOne(x => x.WitnessUser)
                .WithMany()
                .HasForeignKey(x => x.WitnessUserId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => x.IncidentReportId);
            e.HasIndex(x => x.WitnessUserId);
        });

        // ── CaregiverProfileSubmission (caregiver profile form) ──
        modelBuilder.Entity<CaregiverProfileSubmission>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
            e.Property(x => x.CaregiverName).HasMaxLength(300);
            e.Property(x => x.CaregiverRelationship).HasMaxLength(100);
            e.Property(x => x.Payload).HasColumnType("jsonb");
            e.Property(x => x.BasePayload).HasColumnType("jsonb");
            e.Property(x => x.RejectionNote).HasMaxLength(4000);

            e.HasOne(x => x.Participant)
                .WithMany()
                .HasForeignKey(x => x.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(x => x.Tenant)
                .WithMany()
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.TenantId);

            // One ACTIVE link per participant, enforced at the database. Status ints:
            // Draft = 0, Submitted = 1 (see CaregiverSubmissionStatus).
            e.HasIndex(x => x.ParticipantId)
                .IsUnique()
                .HasDatabaseName("IX_CaregiverProfileSubmissions_ParticipantId_Active")
                .HasFilter("\"Status\" IN (0, 1)");
        });

        // ── User ─────────────────────────────────────────────────
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Username).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Email).HasMaxLength(200).IsRequired();
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Mobile).HasMaxLength(20);
            entity.Property(e => e.Region).HasMaxLength(100);
            entity.Property(e => e.WorkerScreeningNumber).HasMaxLength(50);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.Username).IsUnique();
            entity.HasIndex(e => e.Email).IsUnique();
            entity.HasIndex(e => e.IsActive);
            entity.Property(e => e.ExternalPayrollId).HasMaxLength(50);
            // One ODIP user per payroll employee per organisation. Filtered: every unlinked (NULL) row is outside it, so the migration cannot fail on existing data.
            entity.HasIndex(e => new { e.TenantId, e.ExternalPayrollId })
                .IsUnique()
                .HasDatabaseName(User.ExternalPayrollIdIndexName)
                .HasFilter("\"ExternalPayrollId\" IS NOT NULL");
            // One ODIP user per Microsoft identity, across organisations. Filtered so every unlinked row is outside it.
            entity.HasIndex(e => new { e.MicrosoftTenantId, e.MicrosoftObjectId })
                .IsUnique()
                .HasDatabaseName(User.MicrosoftIdentityIndexName)
                .HasFilter("\"MicrosoftObjectId\" IS NOT NULL");
        });

        modelBuilder.Entity<MicrosoftTenantLink>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId).IsUnique().HasDatabaseName(MicrosoftTenantLink.OrganisationIndexName);
            entity.HasIndex(e => e.MicrosoftTenantId).IsUnique().HasDatabaseName(MicrosoftTenantLink.MicrosoftTenantIdIndexName);
            entity.HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        });
    }
}
