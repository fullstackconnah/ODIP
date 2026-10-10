using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// The tenant guards against a real PostgreSQL (skipped, never failed, when POSTGRES_CONNECTION_STRING is unset): every guard is a correlated sub-query over a tenant-filtered set,
/// and EF InMemory cannot say whether it translates to SQL or whether the joins that scope the other reads (a required navigation to a filtered parent) behave the same there.
/// Organisation A calls the routes; every row they ask for belongs to organisation B, and A's own rows are reachable through the same code.
/// </summary>
public class CrossTenantPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public CrossTenantPostgresTests(PostgresFixture pg) => _pg = pg;

    private static OdipDbContext TenantDb(string connectionString, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(connectionString, tenant.Object);
    }

    private sealed record Org(User User, Participant Participant, TripInstance Trip, ParticipantBooking Booking, TripClaim Claim, ClaimLineItem Line, Vehicle Vehicle, VehicleAssignment VehicleAssignment,
        StaffAssignment StaffAssignment, StaffAvailability Availability, TripDay Day, ScheduledActivity Activity, IncidentReport Incident, SupportProfile Profile, AccommodationReservation Reservation);

    private static Org Plant(OdipDbContext admin, Guid tenantId, string ndis)
    {
        var user = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Hill", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = ndis, PlanType = PlanType.SelfManaged };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 3 };
        var property = new AccommodationProperty { Id = Guid.NewGuid(), TenantId = tenantId, PropertyName = "Beach house" };
        var vehicle = new Vehicle { Id = Guid.NewGuid(), TenantId = tenantId, VehicleName = "Van", TotalSeats = 8 };
        admin.AddRange(user, participant, trip, property, vehicle);
        admin.SaveChanges();

        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 480m };
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1), Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        };
        var vehicleAssignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = vehicle.Id, HasOverlapConflict = true };
        var staffAssignment = new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = user.Id, AssignmentStart = new DateOnly(2026, 2, 1), AssignmentEnd = new DateOnly(2026, 2, 3) };
        var availability = new StaffAvailability { Id = Guid.NewGuid(), UserId = user.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2), AvailabilityType = AvailabilityType.Unavailable };
        var day = new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = 1, Date = trip.StartDate, DayTitle = "Original" };
        var activity = new ScheduledActivity { Id = Guid.NewGuid(), TripDayId = day.Id, Title = "Original" };
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = user.Id, IncidentType = IncidentType.Other, OtherTypeSpecify = "x", Severity = IncidentSeverity.Low, Title = "Original", Description = "Original",
            IncidentDateTime = new DateTime(2026, 8, 30, 9, 0, 0, DateTimeKind.Utc),
        };
        var profile = new SupportProfile { Id = Guid.NewGuid(), ParticipantId = participant.Id, BehaviourSupportNotes = "private" };
        var reservation = new AccommodationReservation { Id = Guid.NewGuid(), TripInstanceId = trip.Id, AccommodationPropertyId = property.Id, CheckInDate = new DateOnly(2026, 2, 1), CheckOutDate = new DateOnly(2026, 2, 3) };
        admin.AddRange(booking, claim, line, vehicleAssignment, staffAssignment, availability, day, activity, incident, profile, reservation);
        admin.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "IncidentReport", EntityId = incident.Id, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow, Changes = "[]" });
        admin.SaveChanges();
        return new Org(user, participant, trip, booking, claim, line, vehicle, vehicleAssignment, staffAssignment, availability, day, activity, incident, profile, reservation);
    }

    [SkippableFact]
    public async Task EveryGuardedRoute_TranslatesToSql_AnswersNotFoundForAnotherOrganisation_AndStillServesTheOwner()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var setup = PostgresFixture.NewContext(cs))
            await setup.Database.MigrateAsync();

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        Org foreign, own;
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.AddRange(new Tenant { Id = a, Name = "A", EmailDomain = "a.example.com" }, new Tenant { Id = b, Name = "B", EmailDomain = "b.example.com" });
            admin.SaveChanges();
            foreign = Plant(admin, b, "43100000001");
            own = Plant(admin, a, "43100000002");
        }

        await using var db = TenantDb(cs, a);
        var ct = CancellationToken.None;
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(a);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        // Claims (H8).
        var claims = new ClaimsController(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), new BudgetLedgerService(db, TimeProvider.System), tenant.Object);
        Assert.IsType<NotFoundObjectResult>((await claims.GetClaim(foreign.Claim.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await claims.GetClaimsForTrip(foreign.Trip.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await claims.UpdateClaim(foreign.Claim.Id, new UpdateClaimDto { Notes = "x" }, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await claims.UpdateLineItem(foreign.Claim.Id, foreign.Line.Id, new UpdateClaimLineItemDto { Hours = 1m }, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await claims.DeleteClaim(foreign.Claim.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>(await claims.DownloadBprCsv(foreign.Claim.Id, ct));
        Assert.IsType<OkObjectResult>((await claims.GetClaim(own.Claim.Id, ct)).Result);
        Assert.IsType<OkObjectResult>((await claims.UpdateLineItem(own.Claim.Id, own.Line.Id, new UpdateClaimLineItemDto { Hours = 2m }, ct)).Result);
        Assert.IsType<BadRequestObjectResult>((await claims.UpdateClaim(own.Claim.Id, new UpdateClaimDto { AuthorisedByStaffId = foreign.User.Id }, ct)).Result);
        Assert.IsType<OkObjectResult>((await claims.UpdateClaim(own.Claim.Id, new UpdateClaimDto { AuthorisedByStaffId = own.User.Id }, ct)).Result);

        // The dashboard counts only the caller's own conflict (one flagged vehicle assignment) and open incident (one draft incident), not organisation B's.
        var summary = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await new DashboardController(db).GetSummary(ct)).Result).Value).Data!;
        Assert.Equal((1, 1), (summary.ConflictCount, summary.OpenIncidentCount));

        // Vehicle and staff assignments, availability.
        var vehicleAssignments = new VehicleAssignmentsController(db);
        Assert.IsType<NotFoundObjectResult>((await vehicleAssignments.Delete(foreign.VehicleAssignment.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db)).Delete(foreign.StaffAssignment.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await new StaffController(db).GetAvailability(foreign.User.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await new StaffAvailabilityController(db).Delete(foreign.Availability.Id, ct)).Result);
        Assert.IsType<OkObjectResult>((await vehicleAssignments.Delete(own.VehicleAssignment.Id, ct)).Result);

        // Participants, incidents, audit.
        var participants = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        Assert.IsType<NotFoundObjectResult>((await participants.GetSupportProfile(foreign.Participant.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await participants.GetBookings(foreign.Participant.Id, ct)).Result);
        Assert.IsType<OkObjectResult>((await participants.GetSupportProfile(own.Participant.Id, ct)).Result);
        var incidents = new IncidentsController(db);
        var listed = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await incidents.GetAll(null, null, null, null, null, null, null, null, 1, 50, ct)).Result).Value);
        Assert.Equal(own.Incident.Id, Assert.Single(listed.Data!.Items).Id);
        Assert.IsType<NotFoundObjectResult>((await incidents.Delete(foreign.Incident.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await incidents.GetById(foreign.Incident.Id, ct)).Result);
        var audit = new AuditController(db, NullLogger<AuditController>.Instance);
        Assert.IsType<NotFoundObjectResult>(await audit.GetAuditHistory("IncidentReport", foreign.Incident.Id, ct: ct));
        Assert.IsType<OkObjectResult>(await audit.GetAuditHistory("IncidentReport", own.Incident.Id, ct: ct));

        // Trips, bookings, reservations, days and activities.
        var trips = new TripsController(db, NullLogger<TripsController>.Instance);
        Assert.IsType<NotFoundObjectResult>((await trips.GetSchedule(foreign.Trip.Id, ct)).Result);
        var foreignBookings = Assert.IsType<ApiResponse<List<BookingListDto>>>(Assert.IsType<OkObjectResult>((await trips.GetBookings(foreign.Trip.Id, ct)).Result).Value);
        Assert.Empty(foreignBookings.Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<VehicleAssignmentDto>>>(Assert.IsType<OkObjectResult>((await trips.GetVehicles(foreign.Trip.Id, ct)).Result).Value).Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<StaffAssignmentDto>>>(Assert.IsType<OkObjectResult>((await trips.GetStaff(foreign.Trip.Id, ct)).Result).Value).Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<ReservationDto>>>(Assert.IsType<OkObjectResult>((await trips.GetAccommodation(foreign.Trip.Id, ct)).Result).Value).Data!);
        Assert.IsType<NotFoundObjectResult>((await new BookingsController(db).Patch(foreign.Booking.Id, new PatchBookingDto { BookingStatus = BookingStatus.Cancelled }, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await new BookingsController(db).Delete(foreign.Booking.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await new BookingsController(db).GetById(foreign.Booking.Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await new ReservationsController(db).Delete(foreign.Reservation.Id, ct)).Result);
        var days = new TripDayScheduleController(db);
        Assert.IsType<NotFoundObjectResult>((await days.UpdateTripDay(foreign.Day.Id, new UpdateTripDayDto { DayTitle = "x" }, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await days.DeleteActivity(foreign.Activity.Id, ct)).Result);
        Assert.IsType<OkObjectResult>((await days.DeleteActivity(own.Activity.Id, ct)).Result);

        // Nothing of organisation B changed.
        await using var check = PostgresFixture.NewContext(cs);
        Assert.True(await check.TripClaims.AnyAsync(c => c.Id == foreign.Claim.Id));
        Assert.Equal(480m, (await check.ClaimLineItems.AsNoTracking().SingleAsync(l => l.Id == foreign.Line.Id)).TotalAmount);
        var foreignVehicle = await check.VehicleAssignments.AsNoTracking().SingleAsync(v => v.Id == foreign.VehicleAssignment.Id);
        Assert.Equal(VehicleAssignmentStatus.Requested, foreignVehicle.Status);   // not cancelled by A
        Assert.True(await check.ScheduledActivities.AnyAsync(s => s.Id == foreign.Activity.Id));
        Assert.True(await check.ParticipantBookings.AnyAsync(x => x.Id == foreign.Booking.Id));
        Assert.Equal(IncidentStatus.Draft, (await check.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == foreign.Incident.Id)).Status);
    }

    [SkippableFact]
    public async Task TheActivityLibrary_IsPerOrganisation_OnRealPostgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var setup = PostgresFixture.NewContext(cs))
            await setup.Database.MigrateAsync();

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        Activity own, foreign;
        EventTemplate foreignTemplate;
        ScheduledActivity scheduled;
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.AddRange(new Tenant { Id = a, Name = "A", EmailDomain = "a.example.com" }, new Tenant { Id = b, Name = "B", EmailDomain = "b.example.com" });
            admin.SaveChanges();
            own = new Activity { Id = Guid.NewGuid(), TenantId = a, ActivityName = "Own picnic", Category = ActivityCategory.Leisure };
            foreign = new Activity { Id = Guid.NewGuid(), TenantId = b, ActivityName = "Foreign picnic", Category = ActivityCategory.Leisure };
            foreignTemplate = new EventTemplate { Id = Guid.NewGuid(), TenantId = b, EventCode = "BEACH", EventName = "Beach week" };
            var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = a, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 3 };
            var day = new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = 1, Date = trip.StartDate };
            scheduled = new ScheduledActivity { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = own.Id, Title = "Picnic" };
            admin.AddRange(own, foreign, foreignTemplate, trip, day, scheduled);
            admin.SaveChanges();
        }

        await using var db = TenantDb(cs, a);
        var ct = CancellationToken.None;
        var activities = new ActivitiesController(db);

        // The library lists only A's activity, and A cannot reach B's by id.
        var listed = Assert.IsType<ApiResponse<List<ActivityDto>>>(Assert.IsType<OkObjectResult>((await activities.GetAll(ct)).Result).Value).Data!;
        Assert.Equal(own.Id, Assert.Single(listed).Id);
        Assert.IsType<NotFoundObjectResult>((await activities.Update(foreign.Id, new UpdateActivityDto { ActivityName = "Hijacked" }, ct)).Result);

        // A new activity is stamped with A; B's event template and B's activity are refused where an id comes in the body, and A's own are accepted.
        var created = Assert.IsType<ApiResponse<ActivityDto>>(Assert.IsType<OkObjectResult>((await activities.Create(new CreateActivityDto { ActivityName = "New picnic" }, ct)).Result).Value).Data!;
        Assert.IsType<BadRequestObjectResult>((await activities.Create(new CreateActivityDto { ActivityName = "Stolen", EventTemplateId = foreignTemplate.Id }, ct)).Result);
        var days = new TripDayScheduleController(db);
        Assert.IsType<BadRequestObjectResult>((await days.AddActivity(scheduled.TripDayId, new CreateScheduledActivityDto { Title = "Stolen", ActivityId = foreign.Id }, ct)).Result);
        Assert.IsType<BadRequestObjectResult>((await days.UpdateActivity(scheduled.Id, new UpdateScheduledActivityDto { Title = "Stolen", ActivityId = foreign.Id }, ct)).Result);
        Assert.IsType<OkObjectResult>((await days.UpdateActivity(scheduled.Id, new UpdateScheduledActivityDto { Title = "Picnic", ActivityId = created.Id }, ct)).Result);

        // Nothing of organisation B changed, and nothing was written that should have been refused.
        await using var check = PostgresFixture.NewContext(cs);
        var rows = await check.Activities.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(3, rows.Count);
        var kept = rows.Single(r => r.Id == foreign.Id);
        Assert.Equal(("Foreign picnic", b), (kept.ActivityName, kept.TenantId));
        Assert.Equal(a, rows.Single(r => r.Id == created.Id).TenantId);
        Assert.Equal(created.Id, (await check.ScheduledActivities.AsNoTracking().SingleAsync(s => s.Id == scheduled.Id)).ActivityId);
    }
}
