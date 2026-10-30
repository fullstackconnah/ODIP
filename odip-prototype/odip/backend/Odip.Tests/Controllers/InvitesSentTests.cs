using System.Reflection;
using System.Security.Claims;
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
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

public class InvitesSentTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 14, 30, 0, TimeSpan.Zero);

    private sealed class FixedClock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }

    private static OdipDbContext DbFor(string name, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static StaffController ControllerFor(OdipDbContext db, string role) =>
        new(db, clock: new FixedClock())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role), new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")),
                },
            },
        };

    private static async Task<User> Seed(OdipDbContext db, Guid tenantId, string name, bool active = true, bool signedIn = false, UserRole role = UserRole.SupportWorker)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = name, LastName = "Staff", Username = Guid.NewGuid().ToString("N"), Email = $"{name}@example.com",
            Role = role, IsActive = active, LastLoginAt = signedIn ? DateTime.UtcNow : null, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static async Task<int> Send(StaffController controller, params Guid[] ids) =>
        Assert.IsType<ApiResponse<int>>(Assert.IsType<OkObjectResult>((await controller.InvitesSent(new InvitesSentRequest(ids.ToList()), CancellationToken.None)).Result).Value).Data;

    [Fact]
    public async Task Stamps_active_never_signed_in_staff_with_the_clock_time()
    {
        var tenantId = Guid.NewGuid();
        using var db = DbFor(Guid.NewGuid().ToString(), tenantId);
        var a = await Seed(db, tenantId, "a");
        var b = await Seed(db, tenantId, "b");

        Assert.Equal(2, await Send(ControllerFor(db, "Admin"), a.Id, b.Id));

        Assert.All(await db.Users.ToListAsync(), u => Assert.Equal(Now.UtcDateTime, u.SignInInviteSentAt));
    }

    [Fact]
    public async Task Ignores_archived_signed_in_and_unknown_ids()
    {
        var tenantId = Guid.NewGuid();
        using var db = DbFor(Guid.NewGuid().ToString(), tenantId);
        var archived = await Seed(db, tenantId, "arc", active: false);
        var signedIn = await Seed(db, tenantId, "sig", signedIn: true);

        Assert.Equal(0, await Send(ControllerFor(db, "Admin"), archived.Id, signedIn.Id, Guid.NewGuid()));

        Assert.All(await db.Users.ToListAsync(), u => Assert.Null(u.SignInInviteSentAt));
    }

    [Fact]
    public async Task Ignores_another_tenants_staff()
    {
        var shared = Guid.NewGuid().ToString();
        var otherTenant = Guid.NewGuid();
        using var otherDb = DbFor(shared, otherTenant);
        var theirs = await Seed(otherDb, otherTenant, "theirs");
        var tenantId = Guid.NewGuid();
        using var db = DbFor(shared, tenantId);

        Assert.Equal(0, await Send(ControllerFor(db, "Admin"), theirs.Id));

        Assert.Null((await otherDb.Users.SingleAsync()).SignInInviteSentAt);
    }

    [Fact]
    public async Task Refuses_more_than_100_and_none_but_counts_repeats_once()
    {
        var tenantId = Guid.NewGuid();
        using var db = DbFor(Guid.NewGuid().ToString(), tenantId);
        var controller = ControllerFor(db, "Admin");
        var ids = Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToList();

        Assert.IsType<BadRequestObjectResult>((await controller.InvitesSent(new InvitesSentRequest(ids), CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.InvitesSent(new InvitesSentRequest([]), CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.InvitesSent(null, CancellationToken.None)).Result);
        // 100 distinct plus one repeat is 100 people, so it is accepted.
        Assert.IsType<OkObjectResult>((await controller.InvitesSent(new InvitesSentRequest(ids.Take(100).Append(ids[0]).ToList()), CancellationToken.None)).Result);
    }

    [Theory]
    [InlineData("Coordinator", false)]
    [InlineData("Admin", false)]
    [InlineData("SuperAdmin", true)]
    public async Task Only_a_SuperAdmin_stamps_a_SuperAdmin_row(string role, bool stamped)
    {
        var tenantId = Guid.NewGuid();
        using var db = DbFor(Guid.NewGuid().ToString(), tenantId);
        var boss = await Seed(db, tenantId, "boss", role: UserRole.SuperAdmin);

        Assert.Equal(stamped ? 1 : 0, await Send(ControllerFor(db, role), boss.Id));

        Assert.Equal(stamped, (await db.Users.SingleAsync()).SignInInviteSentAt is not null);
    }

    [Fact]
    public void Roles_match_the_invite_callers_and_the_route_is_absolute()
    {
        var action = typeof(StaffController).GetMethod(nameof(StaffController.InvitesSent))!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", action.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("/api/v1/users/invites-sent", action.GetCustomAttribute<HttpPostAttribute>()?.Template);
    }
}
