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
using Odip.Tests.Support;

namespace Odip.Tests.Tasks;

/// <summary>
/// PP-10/PP-11: coverage for TasksController.GetById, the dedicated single-task fetch added so
/// the edit page no longer fetches the whole list and `.find`s the id client-side.
/// </summary>
public class TasksControllerTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

    private static TripInstance SeedTrip(OdipDbContext db)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), TripName = "Test Trip", StartDate = new DateOnly(2026, 9, 1),
            DurationDays = 3, Status = TripStatus.Draft,
        };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static User SeedUser(OdipDbContext db, string firstName = "Alex", string lastName = "Rivera")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = firstName, LastName = lastName,
            Username = $"{firstName}.{lastName}".ToLowerInvariant(), Email = $"{firstName}.{lastName}@example.com".ToLowerInvariant(),
            IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async System.Threading.Tasks.Task GetById_ExistingTask_ReturnsTheSameShapeAsGetAll()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        var owner = SeedUser(db);
        var controller = new TasksController(db);

        var createResult = await controller.Create(
            new CreateTaskDto { TripInstanceId = trip.Id, TaskType = TaskType.RiskReview, Title = "Review risk plan", OwnerId = owner.Id, Priority = TaskPriority.High },
            CancellationToken.None);
        var created = Assert.IsType<OkObjectResult>(createResult.Result);
        var createdTask = Assert.IsType<ApiResponse<TaskDto>>(created.Value).Data!;

        var getResult = await controller.GetById(createdTask.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(getResult.Result);
        var body = Assert.IsType<ApiResponse<TaskDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(createdTask.Id, body.Data!.Id);
        Assert.Equal("Review risk plan", body.Data.Title);
        Assert.Equal(trip.Id, body.Data.TripInstanceId);
        Assert.Equal(trip.TripName, body.Data.TripName);
        Assert.Equal(owner.Id, body.Data.OwnerId);
        Assert.Equal($"{owner.FirstName} {owner.LastName}", body.Data.OwnerName);
        Assert.Equal(TaskPriority.High, body.Data.Priority);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetById_UnknownId_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new TasksController(db);

        var result = await controller.GetById(Guid.NewGuid(), CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<TaskDto>>(notFound.Value);
        Assert.False(body.Success);
    }

    // ══════════════════════════════════════════════════════════════
    // ITEM 9 — generic obligation tasks (no TripInstanceId) in the tasks list
    // ══════════════════════════════════════════════════════════════

    /// <summary>A generic obligation task (e.g. raised by IObligationTaskService) has no TripInstanceId — it must still appear in GetAll, listed with a null TripName rather than being filtered out or crashing on the (now optional) TripInstance navigation.</summary>
    [Fact]
    public async System.Threading.Tasks.Task GetAll_TripLessGenericTask_IsListedWithNullTripNameAndTripInstanceId()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        db.BookingTasks.Add(new BookingTask
        {
            Id = Guid.NewGuid(), TaskType = TaskType.MedicationWitness, Title = "Witness sign-off needed",
            SourceKey = "med-witness:x", Status = TaskItemStatus.NotStarted,
        });
        await db.SaveChangesAsync();
        var controller = new TasksController(db);

        var result = await controller.GetAll(tripId: null, status: null, dueThisWeek: null, ownerId: null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<TaskDto>>>(ok.Value);
        var task = Assert.Single(body.Data!);
        Assert.Null(task.TripInstanceId);
        Assert.Null(task.TripName);
        Assert.Equal("med-witness:x", task.SourceKey);
    }

    /// <summary>A trip-linked task alongside a trip-less one — both list correctly side by side, proving the LEFT JOIN against the now-optional TripInstance FK doesn't drop or corrupt either row.</summary>
    [Fact]
    public async System.Threading.Tasks.Task GetAll_TripLinkedAndTripLessTasksTogether_BothListedCorrectly()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        db.BookingTasks.Add(new BookingTask { Id = Guid.NewGuid(), TripInstanceId = trip.Id, TaskType = TaskType.RiskReview, Title = "Trip task", Status = TaskItemStatus.NotStarted });
        db.BookingTasks.Add(new BookingTask { Id = Guid.NewGuid(), TaskType = TaskType.IncidentQscReport, Title = "Generic task", SourceKey = "incident-qsc:x", Status = TaskItemStatus.NotStarted });
        await db.SaveChangesAsync();
        var controller = new TasksController(db);

        var result = await controller.GetAll(tripId: null, status: null, dueThisWeek: null, ownerId: null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(2, body.Data!.Count);
        Assert.Contains(body.Data, t => t.Title == "Trip task" && t.TripName == trip.TripName);
        Assert.Contains(body.Data, t => t.Title == "Generic task" && t.TripName == null);
    }

    /// <summary>Mandatory cross-tenant coverage: a generic task (no TripInstance to inherit scoping from) created under tenant A must not be listed for a tenant B caller.</summary>
    [Fact]
    public async System.Threading.Tasks.Task GetAll_GenericTaskFromAnotherTenant_IsNotListed()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();

        var tenantA = new Mock<ICurrentTenant>();
        tenantA.Setup(t => t.TenantId).Returns(tenantAId);
        tenantA.Setup(t => t.IsSuperAdmin).Returns(false);
        var optionsA = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using (var dbA = new OdipDbContext(optionsA, tenantA.Object))
        {
            dbA.BookingTasks.Add(new BookingTask
            {
                Id = Guid.NewGuid(), TaskType = TaskType.MedicationWitness, Title = "Tenant A witness task",
                SourceKey = "med-witness:tenant-a", Status = TaskItemStatus.NotStarted,
            });
            await dbA.SaveChangesAsync();
        }

        var tenantB = new Mock<ICurrentTenant>();
        tenantB.Setup(t => t.TenantId).Returns(tenantBId);
        tenantB.Setup(t => t.IsSuperAdmin).Returns(false);
        var optionsB = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using var dbB = new OdipDbContext(optionsB, tenantB.Object);
        var controllerB = new TasksController(dbB);

        var result = await controllerB.GetAll(tripId: null, status: null, dueThisWeek: null, ownerId: null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Empty(body.Data!);
    }
}
