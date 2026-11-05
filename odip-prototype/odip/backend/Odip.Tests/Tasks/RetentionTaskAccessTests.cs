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

/// <summary>F5: the "records due for purge" task counts archived participants, so only an Admin sees it: in the list, its total, by id and in the dashboard counts.</summary>
public class RetentionTaskAccessTests : IDisposable
{
    private readonly OdipDbContext _db;
    private readonly BookingTask _purge;
    private readonly BookingTask _ordinary;

    public RetentionTaskAccessTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var past = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-2);
        _purge = new BookingTask { Id = Guid.NewGuid(), TaskType = TaskType.RetentionPurgeDue, Title = "2 participant records are due for purge", SourceKey = $"retention-due:{Guid.NewGuid()}:x", DueDate = past, Status = TaskItemStatus.NotStarted, Priority = TaskPriority.Medium };
        _ordinary = new BookingTask { Id = Guid.NewGuid(), TaskType = TaskType.RiskReview, Title = "Ring the venue", DueDate = past, Status = TaskItemStatus.NotStarted, Priority = TaskPriority.Medium };
        _db.BookingTasks.AddRange(_purge, _ordinary);
        _db.SaveChanges();
    }

    public void Dispose() => _db.Dispose();

    private static ControllerContext As(string role) =>
        new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) } };

    [Theory]
    [InlineData("Admin", true)]
    [InlineData("Coordinator", false)]
    [InlineData("SupportWorker", false)]
    [InlineData("ReadOnly", false)]
    public async Task OnlyAnAdminSeesTheTask_InTheListItsTotalAndById(string role, bool seen)
    {
        var tasks = new TasksController(_db) { ControllerContext = As(role) };

        var page = Assert.IsType<ApiResponse<PagedResult<TaskDto>>>(Assert.IsType<OkObjectResult>((await tasks.GetAll(null, null, null, null, CancellationToken.None)).Result).Value).Data!;
        Assert.Equal(seen, page.Items.Any(t => t.Id == _purge.Id));
        Assert.Contains(page.Items, t => t.Id == _ordinary.Id);
        Assert.Equal(page.Items.Count, page.TotalCount);

        var byId = await tasks.GetById(_purge.Id, CancellationToken.None);
        if (seen) Assert.IsType<OkObjectResult>(byId.Result); else Assert.IsType<NotFoundObjectResult>(byId.Result);
    }

    [Fact]
    public async Task TheDashboardCountsLeaveTheTaskOutForEveryoneButAnAdmin()
    {
        async Task<DashboardSummaryDto> Summary(string role) =>
            Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await new DashboardController(_db) { ControllerContext = As(role) }.GetSummary(CancellationToken.None)).Result).Value).Data!;

        var coordinator = await Summary("Coordinator");
        var admin = await Summary("Admin");

        Assert.Equal((1, 1), (coordinator.OverdueTaskCount, coordinator.OutstandingTaskCount));
        Assert.Equal((2, 2), (admin.OverdueTaskCount, admin.OutstandingTaskCount));
    }
}
