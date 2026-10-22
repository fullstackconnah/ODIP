using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Tasks;

/// <summary>QW1 (OPS-1): a task needs no trip. The "Trip not found" check runs only when a trip id is sent, and a task with no trip is the caller's organisation's alone.</summary>
public class TaskWithoutTripTests
{
    [Fact]
    public async System.Threading.Tasks.Task Create_WithNoTrip_StoresATaskWithNoTrip_AndListsIt()
    {
        using var db = Db();
        var controller = new TasksController(db);

        var result = await controller.Create(new CreateTaskDto { Title = "Renew fire-safety check", TaskType = TaskType.Other, Priority = TaskPriority.High, DueDate = new DateOnly(2026, 11, 3), Notes = "Annual" }, CancellationToken.None);

        var created = Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Null(created.TripInstanceId);
        Assert.Null(created.TripName);
        var stored = await db.BookingTasks.AsNoTracking().SingleAsync();
        Assert.Equal(("Renew fire-safety check", TaskPriority.High, new DateOnly(2026, 11, 3), "Annual", (Guid?)null), (stored.Title, stored.Priority, stored.DueDate, stored.Notes, stored.TripInstanceId));
        var list = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, null, null, null, CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(created.Id, Assert.Single(list).Id);
    }

    [Fact]
    public async System.Threading.Tasks.Task Create_WithAnotherOrganisationsTrip_IsStillRefused()
    {
        using var db = Db();
        var foreignTrip = Trip(db, B);

        var result = await new TasksController(db).Create(new CreateTaskDto { Title = "Confirm", TripInstanceId = foreignTrip.Id }, CancellationToken.None);

        Assert.Equal("Trip not found.", Assert.Single(Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!));
        Assert.Empty(await db.BookingTasks.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async System.Threading.Tasks.Task Create_WithNoTripButAnotherOrganisationsBooking_IsStillRefused()
    {
        using var db = Db();
        var foreign = Trip(db, B);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = foreign.Id, ParticipantId = Participant(db, B).Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        db.Add(booking);
        db.SaveChanges();

        var result = await new TasksController(db).Create(new CreateTaskDto { Title = "Confirm", ParticipantBookingId = booking.Id }, CancellationToken.None);

        Assert.Equal("Booking not found.", Assert.Single(Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!));
    }

    [Fact]
    public async System.Threading.Tasks.Task ATaskWithNoTrip_OfAnotherOrganisation_IsNotListedOrReadable()
    {
        using var db = Db();
        var theirs = new BookingTask { Id = Guid.NewGuid(), TenantId = B, Title = "Theirs", TaskType = TaskType.Other };
        db.BookingTasks.Add(theirs);
        db.SaveChanges();
        var controller = new TasksController(db);

        var list = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, null, null, null, CancellationToken.None)).Result).Value).Data!;
        Assert.Empty(list);
        Assert.IsType<NotFoundObjectResult>((await controller.GetById(theirs.Id, CancellationToken.None)).Result);
    }
}
