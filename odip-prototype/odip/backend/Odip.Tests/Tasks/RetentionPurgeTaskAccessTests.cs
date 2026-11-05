using System.Security.Claims;
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

/// <summary>
/// Who may change the "records due for permanent deletion" task: an Admin or SuperAdmin only, on every task endpoint, as for the budget review. A Coordinator can no longer see it
/// (RetentionPurgeAudience) and may not complete, cancel, delete, create or retype it either.
/// </summary>
public class RetentionPurgeTaskAccessTests : IDisposable
{
    private readonly OdipDbContext _db;

    public RetentionPurgeTaskAccessTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    public void Dispose() => _db.Dispose();

    private TasksController Tasks(string role) => new(_db)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) } },
    };

    private BookingTask Seed(TaskType type)
    {
        var task = new BookingTask { Id = Guid.NewGuid(), TaskType = type, Title = "Records due for permanent deletion", Status = TaskItemStatus.NotStarted, Priority = TaskPriority.Medium };
        _db.BookingTasks.Add(task);
        _db.SaveChanges();
        return task;
    }

    private static UpdateTaskDto Edit(BookingTask task, TaskType type) =>
        new() { TaskType = type, Title = task.Title, Priority = task.Priority, Status = TaskItemStatus.NotStarted };

    private BookingTask Stored(Guid id) => _db.BookingTasks.AsNoTracking().Single(t => t.Id == id);

    public static TheoryData<string, bool> Roles => new() { { "SupportWorker", false }, { "ReadOnly", false }, { "Coordinator", false }, { "Admin", true }, { "SuperAdmin", true } };

    private static void Expect(bool allowed, object? result)
    {
        if (allowed) Assert.IsNotType<ForbidResult>(result);
        else Assert.IsType<ForbidResult>(result);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task SetStatus_is_an_admins(string role, bool allowed)
    {
        var task = Seed(TaskType.RetentionPurgeDue);
        var result = await Tasks(role).SetStatus(task.Id, new SetTaskStatusDto { Status = TaskItemStatus.InProgress }, CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskItemStatus.InProgress : TaskItemStatus.NotStarted, Stored(task.Id).Status);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Complete_is_an_admins(string role, bool allowed)
    {
        var task = Seed(TaskType.RetentionPurgeDue);
        var result = await Tasks(role).Complete(task.Id, new CompleteTaskDto { CompletedDate = new DateOnly(2026, 11, 5) }, CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskItemStatus.Completed : TaskItemStatus.NotStarted, Stored(task.Id).Status);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Delete_is_an_admins(string role, bool allowed)
    {
        var task = Seed(TaskType.RetentionPurgeDue);
        var result = await Tasks(role).Delete(task.Id, CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskItemStatus.Cancelled : TaskItemStatus.NotStarted, Stored(task.Id).Status);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Update_cannot_edit_or_retype_the_task_away_unless_an_admin(string role, bool allowed)
    {
        var task = Seed(TaskType.RetentionPurgeDue);
        var result = await Tasks(role).Update(task.Id, Edit(task, TaskType.RiskReview), CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskType.RiskReview : TaskType.RetentionPurgeDue, Stored(task.Id).TaskType);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Update_cannot_retype_another_task_into_it_unless_an_admin(string role, bool allowed)
    {
        var task = Seed(TaskType.RiskReview);
        var result = await Tasks(role).Update(task.Id, Edit(task, TaskType.RetentionPurgeDue), CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskType.RetentionPurgeDue : TaskType.RiskReview, Stored(task.Id).TaskType);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Create_is_an_admins(string role, bool allowed)
    {
        var result = await Tasks(role).Create(new CreateTaskDto { TripInstanceId = Guid.NewGuid(), TaskType = TaskType.RetentionPurgeDue, Title = "Records due" }, CancellationToken.None);
        Expect(allowed, result.Result);
    }

    [Fact]
    public async Task A_coordinator_still_changes_an_ordinary_task()
    {
        var task = Seed(TaskType.RiskReview);
        var result = await Tasks("Coordinator").Delete(task.Id, CancellationToken.None);
        Assert.IsNotType<ForbidResult>(result.Result);
        Assert.Equal(TaskItemStatus.Cancelled, Stored(task.Id).Status);
    }
}
