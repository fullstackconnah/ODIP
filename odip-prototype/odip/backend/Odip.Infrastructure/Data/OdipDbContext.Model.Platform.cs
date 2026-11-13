using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigurePlatform(ModelBuilder modelBuilder)
    {
        // ── What's new ──────────────────────────────────────────────────────────────
        // Release notes are the same for every organisation, and a read mark belongs to one user, so neither table
        // is an ITenantEntity and neither gets a query filter. Do not add a filter here.
        modelBuilder.Entity<WhatsNewEntry>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.HasIndex(e => e.Key).IsUnique();
            entity.Property(e => e.Title).HasMaxLength(80).IsRequired();
            entity.Property(e => e.Body).HasMaxLength(600).IsRequired();
            entity.Property(e => e.Roles).HasConversion<int>();
            entity.HasIndex(e => e.PublishedAtUtc);
        });

        modelBuilder.Entity<WhatsNewUserState>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.UserId).IsUnique();
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // Like WhatsNewUserState: keyed on the user, no tenant column, no query filter, gone with the user.
        modelBuilder.Entity<UserUiPreference>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.UserId).IsUnique();
            entity.Property(e => e.ItineraryView).HasMaxLength(10);
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // ── Early-access requests (public landing page) ─────────────────────────────
        // Deliberately configured OUTSIDE the multi-tenancy block below: the submitter is an
        // anonymous visitor with no tenant, so EarlyAccessRequest is not an ITenantEntity (the
        // TenantId stamping in SaveChangesAsync never touches it), has no TenantId column, and
        // gets NO HasQueryFilter — a tenant claim or a SuperAdmin view-as header must neither
        // scope nor hide these rows. Do not add a filter here.
        modelBuilder.Entity<EarlyAccessRequest>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Organisation).HasMaxLength(150).IsRequired();
            // 254 is the longest valid email address (RFC 5321 path limit minus the angle brackets).
            entity.Property(e => e.Email).HasMaxLength(254).IsRequired();
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Role).HasMaxLength(100);
            entity.Property(e => e.OrganisationSize).HasMaxLength(16);
            entity.Property(e => e.Message).HasMaxLength(1000);
            // Concurrency token: two simultaneous repeat submissions from one address must both be
            // counted. The loser's UPDATE matches no row, EF throws DbUpdateConcurrencyException and
            // EarlyAccessService retries against the fresh count instead of losing an increment.
            entity.Property(e => e.RequestCount).IsConcurrencyToken();
            // Email is stored trimmed + lower-cased, so a plain unique index is case-insensitive in effect.
            entity.HasIndex(e => e.Email).IsUnique();
        });

        // A repeat sign-up whose answers differed. Same exemptions as its parent (no tenant, no filter, not audited); same column lengths.
        modelBuilder.Entity<EarlyAccessLaterSubmission>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Organisation).HasMaxLength(150).IsRequired();
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Role).HasMaxLength(100);
            entity.Property(e => e.OrganisationSize).HasMaxLength(16);
            entity.Property(e => e.Message).HasMaxLength(1000);
            entity.HasOne(e => e.EarlyAccessRequest).WithMany(r => r.LaterSubmissions)
                .HasForeignKey(e => e.EarlyAccessRequestId).OnDelete(DeleteBehavior.Cascade);
        });

        // ── Purge tombstones (7-year retention) ──────────────────────
        modelBuilder.Entity<PurgeRecord>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(50).IsRequired();
            entity.Property(e => e.ConfirmedByName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Reason).HasMaxLength(PurgeRecord.ReasonMaxLength).IsRequired();
            // Backs idempotency: a repeated or racing confirm finds the first record instead of purging twice.
            entity.HasIndex(e => new { e.TenantId, e.EntityType, e.EntityId }).IsUnique();
        });

        // ── Onboarding import batches ──────────────────────────────
        modelBuilder.Entity<ImportBatch>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(260).IsRequired();
            entity.Property(e => e.FileSha256).HasMaxLength(64).IsRequired();
            entity.Property(e => e.IdempotencyKey).HasMaxLength(100).IsRequired();
            entity.Property(e => e.ChoicesFingerprint).HasMaxLength(64);
            entity.Property(e => e.CreatedByName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.UndoneByName).HasMaxLength(200);
            // A double-submitted import finds the first batch by this key (OnboardingImportService); the index is the backstop when two arrive together.
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt });
            entity.HasMany(e => e.Items).WithOne(i => i.Batch).HasForeignKey(i => i.BatchId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<ImportBatchItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => e.BatchId);
            entity.HasIndex(e => e.EntityId);
        });
    }
}
