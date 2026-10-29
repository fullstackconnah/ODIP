using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Tasks;

/// <summary>The dashboard's one-tap Done (POST tasks/{id}/complete) writes status and completion date only, so it cannot undo an edit made after the list loaded (the old whole-row PUT could).</summary>
public class TaskCompleteTests
{
    private static OdipDbContext Db(string name, Guid? tenantId = null, bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static TasksController As(OdipDbContext db, string role) => new(db)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) } },
    };

    private static BookingTask Seed(OdipDbContext db, TaskType type = TaskType.RiskReview, TaskItemStatus status = TaskItemStatus.NotStarted)
    {
        var task = new BookingTask { Id = Guid.NewGuid(), TaskType = type, Title = "Chase certificate", Status = status, Notes = "first note", Priority = TaskPriority.High };
        db.BookingTasks.Add(task);
        db.SaveChanges();
        return task;
    }

    [Fact]
    public async System.Threading.Tasks.Task Complete_ChangesOnlyStatusAndCompletedDate()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var task = Seed(db);
        var ownerId = Guid.NewGuid();
        // Edited by somebody else after the caller's list loaded.
        task.Title = "Renamed by someone else"; task.Notes = "newer note"; task.OwnerId = ownerId; db.SaveChanges();

        var result = await As(db, "Coordinator").Complete(task.Id, new CompleteTaskDto { CompletedDate = new DateOnly(2026, 10, 30) }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var stored = db.BookingTasks.Single(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.Completed, stored.Status);
        Assert.Equal(new DateOnly(2026, 10, 30), stored.CompletedDate);
        Assert.Equal("Renamed by someone else", stored.Title);
        Assert.Equal("newer note", stored.Notes);
        Assert.Equal(ownerId, stored.OwnerId);
        Assert.Equal(TaskPriority.High, stored.Priority);
    }

    [Fact]
    public async System.Threading.Tasks.Task Complete_AnotherTenantsTask_IsNotFound()
    {
        var name = Guid.NewGuid().ToString();
        BookingTask other;
        using (var a = Db(name, Guid.NewGuid(), superAdmin: false)) other = Seed(a);
        using var b = Db(name, Guid.NewGuid(), superAdmin: false);

        var result = await As(b, "Admin").Complete(other.Id, new CompleteTaskDto(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var check = Db(name);
        Assert.Equal(TaskItemStatus.NotStarted, check.BookingTasks.IgnoreQueryFilters().Single(t => t.Id == other.Id).Status);
    }

    [Theory]
    [InlineData(TaskItemStatus.Completed)]
    [InlineData(TaskItemStatus.Cancelled)]
    public async System.Threading.Tasks.Task Complete_AClosedTask_IsAConflictAndUnchanged(TaskItemStatus status)
    {
        using var db = Db(Guid.NewGuid().ToString());
        var task = Seed(db, status: status);

        var result = await As(db, "Admin").Complete(task.Id, new CompleteTaskDto { CompletedDate = new DateOnly(2026, 10, 30) }, CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(status, db.BookingTasks.Single().Status);
        Assert.Null(db.BookingTasks.Single().CompletedDate);
    }

    [Fact]
    public async System.Threading.Tasks.Task Complete_ALeaveCoverTask_IsAConflict()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var task = Seed(db, TaskType.LeaveCoverage);

        var result = await As(db, "Admin").Complete(task.Id, new CompleteTaskDto(), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async System.Threading.Tasks.Task Complete_TheBudgetReview_IsForbiddenToACoordinator_AndAllowedToAnAdmin()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var review = Seed(db, TaskType.BudgetEmergencyReview);

        Assert.IsType<ForbidResult>((await As(db, "Coordinator").Complete(review.Id, new CompleteTaskDto(), CancellationToken.None)).Result);
        Assert.Equal(TaskItemStatus.NotStarted, db.BookingTasks.Single().Status);
        Assert.IsType<OkObjectResult>((await As(db, "Admin").Complete(review.Id, new CompleteTaskDto(), CancellationToken.None)).Result);
        Assert.Equal(TaskItemStatus.Completed, db.BookingTasks.Single().Status);
    }

    [Fact]
    public void Complete_HasUpdatesRoleAudience()
    {
        string? Roles(string method) => typeof(TasksController).GetMethod(method)!.GetCustomAttribute<AuthorizeAttribute>()?.Roles;
        Assert.Equal(Roles(nameof(TasksController.Update)), Roles(nameof(TasksController.Complete)));
        Assert.NotNull(Roles(nameof(TasksController.Complete)));
    }
}
