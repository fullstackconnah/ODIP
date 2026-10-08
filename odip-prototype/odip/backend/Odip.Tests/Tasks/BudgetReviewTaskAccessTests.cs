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

/// <summary>
/// Who may touch the Admin's review of an emergency booking past budget (the phase 3 review, C2, C7 and the design review's M10). The owner's decision is that an Admin reviews an emergency afterwards, so the
/// server holds the task to that: only an Admin or SuperAdmin may complete, cancel, delete or retype it (a Coordinator, who is the one who made the emergency, may not tick it off), and a role that must never see
/// budget standing (SupportWorker, ReadOnly) does not see the task at all. Whoever completes it becomes its owner, which is how the shift panel can say who reviewed it.
/// </summary>
public class BudgetReviewTaskAccessTests : IDisposable
{
    private readonly OdipDbContext _db;

    public BudgetReviewTaskAccessTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    public void Dispose() => _db.Dispose();

    private static ControllerContext As(string role, Guid? userId = null)
    {
        var claims = new List<Claim> { new(ClaimTypes.Role, role) };
        if (userId is { } id) claims.Add(new Claim(ClaimTypes.NameIdentifier, id.ToString()));
        return new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } };
    }

    private TasksController Tasks(string role, Guid? userId = null) => new(_db) { ControllerContext = As(role, userId) };

    private DashboardController Dashboard(string role) => new(_db) { ControllerContext = As(role) };

    private User SeedUser(string first = "Ada", string last = "Admin")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = first, LastName = last, Username = $"{first}.{last}".ToLowerInvariant(), Email = $"{first}.{last}@example.com".ToLowerInvariant(), IsActive = true,
        };
        _db.Users.Add(user);
        _db.SaveChanges();
        return user;
    }

    private BookingTask SeedTask(TaskType type, DateOnly? due = null, string? title = null)
    {
        var task = new BookingTask
        {
            Id = Guid.NewGuid(), TaskType = type, Title = title ?? (type == TaskType.BudgetEmergencyReview ? "Review emergency shift past budget: Sienna Whitfield on 9 Oct 2026" : "Ring the venue"),
            SourceKey = type == TaskType.BudgetEmergencyReview ? $"budget-emergency:{Guid.NewGuid()}" : null, DueDate = due, Status = TaskItemStatus.NotStarted, Priority = TaskPriority.Medium,
        };
        _db.BookingTasks.Add(task);
        _db.SaveChanges();
        return task;
    }

    private static UpdateTaskDto Edit(BookingTask task, TaskItemStatus? status = null, TaskType? type = null, Guid? ownerId = null) => new()
    {
        TaskType = type ?? task.TaskType, Title = task.Title, OwnerId = ownerId ?? task.OwnerId, Priority = task.Priority, DueDate = task.DueDate, Status = status ?? task.Status,
        CompletedDate = status == TaskItemStatus.Completed ? new DateOnly(2026, 10, 9) : task.CompletedDate, Notes = task.Notes,
    };

    private BookingTask Stored(Guid id) => _db.BookingTasks.AsNoTracking().Single(t => t.Id == id);

    // ── Completing, cancelling, deleting and retyping ───────────────────────

    [Fact]
    public async Task ACoordinatorCannotCompleteTheReviewOfTheirOwnEmergency()
    {
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        var result = await Tasks("Coordinator").Update(review.Id, Edit(review, TaskItemStatus.Completed), CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Equal(TaskItemStatus.NotStarted, Stored(review.Id).Status);
    }

    [Fact]
    public async Task ACoordinatorCannotRetypeTheReviewIntoSomethingElse_SoItCannotBeClosedAsAnotherKindOfTask()
    {
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        var result = await Tasks("Coordinator").Update(review.Id, Edit(review, type: TaskType.RiskReview), CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Equal(TaskType.BudgetEmergencyReview, Stored(review.Id).TaskType);
    }

    [Fact]
    public async Task ACoordinatorCannotMakeAnOrdinaryTaskIntoAReviewEither()
    {
        var ordinary = SeedTask(TaskType.RiskReview);

        var result = await Tasks("Coordinator").Update(ordinary.Id, Edit(ordinary, type: TaskType.BudgetEmergencyReview), CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Equal(TaskType.RiskReview, Stored(ordinary.Id).TaskType);
    }

    [Fact]
    public async Task ACoordinatorCannotCreateAReviewTask()
    {
        var result = await Tasks("Coordinator").Create(
            new CreateTaskDto { TripInstanceId = Guid.NewGuid(), TaskType = TaskType.BudgetEmergencyReview, Title = "Review emergency shift past budget: nobody" }, CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Empty(_db.BookingTasks);
    }

    [Fact]
    public async Task ACoordinatorCannotCancelTheReview_ByDeletingIt()
    {
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        var result = await Tasks("Coordinator").Delete(review.Id, CancellationToken.None);

        Assert.IsType<ForbidResult>(result.Result);
        Assert.Equal(TaskItemStatus.NotStarted, Stored(review.Id).Status);
    }

    [Fact]
    public async Task ACoordinatorStillManagesEveryOtherTask()
    {
        var ordinary = SeedTask(TaskType.RiskReview);

        var updated = await Tasks("Coordinator").Update(ordinary.Id, Edit(ordinary, TaskItemStatus.Completed), CancellationToken.None);
        var deleted = await Tasks("Coordinator").Delete(ordinary.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updated.Result);
        Assert.IsType<OkObjectResult>(deleted.Result);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    public async Task AnAdminCompletesTheReview_AndBecomesItsOwner_SoTheShiftCanSayWhoReviewedIt(string role)
    {
        var admin = SeedUser();
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        var result = await Tasks(role, admin.Id).Update(review.Id, Edit(review, TaskItemStatus.Completed), CancellationToken.None);

        var task = Assert.IsType<ApiResponse<TaskDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(admin.Id, task.OwnerId);
        Assert.Equal("Ada Admin", task.OwnerName);
        Assert.Equal(admin.Id, Stored(review.Id).OwnerId);
    }

    [Fact]
    public async Task AnAdminWhoOnlyEditsTheReview_DoesNotTakeItOver()
    {
        var admin = SeedUser();
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        await Tasks("Admin", admin.Id).Update(review.Id, Edit(review, TaskItemStatus.InProgress), CancellationToken.None);

        Assert.Null(Stored(review.Id).OwnerId);   // started, not finished: nobody has reviewed it yet
    }

    [Fact]
    public async Task AnAdminWhoNamesAnOwnerOnCompletion_KeepsThatOwner()
    {
        var admin = SeedUser();
        var colleague = SeedUser("Ben", "Boss");
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        await Tasks("Admin", admin.Id).Update(review.Id, Edit(review, TaskItemStatus.Completed, ownerId: colleague.Id), CancellationToken.None);

        Assert.Equal(colleague.Id, Stored(review.Id).OwnerId);
    }

    // ── Who sees it ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Admin", true)]
    [InlineData("SuperAdmin", true)]
    [InlineData("Coordinator", true)]
    [InlineData("SupportWorker", false)]
    [InlineData("ReadOnly", false)]
    public async Task TheReviewIsInTheTaskListOnlyForTheRolesThatMaySeeBudgetStanding(string role, bool seen)
    {
        var review = SeedTask(TaskType.BudgetEmergencyReview);
        var ordinary = SeedTask(TaskType.RiskReview);

        var result = await Tasks(role).GetAll(null, null, null, null, CancellationToken.None);

        var ids = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Select(t => t.Id).ToList();
        Assert.Contains(ordinary.Id, ids);
        Assert.Equal(seen, ids.Contains(review.Id));
    }

    [Theory]
    [InlineData("Coordinator", true)]
    [InlineData("SupportWorker", false)]
    [InlineData("ReadOnly", false)]
    public async Task TheReviewByIdIsNotFoundForARoleThatMayNotSeeIt(string role, bool seen)
    {
        var review = SeedTask(TaskType.BudgetEmergencyReview);

        var result = await Tasks(role).GetById(review.Id, CancellationToken.None);

        if (seen) Assert.IsType<OkObjectResult>(result.Result);
        else Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task TheDashboardLeavesAnOverdueReviewOutForARoleThatMayNotSeeIt_AndCountsWhatItLists()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        SeedTask(TaskType.BudgetEmergencyReview, due: today.AddDays(-2));
        SeedTask(TaskType.RiskReview, due: today.AddDays(-1));

        var worker = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await Dashboard("SupportWorker").GetSummary(CancellationToken.None)).Result).Value).Data!;
        var coordinator = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await Dashboard("Coordinator").GetSummary(CancellationToken.None)).Result).Value).Data!;

        Assert.Equal((1, 1), (worker.OverdueTaskCount, worker.OverdueTasks.Count));
        Assert.Equal(1, worker.OutstandingTaskCount);
        Assert.Equal((2, 2), (coordinator.OverdueTaskCount, coordinator.OverdueTasks.Count));
        Assert.Equal(2, coordinator.OutstandingTaskCount);
    }
}
