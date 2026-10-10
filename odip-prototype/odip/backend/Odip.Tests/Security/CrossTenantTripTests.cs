using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Security;

/// <summary>
/// TripDay, ScheduledActivity, TripDocument, ParticipantBooking and AccommodationReservation have no organisation column and no query filter. A read that joins a required, filtered
/// parent (the participant, the trip, the property) is scoped by that join and the tests below pin it; a read or write that does not (the schedule, the documents, a day, an activity, a
/// delete, a reservation update) now starts from the caller's own trip and answers "not found" for another organisation's.
/// </summary>
public class CrossTenantTripTests
{
    private static TripsController Trips(OdipDbContext db) => new(db, NullLogger<TripsController>.Instance);

    private static TripDay PlantDayWithActivity(OdipDbContext db, Guid tenantId, out ScheduledActivity activity, out TripInstance trip)
    {
        trip = Trip(db, tenantId);
        var day = new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = 1, Date = trip.StartDate, DayTitle = "Original" };
        activity = new ScheduledActivity { Id = Guid.NewGuid(), TripDayId = day.Id, Title = "Original" };
        db.TripDays.Add(day);
        db.ScheduledActivities.Add(activity);
        db.SaveChanges();
        return day;
    }

    private static AccommodationProperty Property(OdipDbContext db, Guid tenantId)
    {
        var property = new AccommodationProperty { Id = Guid.NewGuid(), TenantId = tenantId, PropertyName = "Beach house" };
        db.AccommodationProperties.Add(property);
        db.SaveChanges();
        return property;
    }

    private static AccommodationReservation PlantReservation(OdipDbContext db, Guid tenantId, out AccommodationProperty property, out TripInstance trip)
    {
        trip = Trip(db, tenantId);
        property = Property(db, tenantId);
        var reservation = new AccommodationReservation
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, AccommodationPropertyId = property.Id, CheckInDate = new DateOnly(2026, 2, 1), CheckOutDate = new DateOnly(2026, 2, 3),
            Comments = "Original",
        };
        db.AccommodationReservations.Add(reservation);
        db.SaveChanges();
        return reservation;
    }

    private static ParticipantBooking PlantBooking(OdipDbContext db, Guid tenantId, out TripInstance trip)
    {
        var participant = Participant(db, tenantId);
        trip = Trip(db, tenantId);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        db.ParticipantBookings.Add(booking);
        db.SaveChanges();
        return booking;
    }

    // ── trips/{id}/schedule ─────────────────────────────────────────────────────

    [Fact]
    public async Task TripSchedule_TripOfAnotherTenant_ReturnsNotFound()
    {
        using var db = Db();
        PlantDayWithActivity(db, B, out _, out var foreignTrip);

        Assert.IsType<NotFoundObjectResult>((await Trips(db).GetSchedule(foreignTrip.Id, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task TripSchedule_OwnTrip_ReturnsItsDays()
    {
        using var db = Db();
        var day = PlantDayWithActivity(db, A, out _, out var trip);

        var result = await Trips(db).GetSchedule(trip.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<TripDayDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(day.Id, Assert.Single(body.Data!).Id);
    }

    // Already scoped by a join to a required, tenant-filtered parent; these pin it so the join is not removed by accident.

    [Fact]
    public async Task TripSubResources_TripOfAnotherTenant_ShowNothing()
    {
        using var db = Db();
        var booking = PlantBooking(db, B, out var foreignTrip);
        db.StaffAssignments.Add(new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = foreignTrip.Id, UserId = User(db, B).Id });
        db.VehicleAssignments.Add(new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = foreignTrip.Id, VehicleId = Vehicle(db, B).Id });
        db.AccommodationReservations.Add(new AccommodationReservation { Id = Guid.NewGuid(), TripInstanceId = foreignTrip.Id, AccommodationPropertyId = Property(db, B).Id });
        db.SaveChanges();
        var controller = Trips(db);

        Assert.Empty(Assert.IsType<ApiResponse<List<BookingListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetBookings(foreignTrip.Id, CancellationToken.None)).Result).Value).Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<StaffAssignmentDto>>>(Assert.IsType<OkObjectResult>((await controller.GetStaff(foreignTrip.Id, CancellationToken.None)).Result).Value).Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<VehicleAssignmentDto>>>(Assert.IsType<OkObjectResult>((await controller.GetVehicles(foreignTrip.Id, CancellationToken.None)).Result).Value).Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<ReservationDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAccommodation(foreignTrip.Id, CancellationToken.None)).Result).Value).Data!);
        Assert.IsType<NotFoundObjectResult>((await controller.GetItinerary(foreignTrip.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.GenerateSchedule(foreignTrip.Id, CancellationToken.None)).Result);
        Assert.True(await db.ParticipantBookings.AnyAsync(b => b.Id == booking.Id));
    }

    // ── bookings ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task BookingCreate_TripOfAnotherTenant_IsRefused_AndWritesNothing()
    {
        using var db = Db();
        var participant = Participant(db, A);
        var foreignTrip = Trip(db, B);

        var result = await new BookingsController(db).Create(new CreateBookingDto { TripInstanceId = foreignTrip.Id, ParticipantId = participant.Id }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(await db.ParticipantBookings.ToListAsync());
    }

    [Fact]
    public async Task BookingDelete_BookingOfAnotherTenant_ReturnsNotFound_AndDeletesNothing()
    {
        using var db = Db();
        var foreign = PlantBooking(db, B, out _);

        var result = await new BookingsController(db).Delete(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.True(await db.ParticipantBookings.AnyAsync(b => b.Id == foreign.Id));
    }

    [Fact]
    public async Task BookingReadsAndEdits_BookingOfAnotherTenant_AreNotFoundOrEmpty()
    {
        using var db = Db();
        var foreign = PlantBooking(db, B, out var foreignTrip);
        var controller = new BookingsController(db);

        Assert.IsType<NotFoundObjectResult>((await controller.GetById(foreign.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.Patch(foreign.Id, new PatchBookingDto { BookingStatus = BookingStatus.Cancelled }, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.Update(foreign.Id, new UpdateBookingDto { TripInstanceId = foreignTrip.Id, ParticipantId = foreign.ParticipantId }, CancellationToken.None)).Result);
        var all = Assert.IsType<ApiResponse<PagedResult<BookingListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, null, 1, 50, CancellationToken.None)).Result).Value);
        Assert.Empty(all.Data!.Items);
        Assert.Equal(BookingStatus.Confirmed, (await db.ParticipantBookings.AsNoTracking().SingleAsync(b => b.Id == foreign.Id)).BookingStatus);
    }

    [Fact]
    public async Task Booking_OwnRows_StillCreateAndDelete()
    {
        using var db = Db();
        var participant = Participant(db, A);
        var trip = Trip(db, A);
        var controller = new BookingsController(db);

        var created = await controller.Create(new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = participant.Id }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<BookingDetailDto>>(Assert.IsType<CreatedAtActionResult>(created.Result).Value).Data!.Id;

        Assert.IsType<OkObjectResult>((await controller.Delete(id, CancellationToken.None)).Result);
        Assert.False(await db.ParticipantBookings.AnyAsync(b => b.Id == id));
    }

    // ── accommodation/{id}/reservations and reservations ───────────────────────────────────────

    [Fact]
    public async Task Reservations_OfAnotherTenant_AreNotListed()
    {
        using var db = Db();
        PlantReservation(db, B, out var foreignProperty, out _);

        var forProperty = await new AccommodationController(db).GetReservations(foreignProperty.Id, CancellationToken.None);
        var all = await new ReservationsController(db).GetAll(CancellationToken.None);

        Assert.Empty(Assert.IsType<ApiResponse<List<ReservationDto>>>(Assert.IsType<OkObjectResult>(forProperty.Result).Value).Data!);
        Assert.Empty(Assert.IsType<ApiResponse<List<ReservationDto>>>(Assert.IsType<OkObjectResult>(all.Result).Value).Data!);
    }

    [Fact]
    public async Task ReservationCreate_TripOrPropertyOfAnotherTenant_IsRefused_AndWritesNothing()
    {
        using var db = Db();
        var ownTrip = Trip(db, A);
        var ownProperty = Property(db, A);
        var foreignTrip = Trip(db, B);
        var foreignProperty = Property(db, B);
        var controller = new ReservationsController(db);
        var dates = (new DateOnly(2026, 2, 1), new DateOnly(2026, 2, 3));

        var withForeignTrip = await controller.Create(new CreateReservationDto { TripInstanceId = foreignTrip.Id, AccommodationPropertyId = ownProperty.Id, CheckInDate = dates.Item1, CheckOutDate = dates.Item2 }, CancellationToken.None);
        var withForeignProperty = await controller.Create(new CreateReservationDto { TripInstanceId = ownTrip.Id, AccommodationPropertyId = foreignProperty.Id, CheckInDate = dates.Item1, CheckOutDate = dates.Item2 }, CancellationToken.None);

        Assert.IsNotType<OkObjectResult>(withForeignTrip.Result);
        Assert.IsNotType<OkObjectResult>(withForeignProperty.Result);
        Assert.Empty(await db.AccommodationReservations.ToListAsync());
    }

    [Fact]
    public async Task ReservationUpdate_ReservationOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        var foreign = PlantReservation(db, B, out var foreignProperty, out _);

        var result = await new ReservationsController(db).Update(foreign.Id, new UpdateReservationDto
        {
            TripInstanceId = foreign.TripInstanceId, AccommodationPropertyId = foreignProperty.Id, CheckInDate = foreign.CheckInDate, CheckOutDate = foreign.CheckOutDate, Comments = "hijacked",
        }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal("Original", (await db.AccommodationReservations.AsNoTracking().SingleAsync(r => r.Id == foreign.Id)).Comments);
    }

    [Fact]
    public async Task ReservationUpdate_PropertyOfAnotherTenant_IsRefused_AndKeepsTheProperty()
    {
        using var db = Db();
        var own = PlantReservation(db, A, out var ownProperty, out _);
        var foreignProperty = Property(db, B);

        var result = await new ReservationsController(db).Update(own.Id, new UpdateReservationDto
        {
            TripInstanceId = own.TripInstanceId, AccommodationPropertyId = foreignProperty.Id, CheckInDate = own.CheckInDate, CheckOutDate = own.CheckOutDate,
        }, CancellationToken.None);

        Assert.IsNotType<OkObjectResult>(result.Result);
        Assert.Equal(ownProperty.Id, (await db.AccommodationReservations.AsNoTracking().SingleAsync(r => r.Id == own.Id)).AccommodationPropertyId);
    }

    [Fact]
    public async Task ReservationDelete_ReservationOfAnotherTenant_ReturnsNotFound_AndDeletesNothing()
    {
        using var db = Db();
        var foreign = PlantReservation(db, B, out _, out _);

        var result = await new ReservationsController(db).Delete(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.True(await db.AccommodationReservations.AnyAsync(r => r.Id == foreign.Id));
    }

    [Fact]
    public async Task Reservation_OwnRows_StillCreateUpdateAndDelete()
    {
        using var db = Db();
        var trip = Trip(db, A);
        var property = Property(db, A);
        var controller = new ReservationsController(db);
        var dates = (new DateOnly(2026, 2, 1), new DateOnly(2026, 2, 3));

        var created = await controller.Create(new CreateReservationDto { TripInstanceId = trip.Id, AccommodationPropertyId = property.Id, CheckInDate = dates.Item1, CheckOutDate = dates.Item2 }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<ReservationDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        Assert.IsType<OkObjectResult>((await controller.Update(id, new UpdateReservationDto { TripInstanceId = trip.Id, AccommodationPropertyId = property.Id, CheckInDate = dates.Item1, CheckOutDate = dates.Item2, Comments = "ok" }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.Delete(id, CancellationToken.None)).Result);
    }

    // ── trip-days and scheduled-activities ─────────────────────────────────────────────────────

    [Fact]
    public async Task TripDayUpdate_DayOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        var foreign = PlantDayWithActivity(db, B, out _, out _);

        var result = await new TripDayScheduleController(db).UpdateTripDay(foreign.Id, new UpdateTripDayDto { DayTitle = "hijacked" }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal("Original", (await db.TripDays.AsNoTracking().SingleAsync(d => d.Id == foreign.Id)).DayTitle);
    }

    [Fact]
    public async Task ActivityAdd_DayOfAnotherTenant_ReturnsNotFound_AndAddsNothing()
    {
        using var db = Db();
        var foreign = PlantDayWithActivity(db, B, out _, out _);

        var result = await new TripDayScheduleController(db).AddActivity(foreign.Id, new CreateScheduledActivityDto { Title = "planted" }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(1, await db.ScheduledActivities.CountAsync());
    }

    [Fact]
    public async Task ActivityUpdateAndDelete_ActivityOfAnotherTenant_ReturnsNotFound_AndChangesNothing()
    {
        using var db = Db();
        PlantDayWithActivity(db, B, out var foreign, out _);
        var controller = new TripDayScheduleController(db);

        var update = await controller.UpdateActivity(foreign.Id, new UpdateScheduledActivityDto { Title = "hijacked" }, CancellationToken.None);
        var delete = await controller.DeleteActivity(foreign.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(update.Result);
        Assert.IsType<NotFoundObjectResult>(delete.Result);
        Assert.Equal("Original", (await db.ScheduledActivities.AsNoTracking().SingleAsync(a => a.Id == foreign.Id)).Title);
    }

    [Fact]
    public async Task TripDayAndActivities_OwnRows_StillUpdateAddAndDelete()
    {
        using var db = Db();
        var day = PlantDayWithActivity(db, A, out var activity, out _);
        var controller = new TripDayScheduleController(db);

        Assert.IsType<OkObjectResult>((await controller.UpdateTripDay(day.Id, new UpdateTripDayDto { DayTitle = "Beach" }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.AddActivity(day.Id, new CreateScheduledActivityDto { Title = "Swim" }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.UpdateActivity(activity.Id, new UpdateScheduledActivityDto { Title = "Walk" }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.DeleteActivity(activity.Id, CancellationToken.None)).Result);
        Assert.Equal("Beach", (await db.TripDays.AsNoTracking().SingleAsync(d => d.Id == day.Id)).DayTitle);
    }
}
