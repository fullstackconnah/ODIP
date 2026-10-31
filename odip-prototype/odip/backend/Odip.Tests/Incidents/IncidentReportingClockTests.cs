using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>The NDIS Commission clock on Create: the default class, the stored deadlines and the two tasks they raise.</summary>
public class IncidentReportingClockTests
{
    // Monday 2 Nov 2026, 11:30 in Sydney (AEDT, UTC+11).
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 0, 30, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static (OdipDbContext Db, IncidentsController Controller, User Reporter) Arrange()
    {
        var db = TestDb.Create(Guid.NewGuid().ToString());
        var reporter = new User
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Alex", LastName = "Rivera",
            Username = "alex.rivera", Email = "alex.rivera@example.com", IsActive = true,
        };
        db.Users.Add(reporter);
        db.SaveChanges();
        return (db, new IncidentsController(db, clock: new FixedClock(Now)), reporter);
    }

    private static CreateIncidentDto Dto(Guid reporterId, IncidentSeverity severity, IncidentType type = IncidentType.PropertyDamage) => new()
    {
        ReportedByStaffId = reporterId, IncidentType = type, Severity = severity, Title = "Incident title", Description = "What happened.",
        IncidentDateTime = new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc),
    };

    [Theory]
    [InlineData(IncidentSeverity.Critical, IncidentType.PropertyDamage, null, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.Low, IncidentType.Abuse, null, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.Low, IncidentType.Neglect, null, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.Low, IncidentType.Death, null, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.Low, IncidentType.MissingPerson, null, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.Low, IncidentType.RestrictivePracticeUse, true, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.Low, IncidentType.PropertyDamage, false, ReportableClass.Within24h)]
    [InlineData(IncidentSeverity.High, IncidentType.PropertyDamage, null, ReportableClass.None)]
    [InlineData(IncidentSeverity.Medium, IncidentType.Injury, true, ReportableClass.None)]
    public void DefaultClass_FollowsSeverityTypeAndAuthorisation(IncidentSeverity severity, IncidentType type, bool? authorised, ReportableClass expected) =>
        Assert.Equal(expected, QscReporting.DefaultClass(severity, type, authorised));

    [Fact]
    public async Task Create_Critical_StoresAwareAtDuesAndRequiredStatus()
    {
        var (db, controller, reporter) = Arrange();
        using var _ = db;

        Assert.IsType<OkObjectResult>((await controller.Create(Dto(reporter.Id, IncidentSeverity.Critical), CancellationToken.None)).Result);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(Now.UtcDateTime, saved.CreatedAt);
        Assert.Equal(Now.UtcDateTime, saved.AwareAt);
        Assert.Equal(ReportableClass.Within24h, saved.ReportableClass);
        Assert.Equal(QscReportingStatus.Required, saved.QscReportingStatus);
        Assert.Equal(Now.UtcDateTime.AddHours(24), saved.NotifyDueAt);
        // Five business days after Monday 2 Nov: Tue to Fri, then Mon 9 Nov, end of day in Sydney. No holiday rows exist, so only weekends were skipped.
        Assert.Equal(new DateTime(2026, 11, 9, 12, 59, 59, DateTimeKind.Utc), saved.DetailedReportDueAt);
        Assert.True(saved.DueCountedWithoutHolidays);
    }

    [Fact]
    public async Task Create_NotReportable_HasNoDuesAndNoTasks()
    {
        var (db, controller, reporter) = Arrange();
        using var _ = db;

        await controller.Create(Dto(reporter.Id, IncidentSeverity.Medium), CancellationToken.None);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(ReportableClass.None, saved.ReportableClass);
        Assert.Equal(QscReportingStatus.NotRequired, saved.QscReportingStatus);
        Assert.Null(saved.NotifyDueAt);
        Assert.Null(saved.DetailedReportDueAt);
        Assert.Empty(await db.BookingTasks.ToListAsync());
    }

    [Fact]
    public async Task Create_Critical_RaisesBothTasksDueOnTheirProviderLocalDays()
    {
        var (db, controller, reporter) = Arrange();
        using var _ = db;

        await controller.Create(Dto(reporter.Id, IncidentSeverity.Critical), CancellationToken.None);

        var tasks = await db.BookingTasks.ToListAsync();
        Assert.Equal(new DateOnly(2026, 11, 3), Assert.Single(tasks, t => t.TaskType == TaskType.IncidentQscReport).DueDate);
        Assert.Equal(new DateOnly(2026, 11, 9), Assert.Single(tasks, t => t.TaskType == TaskType.IncidentCommissionDetailedReport).DueDate);
        Assert.All(tasks, t => Assert.Equal(reporter.TenantId, t.TenantId));
    }

    private static UpdateIncidentDto UpdateDto(IncidentReport i) => new()
    {
        ReportedByStaffId = i.ReportedByUserId, IncidentType = i.IncidentType, Severity = i.Severity, Status = IncidentStatus.Draft,
        Title = i.Title, Description = i.Description, IncidentDateTime = i.IncidentDateTime,
    };

    private static async Task<IncidentReport> CreateCriticalAsync(OdipDbContext db, IncidentsController controller, Guid reporterId)
    {
        await controller.Create(Dto(reporterId, IncidentSeverity.Critical), CancellationToken.None);
        return await db.IncidentReports.SingleAsync();
    }

    [Fact]
    public async Task Update_AwareAtSameMinute_KeepsStoredAwareAndDues()
    {
        var (db, _, reporter) = Arrange();
        using var _d = db;
        var controller = new IncidentsController(db, clock: new FixedClock(Now.AddSeconds(45)));
        var created = await CreateCriticalAsync(db, controller, reporter.Id);
        var notify = created.NotifyDueAt;

        // The form sends the stored time at minute resolution: 11:30 in Sydney, where the stored instant is 11:30:45.
        var result = await controller.Update(created.Id, UpdateDto(created) with { AwareAtLocal = new DateTime(2026, 11, 2, 11, 30, 0) }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(Now.UtcDateTime.AddSeconds(45), saved.AwareAt);
        Assert.Equal(notify, saved.NotifyDueAt);
        Assert.Equal(new DateOnly(2026, 11, 3), (await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.IncidentQscReport)).DueDate);
    }

    [Fact]
    public async Task Update_AwareAtEarlier_RecomputesDuesFromTheNewTime()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);

        // Friday 30 Oct 09:00 in Sydney is Thursday 22:00 UTC.
        await controller.Update(created.Id, UpdateDto(created) with { AwareAtLocal = new DateTime(2026, 10, 30, 9, 0, 0) }, CancellationToken.None);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(new DateTime(2026, 10, 29, 22, 0, 0, DateTimeKind.Utc), saved.AwareAt);
        Assert.Equal(new DateTime(2026, 10, 30, 22, 0, 0, DateTimeKind.Utc), saved.NotifyDueAt);
        Assert.Equal(new DateTime(2026, 11, 6, 12, 59, 59, DateTimeKind.Utc), saved.DetailedReportDueAt);
    }

    [Fact]
    public async Task Update_AwareAtInTheFuture_IsRejected()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);

        var result = await controller.Update(created.Id, UpdateDto(created) with { AwareAtLocal = new DateTime(2026, 11, 2, 18, 0, 0) }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_OverrideNeedsReason_AndAnOverrideToNoneClosesBothTasks()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);

        var without = await controller.Update(created.Id, UpdateDto(created) with { ReportableClass = ReportableClass.None, ReportableClassReason = "  " }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(without.Result);

        var withReason = await controller.Update(created.Id, UpdateDto(created) with { ReportableClass = ReportableClass.None, ReportableClassReason = " Not a reportable event. " }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(withReason.Result);
        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(ReportableClass.None, saved.ReportableClass);
        Assert.Equal("Not a reportable event.", saved.ReportableClassReason);
        Assert.Equal(QscReportingStatus.NotRequired, saved.QscReportingStatus);
        Assert.Null(saved.NotifyDueAt);
        Assert.All(await db.BookingTasks.ToListAsync(), t => Assert.Equal(TaskItemStatus.Completed, t.Status));
    }

    [Fact]
    public async Task Update_OmittedClassAndAwareAt_KeepsWhatIsStored()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);
        await controller.Update(created.Id, UpdateDto(created) with { ReportableClass = ReportableClass.Within5BusinessDays, ReportableClassReason = "Agreed with the Commission." }, CancellationToken.None);
        var before = await db.IncidentReports.AsNoTracking().SingleAsync();

        await controller.Update(created.Id, UpdateDto(created), CancellationToken.None);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(ReportableClass.Within5BusinessDays, saved.ReportableClass);
        Assert.Equal("Agreed with the Commission.", saved.ReportableClassReason);
        Assert.Equal(before.AwareAt, saved.AwareAt);
        Assert.Equal(before.NotifyDueAt, saved.NotifyDueAt);
        Assert.Null(saved.DetailedReportDueAt);
    }

    [Fact]
    public async Task Update_RowFromBeforeTheClock_IsReadAsWithin24hNotNotRequired()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var legacy = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = reporter.TenantId, ReportedByUserId = reporter.Id, IncidentType = IncidentType.Abuse, Severity = IncidentSeverity.High,
            Status = IncidentStatus.Submitted, Title = "Legacy", Description = "What happened.", IncidentDateTime = Now.UtcDateTime.AddDays(-2),
            CreatedAt = Now.UtcDateTime.AddHours(-30), QscReportingStatus = QscReportingStatus.Required, IsActive = true,
        };
        db.IncidentReports.Add(legacy);
        db.SaveChanges();

        await controller.Update(legacy.Id, UpdateDto(legacy), CancellationToken.None);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Equal(ReportableClass.Within24h, saved.ReportableClass);
        Assert.Equal(QscReportingStatus.Required, saved.QscReportingStatus);
        Assert.Equal(legacy.CreatedAt.AddHours(24), saved.NotifyDueAt);
    }

    [Fact]
    public async Task Update_OmittedCommissionDate_Clears_AndTheFlagKeepsWhenOmitted()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);
        await controller.Update(created.Id, UpdateDto(created) with
        {
            CommissionDetailedReportedAt = new DateTime(2026, 11, 3, 10, 0, 0), CommissionFinalReportRequested = true,
        }, CancellationToken.None);
        Assert.NotNull((await db.IncidentReports.SingleAsync()).CommissionDetailedReportedAt);
        Assert.Equal(TaskItemStatus.Completed, (await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.IncidentCommissionDetailedReport)).Status);

        await controller.Update(created.Id, UpdateDto(created), CancellationToken.None);

        var saved = await db.IncidentReports.SingleAsync();
        Assert.Null(saved.CommissionDetailedReportedAt);
        Assert.True(saved.CommissionFinalReportRequested);
    }

    [Fact]
    public async Task GetById_ForAPerthIncident_UsesPerthZoneEvenWhenASydneyTenantExists()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), State = "NSW" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = reporter.TenantId, State = "WA" });
        db.SaveChanges();
        var created = await CreateCriticalAsync(db, controller, reporter.Id);

        var detail = Assert.IsType<ApiResponse<IncidentDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(created.Id, CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(Odip.Infrastructure.Services.ProviderTimeZoneResolver.FromState("WA").Id, detail.TimeZoneId);
        Assert.Equal(created.NotifyDueAt, detail.NotifyDueAt);
        Assert.Equal(ReportableClass.Within24h, detail.ReportableClass);
    }

    [Fact]
    public async Task Update_ReportedAt_DerivesOnTimeOrLate_InTheProviderZone()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);
        // Aware Friday 30 Oct 09:00 in Sydney, so the 24-hour notify is due Saturday 31 Oct 09:00 in Sydney (22:00 UTC on the 30th).
        var aware = new DateTime(2026, 10, 30, 9, 0, 0);

        await controller.Update(created.Id, UpdateDto(created) with { AwareAtLocal = aware, QscReportedAt = new DateTime(2026, 10, 31, 8, 30, 0) }, CancellationToken.None);
        Assert.Equal(QscReportingStatus.ReportedWithin24h, (await db.IncidentReports.SingleAsync()).QscReportingStatus);

        await controller.Update(created.Id, UpdateDto(created) with { AwareAtLocal = aware, QscReportedAt = new DateTime(2026, 10, 31, 9, 30, 0) }, CancellationToken.None);
        Assert.Equal(QscReportingStatus.ReportedLate, (await db.IncidentReports.SingleAsync()).QscReportingStatus);
    }

    [Theory]
    [InlineData(ReportableClass.None, true, true, 0, QscReportingStatus.NotRequired)]
    [InlineData(ReportableClass.Within24h, false, true, 0, QscReportingStatus.Required)]
    [InlineData(ReportableClass.Within24h, true, true, 0, QscReportingStatus.ReportedWithin24h)]
    [InlineData(ReportableClass.Within24h, true, true, 1, QscReportingStatus.ReportedLate)]
    [InlineData(ReportableClass.Within24h, true, false, 0, QscReportingStatus.ReportedLate)]
    public void DeriveStatus_FollowsClassAndReportDate(ReportableClass reportableClass, bool reported, bool hasDue, long ticksAfterDue, QscReportingStatus expected)
    {
        var due = new DateTime(2026, 10, 30, 22, 0, 0, DateTimeKind.Utc);
        Assert.Equal(expected, QscReporting.DeriveStatus(reportableClass, reported ? due.AddTicks(ticksAfterDue) : null, hasDue ? due : null));
    }

    private static async Task<IncidentReport> AddLegacyReportableAsync(OdipDbContext db, User reporter, IncidentStatus status, DateTime? detailedDue)
    {
        var row = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = reporter.TenantId, ReportedByUserId = reporter.Id, IncidentType = IncidentType.Abuse, Severity = IncidentSeverity.High,
            Status = status, Title = "Legacy", Description = "What happened.", IncidentDateTime = Now.UtcDateTime.AddDays(-2),
            CreatedAt = Now.UtcDateTime.AddDays(-2), QscReportingStatus = QscReportingStatus.ReportedWithin24h, IsActive = true,
            DetailedReportDueAt = detailedDue,
        };
        db.IncidentReports.Add(row);
        await db.SaveChangesAsync();
        return row;
    }

    [Fact]
    public async Task Update_LegacyRowWithoutADetailedDue_RaisesNoFiveDayTask_ButFillsTheDue()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var legacy = await AddLegacyReportableAsync(db, reporter, IncidentStatus.Submitted, null);

        await controller.Update(legacy.Id, UpdateDto(legacy) with { ReviewNotes = "Looked at it." }, CancellationToken.None);

        Assert.NotNull((await db.IncidentReports.SingleAsync()).DetailedReportDueAt);
        Assert.DoesNotContain(await db.BookingTasks.ToListAsync(), t => t.TaskType == TaskType.IncidentCommissionDetailedReport);
    }

    [Fact]
    public async Task Update_LegacyRowEditedTwice_NeverRaisesAFiveDayTask()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var legacy = await AddLegacyReportableAsync(db, reporter, IncidentStatus.Submitted, null);

        await controller.Update(legacy.Id, UpdateDto(legacy) with { ReviewNotes = "First look." }, CancellationToken.None);
        await controller.Update(legacy.Id, UpdateDto(legacy) with { ReviewNotes = "Second look." }, CancellationToken.None);

        Assert.DoesNotContain(await db.BookingTasks.ToListAsync(), t => t.TaskType == TaskType.IncidentCommissionDetailedReport);
    }

    [Fact]
    public async Task Update_ClosingAnIncident_LeavesTheOwedFiveDayTaskOpen()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);

        await controller.Update(created.Id, UpdateDto(created) with { Status = IncidentStatus.Closed }, CancellationToken.None);

        Assert.NotEqual(TaskItemStatus.Completed, (await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.IncidentCommissionDetailedReport)).Status);
    }

    [Fact]
    public async Task Update_ReviewNotesOnly_KeepsTheFiveDayTaskOpen()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var created = await CreateCriticalAsync(db, controller, reporter.Id);

        await controller.Update(created.Id, UpdateDto(created) with { ReviewNotes = "Reviewed.", Title = "Renamed incident" }, CancellationToken.None);

        // The task is still owed and kept in step with the incident: it stays open and takes the new title.
        var task = await db.BookingTasks.SingleAsync(t => t.TaskType == TaskType.IncidentCommissionDetailedReport);
        Assert.NotEqual(TaskItemStatus.Completed, task.Status);
        Assert.EndsWith("Renamed incident", task.Title);
    }

    [Fact]
    public async Task Update_ClosedIncident_RaisesNoFiveDayTask()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        var closed = await AddLegacyReportableAsync(db, reporter, IncidentStatus.Closed, Now.UtcDateTime.AddDays(-1));

        await controller.Update(closed.Id, UpdateDto(closed) with { Status = IncidentStatus.Closed }, CancellationToken.None);

        Assert.DoesNotContain(await db.BookingTasks.ToListAsync(), t => t.TaskType == TaskType.IncidentCommissionDetailedReport);
    }

    [Fact]
    public async Task Update_ClassChangedWhileClosing_RaisesNoFiveDayTask()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        await controller.Create(Dto(reporter.Id, IncidentSeverity.Medium), CancellationToken.None);
        var created = await db.IncidentReports.SingleAsync();

        await controller.Update(created.Id, UpdateDto(created) with
        {
            Status = IncidentStatus.Closed, ReportableClass = ReportableClass.Within24h, ReportableClassReason = "Reportable after review.",
        }, CancellationToken.None);

        Assert.DoesNotContain(await db.BookingTasks.ToListAsync(), t => t.TaskType == TaskType.IncidentCommissionDetailedReport);
    }

    [Fact]
    public async Task Update_ClassChangedToWithin24h_RaisesTheFiveDayTask()
    {
        var (db, controller, reporter) = Arrange();
        using var _d = db;
        await controller.Create(Dto(reporter.Id, IncidentSeverity.Medium), CancellationToken.None);
        var created = await db.IncidentReports.SingleAsync();

        await controller.Update(created.Id, UpdateDto(created) with { ReportableClass = ReportableClass.Within24h, ReportableClassReason = "Reportable after review." }, CancellationToken.None);

        Assert.Single(await db.BookingTasks.ToListAsync(), t => t.TaskType == TaskType.IncidentCommissionDetailedReport);
    }
}
