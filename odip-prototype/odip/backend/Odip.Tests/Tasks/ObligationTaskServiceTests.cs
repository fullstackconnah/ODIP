using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Tasks;
using Xunit;

namespace Odip.Tests.Tasks;

/// <summary>
/// Coverage for <see cref="ObligationTaskService"/> — the generic obligation-task engine (item 9
/// of the connection map). Exercises the service directly against an EF InMemory
/// <see cref="OdipDbContext"/>, same fixture pattern as TasksControllerTests. The service never
/// calls SaveChangesAsync itself (same "same SaveChanges as the caller" contract as
/// INotificationRaiser) — every test calls db.SaveChangesAsync() itself after invoking it.
/// </summary>
public class ObligationTaskServiceTests
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
    public async Task EnsureAsync_NoExistingTask_CreatesNotStartedTaskWithAllFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        var shiftId = Guid.NewGuid();
        var leaveId = Guid.NewGuid();

        await service.EnsureAsync(new ObligationTaskSpec(
            SourceKey: "leave-coverage:s1:l1", Type: TaskType.LeaveCoverage, Title: "Re-cover shift",
            DueDate: new DateOnly(2026, 9, 20), LinkTo: "/rostering?date=2026-09-20",
            ShiftId: shiftId, LeaveRequestId: leaveId, Priority: TaskPriority.High), CancellationToken.None);
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        Assert.Equal("leave-coverage:s1:l1", task.SourceKey);
        Assert.Equal(TaskType.LeaveCoverage, task.TaskType);
        Assert.Equal("Re-cover shift", task.Title);
        Assert.Equal(new DateOnly(2026, 9, 20), task.DueDate);
        Assert.Equal("/rostering?date=2026-09-20", task.LinkTo);
        Assert.Equal(shiftId, task.ShiftId);
        Assert.Equal(leaveId, task.LeaveRequestId);
        Assert.Equal(TaskPriority.High, task.Priority);
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
        Assert.Null(task.TripInstanceId);
        Assert.Null(task.CompletedDate);
        Assert.Null(task.AutoCompletedAt);
    }

    [Fact]
    public async Task EnsureAsync_SameSourceKeyTwice_DoesNotCreateASecondRow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        var spec = new ObligationTaskSpec("dup-key", TaskType.MedicationWitness, "First title", new DateOnly(2026, 9, 1), null);

        await service.EnsureAsync(spec, CancellationToken.None);
        await db.SaveChangesAsync();
        await service.EnsureAsync(spec, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.BookingTasks.CountAsync());
    }

    [Fact]
    public async Task EnsureAsync_ExistingNotStartedTask_RefreshesTitleAndDueDateOnly()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        await service.EnsureAsync(new ObligationTaskSpec(
            "key-1", TaskType.IncidentQscReport, "Original title", new DateOnly(2026, 9, 1), "/incidents/x",
            Priority: TaskPriority.High), CancellationToken.None);
        await db.SaveChangesAsync();

        // Second call with a different title/due date and a different (ignored) priority.
        await service.EnsureAsync(new ObligationTaskSpec(
            "key-1", TaskType.IncidentQscReport, "Updated title", new DateOnly(2026, 9, 5), "/incidents/x",
            Priority: TaskPriority.Low), CancellationToken.None);
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        Assert.Equal("Updated title", task.Title);
        Assert.Equal(new DateOnly(2026, 9, 5), task.DueDate);
        // Priority/Status are left as-is by a refresh — a coordinator may have already started it.
        Assert.Equal(TaskPriority.High, task.Priority);
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
    }

    [Fact]
    public async Task EnsureAsync_ExistingInProgressTask_AlsoRefreshesTitleAndDueDate()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        await service.EnsureAsync(new ObligationTaskSpec("key-2", TaskType.FlaggedNoteFollowUp, "Original", new DateOnly(2026, 9, 1), null), CancellationToken.None);
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        task.Status = TaskItemStatus.InProgress;
        await db.SaveChangesAsync();

        await service.EnsureAsync(new ObligationTaskSpec("key-2", TaskType.FlaggedNoteFollowUp, "Refreshed", new DateOnly(2026, 9, 9), null), CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.BookingTasks.SingleAsync();
        Assert.Equal("Refreshed", reloaded.Title);
        Assert.Equal(new DateOnly(2026, 9, 9), reloaded.DueDate);
        Assert.Equal(TaskItemStatus.InProgress, reloaded.Status);
    }

    [Fact]
    public async Task EnsureAsync_ExistingCompletedTask_NeverReopensOrChangesTitle()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        await service.EnsureAsync(new ObligationTaskSpec("key-3", TaskType.MedicationWitness, "Original", new DateOnly(2026, 9, 1), null), CancellationToken.None);
        await db.SaveChangesAsync();
        await service.CompleteAsync("key-3", CancellationToken.None);
        await db.SaveChangesAsync();

        await service.EnsureAsync(new ObligationTaskSpec("key-3", TaskType.MedicationWitness, "A brand new obligation", new DateOnly(2026, 12, 25), null), CancellationToken.None);
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal("Original", task.Title);
        Assert.Equal(new DateOnly(2026, 9, 1), task.DueDate);
    }

    [Fact]
    public async Task EnsureAsync_ExistingCancelledTask_NeverReopens()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        await service.EnsureAsync(new ObligationTaskSpec("key-4", TaskType.LeaveCoverage, "Original", new DateOnly(2026, 9, 1), null), CancellationToken.None);
        await db.SaveChangesAsync();
        var task = await db.BookingTasks.SingleAsync();
        task.Status = TaskItemStatus.Cancelled;
        await db.SaveChangesAsync();

        await service.EnsureAsync(new ObligationTaskSpec("key-4", TaskType.LeaveCoverage, "New title", new DateOnly(2026, 12, 1), null), CancellationToken.None);
        await db.SaveChangesAsync();

        var reloaded = await db.BookingTasks.SingleAsync();
        Assert.Equal(TaskItemStatus.Cancelled, reloaded.Status);
        Assert.Equal("Original", reloaded.Title);
    }

    [Fact]
    public async Task CompleteAsync_ExistingNotStartedTask_MarksCompletedWithAutoCompletedAt()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        await service.EnsureAsync(new ObligationTaskSpec("key-5", TaskType.IncidentQscReport, "Report it", new DateOnly(2026, 9, 1), null), CancellationToken.None);
        await db.SaveChangesAsync();

        await service.CompleteAsync("key-5", CancellationToken.None);
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(DateOnly.FromDateTime(DateTime.UtcNow), task.CompletedDate);
        Assert.NotNull(task.AutoCompletedAt);
    }

    [Fact]
    public async Task CompleteAsync_NoMatchingSourceKey_NoOpDoesNotThrow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);

        await service.CompleteAsync("nonexistent", CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Equal(0, await db.BookingTasks.CountAsync());
    }

    [Fact]
    public async Task CompleteAsync_AlreadyCompleted_NoOp()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        await service.EnsureAsync(new ObligationTaskSpec("key-6", TaskType.MedicationWitness, "T", new DateOnly(2026, 9, 1), null), CancellationToken.None);
        await db.SaveChangesAsync();
        await service.CompleteAsync("key-6", CancellationToken.None);
        await db.SaveChangesAsync();
        var firstCompletedAt = (await db.BookingTasks.SingleAsync()).AutoCompletedAt;

        await service.CompleteAsync("key-6", CancellationToken.None);
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        Assert.Equal(firstCompletedAt, task.AutoCompletedAt);
    }

    [Fact]
    public async Task CompleteByShiftAsync_OnlyCompletesTasksOfTheGivenType()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        var shiftId = Guid.NewGuid();

        await service.EnsureAsync(new ObligationTaskSpec("leave-coverage:s:l1", TaskType.LeaveCoverage, "Cover it", new DateOnly(2026, 9, 1), null, ShiftId: shiftId), CancellationToken.None);
        await service.EnsureAsync(new ObligationTaskSpec("other:s", TaskType.IncidentQscReport, "Other obligation", new DateOnly(2026, 9, 1), null, ShiftId: shiftId), CancellationToken.None);
        await db.SaveChangesAsync();

        await service.CompleteByShiftAsync(shiftId, TaskType.LeaveCoverage, CancellationToken.None);
        await db.SaveChangesAsync();

        var leaveCoverage = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.LeaveCoverage);
        var other = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.IncidentQscReport);
        Assert.Equal(TaskItemStatus.Completed, leaveCoverage.Status);
        Assert.Equal(TaskItemStatus.NotStarted, other.Status);
    }

    [Fact]
    public async Task CompleteByLeaveAsync_CompletesEveryLeaveCoverageTaskForThatLeaveRegardlessOfShift()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var service = new ObligationTaskService(db);
        var leaveId = Guid.NewGuid();
        var shift1 = Guid.NewGuid();
        var shift2 = Guid.NewGuid();

        await service.EnsureAsync(new ObligationTaskSpec($"leave-coverage:{shift1}:{leaveId}", TaskType.LeaveCoverage, "Cover shift 1", new DateOnly(2026, 9, 1), null, ShiftId: shift1, LeaveRequestId: leaveId), CancellationToken.None);
        await service.EnsureAsync(new ObligationTaskSpec($"leave-coverage:{shift2}:{leaveId}", TaskType.LeaveCoverage, "Cover shift 2", new DateOnly(2026, 9, 2), null, ShiftId: shift2, LeaveRequestId: leaveId), CancellationToken.None);
        await db.SaveChangesAsync();

        await service.CompleteByLeaveAsync(leaveId, CancellationToken.None);
        await db.SaveChangesAsync();

        var tasks = await db.BookingTasks.ToListAsync();
        Assert.All(tasks, t => Assert.Equal(TaskItemStatus.Completed, t.Status));
    }

    /// <summary>Mandatory cross-tenant coverage: a generic obligation task (no TripInstanceId to inherit tenant scoping from) created under tenant A must not be visible to tenant B.</summary>
    [Fact]
    public async Task ObligationTask_CreatedUnderTenantA_NotVisibleToTenantB()
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
            var service = new ObligationTaskService(dbA);
            await service.EnsureAsync(new ObligationTaskSpec("tenant-a-task", TaskType.MedicationWitness, "Witness needed", new DateOnly(2026, 9, 1), null), CancellationToken.None);
            await dbA.SaveChangesAsync();
        }

        var tenantB = new Mock<ICurrentTenant>();
        tenantB.Setup(t => t.TenantId).Returns(tenantBId);
        tenantB.Setup(t => t.IsSuperAdmin).Returns(false);
        var optionsB = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        using var dbB = new OdipDbContext(optionsB, tenantB.Object);

        Assert.Empty(await dbB.BookingTasks.ToListAsync());
    }
}
