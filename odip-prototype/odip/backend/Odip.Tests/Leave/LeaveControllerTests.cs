using Microsoft.AspNetCore.Authorization;
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
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Leave;

public class LeaveControllerTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static LeaveController MakeController(OdipDbContext db, Guid? callerId = null)
    {
        var identity = new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, (callerId ?? Guid.NewGuid()).ToString())], "Test");
        return new LeaveController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) }
            }
        };
    }

    /// <summary>A3 fixture: an authenticated identity with no NameIdentifier claim at all — the case ResolveCallerId now surfaces as null instead of persisting Guid.Empty.</summary>
    private static LeaveController MakeControllerWithoutNameIdentifier(OdipDbContext db)
    {
        var identity = new System.Security.Claims.ClaimsIdentity([], "Test");
        return new LeaveController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static LeaveRequest SeedLeave(OdipDbContext db, Guid userId, LeaveStatus status = LeaveStatus.Pending, DateOnly? start = null, DateOnly? end = null)
    {
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start ?? Today, EndDate = end ?? Today, Status = status,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        db.SaveChanges();
        return leave;
    }

    private static RecurringUnavailability SeedRule(OdipDbContext db, Guid userId, LeaveStatus status = LeaveStatus.Pending) =>
        SeedRuleInternal(db, userId, status, new TimeOnly(9, 0), new TimeOnly(12, 0));

    private static RecurringUnavailability SeedRuleInternal(OdipDbContext db, Guid userId, LeaveStatus status, TimeOnly start, TimeOnly end)
    {
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = userId, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = start, EndTime = end, EffectiveFrom = Today, Status = status,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        db.SaveChanges();
        return rule;
    }

    /// <summary>
    /// Every other test in this file runs with IsSuperAdmin = true, which bypasses OdipDbContext's
    /// ambient tenant query filter entirely — none of them prove the filter is actually reached
    /// on LeaveController's reads. This test scopes the db as a genuine non-SuperAdmin tenant A
    /// caller and proves a Tenant B leave request is invisible to it (404 on ApproveLeave, not a
    /// state-machine 409), the same fixture pattern SameTenantWritePathTests.cs uses elsewhere.
    /// </summary>
    [Fact]
    public async Task ApproveLeave_RequestBelongsToAnotherTenant_ReturnsNotFound()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantAId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        using var db = new OdipDbContext(options, tenant.Object);

        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantBId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantBId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        db.SaveChanges();

        var result = await MakeController(db).ApproveLeave(leave.Id, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public void Controller_is_gated_to_SuperAdmin_Admin_Coordinator()
    {
        var attr = typeof(LeaveController).GetCustomAttributes(typeof(AuthorizeAttribute), false)
            .Cast<AuthorizeAttribute>().Single();
        Assert.Equal("SuperAdmin,Admin,Coordinator", attr.Roles);
    }

    // ── Leave: create ──

    [Fact]
    public async Task CreateLeave_MissingUserId_Returns400()
    {
        using var db = CreateDb();
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today }, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_EndBeforeStart_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(-1) },
            CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_Duplicate_Returns409()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedLeave(db, user.Id, LeaveStatus.Approved);
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_AfterDeclined_SameDates_Succeeds()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedLeave(db, user.Id, LeaveStatus.Declined);
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
    }

    [Fact]
    public async Task CreateLeave_AfterCancelled_SameDates_Succeeds()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedLeave(db, user.Id, LeaveStatus.Cancelled);
        var result = await MakeController(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
    }

    /// <summary>A3 ruling: a missing/unparseable NameIdentifier claim must 401, not silently persist Guid.Empty as the requester.</summary>
    [Fact]
    public async Task CreateLeave_NoNameIdentifierClaim_Returns401()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeControllerWithoutNameIdentifier(db).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);
        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateLeave_Valid_LandsApprovedWithRequesterAsDecider()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var callerId = Guid.NewGuid();
        var result = await MakeController(db, callerId).CreateLeave(
            new CreateLeaveRequestDto { UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(2) },
            CancellationToken.None);

        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:184): POST /leave is 201.
        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(created.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Status);
        Assert.Equal(callerId, body.Data.RequestedByUserId);
        Assert.Equal(callerId, body.Data.DecidedByUserId);
    }

    // ── Leave: approve/decline/cancel ──

    [Fact]
    public async Task ApproveLeave_UnknownId_Returns404()
    {
        using var db = CreateDb();
        var result = await MakeController(db).ApproveLeave(Guid.NewGuid(), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveLeave_NotPending_Returns409()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, LeaveStatus.Approved);
        var result = await MakeController(db).ApproveLeave(leave.Id, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    /// <summary>A3 ruling: same as CreateLeave_NoNameIdentifierClaim_Returns401, on the approve path — asserted before any DB mutation.</summary>
    [Fact]
    public async Task ApproveLeave_NoNameIdentifierClaim_Returns401()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, LeaveStatus.Pending);
        var result = await MakeControllerWithoutNameIdentifier(db).ApproveLeave(leave.Id, CancellationToken.None);
        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task ApproveLeave_ReturnsOverlappingPublishedShiftsAndConfirmedTrips()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, LeaveStatus.Pending, Today, Today.AddDays(2));
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = Today.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        var trip = new TripInstance { Id = Guid.NewGuid(), TripCode = "T1", TripName = "Beach Trip", StartDate = Today, DurationDays = 3 };
        db.TripInstances.Add(trip);
        db.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = user.Id,
            AssignmentStart = Today, AssignmentEnd = Today.AddDays(2), Status = AssignmentStatus.Confirmed,
        });
        await db.SaveChangesAsync();

        var result = await MakeController(db).ApproveLeave(leave.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveApprovalResultDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Leave.Status);
        Assert.Contains(body.Data.Overlaps, o => o.Code == "SHIFT_OVERLAP");
        Assert.Contains(body.Data.Overlaps, o => o.Code == "TRIP_OVERLAP");
    }

    /// <summary>Product ruling (2026-09-09): a decline reason is optional, not required — levelled
    /// down to match cancel, which has never demanded one. This replaces the old
    /// DeclineLeave_NoNote_Returns400, which encoded the now-reversed "reason mandatory" rule.</summary>
    [Fact]
    public async Task DeclineLeave_NoNote_Succeeds()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id);
        var result = await MakeController(db).DeclineLeave(leave.Id, new LeaveDecisionDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Declined, body.Data!.Status);
        Assert.Null(body.Data.DecisionNote);
    }

    [Fact]
    public async Task DeclineLeave_WithNote_SetsDeclinedAndNote()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id);
        var result = await MakeController(db).DeclineLeave(
            leave.Id, new LeaveDecisionDto { DecisionNote = "No cover available that week." }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Declined, body.Data!.Status);
        Assert.Equal("No cover available that week.", body.Data.DecisionNote);
    }

    [Theory]
    [InlineData(LeaveStatus.Pending)]
    [InlineData(LeaveStatus.Approved)]
    public async Task CancelLeave_FromPendingOrApproved_Succeeds(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, status);
        var result = await MakeController(db).CancelLeave(leave.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    [Theory]
    [InlineData(LeaveStatus.Declined, "This request has already been declined.")]
    [InlineData(LeaveStatus.Cancelled, "This request has already been cancelled.")]
    public async Task CancelLeave_FromDeclinedOrCancelled_Returns409(LeaveStatus status, string expected)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var leave = SeedLeave(db, user.Id, status);
        var result = await MakeController(db).CancelLeave(leave.Id, CancellationToken.None);
        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(expected, ((ApiResponse<LeaveRequestDto>)conflict.Value!).Errors!.Single());
    }

    // ── Leave: list filters ──

    [Fact]
    public async Task GetLeave_FiltersByStatusAndUserId()
    {
        using var db = CreateDb();
        var user1 = SeedUser(db);
        var user2 = SeedUser(db);
        SeedLeave(db, user1.Id, LeaveStatus.Pending);
        SeedLeave(db, user1.Id, LeaveStatus.Approved, Today.AddDays(10), Today.AddDays(10));
        SeedLeave(db, user2.Id, LeaveStatus.Pending);

        var result = await MakeController(db).GetLeave(LeaveStatus.Pending, user1.Id, null, null, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<LeaveRequestDto>>>(ok.Value);
        var row = Assert.Single(body.Data!);
        Assert.Equal(user1.Id, row.UserId);
        Assert.Equal(LeaveStatus.Pending, row.Status);
    }

    // ── Recurring unavailability: mirrors the leave tests above ──

    [Fact]
    public async Task CreateUnavailability_StartTimeNotBeforeEndTime_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(9, 0), EffectiveFrom = Today },
            CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateUnavailability_EffectiveToBeforeEffectiveFrom_Returns400()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today, EffectiveTo = Today.AddDays(-1) },
            CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateUnavailability_Duplicate_Returns409()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedRule(db, user.Id, LeaveStatus.Approved);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today },
            CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateUnavailability_AfterDeclined_SameRule_Succeeds()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        SeedRule(db, user.Id, LeaveStatus.Declined);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today },
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
    }

    [Fact]
    public async Task CreateUnavailability_Valid_LandsApproved()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var result = await MakeController(db).CreateUnavailability(
            new CreateRecurringUnavailabilityDto { UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today },
            CancellationToken.None);

        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:184): POST /leave/unavailability is 201.
        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(created.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Status);
    }

    [Fact]
    public async Task ApproveUnavailability_ReturnsOverlappingPublishedShift()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        // Clock-relative fixture (Important #3): LeaveController.FindRecurringOverlapsAsync clamps
        // horizonStart to DateTime.UtcNow, not to this file's frozen `Today` constant, so the rule's
        // EffectiveFrom and the shift's date must be pinned to the real UTC "today" the SUT actually
        // reads — otherwise this test goes red once real "today" passes the frozen Wednesday.
        var realToday = DateOnly.FromDateTime(DateTime.UtcNow);
        var wednesday = realToday.AddDays(((int)DayOfWeek.Wednesday - (int)realToday.DayOfWeek + 7) % 7);
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = realToday,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        db.SaveChanges();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = wednesday,
            StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = ShiftStatus.Published,
        });
        await db.SaveChangesAsync();

        var result = await MakeController(db).ApproveUnavailability(rule.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityApprovalResultDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Approved, body.Data!.Unavailability.Status);
        Assert.Contains(body.Data.Overlaps, o => o.Code == "SHIFT_OVERLAP");
    }

    /// <summary>Product ruling (2026-09-09): mirrors DeclineLeave_NoNote_Succeeds — a decline
    /// reason is optional here too, not required. Replaces the old
    /// DeclineUnavailability_NoNote_Returns400, which encoded the now-reversed rule.</summary>
    [Fact]
    public async Task DeclineUnavailability_NoNote_Succeeds()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var rule = SeedRule(db, user.Id);
        var result = await MakeController(db).DeclineUnavailability(rule.Id, new LeaveDecisionDto(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Declined, body.Data!.Status);
        Assert.Null(body.Data.DecisionNote);
    }

    [Theory]
    [InlineData(LeaveStatus.Pending)]
    [InlineData(LeaveStatus.Approved)]
    public async Task CancelUnavailability_FromPendingOrApproved_Succeeds(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var rule = SeedRule(db, user.Id, status);
        var result = await MakeController(db).CancelUnavailability(rule.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    /// <summary>A2 ruling: mirrors CancelLeave_FromDeclinedOrCancelled_Returns409 — no such theory existed for CancelUnavailability before this task.</summary>
    [Theory]
    [InlineData(LeaveStatus.Declined, "This request has already been declined.")]
    [InlineData(LeaveStatus.Cancelled, "This request has already been cancelled.")]
    public async Task CancelUnavailability_FromDeclinedOrCancelled_Returns409(LeaveStatus status, string expected)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var rule = SeedRule(db, user.Id, status);
        var result = await MakeController(db).CancelUnavailability(rule.Id, CancellationToken.None);
        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(expected, ((ApiResponse<RecurringUnavailabilityDto>)conflict.Value!).Errors!.Single());
    }
}
