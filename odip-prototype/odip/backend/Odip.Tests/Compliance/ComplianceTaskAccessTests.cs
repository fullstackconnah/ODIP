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

namespace Odip.Tests.Compliance;

/// <summary>A compliance-date task is an Admin's: no other role sees it in the list, by id or in the overdue count, and a Coordinator may not complete, cancel, delete, create or retype it. The retention task shares the rule (RetentionPurgeAudience).</summary>
public class ComplianceTaskAccessTests : IDisposable
{
    private readonly OdipDbContext _db;
    private readonly BookingTask _compliance;
    private readonly BookingTask _ordinary;

    public ComplianceTaskAccessTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var past = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-2);
        _compliance = Seed(TaskType.ComplianceDue, past);
        _ordinary = Seed(TaskType.RiskReview, past);
    }

    public void Dispose() => _db.Dispose();

    private BookingTask Seed(TaskType type, DateOnly? due = null)
    {
        var task = new BookingTask { Id = Guid.NewGuid(), TaskType = type, Title = type == TaskType.ComplianceDue ? "NDIS registration expired on 1 Nov 2026" : "Ring the venue", DueDate = due, Status = TaskItemStatus.NotStarted, Priority = TaskPriority.Medium };
        _db.BookingTasks.Add(task);
        _db.SaveChanges();
        return task;
    }

    private static ControllerContext As(string role) =>
        new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) } };

    private TasksController Tasks(string role) => new(_db) { ControllerContext = As(role) };

    private BookingTask Stored(Guid id) => _db.BookingTasks.AsNoTracking().Single(t => t.Id == id);

    private static UpdateTaskDto Edit(BookingTask task, TaskType type) => new() { TaskType = type, Title = task.Title, Priority = task.Priority, Status = TaskItemStatus.NotStarted };

    public static TheoryData<string, bool> Roles => new() { { "SupportWorker", false }, { "ReadOnly", false }, { "Coordinator", false }, { "Admin", true }, { "SuperAdmin", true } };

    private static void Expect(bool allowed, object? result)
    {
        if (allowed) Assert.IsNotType<ForbidResult>(result);
        else Assert.IsType<ForbidResult>(result);
    }

    [Theory]
    [InlineData("Admin", true)]
    [InlineData("Coordinator", false)]
    [InlineData("SupportWorker", false)]
    [InlineData("ReadOnly", false)]
    public async Task OnlyAnAdminSeesTheTask_InTheListAndById(string role, bool seen)
    {
        var tasks = Tasks(role);

        var page = Assert.IsType<ApiResponse<PagedResult<TaskDto>>>(Assert.IsType<OkObjectResult>((await tasks.GetAll(null, null, null, null, CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(seen, page.Items.Any(t => t.Id == _compliance.Id));
        Assert.Contains(page.Items, t => t.Id == _ordinary.Id);

        var byId = await tasks.GetById(_compliance.Id, CancellationToken.None);
        if (seen) Assert.IsType<OkObjectResult>(byId.Result); else Assert.IsType<NotFoundObjectResult>(byId.Result);
    }

    [Fact]
    public async Task TheDashboardCountsLeaveTheTaskOutForACoordinator()
    {
        async Task<DashboardSummaryDto> Summary(string role) =>
            Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await new DashboardController(_db) { ControllerContext = As(role) }.GetSummary(CancellationToken.None)).Result).Value).Data!;

        var coordinator = await Summary("Coordinator");
        var admin = await Summary("Admin");

        Assert.Equal((1, 1), (coordinator.OverdueTaskCount, coordinator.OutstandingTaskCount));
        Assert.Equal((2, 2), (admin.OverdueTaskCount, admin.OutstandingTaskCount));
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task SetStatus_is_an_admins(string role, bool allowed)
    {
        var result = await Tasks(role).SetStatus(_compliance.Id, new SetTaskStatusDto { Status = TaskItemStatus.InProgress }, CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskItemStatus.InProgress : TaskItemStatus.NotStarted, Stored(_compliance.Id).Status);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Complete_is_an_admins(string role, bool allowed)
    {
        var task = Seed(TaskType.ComplianceDue);
        var result = await Tasks(role).Complete(task.Id, new CompleteTaskDto { CompletedDate = new DateOnly(2026, 11, 6) }, CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskItemStatus.Completed : TaskItemStatus.NotStarted, Stored(task.Id).Status);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Delete_is_an_admins(string role, bool allowed)
    {
        var task = Seed(TaskType.ComplianceDue);
        var result = await Tasks(role).Delete(task.Id, CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskItemStatus.Cancelled : TaskItemStatus.NotStarted, Stored(task.Id).Status);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Update_cannot_retype_the_task_away_unless_an_admin(string role, bool allowed)
    {
        var task = Seed(TaskType.ComplianceDue);
        var result = await Tasks(role).Update(task.Id, Edit(task, TaskType.RiskReview), CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskType.RiskReview : TaskType.ComplianceDue, Stored(task.Id).TaskType);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Update_cannot_retype_another_task_into_it_unless_an_admin(string role, bool allowed)
    {
        var task = Seed(TaskType.RiskReview);
        var result = await Tasks(role).Update(task.Id, Edit(task, TaskType.ComplianceDue), CancellationToken.None);
        Expect(allowed, result.Result);
        Assert.Equal(allowed ? TaskType.ComplianceDue : TaskType.RiskReview, Stored(task.Id).TaskType);
    }

    [Theory, MemberData(nameof(Roles))]
    public async Task Create_is_an_admins(string role, bool allowed)
    {
        var result = await Tasks(role).Create(new CreateTaskDto { TripInstanceId = Guid.NewGuid(), TaskType = TaskType.ComplianceDue, Title = "Registration expires" }, CancellationToken.None);
        Expect(allowed, result.Result);
    }
}
