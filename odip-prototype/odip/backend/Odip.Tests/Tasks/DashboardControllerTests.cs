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
/// Item 9 of the connection map: DashboardController.GetSummary's OverdueTaskCount/OverdueTasks
/// must count and list a generic obligation task (no TripInstanceId) exactly like a trip-linked
/// one — same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as TasksControllerTests.
/// </summary>
public class DashboardControllerTests
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

    [Fact]
    public async Task GetSummary_OverdueTripLessGenericTask_IsCountedAndListedWithNullTripName()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        db.BookingTasks.Add(new BookingTask
        {
            Id = Guid.NewGuid(), TaskType = TaskType.IncidentQscReport, Title = "Report incident",
            SourceKey = "incident-qsc:overdue", DueDate = today.AddDays(-1), Status = TaskItemStatus.NotStarted,
        });
        await db.SaveChangesAsync();
        var controller = new DashboardController(db);

        var result = await controller.GetSummary(CancellationToken.None);

        var body = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(1, body.Data!.OverdueTaskCount);
        var task = Assert.Single(body.Data.OverdueTasks);
        Assert.Null(task.TripInstanceId);
        Assert.Null(task.TripName);
        Assert.Equal("incident-qsc:overdue", task.SourceKey);
    }

    [Fact]
    public async Task GetSummary_NotYetDueGenericTask_IsNotCountedAsOverdue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        db.BookingTasks.Add(new BookingTask
        {
            Id = Guid.NewGuid(), TaskType = TaskType.MedicationWitness, Title = "Witness sign-off needed",
            SourceKey = "med-witness:not-due", DueDate = today.AddDays(5), Status = TaskItemStatus.NotStarted,
        });
        await db.SaveChangesAsync();
        var controller = new DashboardController(db);

        var result = await controller.GetSummary(CancellationToken.None);

        var body = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(0, body.Data!.OverdueTaskCount);
        Assert.Empty(body.Data.OverdueTasks);
        // OutstandingTaskCount is not date-gated — every non-Completed/Cancelled task counts.
        Assert.Equal(1, body.Data.OutstandingTaskCount);
    }
}
