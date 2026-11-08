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
/// GA PR3 Must 1 on a real PostgreSQL: Approve and the worker's Finish take the same <see cref="Odip.Infrastructure.Services.GroupStaffRowLock"/> (a no-op off Npgsql). a Finish started from inside the coordinator's save must WAIT and then read the recorded row, and a Finish after Approve is refused with 409, leaving the approved times unchanged.
/// Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class GroupStaffApproveLockPostgresTests : IClassFixture<PostgresFixture>
{
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private readonly PostgresFixture _pg;
    public GroupStaffApproveLockPostgresTests(PostgresFixture pg) => _pg = pg;

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

    /// <summary>Right before the coordinator's own save (inside its row lock) a rival Finish starts on another connection; the save is held 1.5 s so the Finish has time to block.</summary>
    private sealed class FinishDuringWriteInterceptor(Func<Task<ActionResult<ApiResponse<PortalActivityShiftDto>>>> finish) : SaveChangesInterceptor
    {
        private bool _done;
        public Task<ActionResult<ApiResponse<PortalActivityShiftDto>>>? Finish { get; private set; }
        public bool? FinishWaitedForTheLock { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (_done || !eventData.Context!.ChangeTracker.Entries<GroupActivityStaff>().Any(e => e.State == EntityState.Modified && e.Entity.ActualEnd != null)) return result;
            _done = true;
            Finish = Task.Run(finish, ct);
            await Task.Delay(1500, ct);
            FinishWaitedForTheLock = !Finish.IsCompleted;
            return result;
        }
    }

    [SkippableFact(DisplayName = "Postgres: a Finish that starts while the coordinator records times waits, then replays; Approve then Finish is refused and the times are unchanged")]
    public async Task RecordThenApprove_HoldTheRow_SoAWorkersFinishCannotOverwriteThem()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        Guid coordinatorId, workerId, rowId, activityId;
        var started = DateTime.UtcNow.AddHours(-4);
        await using (setup)
        {
            User NewUser(string first) => new() { Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = first, LastName = "Test", Role = UserRole.SupportWorker, IsActive = true };
            var coordinator = NewUser("Cora");
            var worker = NewUser("Wendy");
            var activity = new GroupActivity { Id = Guid.NewGuid(), ServiceDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.InProgress };
            var row = new GroupActivityStaff
            {
                Id = Guid.NewGuid(), GroupActivityId = activity.Id, UserId = worker.Id, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), TimeZoneId = "Australia/Sydney",
                ActualStart = started, StartedAt = started,
            };
            setup.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), GroupActivitiesEnabled = true });
            setup.AddRange(coordinator, worker, activity, row);
            await setup.SaveChangesAsync();
            (coordinatorId, workerId, rowId, activityId) = (coordinator.Id, worker.Id, row.Id, activity.Id);
        }
        var recorded = started.AddHours(3);

        // Part A: the row is Started; the coordinator records the finish, and a worker Finish begins during that save.
        await using var finishDb = NewContext(tenantId);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", finishDb.Database.ProviderName);   // so an InMemory run can never satisfy this
        var finishing = new PortalActivityShiftsController(finishDb, TenantOf(tenantId).Object, new Clock(DateTimeOffset.UtcNow), new NotificationRaiser(finishDb)) { ControllerContext = As(workerId) };
        var interceptor = new FinishDuringWriteInterceptor(() => finishing.Finish(rowId, new FinishActivityShiftDto(), CancellationToken.None));
        await using (var record = NewContext(tenantId, interceptor))
        {
            var recorder = new GroupActivitiesController(record, TenantOf(tenantId).Object, new StaffUnavailabilityQuery(record)) { ControllerContext = As(coordinatorId, "Admin") };
            var set = new SetGroupStaffActualsDto { ActualStart = started, ActualEnd = recorded, Reason = "Recorded by the coordinator" };
            Assert.Equal(200, ((ObjectResult)(await recorder.SetStaffActuals(activityId, rowId, set, CancellationToken.None)).Result!).StatusCode ?? 200);
        }
        Assert.True(interceptor.FinishWaitedForTheLock);   // it was blocked on the row while the coordinator held it
        Assert.IsType<OkObjectResult>((await interceptor.Finish!).Result);   // it then read a Finished row and replayed it
        await using (var mid = NewContext(tenantId))
            Assert.Equal(recorded, (await mid.GroupActivityStaff.SingleAsync(r => r.Id == rowId)).ActualEnd!.Value, TimeSpan.FromMilliseconds(5));

        // Part B: Approve, then a Finish is refused and nothing changes.
        await using (var approveDb = NewContext(tenantId))
        {
            var approver = new GroupActivitiesController(approveDb, TenantOf(tenantId).Object, new StaffUnavailabilityQuery(approveDb)) { ControllerContext = As(coordinatorId, "Admin") };
            var results = ((ApiResponse<List<GroupStaffApproveResultDto>>)((ObjectResult)(await approver.ApproveStaffRows(new GroupStaffApproveDto { RowIds = [rowId] }, CancellationToken.None)).Result!).Value!).Data!;
            Assert.True(results.Single().Ok);
        }
        await using var lateDb = NewContext(tenantId);
        var late = new PortalActivityShiftsController(lateDb, TenantOf(tenantId).Object, new Clock(DateTimeOffset.UtcNow), new NotificationRaiser(lateDb)) { ControllerContext = As(workerId) };
        var refusal = Assert.IsAssignableFrom<ObjectResult>((await late.Finish(rowId, new FinishActivityShiftDto(), CancellationToken.None)).Result);
        Assert.Equal(409, refusal.StatusCode);
        Assert.Equal(ShiftErrorCodes.ShiftAlreadyCompleted, Assert.IsType<ApiResponse<PortalActivityShiftDto>>(refusal.Value).Code);
        await using var check = NewContext(tenantId);
        var saved = await check.GroupActivityStaff.SingleAsync(r => r.Id == rowId);
        Assert.Equal(ReviewOutcome.Approved, saved.ReviewOutcome);
        Assert.Equal(recorded, saved.ActualEnd!.Value, TimeSpan.FromMilliseconds(5));
    }
}
