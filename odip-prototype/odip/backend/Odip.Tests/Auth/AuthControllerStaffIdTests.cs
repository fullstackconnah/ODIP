using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Auth;

/// <summary>
/// Coverage for the StaffId field on AuthResponseDto (exercised via DevLogin, which bypasses
/// Firebase entirely — Exchange runs the exact same StaffIdResolver call but can't be
/// unit-tested without mocking the FirebaseAuth static SDK). Post staff/user unification, every
/// User IS the staff record — <see cref="StaffIdResolver"/> resolves to the user's own Id, so
/// the "unlinked" (null StaffId) case from before the merge no longer exists as a reachable
/// state; these tests assert the new invariant (StaffId == the resolved user's own Id) instead.
/// Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as PortalControllerTests/MedicationsWitnessTests.
/// </summary>
public class AuthControllerStaffIdTests
{
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid? viewAsUserId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        tenant.Setup(t => t.ViewAsUserId).Returns(viewAsUserId);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static AuthController MakeController(OdipDbContext db, ICurrentTenant tenant)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = "unit-test-signing-secret-at-least-32-characters-long",
            })
            .Build();

        return new AuthController(db, config, NullLogger<AuthController>.Instance, Mock.Of<ILoginAttemptTracker>(), tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext(),
            },
        };
    }

    private static Tenant SeedTenant(OdipDbContext db)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = "Ability Options", EmailDomain = $"{Guid.NewGuid()}.example.com", IsActive = true };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, UserRole role = UserRole.SupportWorker)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = "Test", LastName = "User", Role = role, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    /// <summary>Runs <paramref name="action"/> with DEV_AUTH_ENABLED="true" (what gates
    /// AuthController.DevLogin), restoring the prior value afterwards so this test's process-wide
    /// env var mutation can't leak into other tests.</summary>
    private static async Task WithDevAuthEnabledAsync(Func<Task> action)
    {
        var previous = Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED");
        Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", "true");
        try
        {
            await action();
        }
        finally
        {
            Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", previous);
        }
    }

    [Fact]
    public async Task DevLogin_ResponseCarriesUsersOwnId()
    {
        await WithDevAuthEnabledAsync(async () =>
        {
            var (db, tenantMock) = CreateDb();
            var tenant = SeedTenant(db);
            var user = SeedUser(db, tenant.Id);
            var controller = MakeController(db, tenantMock.Object);

            var result = await controller.DevLogin(new DevLoginDto { Username = user.Username }, CancellationToken.None);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value);
            Assert.True(body.Success);
            Assert.Equal(user.Id, body.Data!.StaffId);
        });
    }

    [Fact]
    public async Task DevLogin_PlainSupportWorkerUser_ResponseCarriesOwnId()
    {
        await WithDevAuthEnabledAsync(async () =>
        {
            var (db, tenantMock) = CreateDb();
            var tenant = SeedTenant(db);
            var user = SeedUser(db, tenant.Id);
            var controller = MakeController(db, tenantMock.Object);

            var result = await controller.DevLogin(new DevLoginDto { Username = user.Username }, CancellationToken.None);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value);
            Assert.True(body.Success);
            Assert.Equal(user.Id, body.Data!.StaffId);
            Assert.NotNull(body.Data.StaffId);
        });
    }

    [Fact]
    public async Task DevLogin_ViewAsUserSet_ResponseCarriesViewedUsersOwnId_NotCallersOwn()
    {
        await WithDevAuthEnabledAsync(async () =>
        {
            var (db, _) = CreateDb();
            var tenant = SeedTenant(db);
            var caller = SeedUser(db, tenant.Id);
            var viewedUser = SeedUser(db, tenant.Id);

            var tenantMock = new Mock<ICurrentTenant>();
            tenantMock.Setup(t => t.TenantId).Returns((Guid?)null);
            tenantMock.Setup(t => t.IsSuperAdmin).Returns(true);
            tenantMock.Setup(t => t.ViewAsUserId).Returns(viewedUser.Id);

            var controller = MakeController(db, tenantMock.Object);

            // Signing in as `caller`, but ViewAsUserId (X-View-As-User) points at `viewedUser` —
            // the response must carry the VIEWED user's own id, not the caller's own, mirroring
            // PortalController.ResolveCurrentStaffIdAsync's priority order exactly.
            var result = await controller.DevLogin(new DevLoginDto { Username = caller.Username }, CancellationToken.None);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value);
            Assert.Equal(viewedUser.Id, body.Data!.StaffId);
            Assert.NotEqual(caller.Id, body.Data.StaffId);
        });
    }

    [Fact]
    public async Task DevLogin_SuperAdminUser_ResponseStaffIdIsOwnId()
    {
        await WithDevAuthEnabledAsync(async () =>
        {
            var (db, tenantMock) = CreateDb();
            var tenant = SeedTenant(db);
            var superAdmin = SeedUser(db, tenant.Id, role: UserRole.SuperAdmin);
            var controller = MakeController(db, tenantMock.Object);

            var result = await controller.DevLogin(new DevLoginDto { Username = superAdmin.Username }, CancellationToken.None);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value);
            Assert.Equal("SuperAdmin", body.Data!.Role);
            // Post staff/user unification a SuperAdmin is still a User row like any other, so
            // StaffId resolves to their own id rather than null.
            Assert.Equal(superAdmin.Id, body.Data.StaffId);
        });
    }
}
