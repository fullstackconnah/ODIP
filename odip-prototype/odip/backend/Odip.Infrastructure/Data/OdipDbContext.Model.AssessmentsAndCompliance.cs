using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureAssessmentsAndCompliance(ModelBuilder modelBuilder)
    {
        // ── ParticipantAdlAssessment (INTAKE sub-wave C2) ───────────
        modelBuilder.Entity<ParticipantAdlAssessment>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            // Restrict: same idiom as ParticipantHealthCondition/ParticipantConsent -> Participant —
            // a participant with a recorded ADL grid must not be silently cascade-deleted out from
            // under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.AdlAssessments)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            // One row per (participant, ADL type) — enforced at the DB level, same reasoning as
            // ParticipantHealthCondition's unique index above.
            entity.HasIndex(e => new { e.ParticipantId, e.AdlType }).IsUnique();
        });

        // ── ParticipantChecklistItem (INTAKE-03/04) ─────────────────
        modelBuilder.Entity<ParticipantChecklistItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            // Restrict: same idiom as ParticipantAdlAssessment/ParticipantHealthCondition/
            // ParticipantConsent -> Participant — a participant with a recorded checklist grid
            // must not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.ChecklistItems)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            // One row per (participant, checklist item type) — enforced at the DB level, same
            // reasoning as ParticipantAdlAssessment's unique index above.
            entity.HasIndex(e => new { e.ParticipantId, e.ItemType }).IsUnique();
        });

        // ── ParticipantCommunityAccessRiskItem (PF-10.2) ─────────────
        modelBuilder.Entity<ParticipantCommunityAccessRiskItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.StrategyNotes).HasMaxLength(2000);

            // Restrict: same idiom as ParticipantChecklistItem/ParticipantAdlAssessment/
            // ParticipantHealthCondition -> Participant — a participant with a recorded risk
            // matrix must not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.CommunityAccessRiskItems)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            // One row per (participant, risk item type) — enforced at the DB level, same
            // reasoning as ParticipantChecklistItem's unique index above.
            entity.HasIndex(e => new { e.ParticipantId, e.ItemType }).IsUnique();
        });

        // ── RestrictivePracticeMonthlyReport ──────────────────────
        modelBuilder.Entity<RestrictivePracticeMonthlyReport>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Note).HasMaxLength(2000);
            entity.Property(e => e.LodgedByName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.PracticeDescription).HasMaxLength(2000).IsRequired();

            // Restrict: a practice with lodged reports is kept as their record (the controller refuses the delete first).
            entity.HasOne(e => e.RestrictivePractice)
                .WithMany()
                .HasForeignKey(e => e.RestrictivePracticeId)
                .OnDelete(DeleteBehavior.Restrict);

            // One report per practice and month; the lodge race lands here.
            entity.HasIndex(e => new { e.RestrictivePracticeId, e.Month }).IsUnique();
        });

        // ── RestrictivePractice ───────────────────────────────────
        modelBuilder.Entity<RestrictivePractice>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Description).HasMaxLength(2000).IsRequired();
            entity.Property(e => e.AuthorisedBy).HasMaxLength(200);
            entity.Property(e => e.CommissionReference).HasMaxLength(50);
            // The version a save must still match: the PUT answers 409 if the entry changed since the form loaded it.
            entity.Property(e => e.UpdatedAt).IsConcurrencyToken();

            // Restrict: same idiom as ParticipantNote/ParticipantRoutine/ParticipantMedication →
            // Participant — a participant with register history must not be silently
            // cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.RestrictivePractices)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            // SetNull: losing the linked medication (never happens in practice — medications are
            // never hard-deleted) should not take the register entry down with it.
            entity.HasOne(e => e.RelatedMedication)
                .WithMany()
                .HasForeignKey(e => e.RelatedMedicationId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.ParticipantId);
            // One register entry per medicine; unlinked (null) entries are unlimited.
            entity.HasIndex(e => e.RelatedMedicationId).IsUnique().HasFilter("\"RelatedMedicationId\" IS NOT NULL");
        });

        // ── Complaint ─────────────────────────────────────────────
        modelBuilder.Entity<Complaint>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Summary).HasMaxLength(4000).IsRequired();
            entity.Property(e => e.ComplainantName).HasMaxLength(200);
            entity.Property(e => e.ActionsTaken).HasMaxLength(4000);
            entity.Property(e => e.Outcome).HasMaxLength(4000);
            // Retried submits: unique per tenant over NON-NULL keys only, so every existing row (all NULL) is outside the index.
            entity.Property(e => e.IdempotencyKey).HasMaxLength(100);
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(Complaint.IdempotencyIndexName)
                .HasFilter("\"IdempotencyKey\" IS NOT NULL");
            // The version a save must still match: the PUT answers 409 if the complaint changed since the form loaded it.
            entity.Property(e => e.UpdatedAt).IsConcurrencyToken();

            // SetNull on all three links: a complaint outlives a deleted participant, incident or staff member (none is required).
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.IncidentReport).WithMany().HasForeignKey(e => e.IncidentReportId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.HandledBy).WithMany().HasForeignKey(e => e.HandledByUserId).OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => new { e.TenantId, e.IsActive, e.Status, e.ReceivedOn });
            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.IncidentReportId);
        });
    }
}
