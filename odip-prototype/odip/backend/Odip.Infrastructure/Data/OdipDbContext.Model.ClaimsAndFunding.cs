using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureClaimsAndFunding(ModelBuilder modelBuilder)
    {
        // ── TripClaim ─────────────────────────────────────────────
        modelBuilder.Entity<TripClaim>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ClaimReference).HasMaxLength(50).IsRequired();
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.Property(e => e.TotalApprovedAmount).HasPrecision(18, 2);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            // The NDIA's code for a rejected claim (budget phase 2b): nullable, no default, so the column is added to a live table without touching a row.
            entity.Property(e => e.RejectionCode).HasMaxLength(NdiaRejectionCodes.MaxLength);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.TripClaims)
                .HasForeignKey(e => e.TripInstanceId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Cascade);

            // Shift-completion design spec §1 (PR 3) — Kind == Shift claims key off Participant
            // + a date range instead of a TripInstance.
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.AuthorisedByUser)
                .WithMany()
                .HasForeignKey(e => e.AuthorisedByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.ClaimReference).IsUnique();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.TripInstanceId);
            entity.HasIndex(e => e.ParticipantId);
        });

        // ── ClaimLineItem ─────────────────────────────────────────
        modelBuilder.Entity<ClaimLineItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SupportItemCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(18, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(18, 2);
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.Property(e => e.PaidAmount).HasPrecision(18, 2);
            entity.Property(e => e.RejectionReason).HasMaxLength(1000);

            entity.HasOne(e => e.TripClaim)
                .WithMany(c => c.LineItems)
                .HasForeignKey(e => e.TripClaimId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.ParticipantBooking)
                .WithMany()
                .HasForeignKey(e => e.ParticipantBookingId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            // Shift-completion design spec §1 (PR 3) — the Shift-side parent for Kind == Shift
            // claim lines, mutually exclusive with ParticipantBookingId (see check constraint
            // below and the class doc comment).
            entity.HasOne(e => e.Shift)
                .WithMany()
                .HasForeignKey(e => e.ShiftId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            entity.ToTable(tb => tb.HasCheckConstraint(
                "CK_ClaimLineItem_AtMostOneParent",
                "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) <= 1"));

            entity.HasIndex(e => e.TripClaimId);
            entity.HasIndex(e => e.ParticipantBookingId);
            entity.HasIndex(e => e.ShiftId);
            // The database backstop for one counting line per shift. Line status only: a partial index cannot read TripClaim, so a shift on a claim rejected by hand (its lines still Submitted) stays held until that claim is deleted.
            entity.HasIndex(e => new { e.ShiftId, e.ShiftPart }, "IX_ClaimLineItems_ShiftId_ShiftPart_Counting").IsUnique().HasFilter("\"ShiftId\" IS NOT NULL AND \"Status\" <> 5");
            entity.HasIndex(e => e.Status);
        });

        // ── SupportActivityGroup ──────────────────────────────────
        modelBuilder.Entity<SupportActivityGroup>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.GroupCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(200).IsRequired();

            entity.HasIndex(e => e.GroupCode).IsUnique();
            entity.HasIndex(e => e.IsActive);
        });

        // ── SupportCatalogueItem ──────────────────────────────────
        modelBuilder.Entity<SupportCatalogueItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ItemNumber).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Unit).HasMaxLength(10);
            entity.Property(e => e.CatalogueVersion).HasMaxLength(20);
            entity.Property(e => e.PriceLimit_ACT).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_NSW).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_NT).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_QLD).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_SA).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_TAS).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_VIC).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_WA).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_Remote).HasPrecision(18, 2);
            entity.Property(e => e.PriceLimit_VeryRemote).HasPrecision(18, 2);
            entity.Property(e => e.PriceNational).HasPrecision(18, 2);
            entity.Property(e => e.PriceRemote).HasPrecision(18, 2);
            entity.Property(e => e.PriceVeryRemote).HasPrecision(18, 2);
            entity.Property(e => e.RegistrationGroup).HasMaxLength(4);
            entity.Property(e => e.SourceDocument).HasMaxLength(200);

            entity.HasOne(e => e.ActivityGroup)
                .WithMany(g => g.Items)
                .HasForeignKey(e => e.ActivityGroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => new { e.ItemNumber, e.CatalogueVersion });
            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.DayType);
        });

        // ── ProviderSettings ──────────────────────────────────────
        modelBuilder.Entity<ProviderSettings>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RegistrationNumber).HasMaxLength(20);
            entity.Property(e => e.ABN).HasMaxLength(20);
            entity.Property(e => e.OrganisationName).HasMaxLength(200);
            entity.Property(e => e.Address).HasMaxLength(500);
            entity.Property(e => e.BankAccountName).HasMaxLength(200);
            entity.Property(e => e.BSB).HasMaxLength(10);
            entity.Property(e => e.AccountNumber).HasMaxLength(20);
            entity.Property(e => e.InvoiceFooterNotes).HasMaxLength(2000);
            entity.Property(e => e.AgreementResponsibilitiesTerms).HasMaxLength(2000);
            entity.Property(e => e.AgreementComplaintsTerms).HasMaxLength(2000);
            entity.Property(e => e.TimeZoneId).HasMaxLength(64);
            entity.Property(e => e.TradingName).HasMaxLength(200);
            entity.Property(e => e.ContactEmail).HasMaxLength(254);
            entity.Property(e => e.ContactPhone).HasMaxLength(30);
            entity.Property(e => e.Website).HasMaxLength(500);
            // NOT NULL with a constant database default (0 = Warn), so the migration is a
            // metadata-only add on PostgreSQL and every existing row, and any row written by an
            // older build during a rolling deploy, reads back as Warn. Stored as the enum's integer.
            entity.Property(e => e.ParticipantReadinessMode)
                .IsRequired()
                .HasDefaultValue(ParticipantReadinessMode.Warn);
            // NOT NULL DEFAULT 0 (= Warn): a constant default, so the column is added without rewriting the table.
            entity.Property(e => e.MedicationCompetencyMode).HasDefaultValue(MedicationCompetencyMode.Warn);
            entity.Property(e => e.OnboardingItemModes).HasColumnType("jsonb");
            // The row's version, as on ParticipantInquiry: a save from a form loaded before another Admin's save matches no row and gets a 409.
            // The migration adds the column with a constant default, so existing rows are metadata-only and every one reads 0001-01-01 until first saved.
            entity.Property(e => e.UpdatedAt).IsConcurrencyToken();

            // Invoice numbering and terms (Xero PR1): NOT NULL with constant defaults, so adding them is deploy-safe.
            entity.Property(e => e.InvoiceNumberPrefix).HasMaxLength(10).IsRequired().HasDefaultValue("INV-");
            entity.Property(e => e.CreditNotePrefix).HasMaxLength(10).IsRequired().HasDefaultValue("CN-");
            entity.Property(e => e.InvoiceStartNumber).HasDefaultValue(1);
            entity.Property(e => e.PaymentTermsDays).HasDefaultValue(14);

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // ── PublicHoliday ─────────────────────────────────────────
        modelBuilder.Entity<PublicHoliday>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.State).HasMaxLength(10);

            entity.HasIndex(e => e.Date);
            entity.HasIndex(e => new { e.Date, e.State });
        });

        // ── PublicHolidayOverride (plan builder phase B) ──────────
        // The gaps NDIS-CODES 5.3 found in the synced feed, read by the pricing engine after the PublicHoliday rows. Global like PublicHoliday.
        // The seed rows are inserted by the migration once with fixed ids and are the owner's to maintain after that.
        modelBuilder.Entity<PublicHolidayOverride>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.State).HasMaxLength(10);
            entity.Property(e => e.Source).HasMaxLength(200).IsRequired();

            entity.HasIndex(e => new { e.Date, e.State });
            entity.HasData(PublicHolidayOverrideSeed.All);
        });

        // ── PlanPricingSettings (plan builder phase B) ────────────
        // One row per tenant. Every column is NOT NULL with a constant default equal to the owner-approved default, so a row written by an older
        // build during a rolling deploy reads back as the defaults.
        modelBuilder.Entity<PlanPricingSettings>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RegistrationGroupsHeld).HasMaxLength(40).IsRequired().HasDefaultValue(Odip.Domain.Entities.PlanPricingSettings.DefaultRegistrationGroups);
            entity.Property(e => e.RegistrationGroupsConfirmed).HasDefaultValue(false);
            entity.Property(e => e.CrossingPolicy).HasDefaultValue(Odip.Domain.Billing.Pricing.CrossingPolicy.Split);
            entity.Property(e => e.ClaimProviderTravel).HasDefaultValue(true);
            entity.Property(e => e.TravelKmRateStandard).HasPrecision(8, 2).HasDefaultValue(0.99m);
            entity.Property(e => e.TravelKmRateAccessible).HasPrecision(8, 2).HasDefaultValue(2.76m);
            entity.Property(e => e.TravelRatesProvisional).HasDefaultValue(true);
            entity.Property(e => e.GroupOutings).HasDefaultValue(Odip.Domain.Billing.Pricing.GroupOutingFamily.GroupActivities);
            entity.Property(e => e.StaUsesHourlyAndAccommodation).HasDefaultValue(true);
            entity.Property(e => e.ApproverRoles).HasMaxLength(100).IsRequired().HasDefaultValue(Odip.Domain.Entities.PlanPricingSettings.DefaultApproverRoles);
            entity.Property(e => e.ApprovalActivatesParticipant).HasDefaultValue(false);

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.TenantId).IsUnique();
        });

        // ── Participant budgets (phase 1): FundingPlan, FundingPool, FundingPeriod, BudgetSettings ────────────
        // A plan is the root of a participant's budget history, so deleting the participant must not silently cascade it away (Restrict); the pools and periods are parts of the plan and go with it. Money is decimal(18,2) on the period only: a pool's
        // total is the sum of its periods. Dates are `date` columns (DateOnly), instants are UTC `timestamp` columns like the rest of the model.
        modelBuilder.Entity<FundingPlan>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ConfirmedByName).HasMaxLength(200);
            entity.Property(e => e.MyProviderSetBy).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.CreatedBy).HasMaxLength(100).IsRequired();
            entity.Property(e => e.UpdatedBy).HasMaxLength(100).IsRequired();

            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);
            // One plan per participant per start day. (Overlap between plans of different start days is refused by the save, under a lock on the participant.)
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.PlanStart }).IsUnique();
            entity.HasIndex(e => e.ParticipantId);
        });

        modelBuilder.Entity<FundingPool>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Notes).HasMaxLength(1000);

            entity.HasOne(e => e.FundingPlan)
                .WithMany(p => p.Pools)
                .HasForeignKey(e => e.FundingPlanId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.FundingPlanId, e.PaceCategory, e.ManagementType }).IsUnique();
        });

        modelBuilder.Entity<FundingPeriod>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.PlanAmount).HasPrecision(18, 2);
            entity.Property(e => e.SetAside).HasPrecision(18, 2);
            entity.Property(e => e.RolloverOverride).HasPrecision(18, 2);

            entity.HasOne(e => e.FundingPool)
                .WithMany(p => p.Periods)
                .HasForeignKey(e => e.FundingPoolId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.FundingPoolId, e.PeriodStart }).IsUnique();
        });

        // One row per tenant. Every column is NOT NULL with a constant default equal to the default the code uses, so a missing row means the defaults
        // and a row written by an older build during a rolling deploy reads back as them (the same shape as PlanPricingSettings).
        modelBuilder.Entity<BudgetSettings>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Mode).HasDefaultValue(Odip.Domain.Funding.BudgetSettings.DefaultMode);
            entity.Property(e => e.ApproachingPercent).HasDefaultValue(Odip.Domain.Funding.BudgetSettings.DefaultApproachingPercent);

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.TenantId).IsUnique();
        });

        // ── AuditLog ─────────────────────────────────────────────
        // Column types must match the "AddAuditLog" migration exactly (varchar(100)/varchar(20)/
        // varchar(200)/text), which a later migration would otherwise have to reconcile — in
        // particular Action needs HasConversion<string>() or EF's default int mapping would send
        // an integer parameter into the migration's character varying(20) column and fail at runtime.
        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Action).HasConversion<string>().HasMaxLength(20).IsRequired();
            entity.Property(e => e.ChangedByName).HasMaxLength(200);
            entity.Property(e => e.Changes).IsRequired();

            entity.HasIndex(e => e.ChangedAt);
            entity.HasIndex(e => new { e.EntityType, e.EntityId });
            // The Deleted records list: one organisation's deletions, newest first. No FK and no backfill: rows from before the column have none.
            entity.HasIndex(e => new { e.TenantId, e.Action, e.ChangedAt });
        });
    }
}
