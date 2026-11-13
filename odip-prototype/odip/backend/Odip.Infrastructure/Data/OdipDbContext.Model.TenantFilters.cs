using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Funding;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureTenantFilters(ModelBuilder modelBuilder)
    {
        // ── Multi-Tenancy Query Filters ─────────────────────────────────────────────
        // Applied to all root aggregate entities. SuperAdmin bypasses all filters.

        modelBuilder.Entity<User>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<User>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ClaimBatch>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ClaimBatchLine>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        modelBuilder.Entity<Participant>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Participant>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantInquiry>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<InquiryContact>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantOnboarding>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantIntakeSnapshot>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ServiceAgreementDraft>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ServiceAgreementDraftApproval>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ServiceAgreementShare>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ElectronicSigningSnapshot>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ElectronicSigningEvidence>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        // TenantId index for CaregiverProfileSubmission is declared on its own configuration
        // block above, so only the query filter is added here.
        modelBuilder.Entity<CaregiverProfileSubmission>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        modelBuilder.Entity<Vehicle>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Vehicle>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<AccommodationProperty>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<AccommodationProperty>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<EventTemplate>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<EventTemplate>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<Activity>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Activity>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ReferralSource>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ReferralSource>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ServiceLocation>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ServiceLocation>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ComplianceItem>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ComplianceItem>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<TripInstance>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<TripInstance>()
            .HasIndex(e => e.TenantId);

        // BookingTask (item 9 of the connection map): was previously scoped only through its
        // required TripInstance FK. Now that TripInstanceId is optional (generic obligation
        // tasks have no trip), it needs its own TenantId — auto-stamped on insert by
        // SaveChangesAsync below, same as every other row here.
        modelBuilder.Entity<BookingTask>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<BookingTask>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<AppSettings>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<AppSettings>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ProviderSettings>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ProviderSettings>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<PlanPricingSettings>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        // Participant budgets (phase 1): every table carries its own TenantId and the standard filter, so a pool or a period is never reached across tenants
        // even by a query that does not go through its plan.
        modelBuilder.Entity<FundingPlan>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<FundingPool>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<FundingPeriod>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<BudgetSettings>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        // Tenants table — unique index on EmailDomain (null for an organisation with none; PostgreSQL treats NULLs as distinct)
        modelBuilder.Entity<Tenant>()
            .HasIndex(t => t.EmailDomain).IsUnique();
    }
}
