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
/// The five ids a new task can link to come from the request body and are checked against the caller's own organisation: the trip is filtered; the booking, reservation, vehicle assignment and
/// staff assignment have no query filter of their own, so each is checked through its trip.
/// </summary>
public class CrossTenantTaskBodyIdTests
{
    // ── tasks: the five ids a task can link to ─────────────────────────────────────────────────

    private sealed record Linked(TripInstance Trip, ParticipantBooking Booking, AccommodationReservation Reservation, VehicleAssignment VehicleAssignment, StaffAssignment StaffAssignment);

    private static Linked PlantLinked(OdipDbContext db, Guid tenantId)
    {
        var trip = Trip(db, tenantId);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = Participant(db, tenantId).Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        var reservation = new AccommodationReservation { Id = Guid.NewGuid(), TripInstanceId = trip.Id, AccommodationPropertyId = Guid.NewGuid() };
        var vehicleAssignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = Vehicle(db, tenantId).Id };
        var staffAssignment = new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = User(db, tenantId).Id };
        db.AddRange(booking, reservation, vehicleAssignment, staffAssignment);
        db.SaveChanges();
        return new Linked(trip, booking, reservation, vehicleAssignment, staffAssignment);
    }

    public static TheoryData<string, string> TaskLinks => new()
    {
        { "trip", "Trip not found." },
        { "booking", "Booking not found." },
        { "reservation", "Reservation not found." },
        { "vehicle assignment", "Vehicle assignment not found." },
        { "staff assignment", "Staff assignment not found." },
    };

    private static CreateTaskDto TaskFor(string kind, Linked linked, Guid tripId) => new()
    {
        Title = "Confirm", TripInstanceId = kind == "trip" ? linked.Trip.Id : tripId,
        ParticipantBookingId = kind == "booking" ? linked.Booking.Id : null,
        AccommodationReservationId = kind == "reservation" ? linked.Reservation.Id : null,
        VehicleAssignmentId = kind == "vehicle assignment" ? linked.VehicleAssignment.Id : null,
        StaffAssignmentId = kind == "staff assignment" ? linked.StaffAssignment.Id : null,
    };

    [Theory, MemberData(nameof(TaskLinks))]
    public async Task TaskCreate_LinkedRowOfAnotherTenant_Returns400_AndWritesNothing(string kind, string message)
    {
        using var db = Db();
        var ownTrip = Trip(db, A);
        var foreign = PlantLinked(db, B);

        var result = await new TasksController(db).Create(TaskFor(kind, foreign, ownTrip.Id), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal(message, Assert.Single(body.Errors!));
        Assert.Empty(await db.BookingTasks.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task TaskCreate_OwnLinkedRows_StillCreates()
    {
        using var db = Db();
        var own = PlantLinked(db, A);

        var result = await new TasksController(db).Create(new CreateTaskDto
        {
            Title = "Confirm", TripInstanceId = own.Trip.Id, ParticipantBookingId = own.Booking.Id, AccommodationReservationId = own.Reservation.Id,
            VehicleAssignmentId = own.VehicleAssignment.Id, StaffAssignmentId = own.StaffAssignment.Id,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var stored = await db.BookingTasks.AsNoTracking().SingleAsync();
        Assert.Equal((own.Trip.Id, own.Booking.Id, own.Reservation.Id, own.VehicleAssignment.Id, own.StaffAssignment.Id),
            (stored.TripInstanceId, stored.ParticipantBookingId, stored.AccommodationReservationId, stored.VehicleAssignmentId, stored.StaffAssignmentId));
    }

    // Update takes the same DTO but never writes the links (it keeps the ones the task was created with), so the ids in its body cannot move a task onto another organisation's rows.
    [Fact]
    public async Task TaskUpdate_IgnoresTheLinkIdsInItsBody()
    {
        using var db = Db();
        var own = PlantLinked(db, A);
        var foreign = PlantLinked(db, B);
        var controller = new TasksController(db);
        var created = await controller.Create(new CreateTaskDto { Title = "Confirm", TripInstanceId = own.Trip.Id }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        var updated = await controller.Update(id, new UpdateTaskDto { Title = "Confirmed", TripInstanceId = foreign.Trip.Id, ParticipantBookingId = foreign.Booking.Id, StaffAssignmentId = foreign.StaffAssignment.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updated.Result);
        var stored = await db.BookingTasks.AsNoTracking().SingleAsync(t => t.Id == id);
        Assert.Equal(("Confirmed", own.Trip.Id, (Guid?)null, (Guid?)null), (stored.Title, stored.TripInstanceId, stored.ParticipantBookingId, stored.StaffAssignmentId));
    }
}
