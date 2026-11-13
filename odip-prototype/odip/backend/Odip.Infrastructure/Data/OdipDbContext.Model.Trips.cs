using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureTrips(ModelBuilder modelBuilder)
    {
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

        // ── ReferralSource ───────────────────────────────────────
        modelBuilder.Entity<ReferralSource>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Cascade);
            // One name once per organisation. The controller also compares case-insensitively; this is the backstop for a race.
            entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();
        });

        // ── ServiceLocation ──────────────────────────────────────
        modelBuilder.Entity<ServiceLocation>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Address).HasMaxLength(300);
            entity.Property(e => e.Latitude).HasPrecision(9, 6);
            entity.Property(e => e.Longitude).HasPrecision(9, 6);
            entity.Property(e => e.TimeZoneId).HasMaxLength(64);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Cascade);
            // One active place per name per organisation. The controller also compares case-insensitively; this is the backstop for a race.
            entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique().HasFilter("\"IsActive\"");
        });

        // ── ComplianceItem ───────────────────────────────────────
        modelBuilder.Entity<ComplianceItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Label).HasMaxLength(120).IsRequired();
            entity.Property(e => e.Reference).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(1000);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.TenantId, e.ExpiresOn });
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
    }
}
