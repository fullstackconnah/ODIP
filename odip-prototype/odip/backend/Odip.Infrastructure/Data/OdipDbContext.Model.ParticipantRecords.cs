using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureParticipantRecords(ModelBuilder modelBuilder)
    {
        // ── ParticipantMedication ────────────────────────────────
        modelBuilder.Entity<ParticipantMedication>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Strength).HasMaxLength(100);
            entity.Property(e => e.DoseDescription).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Directions).HasMaxLength(1000);
            entity.Property(e => e.TimesOfDay).HasMaxLength(200);
            entity.Property(e => e.PrnIndication).HasMaxLength(500);
            entity.Property(e => e.Purpose).HasMaxLength(500);
            entity.Property(e => e.RestrictivePracticeAuthorisationRef).HasMaxLength(200);
            entity.Property(e => e.PrescriberName).HasMaxLength(200);
            entity.Property(e => e.PharmacyName).HasMaxLength(200);
            entity.Property(e => e.PharmacyPhone).HasMaxLength(30);
            entity.Property(e => e.ConsentGivenBy).HasMaxLength(200);
            entity.Property(e => e.StorageRequirements).HasMaxLength(500);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            // Restrict: a participant with prescribed medication history must not be
            // silently cascade-deleted out from under that record (same idiom as
            // Shift → Participant above).
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.Status);
        });

        // ── MedicationAdministration ─────────────────────────────
        modelBuilder.Entity<MedicationAdministration>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.DoseGiven).HasMaxLength(200);
            entity.Property(e => e.AdministeredAtTimeZone).HasMaxLength(100);
            entity.Property(e => e.RecordedByName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.WitnessName).HasMaxLength(200);
            entity.Property(e => e.Reason).HasMaxLength(1000);
            entity.Property(e => e.PrnReason).HasMaxLength(500);
            entity.Property(e => e.PrnOutcome).HasMaxLength(1000);
            entity.Property(e => e.Notes).HasMaxLength(1000);
            entity.Property(e => e.RecordedWithoutCompetency).HasDefaultValue(false);
            entity.Property(e => e.AmendmentNote).HasMaxLength(500);
            entity.Property(e => e.AmendedByName).HasMaxLength(200);

            // Restrict: the MAR is a compliance record — its parent medication/participant
            // must not silently cascade it away.
            entity.HasOne(e => e.ParticipantMedication)
                .WithMany(m => m.Administrations)
                .HasForeignKey(e => e.ParticipantMedicationId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.TripInstance)
                .WithMany()
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.SetNull);

            // Restrict: same compliance-record idiom as ParticipantMedication/Participant above —
            // a witness's User row must not be silently cascade-deleted out from under the MAR.
            entity.HasOne(e => e.WitnessUser)
                .WithMany()
                .HasForeignKey(e => e.WitnessUserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Restrict: same compliance-record idiom — the recording user's row must not be
            // silently cascade-deleted out from under the MAR.
            entity.HasOne(e => e.RecordedByUser)
                .WithMany()
                .HasForeignKey(e => e.RecordedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => new { e.ParticipantMedicationId, e.AdministeredAt });
            entity.HasIndex(e => new { e.WitnessUserId, e.WitnessStatus });

            // Idempotent submits: unique per tenant over NON-NULL keys only. Filtered so every existing row
            // (all NULL) is outside the index and the migration cannot fail on existing data. Deliberately
            // NOT a unique index on (ParticipantMedicationId, ScheduledAt): see MedicationAdministration.IdempotencyKey.
            entity.Property(e => e.IdempotencyKey).HasMaxLength(100);
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(MedicationAdministration.IdempotencyIndexName)
                .HasFilter("\"IdempotencyKey\" IS NOT NULL");
        });

        // ── ParticipantNote ───────────────────────────────────────
        modelBuilder.Entity<ParticipantNote>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(4000).IsRequired();
            entity.Property(e => e.CreatedByName).HasMaxLength(200).IsRequired();
            // Retried saves: unique per tenant and participant over NON-NULL keys only, so every existing row (all NULL) is outside the index.
            entity.Property(e => e.IdempotencyKey).HasMaxLength(100);
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(ParticipantNote.IdempotencyIndexName)
                .HasFilter("\"IdempotencyKey\" IS NOT NULL");

            // Restrict: same idiom as ParticipantMedication → Participant — a participant
            // with note history must not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);

            // PD-5: idempotency mechanism for the safety-critical auto-note generator — a partial
            // unique index (manual notes have SourceKey == null and are therefore never
            // constrained) so the (ParticipantId, SourceKey) lookup the sync service relies on can
            // never find more than one row.
            entity.HasIndex(e => new { e.ParticipantId, e.SourceKey })
                .IsUnique()
                .HasFilter("\"SourceKey\" IS NOT NULL");
        });

        // ── ParticipantRoutine ────────────────────────────────────
        modelBuilder.Entity<ParticipantRoutine>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000).IsRequired();

            // Restrict: same idiom as ParticipantNote/ParticipantMedication → Participant.
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
        });

        // ── ParticipantRiskEntry ──────────────────────────────────
        modelBuilder.Entity<ParticipantRiskEntry>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Description).HasMaxLength(2000).IsRequired();
            entity.Property(e => e.MitigationNotes).HasMaxLength(2000);

            // Restrict: same idiom as ParticipantNote/ParticipantRoutine/ParticipantMedication →
            // Participant — a participant with risk-entry history must not be silently
            // cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
        });

        // ── ParticipantConsent (INTAKE sub-wave B) ─────────────────
        modelBuilder.Entity<ParticipantConsent>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SignedByName).HasMaxLength(200);

            // Restrict: same idiom as ParticipantNote/ParticipantRoutine/ParticipantRiskEntry →
            // Participant — a participant with recorded consent history must not be silently
            // cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.Consents)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            // One row per (participant, consent type) — enforced at the DB level, not just by
            // controller-side upsert-by-type logic, so a duplicate insert fails loudly instead of
            // producing two rows for the same type that GetForParticipant would then have to
            // arbitrarily pick between.
            entity.HasIndex(e => new { e.ParticipantId, e.ConsentType }).IsUnique();
        });

        // ── ParticipantHealthCondition (INTAKE sub-wave C1) ────────
        modelBuilder.Entity<ParticipantHealthCondition>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Severity).HasMaxLength(200);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            // Restrict: same idiom as ParticipantConsent/ParticipantNote/ParticipantRoutine →
            // Participant — a participant with a recorded support-planning grid must not be
            // silently cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.HealthConditions)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            // One row per (participant, condition type) — enforced at the DB level, same reasoning
            // as ParticipantConsent's unique index above.
            entity.HasIndex(e => new { e.ParticipantId, e.ConditionType }).IsUnique();
        });
    }
}
