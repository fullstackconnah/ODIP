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
using Odip.Infrastructure.Services;
using Odip.Infrastructure.Tasks;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Tasks;

/// <summary>
/// "Today" for a calendar rule (overdue, due this week, plan expired, review overdue, the date a task was completed) is the PROVIDER's
/// date, never the UTC date. Sydney is UTC+10 (AEST) and UTC+11 from Sun 2026-10-04 02:00, so for the first 10-11 hours of every
/// Sydney day the UTC date is still yesterday and a "due yesterday" item was not yet overdue (L3-03). Every test here fixes the clock
/// at a moment where the two dates differ.
///
/// Sydney clock times used below:   2026-10-02 22:00Z = Sat 3 Oct 08:00 AEST     2026-10-03 12:00Z = Sat 3 Oct 22:00 AEST
/// </summary>
public class ProviderTodayTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static ICurrentTenant SuperAdmin()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return tenant.Object;
    }

    private static BookingTask Task(string key, DateOnly? due, TaskItemStatus status = TaskItemStatus.NotStarted) => new()
    {
        Id = Guid.NewGuid(), TaskType = TaskType.IncidentQscReport, Title = key, SourceKey = key, DueDate = due, Status = status,
    };

    private static readonly DateOnly Oct2 = new(2026, 10, 2);
    private static readonly DateOnly Oct3 = new(2026, 10, 3);

    // ── Dashboard + Tasks list (L3-03) ───────────────────────────────────

    [Fact]
    public async Task Dashboard_Overdue_CountsATaskDueYesterdayInSydney_FromSydneyMidnight()
    {
        using var db = CreateDb();
        db.BookingTasks.Add(Task("due-yesterday-in-sydney", Oct2));   // Sydney's today is 3 Oct, so this is overdue
        db.BookingTasks.Add(Task("due-today-in-sydney", Oct3));       // not overdue until Sydney's midnight
        await db.SaveChangesAsync();
        var controller = new DashboardController(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        var body = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await controller.GetSummary(CancellationToken.None)).Result).Value);

        Assert.Equal(1, body.Data!.OverdueTaskCount);
        Assert.Equal("due-yesterday-in-sydney", Assert.Single(body.Data.OverdueTasks).SourceKey);
    }

    [Fact]
    public async Task TasksList_OverdueFilter_ReturnsExactlyTheTasksTheDashboardCountsAsOverdue()
    {
        using var db = CreateDb();
        db.BookingTasks.AddRange(
            Task("late-by-date", Oct2),                                                // NotStarted, past its due date
            Task("stored-overdue", Oct3.AddDays(5), TaskItemStatus.Overdue),           // the stored status says Overdue
            Task("done", Oct2.AddDays(-5), TaskItemStatus.Completed),                  // closed, never overdue
            Task("cancelled", Oct2.AddDays(-5), TaskItemStatus.Cancelled),
            Task("due-today", Oct3),
            Task("future", Oct3.AddDays(3)));
        await db.SaveChangesAsync();
        var clock = FakeClock.AtUtc(2026, 10, 3, 12, 0);

        var dashboard = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>(
            (await new DashboardController(db, clock).GetSummary(CancellationToken.None)).Result).Value).Data!;
        var list = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>(
            (await new TasksController(db, clock).GetAll(null, TaskItemStatus.Overdue, null, null, CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(2, dashboard.OverdueTaskCount);
        Assert.Equal(dashboard.OverdueTasks.Select(t => t.SourceKey).Order(), list.Select(t => t.SourceKey).Order());
    }

    [Fact]
    public async Task TasksList_DueThisWeek_StartsOnSydneysToday()
    {
        using var db = CreateDb();
        db.BookingTasks.AddRange(Task("yesterday-in-sydney", Oct2), Task("today-in-sydney", Oct3), Task("next-week", Oct3.AddDays(7)), Task("later", Oct3.AddDays(8)));
        await db.SaveChangesAsync();
        var controller = new TasksController(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        var list = Assert.IsType<ApiResponse<List<TaskDto>>>(Assert.IsType<OkObjectResult>(
            (await controller.GetAll(null, null, true, null, CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(["today-in-sydney", "next-week"], list.Select(t => t.SourceKey));
    }

    // ── Participant alerts: plan expiry ──────────────────────────────────

    [Fact]
    public async Task Alerts_APlanThatEndedYesterdayInSydney_IsExpired_NotExpiringToday()
    {
        using var db = CreateDb();
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, PlanEndDate = Oct2 });
        await db.SaveChangesAsync();
        var service = new ParticipantAlertsService(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        var alerts = (await service.GetAlertsAsync(null, activeOnly: true)).Single().Alerts;

        var plan = Assert.Single(alerts, a => a.Type is "plan-expired" or "plan-expiring-soon");
        Assert.Equal("plan-expired", plan.Type);
        Assert.Equal(AlertSeverity.Critical, plan.Severity);
    }

    // ── Medication register: review overdue ──────────────────────────────

    [Fact]
    public async Task MedicationList_AReviewDueYesterdayInSydney_IsFlaggedReviewOverdue_AReviewDueTodayIsNot()
    {
        using var db = CreateDb();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.ParticipantMedications.AddRange(
            Medication(participant.Id, "Due yesterday", new DateTime(2026, 10, 2)),
            Medication(participant.Id, "Due today", new DateTime(2026, 10, 3)));
        await db.SaveChangesAsync();
        var clock = FakeClock.AtUtc(2026, 10, 2, 22, 0);
        var controller = new MedicationsController(db, SuperAdmin(), slots: new MedicationSlotService(db, clock));

        var list = Assert.IsType<ApiResponse<List<MedicationListDto>>>(Assert.IsType<OkObjectResult>(
            (await controller.GetForParticipant(participant.Id, false, CancellationToken.None)).Result).Value).Data!;

        Assert.Contains("ReviewOverdue", list.Single(m => m.Name == "Due yesterday").ComplianceFlags);
        Assert.DoesNotContain("ReviewOverdue", list.Single(m => m.Name == "Due today").ComplianceFlags);
    }

    private static ParticipantMedication Medication(Guid participantId, string name, DateTime nextReviewDue) => new()
    {
        Id = Guid.NewGuid(), ParticipantId = participantId, Name = name, DoseDescription = "1 tablet",
        Type = MedicationType.Regular, TimesOfDay = "08:00", Status = MedicationStatus.Active, ConsentObtained = true,
        StartDate = new DateTime(2026, 1, 1), NextReviewDue = nextReviewDue,
    };

    // ── Obligation tasks: the date a task was completed ──────────────────

    [Fact]
    public async Task AnObligationTaskCompletedOnSaturdayMorningInSydney_IsCompletedOnSaturday_NotFriday()
    {
        using var db = CreateDb();
        db.BookingTasks.Add(Task("incident-qsc:1", Oct3));
        await db.SaveChangesAsync();
        var service = new ObligationTaskService(db, FakeClock.AtUtc(2026, 10, 2, 22, 0));

        await service.CompleteAsync("incident-qsc:1");
        await db.SaveChangesAsync();

        var task = await db.BookingTasks.SingleAsync();
        Assert.Equal(TaskItemStatus.Completed, task.Status);
        Assert.Equal(Oct3, task.CompletedDate);
    }
}
