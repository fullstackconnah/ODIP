using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// POST api/v1/staff/{id}/two-step/reset: an Admin (or a SuperAdmin viewing the organisation) clears a person's second factor in Firebase. The
/// tenant lookup comes first (another organisation's id is a 404 and Firebase is never asked), then the role rule, then Firebase, and the audit row
/// is written only once Firebase has done it.
/// </summary>
public class StaffTwoStepResetTests
{
    private const string SuperAdminDomain = "platform.example.com";

    private sealed class Rig
    {
        public required OdipDbContext Db { get; init; }
        public required Guid TenantId { get; init; }
        public required Mock<IFirebaseUserService> Firebase { get; init; }
        public required User Caller { get; init; }
        public required StaffController Controller { get; init; }
    }

    private static Rig Build(string callerRole, bool callerIsSuperAdmin = false, Guid? viewedTenant = null)
    {
        var tenantId = viewedTenant ?? Guid.NewGuid();
        var currentTenant = new Mock<ICurrentTenant>();
        currentTenant.Setup(t => t.TenantId).Returns(tenantId);
        currentTenant.Setup(t => t.IsSuperAdmin).Returns(callerIsSuperAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, currentTenant.Object);
        var caller = Seed(db, tenantId, callerIsSuperAdmin ? UserRole.SuperAdmin : Enum.Parse<UserRole>(callerRole));
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(SecondFactorResetResult.Done);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:SuperAdminDomain"] = SuperAdminDomain }).Build();
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Role, callerRole), new Claim(ClaimTypes.NameIdentifier, caller.Id.ToString()), new Claim("fullName", "Cal Ler")], "Test");
        var controller = new StaffController(db, config: config, firebaseUserService: firebase.Object, logger: new Mock<ILogger<StaffController>>().Object, currentTenant: currentTenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
        return new Rig { Db = db, TenantId = tenantId, Firebase = firebase, Caller = caller, Controller = controller };
    }

    private static User Seed(OdipDbContext db, Guid tenantId, UserRole role, string? email = null)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Pat", LastName = "Target", Username = Guid.NewGuid().ToString("N"),
            Email = email ?? $"{Guid.NewGuid():N}@gmail.com", Role = role, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static List<AuditLog> TwoStepAudits(OdipDbContext db) =>
        db.AuditLogs.IgnoreQueryFilters().Where(a => a.Action == AuditAction.TwoStepReset).ToList();

    private static Task<ActionResult<ApiResponse<bool>>> Reset(Rig rig, Guid id) => rig.Controller.ResetTwoStep(id, CancellationToken.None);

    [Fact]
    public async Task Admin_resets_Coordinator_in_own_org()
    {
        var rig = Build("Admin");
        var target = Seed(rig.Db, rig.TenantId, UserRole.Coordinator);

        var result = await Reset(rig, target.Id);

        Assert.IsType<OkObjectResult>(result.Result);
        rig.Firebase.Verify(f => f.ResetSecondFactorsAsync(target.Email, It.IsAny<CancellationToken>()), Times.Once);
        var audit = Assert.Single(TwoStepAudits(rig.Db));
        Assert.Equal(("User", target.Id, rig.Caller.Id), (audit.EntityType, audit.EntityId, audit.ChangedById));
        Assert.Equal("Cal Ler", audit.ChangedByName);
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task Admin_cannot_reset_Admin_or_SuperAdmin(UserRole targetRole)
    {
        var rig = Build("Admin");
        var target = Seed(rig.Db, rig.TenantId, targetRole);

        var result = await Reset(rig, target.Id);

        Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, ((ObjectResult)result.Result!).StatusCode);
        rig.Firebase.Verify(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.Empty(TwoStepAudits(rig.Db));
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.Coordinator)]
    public async Task SuperAdmin_resets_Admin_or_Coordinator_in_viewed_org(UserRole targetRole)
    {
        var rig = Build("SuperAdmin", callerIsSuperAdmin: true);
        var target = Seed(rig.Db, rig.TenantId, targetRole);

        var result = await Reset(rig, target.Id);

        Assert.IsType<OkObjectResult>(result.Result);
        rig.Firebase.Verify(f => f.ResetSecondFactorsAsync(target.Email, It.IsAny<CancellationToken>()), Times.Once);
        Assert.Single(TwoStepAudits(rig.Db));
    }

    [Fact]
    public async Task SuperAdmin_cannot_reset_a_SuperAdmin()
    {
        var rig = Build("SuperAdmin", callerIsSuperAdmin: true);
        var target = Seed(rig.Db, rig.TenantId, UserRole.SuperAdmin);

        var result = await Reset(rig, target.Id);

        Assert.Equal(403, ((ObjectResult)result.Result!).StatusCode);
        rig.Firebase.Verify(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    public async Task A_row_at_the_SuperAdmin_domain_is_403_whatever_its_role(string caller)
    {
        var rig = Build(caller, callerIsSuperAdmin: caller == "SuperAdmin");
        var target = Seed(rig.Db, rig.TenantId, UserRole.Coordinator, $"someone@{SuperAdminDomain}");

        var result = await Reset(rig, target.Id);

        Assert.Equal(403, ((ObjectResult)result.Result!).StatusCode);
        rig.Firebase.Verify(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Admin_cross_tenant_target_is_404_and_no_firebase_call()
    {
        var rig = Build("Admin");
        var other = Seed(rig.Db, Guid.NewGuid(), UserRole.Coordinator);

        var result = await Reset(rig, other.Id);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        rig.Firebase.Verify(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.Empty(TwoStepAudits(rig.Db));
    }

    [Fact]
    public async Task Unknown_id_is_404()
    {
        var rig = Build("Admin");

        Assert.IsType<NotFoundObjectResult>((await Reset(rig, Guid.NewGuid())).Result);
    }

    [Fact]
    public void Only_Admin_and_SuperAdmin_may_call_it_so_Coordinator_and_SupportWorker_get_403_from_the_role_attribute()
    {
        var attribute = typeof(StaffController).GetMethod(nameof(StaffController.ResetTwoStep))!.GetCustomAttribute<AuthorizeAttribute>()!;

        Assert.Equal("Admin,SuperAdmin", attribute.Roles);
        Assert.Equal("api/v1/staff", typeof(StaffController).GetCustomAttribute<RouteAttribute>()!.Template);
        Assert.Equal("{id:guid}/two-step/reset", typeof(StaffController).GetMethod(nameof(StaffController.ResetTwoStep))!.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    [Fact]
    public async Task No_firebase_account_is_400_no_audit()
    {
        var rig = Build("Admin");
        var target = Seed(rig.Db, rig.TenantId, UserRole.Coordinator);
        rig.Firebase.Setup(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(SecondFactorResetResult.NoAccount);

        var result = await Reset(rig, target.Id);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("This person doesn't have a sign-in yet, so there is nothing to reset.", Assert.IsType<ApiResponse<bool>>(bad.Value).Errors![0]);
        Assert.Empty(TwoStepAudits(rig.Db));
    }

    [Fact]
    public async Task Firebase_failure_is_502_no_audit()
    {
        var rig = Build("Admin");
        var target = Seed(rig.Db, rig.TenantId, UserRole.Coordinator);
        rig.Firebase.Setup(f => f.ResetSecondFactorsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ThrowsAsync(new HttpRequestException("boom"));

        var result = await Reset(rig, target.Id);

        Assert.Equal(502, ((ObjectResult)result.Result!).StatusCode);
        Assert.Empty(TwoStepAudits(rig.Db));
    }
}
