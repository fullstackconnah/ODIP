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
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Portal;

/// <summary>
/// Shared arrangement for the shift-package tests: a Sydney provider, one community shift 09:00-17:00 on Tuesday
/// 14 July 2026 (AEST, UTC+10, so 13 Jul 23:00Z to 14 Jul 07:00Z), a medication-competent worker, and - when the
/// shift is InProgress - an active completion that started at 09:05 local with the controllable
/// <see cref="Clock"/> at 11:00 local. Every controller built from it shares that clock.
/// </summary>
internal sealed class ShiftPackageFixture
{
    public static readonly DateOnly ServiceDate = new(2026, 7, 14);
    /// <summary>09:05 local = 13 Jul 23:05 UTC.</summary>
    public static readonly DateTime ActualStartUtc = new(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc);
    /// <summary>11:00 local = 01:00 UTC on the 14th.</summary>
    public static readonly DateTimeOffset DefaultNow = new(2026, 7, 14, 1, 0, 0, TimeSpan.Zero);

    public required OdipDbContext Db { get; init; }
    public required Mock<ICurrentTenant> Tenant { get; init; }
    public required FakeClock Clock { get; init; }
    public required User Worker { get; init; }
    public required Participant Participant { get; init; }
    public required Shift Shift { get; init; }
    public ShiftCompletion? Completion { get; init; }

    /// <summary>The worker's controller.</summary>
    public PortalController Controller => ControllerFor(Worker.Id);

    public static ShiftPackageFixture Create(
        ShiftStatus status = ShiftStatus.InProgress, bool workerCompetent = true, DateTimeOffset? now = null,
        bool withAuditing = false, Guid? tenantId = null, bool endsNextDay = false, TimeOnly? start = null, TimeOnly? end = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        tenant.Setup(t => t.ViewAsUserId).Returns((Guid?)null);

        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
        if (withAuditing)
        {
            var httpContext = new DefaultHttpContext();
            var accessor = new Mock<IHttpContextAccessor>();
            accessor.Setup(a => a.HttpContext).Returns(httpContext);
            options.AddInterceptors(new AuditInterceptor(accessor.Object));
        }
        var db = new OdipDbContext(options.Options, tenant.Object);
        var tid = tenantId ?? Guid.Empty;

        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tid, State = "NSW" });
        var worker = new User
        {
            Id = Guid.NewGuid(), TenantId = tid, Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = "Ben", LastName = "Turner", Role = UserRole.SupportWorker, IsActive = true,
            IsMedicationCompetent = workerCompetent, MedicationCompetencyExpiryDate = workerCompetent ? new DateOnly(2099, 1, 1) : null,
        };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tid, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tid, ParticipantId = participant.Id, UserId = worker.Id, ServiceDate = ServiceDate,
            StartTime = start ?? new TimeOnly(9, 0), EndTime = end ?? new TimeOnly(17, 0), EndsNextDay = endsNextDay,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        db.Users.Add(worker);
        db.Participants.Add(participant);
        db.Shifts.Add(shift);

        ShiftCompletion? completion = null;
        if (status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed)
        {
            completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = tid, ShiftId = shift.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
                SubmittedByUserId = worker.Id, StartedAt = ActualStartUtc, IsActive = true,
            };
            db.ShiftCompletions.Add(completion);
        }
        db.SaveChanges();

        return new ShiftPackageFixture
        {
            Db = db, Tenant = tenant, Clock = new FakeClock(now ?? DefaultNow), Worker = worker,
            Participant = participant, Shift = shift, Completion = completion,
        };
    }

    public PortalController ControllerFor(Guid callerUserId)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString()), new Claim("fullName", "Test Caller")], "Test");
        return new PortalController(Db, Tenant.Object, clock: Clock)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) },
            },
        };
    }

    public User AddWorker(string first = "Other", string last = "Worker", bool competent = true)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = Worker.TenantId, Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = first, LastName = last, Role = UserRole.SupportWorker, IsActive = true,
            IsMedicationCompetent = competent, MedicationCompetencyExpiryDate = competent ? new DateOnly(2099, 1, 1) : null,
        };
        Db.Users.Add(u);
        Db.SaveChanges();
        return u;
    }

    public void Advance(TimeSpan by) => Clock.Set(Clock.GetUtcNow() + by);

    // ── response helpers ──

    public static PortalShiftDetailDto Detail(ActionResult<ApiResponse<PortalShiftDetailDto>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(ok.Value);
        Assert.True(body.Success);
        return body.Data!;
    }

    /// <summary>Asserts a non-200 outcome and returns its body.</summary>
    public static ApiResponse<PortalShiftDetailDto> Failure(ActionResult<ApiResponse<PortalShiftDetailDto>> result, int expectedStatus)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(expectedStatus, obj.StatusCode);
        var body = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(obj.Value);
        Assert.False(body.Success);
        return body;
    }
}
