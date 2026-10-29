using System.Security.Claims;
using Microsoft.AspNetCore.Http;
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

/// <summary>The Tasks page and trip Tasks tab status change (POST tasks/{id}/status) writes status and completion date only, so it cannot undo an edit made after the list loaded (the old whole-row PUT could).</summary>
public class TaskStatusTests
{
    private static OdipDbContext Db(string name, Guid? tenantId = null, bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static TasksController As(OdipDbContext db, string role, Guid? userId = null)
    {
        var claims = new List<Claim> { new(ClaimTypes.Role, role) };
        if (userId is { } id) claims.Add(new Claim(ClaimTypes.NameIdentifier, id.ToString()));
        return new(db) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } } };
    }

    private static BookingTask Seed(OdipDbContext db, TaskType type = TaskType.RiskReview, TaskItemStatus status = TaskItemStatus.NotStarted)
    {
        var task = new BookingTask { Id = Guid.NewGuid(), TaskType = type, Title = "Chase certificate", Status = status, Notes = "first note", Priority = TaskPriority.High };
        db.BookingTasks.Add(task);
        db.SaveChanges();
        return task;
    }

    [Fact]
    public async System.Threading.Tasks.Task SetStatus_ChangesOnlyStatusAndCompletedDate()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var task = Seed(db);
        var ownerId = Guid.NewGuid();
        // Edited by somebody else after the caller's list loaded.
        task.Title = "Renamed by someone else"; task.Notes = "newer note"; task.OwnerId = ownerId; db.SaveChanges();

        var result = await As(db, "Coordinator").SetStatus(task.Id, new SetTaskStatusDto { Status = TaskItemStatus.Completed, CompletedDate = new DateOnly(2026, 10, 30) }, CancellationToken.None);

        var dto = Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Renamed by someone else", dto.Data!.Title);
        var stored = db.BookingTasks.Single(t => t.Id == task.Id);
        Assert.Equal(TaskItemStatus.Completed, stored.Status);
        Assert.Equal(new DateOnly(2026, 10, 30), stored.CompletedDate);
        Assert.Equal("Renamed by someone else", stored.Title);
        Assert.Equal("newer note", stored.Notes);
        Assert.Equal(ownerId, stored.OwnerId);
        Assert.Equal(TaskPriority.High, stored.Priority);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetStatus_CompletedWithoutADate_IsABadRequest()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var task = Seed(db);

        var result = await As(db, "Admin").SetStatus(task.Id, new SetTaskStatusDto { Status = TaskItemStatus.Completed }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(TaskItemStatus.NotStarted, db.BookingTasks.Single().Status);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetStatus_BackToInProgress_ClearsTheCompletedDate()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var task = Seed(db, status: TaskItemStatus.Completed);
        task.CompletedDate = new DateOnly(2026, 10, 29); db.SaveChanges();

        var result = await As(db, "Admin").SetStatus(task.Id, new SetTaskStatusDto { Status = TaskItemStatus.InProgress }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(TaskItemStatus.InProgress, db.BookingTasks.Single().Status);
        Assert.Null(db.BookingTasks.Single().CompletedDate);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetStatus_AnotherTenantsTask_IsNotFound()
    {
        var name = Guid.NewGuid().ToString();
        BookingTask other;
        using (var a = Db(name, Guid.NewGuid(), superAdmin: false)) other = Seed(a);
        using var b = Db(name, Guid.NewGuid(), superAdmin: false);

        var result = await As(b, "Admin").SetStatus(other.Id, new SetTaskStatusDto { Status = TaskItemStatus.InProgress }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var check = Db(name);
        Assert.Equal(TaskItemStatus.NotStarted, check.BookingTasks.IgnoreQueryFilters().Single(t => t.Id == other.Id).Status);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetStatus_TheBudgetReview_IsForbiddenToACoordinator()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var review = Seed(db, TaskType.BudgetEmergencyReview);

        var result = await As(db, "Coordinator").SetStatus(review.Id, new SetTaskStatusDto { Status = TaskItemStatus.InProgress }, CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Equal(TaskItemStatus.NotStarted, db.BookingTasks.Single().Status);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetStatus_AnAdminCompletingTheReview_BecomesItsOwner()
    {
        using var db = Db(Guid.NewGuid().ToString());
        var review = Seed(db, TaskType.BudgetEmergencyReview);
        var admin = Guid.NewGuid();

        var result = await As(db, "Admin", admin).SetStatus(review.Id, new SetTaskStatusDto { Status = TaskItemStatus.Completed, CompletedDate = new DateOnly(2026, 10, 30) }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(admin, db.BookingTasks.Single().OwnerId);
    }
}
