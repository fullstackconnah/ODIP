using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

/// <summary>
/// Primary database context for Odip application.
/// Configures all entity relationships, indexes, and constraints.
/// </summary>
public partial class OdipDbContext : DbContext
{
    private readonly ICurrentTenant _tenant;

    public OdipDbContext(DbContextOptions<OdipDbContext> options, ICurrentTenant tenant)
        : base(options)
    {
        _tenant = tenant;
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Participant> Participants => Set<Participant>();
    public DbSet<ParticipantInquiry> ParticipantInquiries => Set<ParticipantInquiry>();
    public DbSet<InquiryContact> InquiryContacts => Set<InquiryContact>();
    public DbSet<ParticipantOnboarding> ParticipantOnboardings => Set<ParticipantOnboarding>();
    public DbSet<ParticipantIntakeSnapshot> ParticipantIntakeSnapshots => Set<ParticipantIntakeSnapshot>();
    public DbSet<ServiceAgreementDraft> ServiceAgreementDrafts => Set<ServiceAgreementDraft>();
    public DbSet<ServiceAgreementDraftLine> ServiceAgreementDraftLines => Set<ServiceAgreementDraftLine>();
    public DbSet<ServiceAgreementDraftBlock> ServiceAgreementDraftBlocks => Set<ServiceAgreementDraftBlock>();
    public DbSet<ServiceAgreementDraftApproval> ServiceAgreementDraftApprovals => Set<ServiceAgreementDraftApproval>();
    public DbSet<ServiceAgreementShare> ServiceAgreementShares => Set<ServiceAgreementShare>();
    public DbSet<ElectronicSigningSnapshot> ElectronicSigningSnapshots => Set<ElectronicSigningSnapshot>();
    public DbSet<ElectronicSigningEvidence> ElectronicSigningEvidence => Set<ElectronicSigningEvidence>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<ParticipantContact> ParticipantContacts => Set<ParticipantContact>();
    // CONTACT-01/02/03 — see Person/ParticipantContactRole's type docs for why this is a separate
    // model from Contact/ParticipantContact above rather than a replacement of it.
    public DbSet<Person> People => Set<Person>();
    public DbSet<ParticipantContactRole> ParticipantContactRoles => Set<ParticipantContactRole>();
    public DbSet<SupportProfile> SupportProfiles => Set<SupportProfile>();
    public DbSet<ParticipantGroupRevision> ParticipantGroupRevisions => Set<ParticipantGroupRevision>();
    public DbSet<ParticipantMedication> ParticipantMedications => Set<ParticipantMedication>();
    public DbSet<MedicationAdministration> MedicationAdministrations => Set<MedicationAdministration>();
    public DbSet<ParticipantNote> ParticipantNotes => Set<ParticipantNote>();
    public DbSet<ParticipantRoutine> ParticipantRoutines => Set<ParticipantRoutine>();
    public DbSet<ParticipantRiskEntry> ParticipantRiskEntries => Set<ParticipantRiskEntry>();
    /// <summary>INTAKE sub-wave B. See <see cref="Entities.ParticipantConsent"/>'s type doc.</summary>
    public DbSet<ParticipantConsent> ParticipantConsents => Set<ParticipantConsent>();
    /// <summary>INTAKE sub-wave C1. See <see cref="Entities.ParticipantHealthCondition"/>'s type doc.</summary>
    public DbSet<ParticipantHealthCondition> ParticipantHealthConditions => Set<ParticipantHealthCondition>();
    /// <summary>INTAKE sub-wave C2. See <see cref="Entities.ParticipantAdlAssessment"/>'s type doc.</summary>
    public DbSet<ParticipantAdlAssessment> ParticipantAdlAssessments => Set<ParticipantAdlAssessment>();
    /// <summary>INTAKE-03/04. See <see cref="Entities.ParticipantChecklistItem"/>'s type doc.</summary>
    public DbSet<ParticipantChecklistItem> ParticipantChecklistItems => Set<ParticipantChecklistItem>();
    /// <summary>PF-10.2. See <see cref="Entities.ParticipantCommunityAccessRiskItem"/>'s type doc.</summary>
    public DbSet<ParticipantCommunityAccessRiskItem> ParticipantCommunityAccessRiskItems => Set<ParticipantCommunityAccessRiskItem>();
    public DbSet<RestrictivePractice> RestrictivePractices => Set<RestrictivePractice>();
    public DbSet<RestrictivePracticeMonthlyReport> RestrictivePracticeMonthlyReports => Set<RestrictivePracticeMonthlyReport>();
    public DbSet<EventTemplate> EventTemplates => Set<EventTemplate>();
    public DbSet<TripInstance> TripInstances => Set<TripInstance>();
    public DbSet<ParticipantBooking> ParticipantBookings => Set<ParticipantBooking>();
    public DbSet<AccommodationProperty> AccommodationProperties => Set<AccommodationProperty>();
    public DbSet<AccommodationReservation> AccommodationReservations => Set<AccommodationReservation>();
    public DbSet<Vehicle> Vehicles => Set<Vehicle>();
    public DbSet<VehicleAssignment> VehicleAssignments => Set<VehicleAssignment>();
    public DbSet<StaffAvailability> StaffAvailabilities => Set<StaffAvailability>();
    public DbSet<StaffAssignment> StaffAssignments => Set<StaffAssignment>();
    public DbSet<TripDay> TripDays => Set<TripDay>();
    public DbSet<ScheduledActivity> ScheduledActivities => Set<ScheduledActivity>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<ReferralSource> ReferralSources => Set<ReferralSource>();
    public DbSet<ServiceLocation> ServiceLocations => Set<ServiceLocation>();
    public DbSet<ComplianceItem> ComplianceItems => Set<ComplianceItem>();
    public DbSet<BookingTask> BookingTasks => Set<BookingTask>();
    public DbSet<TripDocument> TripDocuments => Set<TripDocument>();
    public DbSet<User> Users => Set<User>();
    public DbSet<IncidentReport> IncidentReports => Set<IncidentReport>();
    public DbSet<Complaint> Complaints => Set<Complaint>();
    /// <summary>IN-5: see <see cref="Entities.IncidentInjury"/>'s type doc.</summary>
    public DbSet<IncidentInjury> IncidentInjuries => Set<IncidentInjury>();
    /// <summary>IN-7: see <see cref="Entities.IncidentWitness"/>'s type doc.</summary>
    public DbSet<IncidentWitness> IncidentWitnesses => Set<IncidentWitness>();
    /// <summary>Caregiver profile form: see <see cref="Entities.CaregiverProfileSubmission"/>.</summary>
    public DbSet<CaregiverProfileSubmission> CaregiverProfileSubmissions => Set<CaregiverProfileSubmission>();
    public DbSet<AppSettings> AppSettings => Set<AppSettings>();
    public DbSet<TripClaim> TripClaims => Set<TripClaim>();
    public DbSet<ClaimLineItem> ClaimLineItems => Set<ClaimLineItem>();
    public DbSet<ClaimBatch> ClaimBatches => Set<ClaimBatch>();
    public DbSet<ClaimBatchLine> ClaimBatchLines => Set<ClaimBatchLine>();
    public DbSet<SupportActivityGroup> SupportActivityGroups => Set<SupportActivityGroup>();
    public DbSet<SupportCatalogueItem> SupportCatalogueItems => Set<SupportCatalogueItem>();
    public DbSet<ProviderSettings> ProviderSettings => Set<ProviderSettings>();
    public DbSet<MicrosoftTenantLink> MicrosoftTenantLinks => Set<MicrosoftTenantLink>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<InvoiceNumberCounter> InvoiceNumberCounters => Set<InvoiceNumberCounter>();

    /// <summary>
    /// The caller's own provider-settings row. A SuperAdmin's query filter is off, so a plain <c>FirstOrDefault</c> on <see cref="ProviderSettings"/> lands on an arbitrary
    /// organisation: unscoped there is no row (callers use their no-row defaults), viewing as an organisation only that organisation's row. Everyone else is filtered as usual.
    /// </summary>
    public IQueryable<ProviderSettings> ScopedProviderSettings()
    {
        if (!_tenant.IsSuperAdmin) return ProviderSettings;
        var tenantId = _tenant.TenantId;
        return ProviderSettings.Where(p => tenantId != null && p.TenantId == tenantId);
    }

    public DbSet<PublicHoliday> PublicHolidays => Set<PublicHoliday>();
    public DbSet<PublicHolidayOverride> PublicHolidayOverrides => Set<PublicHolidayOverride>();
    public DbSet<PlanPricingSettings> PlanPricingSettings => Set<PlanPricingSettings>();
    // Participant budgets (phase 1): see Odip.Domain.Funding.FundingEntities.
    public DbSet<FundingPlan> FundingPlans => Set<FundingPlan>();
    public DbSet<FundingPool> FundingPools => Set<FundingPool>();
    public DbSet<FundingPeriod> FundingPeriods => Set<FundingPeriod>();
    public DbSet<BudgetSettings> BudgetSettings => Set<BudgetSettings>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    /// <summary>Public landing-page early-access requests. NOT tenant-scoped: see <see cref="Entities.EarlyAccessRequest"/>'s type doc.</summary>
    public DbSet<EarlyAccessRequest> EarlyAccessRequests => Set<EarlyAccessRequest>();

    /// <summary>Release notes shown in What's new. NOT tenant-scoped: see <see cref="Entities.WhatsNewEntry"/>'s type doc.</summary>
    public DbSet<WhatsNewEntry> WhatsNewEntries => Set<WhatsNewEntry>();

    /// <summary>When each person last opened What's new. Keyed on the user, NOT tenant-scoped.</summary>
    public DbSet<WhatsNewUserState> WhatsNewUserStates => Set<WhatsNewUserState>();
    public DbSet<UserUiPreference> UserUiPreferences => Set<UserUiPreference>();
    public DbSet<EarlyAccessLaterSubmission> EarlyAccessLaterSubmissions => Set<EarlyAccessLaterSubmission>();

    // Rostering (M4)
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ShiftPattern> ShiftPatterns => Set<ShiftPattern>();
    public DbSet<GroupActivity> GroupActivities => Set<GroupActivity>();
    public DbSet<GroupActivityStaff> GroupActivityStaff => Set<GroupActivityStaff>();
    public DbSet<GroupActivitySeries> GroupActivitySeries => Set<GroupActivitySeries>();
    public DbSet<GroupActivitySeriesParticipant> GroupActivitySeriesParticipants => Set<GroupActivitySeriesParticipant>();
    public DbSet<RosterWeek> RosterWeeks => Set<RosterWeek>();
    public DbSet<StaffParticipantCompatibility> StaffParticipantCompatibilities => Set<StaffParticipantCompatibility>();
    public DbSet<ShiftNote> ShiftNotes => Set<ShiftNote>();

    /// <summary>Shift-completion state machine: see <see cref="Rostering.ShiftCompletion"/>'s type doc.</summary>
    public DbSet<ShiftCompletion> ShiftCompletions => Set<ShiftCompletion>();

    /// <summary>Breaks taken during a shift, hung off the active <see cref="ShiftCompletion"/> — see <see cref="Rostering.ShiftBreak"/>'s type doc.</summary>
    public DbSet<ShiftBreak> ShiftBreaks => Set<ShiftBreak>();

    /// <summary>The next worker marking a handover as read - see <see cref="Rostering.HandoverAcknowledgement"/>.</summary>
    public DbSet<HandoverAcknowledgement> HandoverAcknowledgements => Set<HandoverAcknowledgement>();

    /// <summary>Routines a worker ticked off during a shift, hung off the active completion - see <see cref="Rostering.ShiftRoutineCheck"/>.</summary>
    public DbSet<ShiftRoutineCheck> ShiftRoutineChecks => Set<ShiftRoutineCheck>();
    /// <summary>Staff leave + recurring unavailability: see <see cref="Entities.User"/>-scoped <see cref="LeaveRequest"/>.</summary>
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<RecurringUnavailability> RecurringUnavailabilities => Set<RecurringUnavailability>();

    /// <summary>Transactional outbox — see <see cref="NotificationOutbox"/>'s type doc. docs/specs/2026-09-08-notifications-design.md.</summary>
    public DbSet<NotificationOutbox> NotificationOutbox => Set<NotificationOutbox>();

    /// <summary>"Report a problem" notes waiting to go, or already gone, to the Work Board. See <see cref="ProblemReport"/>.</summary>
    public DbSet<ProblemReport> ProblemReports => Set<ProblemReport>();
    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();
    public DbSet<NotificationLog> NotificationLogs => Set<NotificationLog>();
    /// <summary>The bell's inbox — see <see cref="InAppNotification"/>.</summary>
    public DbSet<InAppNotification> InAppNotifications => Set<InAppNotification>();

    /// <summary>Onboarding import batches (Settings → Import data) and the records each created: see <see cref="Entities.ImportBatch"/>.</summary>
    public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();
    public DbSet<PurgeRecord> PurgeRecords => Set<PurgeRecord>();
    public DbSet<ImportBatchItem> ImportBatchItems => Set<ImportBatchItem>();

    /// <summary>Employment Hero Payroll (Settings → Integrations): the connection, the Needs-attention items and the sync log. See Domain/Integrations.</summary>
    public DbSet<EmploymentHeroConnection> EmploymentHeroConnections => Set<EmploymentHeroConnection>();
    public DbSet<EmploymentHeroAttention> EmploymentHeroAttentions => Set<EmploymentHeroAttention>();
    public DbSet<EmploymentHeroSyncLog> EmploymentHeroSyncLogs => Set<EmploymentHeroSyncLog>();
    public DbSet<EmploymentHeroOutbox> EmploymentHeroOutbox => Set<EmploymentHeroOutbox>();

    /// <summary>
    /// Who the audit rows this context writes name when no person did the work (the Employment Hero sync sets "Employment Hero sync"). When set it wins
    /// over the request's user, with no user id. A background context has no HttpContext, so this is the only way it can name an actor.
    /// </summary>
    public string? AuditActorName { get; set; }

    /// <summary>The organisation this request acts in: the view-as organisation for a SuperAdmin; null for an unscoped SuperAdmin (their token still carries a home tenant) and when none is in scope. The audit interceptor stamps it on rows.</summary>
    public Guid? CurrentTenantId => _tenant.IsSuperAdmin ? null : _tenant.TenantId;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        ConfigureParticipants(modelBuilder);
        ConfigureTrips(modelBuilder);
        ConfigureIncidentsAndUsers(modelBuilder);
        ConfigureClaimsAndFunding(modelBuilder);
        ConfigureRostering(modelBuilder);
        ConfigureNotifications(modelBuilder);
        ConfigureParticipantRecords(modelBuilder);
        ConfigureInquiriesAndAgreements(modelBuilder);
        ConfigureAssessmentsAndCompliance(modelBuilder);
        ConfigurePlatform(modelBuilder);
        ConfigureInvoicingAndPayroll(modelBuilder);
        ConfigureTenantFilters(modelBuilder);
        ConfigureTenantFilters2(modelBuilder);
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        // Auto-populate TenantId on new tenant-scoped entities
        if (_tenant.TenantId.HasValue)
        {
            foreach (var entry in ChangeTracker.Entries<ITenantEntity>()
                .Where(e => e.State == EntityState.Added))
            {
                // Only set TenantId if it hasn't been explicitly assigned (e.g. by SuperAdmin)
                if (entry.Entity.TenantId == default)
                    entry.Entity.TenantId = _tenant.TenantId.Value;
            }
        }

        return await base.SaveChangesAsync(cancellationToken);
    }
}
