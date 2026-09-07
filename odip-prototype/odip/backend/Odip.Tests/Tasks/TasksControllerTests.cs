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

namespace Odip.Tests.Tasks;

/// <summary>
/// PP-10/PP-11: coverage for TasksController.GetById, the dedicated single-task fetch added so
/// the edit page no longer fetches the whole list and `.find`s the id client-side.
/// </summary>
public class TasksControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

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
}
