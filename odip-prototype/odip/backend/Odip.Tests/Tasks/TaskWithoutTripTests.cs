using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
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

    /// <summary>A SuperAdmin who has not chosen an organisation to view as: no tenant, every row visible.</summary>
    private static (OdipDbContext Db, TasksController Controller) TenantlessSuperAdmin()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, new TasksController(db, null, tenant.Object));
    }

    [Fact]
    public async System.Threading.Tasks.Task Create_WithATrip_TakesTheTripsOrganisation_EvenForATenantlessSuperAdmin()
    {
        var (db, controller) = TenantlessSuperAdmin();
        using var _ = db;
        var trip = Trip(db, B);

        var result = await controller.Create(new CreateTaskDto { Title = "Confirm", TripInstanceId = trip.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(B, (await db.BookingTasks.SingleAsync()).TenantId);
    }

    [Fact]
    public async System.Threading.Tasks.Task Create_WithNoTrip_ForASuperAdminWhoHasNotChosenAnOrganisation_IsRefused()
    {
        var (db, controller) = TenantlessSuperAdmin();
        using var _ = db;

        var result = await controller.Create(new CreateTaskDto { Title = "Renew" }, CancellationToken.None);

        Assert.Equal(TasksController.ChooseOrganisation, Assert.Single(Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!));
        Assert.Empty(await db.BookingTasks.ToListAsync());
    }

    [Fact]
    public async System.Threading.Tasks.Task Create_WithNoTripButABooking_TakesTheBookingsTrip()
    {
        using var db = Db();
        var trip = Trip(db, A);
        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = Participant(db, A).Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        db.Add(booking);
        db.SaveChanges();

        var result = await new TasksController(db).Create(new CreateTaskDto { Title = "Confirm", ParticipantBookingId = booking.Id }, CancellationToken.None);

        var created = Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal((trip.Id, trip.TripName), (created.TripInstanceId, created.TripName));
        Assert.Equal(trip.Id, (await db.BookingTasks.SingleAsync()).TripInstanceId);
    }
}
