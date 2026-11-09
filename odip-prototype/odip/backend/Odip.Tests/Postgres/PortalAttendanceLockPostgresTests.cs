using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// ga-portal-attendance on a real PostgreSQL: the worker's mark takes the board lock, the participant lock, its own row lock and the shift locks, in approve's order. A rival write that starts from inside the
/// first one's save must WAIT and then land, with no RosterBusyException. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class PortalAttendanceLockPostgresTests : IClassFixture<PostgresFixture>
{
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private readonly PostgresFixture _pg;
    public PortalAttendanceLockPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Mock<ICurrentTenant> TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    private OdipDbContext NewContext(Guid tenantId, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, TenantOf(tenantId).Object);

    private static ControllerContext As(Guid userId, string? role = null)
    {
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, userId.ToString()) };
        if (role is not null) claims.Add(new Claim(ClaimTypes.Role, role));
        return new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")) } };
    }

    /// <summary>Right before the first write's own save (inside its locks) a rival starts on another connection; the save is held 1.5 s so the rival has time to block.</summary>
    private sealed class RivalDuringSaveInterceptor(Func<OdipDbContext, bool> when, Func<Task<ObjectResult>> rival) : SaveChangesInterceptor
    {
        private bool _done;
        public Task<ObjectResult>? Rival { get; private set; }
        public bool? RivalWaited { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (_done || !when((OdipDbContext)eventData.Context!)) return result;
            _done = true;
            Rival = Task.Run(rival, ct);
            await Task.Delay(1500, ct);
            RivalWaited = !Rival.IsCompleted;
            return result;
        }
    }

    private sealed record Ids(Guid TenantId, Guid CoordinatorId, Guid WorkerA, Guid RowA, Guid WorkerB, Guid RowB, Guid ActivityId, Guid ParticipantId, Guid ShiftId);

    /// <summary>Worker A is Started; worker B is Finished and waiting for approval; one participant has a Published shift on the InProgress activity.</summary>
    private async Task<Ids> SeedAsync()
    {
        var (setup, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        await using (setup)
        {
            User NewUser(string first) => new() { Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = first, LastName = "Test", Role = UserRole.SupportWorker, IsActive = true };
            var (coordinator, a, b) = (NewUser("Cora"), NewUser("Wendy"), NewUser("Bea"));
            var activity = new GroupActivity { Id = Guid.NewGuid(), ServiceDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.InProgress };
            var started = DateTime.UtcNow.AddHours(-4);
            var rowA = new GroupActivityStaff { Id = Guid.NewGuid(), GroupActivityId = activity.Id, UserId = a.Id, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), TimeZoneId = "Australia/Sydney", ActualStart = started, StartedAt = started };
            var rowB = new GroupActivityStaff
            {
                Id = Guid.NewGuid(), GroupActivityId = activity.Id, UserId = b.Id, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), TimeZoneId = "Australia/Sydney",
                ActualStart = started, StartedAt = started, ActualEnd = started.AddHours(3), SubmittedAt = started.AddHours(3),
            };
            var person = new Participant { Id = Guid.NewGuid(), FirstName = "Pat", LastName = "Test", IsActive = true };
            var shift = new Shift { Id = Guid.NewGuid(), ParticipantId = person.Id, ServiceDate = activity.ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Published, GroupActivityId = activity.Id };
            setup.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), GroupActivitiesEnabled = true });
            setup.AddRange(coordinator, a, b, activity, rowA, rowB, person, shift);
            await setup.SaveChangesAsync();
            return new Ids(tenantId, coordinator.Id, a.Id, rowA.Id, b.Id, rowB.Id, activity.Id, person.Id, shift.Id);
        }
    }

    private Task<ObjectResult> MarkAsync(Ids ids, bool attended)
    {
        var db = NewContext(ids.TenantId);
        var controller = new PortalActivityShiftsController(db, TenantOf(ids.TenantId).Object, new Clock(DateTimeOffset.UtcNow), new NotificationRaiser(db)) { ControllerContext = As(ids.WorkerA) };
        return Run(db, async () => (ObjectResult)(await controller.SetAttendance(ids.RowA, new SetActivityAttendanceDto { ParticipantId = ids.ParticipantId, Attended = attended }, CancellationToken.None)).Result!);
    }

    private Task<ObjectResult> FinishAsync(Ids ids)
    {
        var db = NewContext(ids.TenantId);
        var controller = new PortalActivityShiftsController(db, TenantOf(ids.TenantId).Object, new Clock(DateTimeOffset.UtcNow), new NotificationRaiser(db)) { ControllerContext = As(ids.WorkerA) };
        return Run(db, async () => (ObjectResult)(await controller.Finish(ids.RowA, new FinishActivityShiftDto(), CancellationToken.None)).Result!);
    }

    private Task<ObjectResult> ApproveAsync(Ids ids)
    {
        var db = NewContext(ids.TenantId);
        var controller = new GroupActivitiesController(db, TenantOf(ids.TenantId).Object, new StaffUnavailabilityQuery(db)) { ControllerContext = As(ids.CoordinatorId, "Admin") };
        return Run(db, async () => (ObjectResult)(await controller.ApproveStaffRows(new GroupStaffApproveDto { RowIds = [ids.RowB] }, CancellationToken.None)).Result!);
    }

    private static async Task<ObjectResult> Run(OdipDbContext db, Func<Task<ObjectResult>> call)
    {
        await using (db) return await call();
    }

    private static bool IsShiftWrite(OdipDbContext c) => c.ChangeTracker.Entries<Shift>().Any(e => e.State == EntityState.Modified && e.Entity.Status == ShiftStatus.Cancelled);
    private static bool IsApproveWrite(OdipDbContext c) => c.ChangeTracker.Entries<GroupActivityStaff>().Any(e => e.State == EntityState.Modified && e.Entity.ReviewOutcome == ReviewOutcome.Approved);

    [SkippableFact(DisplayName = "Postgres: a portal mark that starts while a coordinator approves another worker waits for the board, then lands")]
    public async Task PortalMark_DuringApprove_WaitsAndBothLand()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var ids = await SeedAsync();
        var interceptor = new RivalDuringSaveInterceptor(IsApproveWrite, () => MarkAsync(ids, false));
        await using (var approveDb = NewContext(ids.TenantId, interceptor))
        {
            Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", approveDb.Database.ProviderName);   // so an InMemory run can never satisfy this
            var approver = new GroupActivitiesController(approveDb, TenantOf(ids.TenantId).Object, new StaffUnavailabilityQuery(approveDb)) { ControllerContext = As(ids.CoordinatorId, "Admin") };
            var approved = ((ApiResponse<List<GroupStaffApproveResultDto>>)((ObjectResult)(await approver.ApproveStaffRows(new GroupStaffApproveDto { RowIds = [ids.RowB] }, CancellationToken.None)).Result!).Value!).Data!;
            Assert.True(approved.Single().Ok);
        }
        Assert.True(interceptor.RivalWaited);
        Assert.Equal(200, (await interceptor.Rival!).StatusCode ?? 200);   // not a 409 "roster busy"
        await using var check = NewContext(ids.TenantId);
        Assert.Equal(ShiftStatus.Cancelled, (await check.Shifts.SingleAsync(s => s.Id == ids.ShiftId)).Status);
        Assert.Equal(ReviewOutcome.Approved, (await check.GroupActivityStaff.SingleAsync(r => r.Id == ids.RowB)).ReviewOutcome);
    }

    [SkippableFact(DisplayName = "Postgres: a Finish that starts while the worker's own mark saves waits for the row lock, then lands and keeps the mark")]
    public async Task Finish_DuringPortalMark_WaitsForTheRowLock()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var ids = await SeedAsync();
        var interceptor = new RivalDuringSaveInterceptor(IsShiftWrite, () => FinishAsync(ids));
        await using (var markDb = NewContext(ids.TenantId, interceptor))
        {
            var controller = new PortalActivityShiftsController(markDb, TenantOf(ids.TenantId).Object, new Clock(DateTimeOffset.UtcNow), new NotificationRaiser(markDb)) { ControllerContext = As(ids.WorkerA) };
            Assert.Equal(200, ((ObjectResult)(await controller.SetAttendance(ids.RowA, new SetActivityAttendanceDto { ParticipantId = ids.ParticipantId, Attended = false }, CancellationToken.None)).Result!).StatusCode ?? 200);
        }
        Assert.True(interceptor.RivalWaited);
        Assert.Equal(200, (await interceptor.Rival!).StatusCode ?? 200);
        await using var check = NewContext(ids.TenantId);
        Assert.Equal(ShiftStatus.Cancelled, (await check.Shifts.SingleAsync(s => s.Id == ids.ShiftId)).Status);
        Assert.Equal(GroupStaffRowState.Finished, (await check.GroupActivityStaff.SingleAsync(r => r.Id == ids.RowA)).State);
    }

    [SkippableFact(DisplayName = "Postgres: an approve that starts while a portal mark saves waits for the board, then lands")]
    public async Task Approve_DuringPortalMark_Waits()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var ids = await SeedAsync();
        var interceptor = new RivalDuringSaveInterceptor(IsShiftWrite, () => ApproveAsync(ids));
        await using (var markDb = NewContext(ids.TenantId, interceptor))
        {
            var controller = new PortalActivityShiftsController(markDb, TenantOf(ids.TenantId).Object, new Clock(DateTimeOffset.UtcNow), new NotificationRaiser(markDb)) { ControllerContext = As(ids.WorkerA) };
            Assert.Equal(200, ((ObjectResult)(await controller.SetAttendance(ids.RowA, new SetActivityAttendanceDto { ParticipantId = ids.ParticipantId, Attended = false }, CancellationToken.None)).Result!).StatusCode ?? 200);
        }
        Assert.True(interceptor.RivalWaited);
        var approved = ((ApiResponse<List<GroupStaffApproveResultDto>>)(await interceptor.Rival!).Value!).Data!;
        Assert.True(approved.Single().Ok);
        await using var check = NewContext(ids.TenantId);
        Assert.Equal(ShiftStatus.Cancelled, (await check.Shifts.SingleAsync(s => s.Id == ids.ShiftId)).Status);
        Assert.Equal(ReviewOutcome.Approved, (await check.GroupActivityStaff.SingleAsync(r => r.Id == ids.RowB)).ReviewOutcome);
    }
}
