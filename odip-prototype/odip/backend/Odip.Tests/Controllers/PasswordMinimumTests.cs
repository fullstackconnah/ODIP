using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// A password an admin types for someone else must be at least 12 characters. The account the app creates is verified from the start, so
/// a typed password is a working credential, and Firebase's own floor of 6 would let "Welcome1" guard a real person's account. Both create
/// paths that accept a password refuse a short one with a 400 before anything is written or sent to Firebase (without this it was a
/// Firebase rejection surfacing as a 502). Leaving it out is still fine: the person sets their own from the emailed link.
/// </summary>
public class PasswordMinimumTests
{
    private const string Eleven = "Winter-2026"; // 11 characters
    private const string Twelve = "Winter-2026!"; // 12 characters
    private const string Expected = "A password must be at least 12 characters.";

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("a", Expected)]
    [InlineData(Eleven, Expected)]
    [InlineData(Twelve, null)]
    [InlineData("a-much-longer-password-than-the-minimum", null)]
    public void Policy_refuses_a_given_password_under_twelve_characters_and_accepts_none_or_enough(string? password, string? refusal)
    {
        Assert.Equal(refusal, PasswordPolicy.Check(password));
        Assert.Equal(12, PasswordPolicy.MinLength);
    }

    // ── Admin Users create ──────────────────────────────────────────────

    private static OdipDbContext SuperAdminDb(bool ignoreInMemoryTransactions = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
        // CreateWithSetup runs inside a transaction, which the InMemory provider refuses unless told to ignore it.
        if (ignoreInMemoryTransactions) builder.ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning));
        return new OdipDbContext(builder.Options, tenant.Object);
    }

    private static Tenant SeedTenant(OdipDbContext db)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = "acme.example.com", IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static CreateAdminUserDto AdminDto(Guid tenantId, string? password) => new()
    {
        FirstName = "Jane", LastName = "Smith", Email = "jane.smith@acme.example.com", Username = "jane.smith", Role = "Coordinator", TenantId = tenantId, Password = password,
    };

    private static AdminUsersController AdminController(OdipDbContext db, Mock<IFirebaseUserService> firebase) =>
        new(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

    private static void VerifyFirebaseNeverCreated(Mock<IFirebaseUserService> firebase) =>
        firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);

    [Fact]
    public async Task AdminUsers_create_refuses_a_short_password_before_anything_is_written_or_sent()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await AdminController(db, firebase).Create(AdminDto(tenant.Id, Eleven), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(Expected, Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors![0]);
        Assert.Empty(await db.Users.IgnoreQueryFilters().ToListAsync());
        VerifyFirebaseNeverCreated(firebase);
    }

    [Fact]
    public async Task AdminUsers_create_accepts_twelve_characters_and_hands_Firebase_the_password()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        var result = await AdminController(db, firebase).Create(AdminDto(tenant.Id, Twelve), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        firebase.Verify(f => f.CreateUserAsync("jane.smith@acme.example.com", "Jane Smith", Twelve, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task AdminUsers_create_treats_no_password_and_an_empty_one_the_same_and_sends_Firebase_none(string? password)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        var result = await AdminController(db, firebase).Create(AdminDto(tenant.Id, password), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        firebase.Verify(f => f.CreateUserAsync("jane.smith@acme.example.com", "Jane Smith", null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Tenant first user ───────────────────────────────────────────────

    private static CreateTenantWithSetupDto TenantDto(string? password) => new(
        "Brightside Care", "brightside.example.com", null,
        new CreateInitialUserDto("Jane", "Smith", "jane.smith@brightside.example.com", "jane.smith", "Admin", password));

    [Fact]
    public async Task Tenant_create_refuses_a_short_first_user_password_and_creates_nothing()
    {
        using var db = SuperAdminDb(ignoreInMemoryTransactions: true);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await new TenantsController(db, firebase.Object).CreateWithSetup(TenantDto(Eleven), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(Expected, Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors![0]);
        Assert.Empty(await db.Tenants.ToListAsync());
        Assert.Empty(await db.Users.IgnoreQueryFilters().ToListAsync());
        VerifyFirebaseNeverCreated(firebase);
    }

    [Theory]
    [InlineData(Twelve)]
    [InlineData(null)]
    public async Task Tenant_create_accepts_twelve_characters_or_no_password(string? password)
    {
        using var db = SuperAdminDb(ignoreInMemoryTransactions: true);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        var result = await new TenantsController(db, firebase.Object).CreateWithSetup(TenantDto(password), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        firebase.Verify(f => f.CreateUserAsync("jane.smith@brightside.example.com", "Jane Smith", password, It.IsAny<CancellationToken>()), Times.Once);
    }
}
