using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Integrations;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureTenantFilters2(ModelBuilder modelBuilder)
    {
        // ── Rostering tenant query filters ────────────────────────────────────────
        modelBuilder.Entity<Shift>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Shift>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<GroupActivity>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<GroupActivityStaff>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<GroupActivitySeries>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<GroupActivitySeriesParticipant>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        modelBuilder.Entity<ShiftPattern>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftPattern>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RosterWeek>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        modelBuilder.Entity<StaffParticipantCompatibility>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<StaffParticipantCompatibility>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftNote>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftNote>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftCompletion>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftCompletion>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftBreak>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftBreak>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<HandoverAcknowledgement>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<HandoverAcknowledgement>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftRoutineCheck>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftRoutineCheck>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<LeaveRequest>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<LeaveRequest>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RecurringUnavailability>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<RecurringUnavailability>()
            .HasIndex(e => e.TenantId);

        // ── Notifications tenant query filters ─────────────────────────────────────
        modelBuilder.Entity<NotificationOutbox>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<NotificationOutbox>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ProblemReport>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ProblemReport>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<NotificationPreference>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<NotificationPreference>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<NotificationLog>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<NotificationLog>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<InAppNotification>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<InAppNotification>()
            .HasIndex(e => e.TenantId);

        // ── Medication Management tenant query filters ────────────────────────────
        modelBuilder.Entity<ParticipantMedication>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantMedication>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<MedicationAdministration>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<MedicationAdministration>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantNote>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantNote>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantRoutine>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantRoutine>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantRiskEntry>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantRiskEntry>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantConsent>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantConsent>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantHealthCondition>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantHealthCondition>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantAdlAssessment>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantAdlAssessment>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantChecklistItem>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantChecklistItem>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantCommunityAccessRiskItem>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantCommunityAccessRiskItem>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RestrictivePractice>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<RestrictivePractice>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RestrictivePracticeMonthlyReport>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<RestrictivePracticeMonthlyReport>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<Complaint>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Complaint>()
            .HasIndex(e => e.TenantId);

        // ── Contacts (CONTACT-01/02/03) tenant query filters ───────────────────────
        modelBuilder.Entity<Person>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Person>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantContactRole>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantContactRole>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ImportBatch>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<PurgeRecord>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        modelBuilder.Entity<IncidentReport>()
            // Fail closed: a caller with no tenant must not match NULL-tenant rows (EF null semantics).
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || (e.TenantId != null && e.TenantId == _tenant.TenantId));
        modelBuilder.Entity<IncidentReport>()
            .HasIndex(e => e.TenantId);

        // Fail closed, as IncidentReport: TenantId is nullable until the contract PR.
        modelBuilder.Entity<TripClaim>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || (e.TenantId != null && e.TenantId == _tenant.TenantId));
        modelBuilder.Entity<TripClaim>()
            .HasIndex(e => e.TenantId);
        modelBuilder.Entity<ClaimLineItem>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || (e.TenantId != null && e.TenantId == _tenant.TenantId));
        modelBuilder.Entity<ClaimLineItem>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<EmploymentHeroConnection>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<EmploymentHeroAttention>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<EmploymentHeroSyncLog>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<EmploymentHeroOutbox>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Invoice>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<InvoiceLine>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<InvoiceNumberCounter>()
            .HasQueryFilter(TenantFilter.Name, e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
    }
}
