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
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// W9 on a real PostgreSQL: the coordinator's break toggle and Approve (single and batch) take the same shift row lock (<see cref="ShiftRowLock"/>, a no-op off Npgsql,
/// so an in-memory test cannot show it). Approve is made to hold the lock at its own save, a toggle is started from inside that save, and the toggle must WAIT, then read
/// the approved shift and refuse with 409 - so the break kind Employment Hero is sent is always the one the approver saw. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class BreakKindApproveLockPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public BreakKindApproveLockPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Mock<ICurrentTenant> TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    private static RosteringController Controller(OdipDbContext db, Guid userId) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), null)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test")) }
            }
        };

    /// <summary>Right before Approve's own save (inside its lock) a rival toggle starts on another connection; the save is held 1.5 s so the toggle has time to block.</summary>
    private sealed class ToggleDuringApproveInterceptor(Func<Task<ActionResult<ApiResponse<ShiftCompletionDto>>>> toggle) : SaveChangesInterceptor
    {
        private bool _done;
        public Task<ActionResult<ApiResponse<ShiftCompletionDto>>>? Toggle { get; private set; }
        public bool? ToggleWaitedForTheLock { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (_done || !eventData.Context!.ChangeTracker.Entries<Shift>().Any(e => e.State == EntityState.Modified && e.Entity.Status == ShiftStatus.Completed)) return result;
            _done = true;
            Toggle = Task.Run(toggle, ct);
            await Task.Delay(1500, ct);
            ToggleWaitedForTheLock = !Toggle.IsCompleted;
            return result;
        }
    }

    private async Task<(Guid TenantId, Guid UserId, Guid ShiftId, Guid BreakId)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        await using var _ = db;
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = "Ben", LastName = "Turner", Role = UserRole.SupportWorker, IsActive = true,
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = new DateOnly(2026, 7, 14),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.PendingReview,
        };
        var start = new DateTime(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc);
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = start, ActualEnd = start.AddHours(8), TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = user.Id, StartedAt = start, SubmittedAt = start.AddHours(8), IsActive = true,
        };
        var brk = new ShiftBreak { Id = Guid.NewGuid(), ShiftCompletionId = completion.Id, StartedAt = start.AddHours(3), EndedAt = start.AddHours(3).AddMinutes(30), CreatedByUserId = user.Id };
        db.AddRange(participant, user, shift, completion, brk);
        await db.SaveChangesAsync();
        return (tenantId, user.Id, shift.Id, brk.Id);
    }

    private OdipDbContext NewContext(Guid tenantId, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, TenantOf(tenantId).Object);

    private async Task RunAsync(bool batch)
    {
        var (tenantId, userId, shiftId, breakId) = await SeedAsync();
        await using var toggleDb = NewContext(tenantId);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", toggleDb.Database.ProviderName);   // so an InMemory run can never satisfy this class
        var interceptor = new ToggleDuringApproveInterceptor(() => Controller(toggleDb, userId).SetCompletionBreakKind(shiftId, breakId, new SetShiftBreakKindDto { WithParticipant = true }, CancellationToken.None));
        await using var approveDb = NewContext(tenantId, interceptor);
        var approver = Controller(approveDb, userId);

        if (batch) await approver.ApproveBatch(new ApproveBatchDto([shiftId]), CancellationToken.None);
        else await approver.ApproveCompletion(shiftId, CancellationToken.None);

        Assert.True(interceptor.ToggleWaitedForTheLock);   // it was blocked on the shift row while Approve held it
        var refusal = Assert.IsAssignableFrom<ObjectResult>((await interceptor.Toggle!).Result);
        Assert.Equal(409, refusal.StatusCode);
        Assert.Equal(ShiftErrorCodes.ShiftNotPendingReview, Assert.IsType<ApiResponse<ShiftCompletionDto>>(refusal.Value).Code);

        await using var check = NewContext(tenantId);
        Assert.Equal(ShiftStatus.Completed, (await check.Shifts.SingleAsync(s => s.Id == shiftId)).Status);
        Assert.False((await check.ShiftBreaks.SingleAsync(b => b.Id == breakId)).WithParticipant);   // what Approve read is what was approved
    }

    [SkippableFact(DisplayName = "Postgres: a break toggle that starts while Approve holds the shift waits, then gets 409 and changes nothing")]
    public async Task ApproveHoldsTheLock_SoAToggleStartedDuringItWaitsAndThenIsRefused()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        await RunAsync(batch: false);
    }

    [SkippableFact(DisplayName = "Postgres: the batch approve takes the same lock")]
    public async Task BatchApproveHoldsTheLock_TooSoAToggleStartedDuringItWaitsAndThenIsRefused()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        await RunAsync(batch: true);
    }
}
