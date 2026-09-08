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

namespace Odip.Tests.Portal;

public class PortalLeaveTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);

    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid? viewAsUserId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAsUserId);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static PortalController MakeController(OdipDbContext db, ICurrentTenant tenant, Guid callerUserId)
    {
        var identity = new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, callerUserId.ToString())], "Test");
        return new PortalController(db, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db, string firstName = "Ben", string lastName = "Turner")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = firstName, LastName = lastName, Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task PostLeave_Valid_LandsPendingWithSelfAsRequester()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(1) },
            CancellationToken.None);

        // Ruling: portal POST /leave returns 201 (spec :171), not 200 — see PostUnavailability_Valid_Returns201 too.
        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(created.Value);
        Assert.Equal(LeaveStatus.Pending, body.Data!.Status);
        Assert.Equal(user.Id, body.Data.UserId);
        Assert.Equal(user.Id, body.Data.RequestedByUserId);
        Assert.Null(body.Data.DecidedByUserId);
    }

    [Fact]
    public async Task PostLeave_IgnoresAnySuppliedUserId_AlwaysUsesTheCaller()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var someoneElse = SeedUser(db, "Amy", "Ng");
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today, UserId = someoneElse.Id },
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(created.Value);
        Assert.Equal(user.Id, body.Data!.UserId);
    }

    [Fact]
    public async Task PostLeave_EndBeforeStart_Returns400()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today.AddDays(-1) },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task PostLeave_Duplicate_Returns409()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    /// <summary>A1 ruling: a declined request being resubmitted is a legitimate flow — the duplicate check must ignore Declined rows (same as Cancelled) on the portal's own create path too.</summary>
    [Fact]
    public async Task PostLeave_AfterDeclined_SameDates_Succeeds()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Declined, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
    }

    [Fact]
    public async Task CancelMyLeave_OwnPendingRequest_Succeeds()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    [Fact]
    public async Task CancelMyLeave_AnotherUsersRequest_Returns404NotFound()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var someoneElse = SeedUser(db, "Amy", "Ng");
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = someoneElse.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = someoneElse.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var reloaded = await db.LeaveRequests.SingleAsync(l => l.Id == leave.Id);
        Assert.Equal(LeaveStatus.Pending, reloaded.Status); // never mutated
    }

    [Fact]
    public async Task CancelMyLeave_AlreadyApproved_Returns409WithWithdrawWording()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Approved, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(conflict.Value);
        Assert.Contains("Only pending requests can be withdrawn.", body.Errors!);
    }

    [Fact]
    public async Task GetMyLeave_ReturnsOnlyTheCallersOwnLeaveAndUnavailability()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var someoneElse = SeedUser(db, "Amy", "Ng");
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = user.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = someoneElse.Id, LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today,
            Status = LeaveStatus.Pending, RequestedByUserId = someoneElse.Id, RequestedAt = DateTime.UtcNow,
        });
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0), EffectiveFrom = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.GetMyLeave(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalLeaveResponseDto>>(ok.Value);
        var leaveRow = Assert.Single(body.Data!.Leave);
        Assert.Equal(user.Id, leaveRow.UserId);
        Assert.Single(body.Data.Unavailability);
    }

    [Fact]
    public async Task PostUnavailability_Valid_Returns201()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyUnavailability(
            new CreateRecurringUnavailabilityDto { DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = Today },
            CancellationToken.None);

        // Ruling: portal POST /unavailability returns 201 (spec :173), not 200.
        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(created.Value);
        Assert.Equal(LeaveStatus.Pending, body.Data!.Status);
        Assert.Equal(user.Id, body.Data.UserId);
    }

    [Fact]
    public async Task PostUnavailability_StartTimeNotBeforeEndTime_Returns400()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CreateMyUnavailability(
            new CreateRecurringUnavailabilityDto { DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(9, 0), EffectiveFrom = Today },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CancelMyUnavailability_OwnPendingRule_Succeeds()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = user.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0),
            EndTime = new TimeOnly(12, 0), EffectiveFrom = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = user.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        await db.SaveChangesAsync();
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyUnavailability(rule.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<RecurringUnavailabilityDto>>(ok.Value);
        Assert.Equal(LeaveStatus.Cancelled, body.Data!.Status);
    }

    [Fact]
    public async Task CancelMyUnavailability_UnknownId_Returns404()
    {
        var (db, tenant) = CreateDb();
        var user = SeedUser(db);
        var controller = MakeController(db, tenant.Object, user.Id);

        var result = await controller.CancelMyUnavailability(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ══════════════════════════════════════════════════════════════
    // TENANT ISOLATION (fix round 1)
    //
    // Every test above runs with IsSuperAdmin = true (see CreateDb), which short-circuits
    // OdipDbContext's ambient `IsSuperAdmin || TenantId == _tenant.TenantId` query filter before
    // the TenantId half is ever evaluated — so none of them actually exercise tenant isolation,
    // only the explicit UserId == staffId.Value ownership check. These three scope a genuine
    // non-SuperAdmin Tenant A caller instead, reusing the fixture idiom from
    // LeaveControllerTests.cs's ApproveLeave_RequestBelongsToAnotherTenant_ReturnsNotFound and
    // SameTenantWritePathTests.cs's CreateDbWithTwoTenants. Where possible the "foreign" row's
    // UserId is deliberately set to the caller's own id — so if the tenant filter were ever
    // missing, the explicit UserId == staffId.Value check would incorrectly still let it through,
    // making these a genuine test of the tenant filter rather than of the ownership filter.
    // ══════════════════════════════════════════════════════════════

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

    private static User SeedUserInTenant(OdipDbContext db, Guid tenantId, string firstName = "Ben", string lastName = "Turner")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = firstName, LastName = lastName, Role = UserRole.SupportWorker, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task CancelMyLeave_OtherTenantRequest_Returns404()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        var (db, tenant) = CreateTenantScopedDb(tenantAId);
        var caller = SeedUserInTenant(db, tenantAId);
        var controller = MakeController(db, tenant.Object, caller.Id);

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantBId, UserId = caller.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = caller.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);
        await db.SaveChangesAsync();

        var result = await controller.CancelMyLeaveRequest(leave.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var reloaded = await db.LeaveRequests.IgnoreQueryFilters().SingleAsync(l => l.Id == leave.Id);
        Assert.Equal(LeaveStatus.Pending, reloaded.Status); // never mutated
    }

    [Fact]
    public async Task GetMyLeave_NonSuperAdmin_ReturnsOnlyOwnTenantRows()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();
        var (db, tenant) = CreateTenantScopedDb(tenantAId);
        var caller = SeedUserInTenant(db, tenantAId);
        var controller = MakeController(db, tenant.Object, caller.Id);

        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantAId, UserId = caller.Id, LeaveType = LeaveType.Annual,
            StartDate = Today, EndDate = Today, Status = LeaveStatus.Pending,
            RequestedByUserId = caller.Id, RequestedAt = DateTime.UtcNow,
        });
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = tenantBId, UserId = caller.Id, LeaveType = LeaveType.Annual,
            StartDate = Today.AddDays(5), EndDate = Today.AddDays(5), Status = LeaveStatus.Pending,
            RequestedByUserId = caller.Id, RequestedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var result = await controller.GetMyLeave(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PortalLeaveResponseDto>>(ok.Value);
        var row = Assert.Single(body.Data!.Leave);
        var reloaded = await db.LeaveRequests.IgnoreQueryFilters().SingleAsync(l => l.Id == row.Id);
        Assert.Equal(tenantAId, reloaded.TenantId);
    }

    [Fact]
    public async Task PostLeave_NonSuperAdmin_StampsCallerTenantAndUser()
    {
        var tenantAId = Guid.NewGuid();
        var (db, tenant) = CreateTenantScopedDb(tenantAId);
        var caller = SeedUserInTenant(db, tenantAId);
        var controller = MakeController(db, tenant.Object, caller.Id);

        var result = await controller.CreateMyLeaveRequest(
            new CreateLeaveRequestDto { LeaveType = LeaveType.Annual, StartDate = Today, EndDate = Today },
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        var body = Assert.IsType<ApiResponse<LeaveRequestDto>>(created.Value);
        Assert.Equal(caller.Id, body.Data!.UserId);

        var saved = await db.LeaveRequests.SingleAsync(l => l.Id == body.Data.Id);
        Assert.Equal(tenantAId, saved.TenantId);
        Assert.Equal(caller.Id, saved.UserId);
    }
}
