using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Leave;

public class StaffUnavailabilityQueryTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task Approved_leave_produces_an_ApprovedLeave_window_spanning_the_whole_days()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var window = Assert.Single(windows);
        Assert.Equal(UnavailabilityKind.ApprovedLeave, window.Kind);
        Assert.Equal(new DateOnly(2026, 9, 10).ToDateTime(TimeOnly.MinValue), window.Start);
        Assert.Equal(new DateOnly(2026, 9, 13).ToDateTime(TimeOnly.MinValue), window.End); // inclusive end-date, so the window runs to the START of the following day
    }

    [Fact]
    public async Task Pending_leave_produces_a_PendingLeave_window()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Sick,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Equal(UnavailabilityKind.PendingLeave, Assert.Single(windows).Kind);
    }

    [Theory]
    [InlineData(LeaveStatus.Declined)]
    [InlineData(LeaveStatus.Cancelled)]
    public async Task Declined_or_cancelled_leave_produces_no_window(LeaveStatus status)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = status, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Approved_recurring_rule_expands_to_one_window_per_occurrence()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Approved,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.All(windows, w => Assert.Equal(UnavailabilityKind.RecurringRule, w.Kind));
        Assert.Equal(5, windows.Count); // 5 Wednesdays in Sept 2026
        var first = windows.OrderBy(w => w.Start).First();
        Assert.Equal(new DateTime(2026, 9, 2, 9, 0, 0), first.Start);
        Assert.Equal(new DateTime(2026, 9, 2, 12, 0, 0), first.End);
    }

    [Fact]
    public async Task Pending_recurring_rule_produces_no_window()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Theory]
    [InlineData(AvailabilityType.Unavailable)]
    [InlineData(AvailabilityType.Training)]
    [InlineData(AvailabilityType.Leave)] // Important #2 — Leave rows still created via the pre-PR-2 editor must still block rostering
    public async Task Legacy_unavailable_or_training_rows_produce_a_Legacy_window(AvailabilityType type)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, AvailabilityType = type, Notes = "Doctor's appointment",
            StartDateTime = new DateTime(2026, 9, 10, 8, 0, 0), EndDateTime = new DateTime(2026, 9, 10, 12, 0, 0),
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var window = Assert.Single(windows);
        Assert.Equal(UnavailabilityKind.Legacy, window.Kind);
        Assert.Equal(type, window.LegacySourceType);
        Assert.Equal("Doctor's appointment", window.LegacyNotes);
    }

    [Theory]
    [InlineData(AvailabilityType.Available)]
    [InlineData(AvailabilityType.Preferred)]
    [InlineData(AvailabilityType.Tentative)]
    public async Task Legacy_rows_of_other_types_produce_no_window(AvailabilityType type)
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, AvailabilityType = type,
            StartDateTime = new DateTime(2026, 9, 10, 8, 0, 0), EndDateTime = new DateTime(2026, 9, 10, 12, 0, 0),
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task A_window_entirely_outside_the_requested_range_is_excluded()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 10, 1), EndDate = new DateOnly(2026, 10, 2),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Windows_from_a_user_not_in_the_requested_list_are_excluded()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        var otherUser = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = otherUser.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = LeaveStatus.Approved, RequestedByUserId = otherUser.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Empty_userIds_list_short_circuits_to_no_query()
    {
        using var db = CreateDb();
        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(Array.Empty<Guid>(), new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }

    [Fact]
    public async Task Unions_all_three_sources_at_once()
    {
        using var db = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 5), EndDate = new DateOnly(2026, 9, 5),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantId, UserId = user.Id, DayOfWeek = DayOfWeek.Wednesday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), EffectiveTo = new DateOnly(2026, 9, 2), Status = LeaveStatus.Approved,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, AvailabilityType = AvailabilityType.Training,
            StartDateTime = new DateTime(2026, 9, 20, 8, 0, 0), EndDateTime = new DateTime(2026, 9, 20, 12, 0, 0),
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Equal(3, windows.Count);
        Assert.Contains(windows, w => w.Kind == UnavailabilityKind.ApprovedLeave);
        Assert.Contains(windows, w => w.Kind == UnavailabilityKind.RecurringRule);
        Assert.Contains(windows, w => w.Kind == UnavailabilityKind.Legacy);
    }

    // Minor #12 — the query has no explicit TenantId predicate of its own; it relies entirely on
    // the global query filter. Prove that reliance with a non-SuperAdmin caller (all other
    // fixtures in this file are SuperAdmin, which short-circuits the filter before the tenant half
    // is evaluated), reusing the CreateTenantScopedDb idiom from Odip.Tests/Portal/PortalLeaveTests.cs.
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateTenantScopedDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        tenant.Setup(t => t.ViewAsUserId).Returns((Guid?)null);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static User SeedUserInTenant(OdipDbContext db, Guid tenantId)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task NonSuperAdmin_caller_sees_no_windows_from_another_tenants_LeaveRequest()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        var (db, tenant) = CreateTenantScopedDb(tenantAId);
        var user = SeedUserInTenant(db, tenantAId);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantBId, UserId = user.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 10),
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var windows = await new StaffUnavailabilityQuery(db)
            .GetWindowsAsync(new[] { user.Id }, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        Assert.Empty(windows);
    }
}
