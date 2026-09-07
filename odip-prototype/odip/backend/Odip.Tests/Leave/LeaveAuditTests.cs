using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Leave;

/// <summary>
/// Confirms LeaveRequest/RecurringUnavailability/StaffAvailability — all three added to
/// AuditedEntities.Types this feature (Task 3) — actually produce AuditLog rows via
/// AuditInterceptor, in particular that a coordinator's decline note and a staff member's
/// withdrawal are recoverable from the audit trail. Mirrors
/// Odip.Tests/Rostering/RosteringAuditTests.cs's scaffold exactly.
/// </summary>
public class LeaveAuditTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static OdipDbContext CreateDb(Guid actingUserId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, actingUserId.ToString()),
                new Claim("fullName", "Jane Coordinator")
            ],
            "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static User NewStaff() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    [Fact]
    public async Task CreateLeaveRequest_WritesCreatedAuditLog()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(LeaveRequest)).ToList());
        Assert.Equal(leave.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
        Assert.Equal("Jane Coordinator", log.ChangedByName);
    }

    [Fact]
    public async Task DeclineLeaveRequest_WritesAuditLogWithTheDecisionNote()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();

        leave.Status = LeaveStatus.Declined;
        leave.DecidedByUserId = actingUserId;
        leave.DecidedAt = DateTime.UtcNow;
        leave.DecisionNote = "No cover available that week.";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(LeaveRequest) && a.EntityId == leave.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("DecisionNote", updateLog.Changes);
        Assert.Contains("No cover available that week.", updateLog.Changes);
        Assert.Contains("Status", updateLog.Changes);
    }

    [Fact]
    public async Task CreateRecurringUnavailability_WritesCreatedAuditLog()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(RecurringUnavailability)).ToList());
        Assert.Equal(rule.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
    }

    [Fact]
    public async Task ApproveRecurringUnavailability_WritesAuditLogWithStatusChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = staff.Id, DayOfWeek = DayOfWeek.Monday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        await db.SaveChangesAsync();

        rule.Status = LeaveStatus.Approved;
        rule.DecidedByUserId = actingUserId;
        rule.DecidedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(RecurringUnavailability) && a.EntityId == rule.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Status", updateLog.Changes);
    }

    [Fact]
    public async Task CreateStaffAvailability_NowWritesCreatedAuditLog()
    {
        // StaffAvailability was conspicuously absent from AuditedEntities.Types before this
        // feature (see the spec's Context section) — Task 3 adds it. This proves the remaining
        // Unavailable/Training/Preferred/Available rows get history from this point forward,
        // even though the entity itself is otherwise untouched by this PR.
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var staff = NewStaff();
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var availability = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, AvailabilityType = AvailabilityType.Unavailable,
            StartDateTime = Today.ToDateTime(new TimeOnly(8, 0)), EndDateTime = Today.ToDateTime(new TimeOnly(12, 0)),
        };
        db.StaffAvailabilities.Add(availability);
        await db.SaveChangesAsync();

        var log = Assert.Single(db.AuditLogs.Where(a => a.EntityType == nameof(StaffAvailability)).ToList());
        Assert.Equal(availability.Id, log.EntityId);
        Assert.Equal(AuditAction.Created, log.Action);
    }
}
