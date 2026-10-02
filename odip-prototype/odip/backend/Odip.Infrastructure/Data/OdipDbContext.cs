using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Odip.Domain.Billing;
using Odip.Domain.Dictionary;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

/// <summary>
/// Primary database context for Odip application.
/// Configures all entity relationships, indexes, and constraints.
/// </summary>
public class OdipDbContext : DbContext
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
    public DbSet<ParticipantOnboarding> ParticipantOnboardings => Set<ParticipantOnboarding>();
    public DbSet<ParticipantIntakeSnapshot> ParticipantIntakeSnapshots => Set<ParticipantIntakeSnapshot>();
    public DbSet<ServiceAgreementDraft> ServiceAgreementDrafts => Set<ServiceAgreementDraft>();
    public DbSet<ServiceAgreementDraftLine> ServiceAgreementDraftLines => Set<ServiceAgreementDraftLine>();
    public DbSet<ElectronicSigningSnapshot> ElectronicSigningSnapshots => Set<ElectronicSigningSnapshot>();
    public DbSet<ElectronicSigningEvidence> ElectronicSigningEvidence => Set<ElectronicSigningEvidence>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<ParticipantContact> ParticipantContacts => Set<ParticipantContact>();
    // CONTACT-01/02/03 — see Person/ParticipantContactRole's type docs for why this is a separate
    // model from Contact/ParticipantContact above rather than a replacement of it.
    public DbSet<Person> People => Set<Person>();
    public DbSet<ParticipantContactRole> ParticipantContactRoles => Set<ParticipantContactRole>();
    public DbSet<SupportProfile> SupportProfiles => Set<SupportProfile>();
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
    public DbSet<BookingTask> BookingTasks => Set<BookingTask>();
    public DbSet<TripDocument> TripDocuments => Set<TripDocument>();
    public DbSet<User> Users => Set<User>();
    public DbSet<IncidentReport> IncidentReports => Set<IncidentReport>();
    /// <summary>IN-5: see <see cref="Entities.IncidentInjury"/>'s type doc.</summary>
    public DbSet<IncidentInjury> IncidentInjuries => Set<IncidentInjury>();
    /// <summary>IN-7: see <see cref="Entities.IncidentWitness"/>'s type doc.</summary>
    public DbSet<IncidentWitness> IncidentWitnesses => Set<IncidentWitness>();
    /// <summary>Caregiver profile form: see <see cref="Entities.CaregiverProfileSubmission"/>.</summary>
    public DbSet<CaregiverProfileSubmission> CaregiverProfileSubmissions => Set<CaregiverProfileSubmission>();
    public DbSet<AppSettings> AppSettings => Set<AppSettings>();
    public DbSet<TripClaim> TripClaims => Set<TripClaim>();
    public DbSet<ClaimLineItem> ClaimLineItems => Set<ClaimLineItem>();
    public DbSet<SupportActivityGroup> SupportActivityGroups => Set<SupportActivityGroup>();
    public DbSet<SupportCatalogueItem> SupportCatalogueItems => Set<SupportCatalogueItem>();
    public DbSet<ProviderSettings> ProviderSettings => Set<ProviderSettings>();
    public DbSet<PublicHoliday> PublicHolidays => Set<PublicHoliday>();
    public DbSet<PublicHolidayOverride> PublicHolidayOverrides => Set<PublicHolidayOverride>();
    public DbSet<PlanPricingSettings> PlanPricingSettings => Set<PlanPricingSettings>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    /// <summary>Public landing-page early-access requests. NOT tenant-scoped: see <see cref="Entities.EarlyAccessRequest"/>'s type doc.</summary>
    public DbSet<EarlyAccessRequest> EarlyAccessRequests => Set<EarlyAccessRequest>();

    // Billing
    public DbSet<FundingSource> FundingSources => Set<FundingSource>();
    public DbSet<ServiceBooking> ServiceBookings => Set<ServiceBooking>();
    public DbSet<ServiceBookingLine> ServiceBookingLines => Set<ServiceBookingLine>();
    public DbSet<BillableEvent> BillableEvents => Set<BillableEvent>();
    public DbSet<ClaimBatch> ClaimBatches => Set<ClaimBatch>();

    // Dictionary / forms engine
    public DbSet<FieldDefinition> FieldDefinitions => Set<FieldDefinition>();
    public DbSet<FieldValue> FieldValues => Set<FieldValue>();
    public DbSet<FormTemplate> FormTemplates => Set<FormTemplate>();

    // Rostering (M4)
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ShiftPattern> ShiftPatterns => Set<ShiftPattern>();
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
    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();
    public DbSet<NotificationLog> NotificationLogs => Set<NotificationLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // ── Participant ──────────────────────────────────────────
        modelBuilder.Entity<Participant>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.PreferredName).HasMaxLength(100);
            entity.Property(e => e.NdisNumber).HasMaxLength(20);
            entity.Property(e => e.Region).HasMaxLength(100);
            entity.Property(e => e.FundingOrganisation).HasMaxLength(200);
            entity.Property(e => e.MobilitySupportOptions).HasColumnType("text[]");
            // DIAG-01
            entity.Property(e => e.PrimaryDiagnosis).HasMaxLength(200);
            entity.Property(e => e.OtherDiagnoses).HasColumnType("text[]");
            // LIVING-02/03/04
            entity.Property(e => e.MainSupportPersonName).HasMaxLength(200);
            entity.Property(e => e.MainSupportPersonRelationship).HasMaxLength(100);
            entity.Property(e => e.WhoLivesWith).HasMaxLength(2000);
            entity.Property(e => e.SilProviderName).HasMaxLength(200);
            entity.Property(e => e.SilProviderContactPhone).HasMaxLength(20);
            entity.Property(e => e.AccommodationType).HasMaxLength(100);
            entity.Property(e => e.OnSiteSupportHours).HasMaxLength(100);
            entity.Property(e => e.LivingArrangementNotes).HasMaxLength(2000);
            // INTAKE-06
            entity.Property(e => e.AddressStreet).HasMaxLength(200);
            entity.Property(e => e.AddressSuburb).HasMaxLength(100);
            entity.Property(e => e.AddressState).HasMaxLength(10);
            entity.Property(e => e.AddressPostcode).HasMaxLength(4);
            // INTAKE sub-wave A — Participant Details additions.
            entity.Property(e => e.MiddleName).HasMaxLength(100);
            entity.Property(e => e.PlaceOfBirth).HasMaxLength(200);
            entity.Property(e => e.Country).HasMaxLength(100);
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Email).HasMaxLength(200);
            // INTAKE sub-wave A — Key Identifiers step.
            entity.Property(e => e.PensionCardNumber).HasMaxLength(50);
            entity.Property(e => e.MedicareNumber).HasMaxLength(50);
            entity.Property(e => e.CompanionCardNumber).HasMaxLength(50);
            entity.Property(e => e.PrivateHealthFund).HasMaxLength(100);
            entity.Property(e => e.PrivateHealthMembershipNumber).HasMaxLength(50);
            entity.Property(e => e.TaxiCardNumber).HasMaxLength(50);
            entity.Property(e => e.HairColour).HasMaxLength(50);
            entity.Property(e => e.EyeColour).HasMaxLength(50);
            entity.Property(e => e.WeightKg).HasPrecision(5, 2);
            entity.Property(e => e.HeightCm).HasPrecision(5, 2);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.Region);
            entity.HasIndex(e => e.NdisNumber);
            entity.HasIndex(e => e.SupportRatio);
        });

        // ── Contact ──────────────────────────────────────────────
        modelBuilder.Entity<Contact>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.Mobile).HasMaxLength(20);
            entity.Property(e => e.Phone).HasMaxLength(20);
            entity.Property(e => e.Organisation).HasMaxLength(200);
            entity.Property(e => e.RoleRelationship).HasMaxLength(100);
            entity.Property(e => e.Suburb).HasMaxLength(100);
            entity.Property(e => e.State).HasMaxLength(10);
            entity.Property(e => e.Postcode).HasMaxLength(10);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.IsActive);
        });

        // ── ParticipantContact (M:N join) ────────────────────────
        modelBuilder.Entity<ParticipantContact>(entity =>
        {
            entity.HasKey(e => new { e.ParticipantId, e.ContactId });

            entity.HasOne(e => e.Participant)
                .WithMany(p => p.ParticipantContacts)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Contact)
                .WithMany(c => c.ParticipantContacts)
                .HasForeignKey(e => e.ContactId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // ── Person (CONTACT-01/02/03) ─────────────────────────────
        modelBuilder.Entity<Person>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Mobile).HasMaxLength(30);
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.AddressLine).HasMaxLength(200);
            entity.Property(e => e.Suburb).HasMaxLength(100);
            entity.Property(e => e.State).HasMaxLength(10);
            entity.Property(e => e.Postcode).HasMaxLength(4);
            entity.Property(e => e.Organisation).HasMaxLength(200);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.LastName);
        });

        // ── ParticipantContactRole (CONTACT-01/02/03) ─────────────
        modelBuilder.Entity<ParticipantContactRole>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RelationshipToParticipant).HasMaxLength(100);
            entity.Property(e => e.AppointingTribunal).HasMaxLength(50);
            entity.Property(e => e.OrderScopeDomains).HasColumnType("text[]");
            entity.Property(e => e.ReasonForAppointment).HasMaxLength(500);
            entity.Property(e => e.AlternateRepresentativeName).HasMaxLength(200);
            entity.Property(e => e.FundingLineItemType).HasMaxLength(100);
            entity.Property(e => e.OrganisationName).HasMaxLength(200);
            entity.Property(e => e.RegistrationNumber).HasMaxLength(100);
            entity.Property(e => e.Discipline).HasMaxLength(100);
            entity.Property(e => e.FrequencyOfContact).HasMaxLength(200);
            entity.Property(e => e.RoleTitle).HasMaxLength(100);
            entity.Property(e => e.ScopeNotes).HasMaxLength(500);
            entity.Property(e => e.AuthorisationDocumentReference).HasMaxLength(200);
            entity.Property(e => e.PreferredLanguage).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            // Restrict, same idiom as ParticipantNote/ParticipantRoutine/ParticipantRiskEntry →
            // Participant — a participant with contact-role history must not be silently
            // cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.ContactRoles)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            // Restrict, not Cascade: a Person referenced by role rows must not silently disappear
            // rows out from under an audit trail — the frontend blocks deleting a Person still in
            // use instead (there is no Person delete endpoint at all for CONTACT-01's MVP).
            entity.HasOne(e => e.Person)
                .WithMany(p => p.ContactRoles)
                .HasForeignKey(e => e.PersonId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.PersonId);
            entity.HasIndex(e => e.RoleType);
        });

        // ── SupportProfile (1:1 with Participant) ────────────────
        modelBuilder.Entity<SupportProfile>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.Participant)
                .WithOne(p => p.SupportProfile)
                .HasForeignKey<SupportProfile>(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => e.ParticipantId).IsUnique();
        });

        // ── EventTemplate ────────────────────────────────────────
        modelBuilder.Entity<EventTemplate>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EventCode).HasMaxLength(20).IsRequired();
            entity.Property(e => e.EventName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.DefaultDestination).HasMaxLength(200);
            entity.Property(e => e.DefaultRegion).HasMaxLength(100);
            entity.Property(e => e.PreferredTimeOfYear).HasMaxLength(100);

            entity.HasIndex(e => e.EventCode).IsUnique();
            entity.HasIndex(e => e.IsActive);
        });

        // ── TripInstance ─────────────────────────────────────────
        modelBuilder.Entity<TripInstance>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TripName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.TripCode).HasMaxLength(20);
            entity.Property(e => e.Destination).HasMaxLength(200);
            entity.Property(e => e.Region).HasMaxLength(100);
            entity.Ignore(e => e.EndDate);
            entity.Ignore(e => e.OopDueDate);

            entity.HasOne(e => e.EventTemplate)
                .WithMany(t => t.TripInstances)
                .HasForeignKey(e => e.EventTemplateId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.LeadCoordinator)
                .WithMany()
                .HasForeignKey(e => e.LeadCoordinatorId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.StartDate);
            entity.HasIndex(e => e.Region);
            entity.HasIndex(e => e.TripCode).IsUnique().HasFilter("\"TripCode\" IS NOT NULL");
        });

        // ── ParticipantBooking ───────────────────────────────────
        modelBuilder.Entity<ParticipantBooking>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.Bookings)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Participant)
                .WithMany(p => p.Bookings)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => e.BookingStatus);
            entity.HasIndex(e => e.InsuranceStatus);
            entity.HasIndex(e => new { e.TripInstanceId, e.ParticipantId }).IsUnique();
        });

        // ── AccommodationProperty ────────────────────────────────
        modelBuilder.Entity<AccommodationProperty>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.PropertyName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.ProviderOwner).HasMaxLength(200);
            entity.Property(e => e.Location).HasMaxLength(200);
            entity.Property(e => e.Region).HasMaxLength(100);
            entity.Property(e => e.Suburb).HasMaxLength(100);
            entity.Property(e => e.State).HasMaxLength(10);
            entity.Property(e => e.Postcode).HasMaxLength(10);
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.Phone).HasMaxLength(20);
            entity.Property(e => e.Mobile).HasMaxLength(20);
            entity.Property(e => e.Website).HasMaxLength(300);

            entity.HasIndex(e => e.Region);
            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.IsWheelchairAccessible);
        });

        // ── AccommodationReservation ─────────────────────────────
        modelBuilder.Entity<AccommodationReservation>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Cost).HasPrecision(18, 2);
            entity.Property(e => e.ConfirmationReference).HasMaxLength(100);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.AccommodationReservations)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.AccommodationProperty)
                .WithMany(a => a.Reservations)
                .HasForeignKey(e => e.AccommodationPropertyId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ReservationStatus);
            entity.HasIndex(e => new { e.AccommodationPropertyId, e.CheckInDate, e.CheckOutDate });
        });

        // ── Vehicle ──────────────────────────────────────────────
        modelBuilder.Entity<Vehicle>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.VehicleName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Registration).HasMaxLength(20);

            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.VehicleType);
        });

        // ── VehicleAssignment ────────────────────────────────────
        modelBuilder.Entity<VehicleAssignment>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.VehicleAssignments)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Vehicle)
                .WithMany(v => v.Assignments)
                .HasForeignKey(e => e.VehicleId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.DriverUser)
                .WithMany()
                .HasForeignKey(e => e.DriverUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);

            entity.HasIndex(e => e.Status);
        });

        // ── StaffAvailability ────────────────────────────────────
        modelBuilder.Entity<StaffAvailability>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => new { e.UserId, e.StartDateTime, e.EndDateTime });
            entity.HasIndex(e => e.AvailabilityType);
        });

        // ── StaffAssignment ─────────────────────────────────────
        modelBuilder.Entity<StaffAssignment>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.StaffAssignments)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => new { e.UserId, e.AssignmentStart, e.AssignmentEnd });
        });

        // ── TripDay ──────────────────────────────────────────────
        modelBuilder.Entity<TripDay>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.TripDays)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => new { e.TripInstanceId, e.DayNumber }).IsUnique();
        });

        // ── ScheduledActivity ────────────────────────────────────
        modelBuilder.Entity<ScheduledActivity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(200).IsRequired();

            entity.HasOne(e => e.TripDay)
                .WithMany(d => d.ScheduledActivities)
                .HasForeignKey(e => e.TripDayId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Activity)
                .WithMany(a => a.ScheduledActivities)
                .HasForeignKey(e => e.ActivityId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.SortOrder);
            entity.Property(e => e.Status).HasDefaultValue(ScheduledActivityStatus.Planned);
            entity.Property(e => e.BookingReference).HasMaxLength(200);
            entity.Property(e => e.ProviderName).HasMaxLength(200);
            entity.Property(e => e.ProviderPhone).HasMaxLength(50);
            entity.Property(e => e.ProviderEmail).HasMaxLength(200);
            entity.Property(e => e.ProviderWebsite).HasMaxLength(500);
            entity.Property(e => e.EstimatedCost).HasPrecision(18, 2);
            entity.HasIndex(e => e.Status);
        });

        // ── Activity ─────────────────────────────────────────────
        modelBuilder.Entity<Activity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ActivityName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Location).HasMaxLength(200);

            entity.HasOne(e => e.EventTemplate)
                .WithMany(t => t.Activities)
                .HasForeignKey(e => e.EventTemplateId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.Category);
            entity.HasIndex(e => e.IsActive);
        });

        // ── BookingTask ──────────────────────────────────────────
        modelBuilder.Entity<BookingTask>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(300).IsRequired();

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.Tasks)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.ParticipantBooking)
                .WithMany(b => b.Tasks)
                .HasForeignKey(e => e.ParticipantBookingId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.AccommodationReservation)
                .WithMany(r => r.Tasks)
                .HasForeignKey(e => e.AccommodationReservationId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.VehicleAssignment)
                .WithMany(v => v.Tasks)
                .HasForeignKey(e => e.VehicleAssignmentId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.StaffAssignment)
                .WithMany(s => s.Tasks)
                .HasForeignKey(e => e.StaffAssignmentId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.Owner)
                .WithMany()
                .HasForeignKey(e => e.OwnerId)
                .OnDelete(DeleteBehavior.SetNull);

            // Generic obligation source links (item 9) — SetNull, same idiom as the other
            // optional FKs above: losing the source row (shift deleted, etc.) should orphan the
            // task rather than take it down with it.
            entity.HasOne(e => e.Shift)
                .WithMany()
                .HasForeignKey(e => e.ShiftId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.IncidentReport)
                .WithMany()
                .HasForeignKey(e => e.IncidentReportId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.MedicationAdministration)
                .WithMany()
                .HasForeignKey(e => e.MedicationAdministrationId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.ShiftNote)
                .WithMany()
                .HasForeignKey(e => e.ShiftNoteId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.LeaveRequest)
                .WithMany()
                .HasForeignKey(e => e.LeaveRequestId)
                .OnDelete(DeleteBehavior.SetNull);

            // Idempotency key for IObligationTaskService.EnsureAsync — unique where not null
            // (manually-created trip/booking tasks leave SourceKey null and are unconstrained).
            entity.HasIndex(e => e.SourceKey).IsUnique().HasFilter("\"SourceKey\" IS NOT NULL");

            entity.HasIndex(e => e.ShiftId);
            entity.HasIndex(e => e.IncidentReportId);
            entity.HasIndex(e => e.MedicationAdministrationId);
            entity.HasIndex(e => e.ShiftNoteId);
            entity.HasIndex(e => e.LeaveRequestId);

            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.DueDate);
            entity.HasIndex(e => e.Priority);
            entity.HasIndex(e => e.TaskType);
        });

        // ── TripDocument ─────────────────────────────────────────
        modelBuilder.Entity<TripDocument>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(300).IsRequired();
            entity.Property(e => e.FilePath).HasMaxLength(500);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.Documents)
                .HasForeignKey(e => e.TripInstanceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.ParticipantBooking)
                .WithMany(b => b.Documents)
                .HasForeignKey(e => e.ParticipantBookingId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(e => e.DocumentType);
        });

        // ── IncidentReport ───────────────────────────────────────
        modelBuilder.Entity<IncidentReport>(e =>
        {
            e.HasKey(i => i.Id);
            e.Property(i => i.Title).HasMaxLength(300).IsRequired();

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
            e.Property(x => x.StatementText).HasMaxLength(4000);

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
        });

        // ── TripClaim ─────────────────────────────────────────────
        modelBuilder.Entity<TripClaim>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ClaimReference).HasMaxLength(50).IsRequired();
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.Property(e => e.TotalApprovedAmount).HasPrecision(18, 2);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            entity.HasOne(e => e.TripInstance)
                .WithMany(t => t.TripClaims)
                .HasForeignKey(e => e.TripInstanceId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Cascade);

            // Shift-completion design spec §1 (PR 3) — Kind == Shift claims key off Participant
            // + a date range instead of a TripInstance. TripClaim is deliberately NOT
            // ITenantEntity (standing ruling); callers must scope through the tenant-filtered
            // Participants/Shifts sets.
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
                "CK_ClaimLineItem_ExactlyOneParent",
                "((\"ParticipantBookingId\" IS NOT NULL)::int + (\"ShiftId\" IS NOT NULL)::int) = 1"));

            entity.HasIndex(e => e.TripClaimId);
            entity.HasIndex(e => e.ParticipantBookingId);
            entity.HasIndex(e => e.ShiftId);
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
            // NOT NULL with a constant database default (0 = Warn), so the migration is a
            // metadata-only add on PostgreSQL and every existing row, and any row written by an
            // older build during a rolling deploy, reads back as Warn. Stored as the enum's integer.
            entity.Property(e => e.ParticipantReadinessMode)
                .IsRequired()
                .HasDefaultValue(ParticipantReadinessMode.Warn);
            // NOT NULL DEFAULT 0 (= Warn): a constant default, so the column is added without rewriting the table.
            entity.Property(e => e.MedicationCompetencyMode).HasDefaultValue(MedicationCompetencyMode.Warn);

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

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.TenantId).IsUnique();
        });

        // ── AuditLog ─────────────────────────────────────────────
        // Column types must match the "AddAuditLog" migration exactly (varchar(100)/varchar(20)/
        // varchar(200)/text) since we cannot add a new migration to reconcile a mismatch — in
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
        });

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

        // ── FundingSource ────────────────────────────────────────
        modelBuilder.Entity<FundingSource>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.BudgetCategory).HasMaxLength(200);
            entity.Property(e => e.NdisPlanNumber).HasMaxLength(50);
            entity.Property(e => e.Budget).HasPrecision(18, 2);
            entity.Property(e => e.PayerName).HasMaxLength(200);
            entity.Property(e => e.PayerEmail).HasMaxLength(200);

            // Restrict: a FundingSource is the root of a participant's billing/claim
            // history (ServiceBookings and BillableEvents hang off it) — deleting the
            // participant must not silently cascade that history away.
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.IsActive);
        });

        // ── ServiceBooking ───────────────────────────────────────
        modelBuilder.Entity<ServiceBooking>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProdaBookingReference).HasMaxLength(50).IsRequired();
            entity.Ignore(e => e.ClaimDeadline);

            // Restrict: the booking tracks claimed-vs-allocated balance (the #1
            // documented PRODA rejection cause) — it must not vanish just because its
            // FundingSource row is removed.
            entity.HasOne(e => e.FundingSource)
                .WithMany()
                .HasForeignKey(e => e.FundingSourceId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.FundingSourceId);
            entity.HasIndex(e => e.ProdaBookingReference);
        });

        // ── ServiceBookingLine ───────────────────────────────────
        // Own DbSet (not owned): it already carries its own Guid Id and an explicit
        // ServiceBookingId FK in the domain type, i.e. it is shaped as a normal
        // dependent entity rather than a value object — same idiom as ClaimLineItem.
        modelBuilder.Entity<ServiceBookingLine>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SupportItemNumber).HasMaxLength(50).IsRequired();
            entity.Property(e => e.AllocatedAmount).HasPrecision(18, 2);
            entity.Property(e => e.ClaimedAmount).HasPrecision(18, 2);
            entity.Ignore(e => e.RemainingAmount);

            // Cascade: lines have no independent existence outside their booking
            // (mirrors ClaimLineItem → TripClaim).
            entity.HasOne(e => e.ServiceBooking)
                .WithMany(b => b.Lines)
                .HasForeignKey(e => e.ServiceBookingId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => e.ServiceBookingId);
        });

        // ── BillableEvent ────────────────────────────────────────
        modelBuilder.Entity<BillableEvent>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SupportItemNumber).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SourceEntityType).HasMaxLength(100);
            entity.Property(e => e.Quantity).HasPrecision(18, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(18, 2);
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.Property(e => e.CancellationReasonCode).HasMaxLength(50);
            entity.Property(e => e.ClaimReference).HasMaxLength(100).IsRequired();
            entity.Property(e => e.RejectionReason).HasMaxLength(1000);

            // Restrict everywhere below: BillableEvent is the universal billing unit
            // (the financial record itself) — none of its parents may cascade-delete it.
            entity.HasOne(e => e.FundingSource)
                .WithMany()
                .HasForeignKey(e => e.FundingSourceId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<Participant>()
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<ServiceBooking>()
                .WithMany()
                .HasForeignKey(e => e.ServiceBookingId)
                .OnDelete(DeleteBehavior.Restrict);

            // ClaimBatch → BillableEvent: BillableEvent has no ClaimBatchId property
            // (only ClaimBatch.Events is navigable), so the FK is a shadow property.
            // Restrict per spec: a ClaimBatch already submitted to PRODA must not
            // silently cascade-delete the BillableEvent rows that make up the claim.
            entity.HasOne<ClaimBatch>()
                .WithMany(b => b.Events)
                .HasForeignKey("ClaimBatchId")
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.FundingSourceId);
            entity.HasIndex(e => e.ServiceBookingId);
            entity.HasIndex(e => e.ClaimReference);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.Stream);
        });

        // ── ClaimBatch ───────────────────────────────────────────
        modelBuilder.Entity<ClaimBatch>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(100).IsRequired();

            entity.HasIndex(e => e.FileName);
            entity.HasIndex(e => e.SubmittedAt);
        });

        // ── FieldDefinition ──────────────────────────────────────
        modelBuilder.Entity<FieldDefinition>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FieldId).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(300).IsRequired();
            entity.Property(e => e.Domain).HasMaxLength(100).IsRequired();
            entity.Property(e => e.PicklistOptionsRaw).HasMaxLength(2000);
            entity.Property(e => e.Comments).HasMaxLength(2000);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            // Natively mapped to a Postgres array, same idiom as
            // Participant.MobilitySupportOptions.
            entity.Property(e => e.AppearsInForms).HasColumnType("text[]");
            entity.Ignore(e => e.PicklistOptions);

            // FieldId is unique per tenant (per the domain type's own doc comment).
            entity.HasIndex(e => new { e.TenantId, e.FieldId }).IsUnique();
            entity.HasIndex(e => e.Domain);
            entity.HasIndex(e => e.IsActive);
        });

        // ── FieldValue ───────────────────────────────────────────
        modelBuilder.Entity<FieldValue>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.UpdatedBy).HasMaxLength(200);
            // Value is intentionally left unbounded (EAV values vary widely by
            // FieldDefinition.DataType, e.g. multi-select lists serialised as text).

            // Restrict: a field definition still referenced by recorded values must
            // not be deleted out from under them (data-integrity guard on the registry).
            entity.HasOne<FieldDefinition>()
                .WithMany()
                .HasForeignKey(e => e.FieldDefinitionId)
                .OnDelete(DeleteBehavior.Restrict);

            // Cascade: form-driven field values are participant-owned data with no
            // independent existence once the participant is gone — same idiom as
            // SupportProfile → Participant.
            entity.HasOne<Participant>()
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            // One recorded value per participant/field pair.
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.FieldDefinitionId }).IsUnique();
            entity.HasIndex(e => e.FieldDefinitionId);
        });

        // ── FormTemplate ─────────────────────────────────────────
        // Sections is a list of plain (non-entity) FormSection value objects — mapped
        // as a JSON column via a value converter (Npgsql has no native array support
        // for complex types, unlike the string[]/text[] mapping used above).
        var formSectionsComparer = new ValueComparer<List<FormSection>>(
            (a, b) => JsonSerializer.Serialize(a, (JsonSerializerOptions?)null) == JsonSerializer.Serialize(b, (JsonSerializerOptions?)null),
            v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null).GetHashCode(),
            v => JsonSerializer.Deserialize<List<FormSection>>(JsonSerializer.Serialize(v, (JsonSerializerOptions?)null), (JsonSerializerOptions?)null) ?? new List<FormSection>());

        modelBuilder.Entity<FormTemplate>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);

            var sectionsProperty = entity.Property(e => e.Sections)
                .HasConversion(
                    v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                    v => JsonSerializer.Deserialize<List<FormSection>>(v, (JsonSerializerOptions?)null) ?? new List<FormSection>())
                .HasColumnType("jsonb");
            sectionsProperty.Metadata.SetValueComparer(formSectionsComparer);

            entity.HasIndex(e => e.Name);
        });

        // ── Shift ────────────────────────────────────────────────
        modelBuilder.Entity<Shift>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);
            // Computed from StartTime/EndTime/EndsNextDay — never persisted.
            entity.Ignore(e => e.DurationHours);

            // Restrict: a rostered participant or staff member must not be silently
            // cascade-deleted out from under their shifts (same idiom as FundingSource →
            // Participant and StaffAssignment → User above).
            entity.HasOne(e => e.Participant)
                .WithMany()
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Board queries filter by day/week; the roster-check helper filters by staff+week.
            entity.HasIndex(e => new { e.TenantId, e.ServiceDate });
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.ServiceDate });
            // Pattern generation idempotency check: "does this pattern already have a shift on this date".
            entity.HasIndex(e => new { e.ShiftPatternId, e.ServiceDate });
            // Review-queue filter (design spec §2, GetCompletions): status + date-range scan, tenant-scoped.
            entity.HasIndex(e => new { e.TenantId, e.Status, e.ServiceDate });
        });

        // ── ShiftPattern ─────────────────────────────────────────
        modelBuilder.Entity<ShiftPattern>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Notes).HasMaxLength(2000);

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

        // ── Notifications (outbox + preferences + delivery log) ────
        // docs/specs/2026-09-08-notifications-design.md §1.
        modelBuilder.Entity<NotificationOutbox>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EntityType).HasMaxLength(100);
            entity.Property(e => e.LastError).HasMaxLength(2000);

            entity.HasIndex(e => new { e.Status, e.NextAttemptAt });                              // dispatcher poll
            entity.HasIndex(e => new { e.TenantId, e.EventType, e.EntityId, e.RecipientUserId, e.CreatedAt });  // dedupe lookup
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

        // ── StaffAssignment override fields (PR 3 wires the gate; columns land now) ──
        modelBuilder.Entity<StaffAssignment>(entity =>
        {
            entity.Property(e => e.OverrideReason).HasMaxLength(2000);
            entity.Property(e => e.AcknowledgedFindingCodes).HasMaxLength(500);
        });

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
            // FundingSource/Shift → Participant above).
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

        // ── Participant lifecycle foundation ───────────────────────
        modelBuilder.Entity<ParticipantInquiry>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Phone).HasMaxLength(50);
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.Source).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Provenance).HasMaxLength(2000);
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId });
        });
        modelBuilder.Entity<ParticipantOnboarding>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProfileCompletedBy).HasMaxLength(200);
            entity.Property(e => e.ServiceTypeConfirmedBy).HasMaxLength(200);
            entity.Property(e => e.ServiceAgreementSignedBy).HasMaxLength(200);
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ParticipantId).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId }).IsUnique();
        });
        modelBuilder.Entity<ParticipantIntakeSnapshot>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CompletedAtUtc).HasColumnType("timestamp with time zone");
            entity.Property(e => e.CompletedBy).HasMaxLength(200).IsRequired();
            entity.Property(e => e.RequestId).HasMaxLength(100).IsRequired();
            entity.Property(e => e.ContentHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.SnapshotJson).IsRequired();
            entity.Property(e => e.PdfContent).IsRequired();
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.Revision }).IsUnique();
            entity.HasIndex(e => new { e.ParticipantId, e.RequestId }).IsUnique();
        });
        modelBuilder.Entity<ServiceAgreementDraft>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.State).HasMaxLength(3).IsRequired();
            entity.Property(e => e.ServiceTypesJson).HasMaxLength(4000).IsRequired();
            entity.Property(e => e.Representative).HasMaxLength(500);
            entity.Property(e => e.ParticipantNameSnapshot).HasMaxLength(300).IsRequired();
            entity.Property(e => e.NdisNumberSnapshot).HasMaxLength(100);
            entity.Property(e => e.CreatedBy).HasMaxLength(200).IsRequired();
            entity.HasOne(e => e.Participant).WithMany().HasForeignKey(e => e.ParticipantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.TenantId, e.ParticipantId, e.Version }).IsUnique();
        });
        modelBuilder.Entity<ServiceAgreementDraftLine>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ServiceType).HasMaxLength(200).IsRequired();
            entity.Property(e => e.ItemCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.CatalogueVersion).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(12, 2);
            entity.Property(e => e.UnitPrice).HasPrecision(12, 2);
            entity.HasOne(e => e.Draft).WithMany(e => e.Lines).HasForeignKey(e => e.DraftId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.DraftId);
        });
        modelBuilder.Entity<ElectronicSigningSnapshot>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.DocumentJson).IsRequired();
            entity.Property(e => e.DocumentHash).HasMaxLength(64).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.DraftId, e.DraftVersion }).IsUnique();
        });
        modelBuilder.Entity<ElectronicSigningEvidence>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.IdempotencyKey).HasMaxLength(200).IsRequired();
            entity.Property(e => e.SignerName).HasMaxLength(300).IsRequired();
            entity.Property(e => e.SignerCapacity).HasMaxLength(200).IsRequired();
            entity.Property(e => e.EvidenceHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.PreviousEvidenceHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(50).IsRequired();
            entity.HasOne(e => e.Snapshot).WithMany(e => e.Evidence).HasForeignKey(e => e.SnapshotId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.SnapshotId, e.IdempotencyKey }).IsUnique();
        });

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

        // ── RestrictivePractice ───────────────────────────────────
        modelBuilder.Entity<RestrictivePractice>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Description).HasMaxLength(2000).IsRequired();
            entity.Property(e => e.AuthorisedBy).HasMaxLength(200);

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
            entity.HasIndex(e => e.RelatedMedicationId);
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
            // Concurrency token: two simultaneous repeat submissions from one address must both be
            // counted. The loser's UPDATE matches no row, EF throws DbUpdateConcurrencyException and
            // EarlyAccessService retries against the fresh count instead of losing an increment.
            entity.Property(e => e.RequestCount).IsConcurrencyToken();
            // Email is stored trimmed + lower-cased, so a plain unique index is case-insensitive in effect.
            entity.HasIndex(e => e.Email).IsUnique();
        });

        // ── Multi-Tenancy Query Filters ─────────────────────────────────────────────
        // Applied to all root aggregate entities. SuperAdmin bypasses all filters.

        modelBuilder.Entity<User>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<User>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<Participant>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Participant>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantInquiry>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantOnboarding>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantIntakeSnapshot>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ServiceAgreementDraft>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ElectronicSigningSnapshot>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ElectronicSigningEvidence>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        // TenantId index for CaregiverProfileSubmission is declared on its own configuration
        // block above, so only the query filter is added here.
        modelBuilder.Entity<CaregiverProfileSubmission>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        modelBuilder.Entity<Vehicle>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Vehicle>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<AccommodationProperty>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<AccommodationProperty>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<EventTemplate>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<EventTemplate>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<TripInstance>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<TripInstance>()
            .HasIndex(e => e.TenantId);

        // BookingTask (item 9 of the connection map): was previously scoped only through its
        // required TripInstance FK. Now that TripInstanceId is optional (generic obligation
        // tasks have no trip), it needs its own TenantId — auto-stamped on insert by
        // SaveChangesAsync below, same as every other row here.
        modelBuilder.Entity<BookingTask>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<BookingTask>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<AppSettings>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<AppSettings>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ProviderSettings>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ProviderSettings>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<PlanPricingSettings>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);

        // Tenants table — unique index on EmailDomain
        modelBuilder.Entity<Tenant>()
            .HasIndex(t => t.EmailDomain).IsUnique();

        // ── Billing / Dictionary tenant query filters ─────────────────────────────
        modelBuilder.Entity<FundingSource>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<FundingSource>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ServiceBooking>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ServiceBooking>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<BillableEvent>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<BillableEvent>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ClaimBatch>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ClaimBatch>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<FieldDefinition>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<FieldDefinition>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<FieldValue>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<FieldValue>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<FormTemplate>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<FormTemplate>()
            .HasIndex(e => e.TenantId);

        // ── Rostering tenant query filters ────────────────────────────────────────
        modelBuilder.Entity<Shift>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Shift>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftPattern>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftPattern>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<StaffParticipantCompatibility>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<StaffParticipantCompatibility>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftNote>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftNote>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftCompletion>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftCompletion>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftBreak>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftBreak>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<HandoverAcknowledgement>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<HandoverAcknowledgement>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ShiftRoutineCheck>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ShiftRoutineCheck>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<LeaveRequest>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<LeaveRequest>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RecurringUnavailability>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<RecurringUnavailability>()
            .HasIndex(e => e.TenantId);

        // ── Notifications tenant query filters ─────────────────────────────────────
        modelBuilder.Entity<NotificationOutbox>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<NotificationOutbox>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<NotificationPreference>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<NotificationPreference>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<NotificationLog>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<NotificationLog>()
            .HasIndex(e => e.TenantId);

        // ── Medication Management tenant query filters ────────────────────────────
        modelBuilder.Entity<ParticipantMedication>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantMedication>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<MedicationAdministration>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<MedicationAdministration>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantNote>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantNote>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantRoutine>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantRoutine>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantRiskEntry>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantRiskEntry>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantConsent>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantConsent>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantHealthCondition>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantHealthCondition>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantAdlAssessment>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantAdlAssessment>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantChecklistItem>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantChecklistItem>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantCommunityAccessRiskItem>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantCommunityAccessRiskItem>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<RestrictivePractice>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<RestrictivePractice>()
            .HasIndex(e => e.TenantId);

        // ── Contacts (CONTACT-01/02/03) tenant query filters ───────────────────────
        modelBuilder.Entity<Person>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<Person>()
            .HasIndex(e => e.TenantId);

        modelBuilder.Entity<ParticipantContactRole>()
            .HasQueryFilter(e => _tenant.IsSuperAdmin || e.TenantId == _tenant.TenantId);
        modelBuilder.Entity<ParticipantContactRole>()
            .HasIndex(e => e.TenantId);
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
