using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureRostering(ModelBuilder modelBuilder)
    {
        // ── TripInstance — new FK to SupportActivityGroup ─────────
        modelBuilder.Entity<TripInstance>()
            .HasOne(t => t.DefaultActivityGroup)
            .WithMany()
            .HasForeignKey(t => t.DefaultActivityGroupId)
            .OnDelete(DeleteBehavior.SetNull);

        // ── Participant — new FK to Contact (PlanManager) ─────────
        modelBuilder.Entity<Participant>()
            .HasOne(p => p.PlanManagerContact)
            .WithMany()
            .HasForeignKey(p => p.PlanManagerContactId)
            .OnDelete(DeleteBehavior.SetNull);

        // ── Participant — new FK to User (PreferredUser) ──────────
        modelBuilder.Entity<Participant>()
            .HasOne(p => p.PreferredUser)
            .WithMany()
            .HasForeignKey(p => p.PreferredUserId)
            .OnDelete(DeleteBehavior.SetNull);

        // ── Shift ────────────────────────────────────────────────
        modelBuilder.Entity<Shift>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.Location).HasMaxLength(200);
            entity.Property(e => e.SupportGroupCode).HasMaxLength(50);
            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);
            entity.Property(e => e.RegularAwayReason).HasMaxLength(200);
            // What the pattern the shift was generated from asked of a worker (plan builder, phase D). Deliberately no unique index on a shift: the demo pack places its shifts by a
            // deterministic id, and a natural key here would wedge it. Generation is made safe by an advisory lock (RosterShiftGenerator), not by a key.
            entity.Property(e => e.RequirementsJson).HasColumnType("jsonb");
            // Computed from StartTime/EndTime/EndsNextDay — never persisted.
            entity.Ignore(e => e.DurationHours);

            // Restrict: a rostered participant or staff member must not be silently
            // cascade-deleted out from under their shifts (same idiom as
            // StaffAssignment → User above).
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // SetNull: losing the user only loses the flag's name, never the shift (as ShiftPattern.DefaultUser).
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.RegularUserId).OnDelete(DeleteBehavior.SetNull);

            // Restrict: places are archived, never deleted, so a shift keeps its place and its zone.
            entity.HasOne(e => e.ServiceLocation).WithMany().HasForeignKey(e => e.ServiceLocationId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ServiceLocationId);

            // Board queries filter by day/week; the roster-check helper filters by staff+week.
            entity.HasIndex(e => new { e.TenantId, e.ServiceDate });
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.ServiceDate });
            // Pattern generation idempotency check: "does this pattern already have a shift on this date".
            entity.HasIndex(e => new { e.ShiftPatternId, e.ServiceDate });
            // Review-queue filter (design spec §2, GetCompletions): status + date-range scan, tenant-scoped.
            entity.HasIndex(e => new { e.TenantId, e.Status, e.ServiceDate });

            // Restrict: activities are cancelled, never deleted, so a participant's shift keeps its link (group activities D2).
            entity.HasOne(e => e.GroupActivity).WithMany().HasForeignKey(e => e.GroupActivityId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.GroupActivityId);
        });

        // ── Group activities (D2) ────────────────────────────────
        modelBuilder.Entity<GroupActivity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(200);
            entity.Property(e => e.Location).HasMaxLength(200);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.HasOne(e => e.Activity).WithMany().HasForeignKey(e => e.ActivityId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ServiceLocation).WithMany().HasForeignKey(e => e.ServiceLocationId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ActivityId);
            entity.HasOne(e => e.Series).WithMany().HasForeignKey(e => e.SeriesId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ServiceLocationId);
            entity.HasIndex(e => e.SeriesId);
            entity.HasIndex(e => new { e.TenantId, e.ServiceDate });
        });

        modelBuilder.Entity<GroupActivitySeries>(entity => entity.HasKey(e => e.Id));

        modelBuilder.Entity<GroupActivitySeriesParticipant>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasOne<GroupActivitySeries>().WithMany().HasForeignKey(e => e.SeriesId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Participant>().WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.SeriesId, e.ParticipantId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId });
        });

        modelBuilder.Entity<GroupActivityStaff>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).HasMaxLength(100);
            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);
            entity.Property(e => e.TimeZoneId).HasMaxLength(64);
            entity.Property(e => e.AdjustmentReason).HasMaxLength(500);
            entity.Ignore(e => e.State);
            // Cascade: an activity is never deleted, so this only ever removes rows with a test database's teardown.
            entity.HasOne(e => e.GroupActivity).WithMany(a => a.Staff).HasForeignKey(e => e.GroupActivityId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.GroupActivityId, e.UserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.UserId });
        });

        // ── ShiftPattern ─────────────────────────────────────────
        modelBuilder.Entity<ShiftPattern>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.SupportGroupCode).HasMaxLength(50);
            // The slot's regular: a second coordinator's Stop or Make must not overwrite a change made since the board loaded (REV281B).
            entity.Property(e => e.DefaultUserId).IsConcurrencyToken();

            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            // Optional pre-fill; unlike Shift.UserId this is just a default, so losing the
            // staff member should fall back to unfilled generation rather than block deletion.
            entity.HasOne(e => e.DefaultUser)
                .WithMany()
                .HasForeignKey(e => e.DefaultUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => new { e.TenantId, e.ParticipantId });
            entity.HasIndex(e => e.IsActive);

            // Plan builder phase D: the pattern an approved agreement revision made remembers its revision, block and worker slot. The key is partial so that a hand-made or demo pattern
            // (no source) is outside it altogether, and approving the same revision twice, or two approvals racing, can never make the same weekday twice.
            entity.Property(e => e.SourceBlockKey).HasMaxLength(64);
            entity.Property(e => e.RequirementsJson).HasColumnType("jsonb");
            entity.HasOne<ServiceAgreementDraft>().WithMany().HasForeignKey(e => e.SourceDraftId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.SourceDraftId);
            entity.HasIndex(e => new { e.SourceDraftId, e.SourceBlockKey, e.DayOfWeek, e.WorkerSlot }).IsUnique().HasFilter("\"SourceDraftId\" IS NOT NULL").HasDatabaseName("IX_ShiftPatterns_SourceDraft_Block_Day_Slot");
        });

        // ── RosterWeek (Start rostering, 2026-10-16) ─────────────
        modelBuilder.Entity<RosterWeek>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.TenantId, e.WeekStart }).IsUnique();
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.StartedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        // ── StaffParticipantCompatibility ────────────────────────
        modelBuilder.Entity<StaffParticipantCompatibility>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Reason).HasMaxLength(1000);

            // Cascade: a compatibility cell has no meaning once either side of the pair is
            // gone — unlike Shift/ShiftPattern this isn't roster history, just a preference.
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.ParticipantId }).IsUnique();
        });

        // ── ShiftNote (NOTES-01) ─────────────────────────────────
        modelBuilder.Entity<ShiftNote>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AuthorName).HasMaxLength(200);
            entity.Property(e => e.Body).HasMaxLength(1000);

            // Restrict: same idiom as Shift's own Participant/User FKs — a shift's note history
            // must not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.Shift)
                .WithMany()
                .HasForeignKey(e => e.ShiftId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.AuthorUser)
                .WithMany()
                .HasForeignKey(e => e.AuthorUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TenantId, e.ShiftId });
        });

        // ── ShiftCompletion (shift-completion state machine) ────────
        modelBuilder.Entity<ShiftCompletion>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TimeZoneId).HasMaxLength(100);
            entity.Property(e => e.ReturnReason).HasMaxLength(2000);
            entity.Property(e => e.HandoverText).HasMaxLength(2000);
            entity.Property(e => e.TimeAdjustmentReason).HasMaxLength(500);
            entity.Property(e => e.StartTimeReason).HasMaxLength(Odip.Domain.Rostering.ShiftTimeRules.MaxReasonLength);
            entity.Property(e => e.FinishTimeReason).HasMaxLength(Odip.Domain.Rostering.ShiftTimeRules.MaxReasonLength);
            entity.Property(e => e.LocationReason).HasMaxLength(Odip.Domain.Rostering.LocationCheck.MaxReasonLength);
            entity.Property(e => e.Kilometres).HasPrecision(6, 1);
            entity.Property(e => e.PreShiftTravelKilometres).HasPrecision(6, 1);
            entity.Property(e => e.PostShiftTravelKilometres).HasPrecision(6, 1);

            // Restrict: same idiom as ShiftNote -> Shift — a shift's completion history must
            // not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.Shift)
                .WithMany()
                .HasForeignKey(e => e.ShiftId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TenantId, e.ShiftId });

            // "At most one active" per Shift — mirrors CaregiverProfileSubmission's
            // partial-index precedent (OdipDbContext.cs:~650-653).
            entity.HasIndex(e => e.ShiftId)
                .IsUnique()
                .HasDatabaseName(ShiftCompletion.ActiveIndexName)
                .HasFilter("\"IsActive\"");
        });

        // ── ShiftBreak (shift package) ────────────────────────────
        modelBuilder.Entity<ShiftBreak>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Restrict: same idiom as ShiftNote/ShiftCompletion -> Shift — a completion's break history must
            // not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.ShiftCompletion)
                .WithMany()
                .HasForeignKey(e => e.ShiftCompletionId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TenantId, e.ShiftCompletionId });

            // "At most one running break" per completion — mirrors ShiftCompletion's own partial unique index.
            entity.HasIndex(e => e.ShiftCompletionId)
                .IsUnique()
                .HasDatabaseName(ShiftBreak.OneRunningIndexName)
                .HasFilter("\"EndedAt\" IS NULL");
        });

        // ── HandoverAcknowledgement (shift package) ─────────────────
        modelBuilder.Entity<HandoverAcknowledgement>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Restrict throughout: an acknowledgement is an audit-worthy record of who read what; the completion,
            // shift and user it points at must not cascade it away.
            entity.HasOne(e => e.SourceCompletion).WithMany().HasForeignKey(e => e.SourceCompletionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Shift).WithMany().HasForeignKey(e => e.ShiftId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);

            // One acknowledgement per reader per handover - acknowledging again is an idempotent no-op.
            entity.HasIndex(e => new { e.SourceCompletionId, e.UserId })
                .IsUnique()
                .HasDatabaseName(HandoverAcknowledgement.UniqueReaderIndexName);
            entity.HasIndex(e => new { e.TenantId, e.ShiftId });
        });

        // ── ShiftRoutineCheck (shift package) ────────────────────────
        modelBuilder.Entity<ShiftRoutineCheck>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Restrict: a completion's tick history must not be cascade-deleted out from under it (same idiom as ShiftBreak); the worker too.
            entity.HasOne(e => e.ShiftCompletion).WithMany().HasForeignKey(e => e.ShiftCompletionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CheckedByUser).WithMany().HasForeignKey(e => e.CheckedByUserId).OnDelete(DeleteBehavior.Restrict);
            // Restrict: a tick is history. The routine endpoints retire a routine (IsActive = false) rather than delete it, so a routine that has been
            // ticked on a shift can never be removed out from under its ticks (a hard delete now fails instead of erasing the record).
            entity.HasOne(e => e.ParticipantRoutine).WithMany().HasForeignKey(e => e.ParticipantRoutineId).OnDelete(DeleteBehavior.Restrict);
            entity.Property(e => e.RoutineTitle).HasMaxLength(200);

            entity.HasIndex(e => new { e.TenantId, e.ShiftCompletionId });

            // One tick per (completion, routine, occurrence). A plain unique index treats NULL ScheduledAt (an untimed routine) as distinct, so
            // there are two partial unique indexes: timed occurrences, and untimed routines.
            entity.HasIndex(e => new { e.ShiftCompletionId, e.ParticipantRoutineId, e.ScheduledAt })
                .IsUnique()
                .HasDatabaseName(ShiftRoutineCheck.UniqueTimedIndexName)
                .HasFilter("\"ScheduledAt\" IS NOT NULL");
            entity.HasIndex(e => new { e.ShiftCompletionId, e.ParticipantRoutineId })
                .IsUnique()
                .HasDatabaseName(ShiftRoutineCheck.UniqueUntimedIndexName)
                .HasFilter("\"ScheduledAt\" IS NULL");
        });

        // ── LeaveRequest ─────────────────────────────────────────
        modelBuilder.Entity<LeaveRequest>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Reason).HasMaxLength(2000);
            entity.Property(e => e.DecisionNote).HasMaxLength(2000);
            entity.Property(e => e.ExternalLeaveId).HasMaxLength(20);
            entity.Property(e => e.SentHours).HasPrecision(6, 2);
            // The row's version: an approve and a withdraw that both loaded it Pending cannot both save, so the loser gets a 409 instead of overwriting the winner.
            entity.Property(e => e.UpdatedAt).IsConcurrencyToken();
            entity.HasIndex(e => new { e.TenantId, e.ExternalLeaveId })
                .IsUnique()
                .HasDatabaseName(LeaveRequest.ExternalLeaveIdIndexName)
                .HasFilter("\"ExternalLeaveId\" IS NOT NULL");

            // Restrict: same idiom as Shift -> User — a staff member with leave history must not
            // be silently cascade-deleted out from under it.
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Coordinator list filters by status/user; StaffUnavailabilityQuery filters by
            // user + status + date range.
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.StartDate, e.EndDate });
        });

        // ── RecurringUnavailability ──────────────────────────────
        modelBuilder.Entity<RecurringUnavailability>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.DecisionNote).HasMaxLength(2000);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });
        });
    }
}
