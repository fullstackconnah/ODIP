using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureNotifications(ModelBuilder modelBuilder)
    {
        // ── Notifications (outbox + preferences + delivery log) ────
        // docs/specs/2026-09-08-notifications-design.md §1.
        modelBuilder.Entity<NotificationOutbox>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(100);
            entity.Property(e => e.LastError).HasMaxLength(2000);

            entity.HasIndex(e => new { e.Status, e.NextAttemptAt });                              // dispatcher poll
            entity.HasIndex(e => new { e.EntityId, e.RecipientUserId, e.CreatedAt });  // dedupe lookup (NotificationRaiser)
        });

        // Report a problem: the saved note and its Work Board retry state. Status is the default int, like the outbox.
        modelBuilder.Entity<ProblemReport>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ReporterName).HasMaxLength(200);
            entity.Property(e => e.ReporterRole).HasMaxLength(32);
            entity.Property(e => e.OrganisationName).HasMaxLength(200);
            entity.Property(e => e.Text).HasMaxLength(2000);
            entity.Property(e => e.PagePath).HasMaxLength(200);
            entity.Property(e => e.AppVersion).HasMaxLength(64);
            entity.Property(e => e.ApiVersion).HasMaxLength(64);
            entity.Property(e => e.UserAgent).HasMaxLength(300);
            entity.Property(e => e.LastError).HasMaxLength(500);

            entity.HasIndex(e => new { e.Status, e.NextAttemptAt });          // the retry loop's poll
            entity.HasIndex(e => new { e.ReporterUserId, e.CreatedAt });      // the per-user cap
        });

        modelBuilder.Entity<NotificationPreference>(entity =>
        {
            entity.HasKey(e => e.Id);

            // Restrict: same idiom as LeaveRequest -> User — a user's preference history must
            // not be silently cascade-deleted out from under it.
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.EventType, e.Channel }).IsUnique();
        });

        modelBuilder.Entity<NotificationLog>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RecipientAddress).HasMaxLength(320); // RFC 5321 max email length

            // Restrict: an outbox row's delivery trail must not disappear if the row itself is
            // ever deleted (it never is in v1, but this matches the codebase's default idiom).
            entity.HasOne(e => e.Outbox)
                .WithMany()
                .HasForeignKey(e => e.OutboxId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.OutboxId);
        });

        // The bell (dashboard spec 2026-10-14). Title and LinkTo stay unbounded text: the row commits in the caller's own
        // SaveChanges, so a length limit on a title that carries names could fail the leave request or incident it rides on.
        modelBuilder.Entity<InAppNotification>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(100);
            entity.HasIndex(e => new { e.RecipientUserId, e.CreatedAt }).IsDescending(false, true);   // the bell: own rows, newest first
            // The badge's unread count, polled every minute: only unread rows, not the recipient's whole 90-day history.
            entity.HasIndex(e => e.RecipientUserId).HasFilter("\"ReadAt\" IS NULL").HasDatabaseName("IX_InAppNotifications_Unread");
        });

        // ── StaffAssignment override fields (PR 3 wires the gate; columns land now) ──
        modelBuilder.Entity<StaffAssignment>(entity =>
        {
            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);
        });
    }
}
