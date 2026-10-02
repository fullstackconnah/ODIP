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
/// A create answers with what became of the person's Firebase sign-in account: "created" (the app just made it) or "existing" (one was
/// already there, and EmailAlreadyExists is swallowed so it is left exactly as it was). The screen needs the difference: a password the admin
/// typed was applied to a created account and NOT to an existing one, and the set-password email is worded "set" or "reset" accordingly.
/// A tenant's first user has a third answer, "failed": the tenant and the user are already committed when Firebase is asked, so a Firebase failure
/// is reported (and logged) rather than turned into a 500 for a tenant that exists.
/// </summary>
public class FirebaseAccountOutcomeTests
{
    private static OdipDbContext SuperAdminDb(bool ignoreInMemoryTransactions = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
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

    // ── Admin Users create ──────────────────────────────────────────────

    private static CreateAdminUserDto AdminDto(Guid tenantId, string? password = null) => new()
    {
        FirstName = "Jane", LastName = "Smith", Email = "jane.smith@acme.example.com", Username = "jane.smith", Role = "Coordinator", TenantId = tenantId, Password = password,
    };

    private static async Task<AdminUserDto> CreateUser(Mock<IFirebaseUserService> firebase, string? password = null)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var result = await controller.Create(AdminDto(tenant.Id, password), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        return Assert.IsType<ApiResponse<AdminUserDto>>(created.Value).Data!;
    }

    [Fact]
    public async Task AdminUsers_create_says_created_when_the_app_made_the_account()
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        var user = await CreateUser(firebase, "Winter-2026!");

        Assert.Equal("created", user.FirebaseAccount);
    }

    [Fact]
    public async Task AdminUsers_create_says_existing_when_an_account_was_already_there_and_leaves_it_alone()
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(FirebaseTestExceptions.EmailAlreadyExists());

        var user = await CreateUser(firebase, "Winter-2026!");

        Assert.Equal("existing", user.FirebaseAccount);
        firebase.Verify(f => f.DeleteUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AdminUsers_GetById_does_not_claim_anything_about_Firebase()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, FirstName = "Jane", LastName = "Smith", Username = "jane.smith", Email = "jane.smith@acme.example.com",
            Role = Odip.Domain.Enums.UserRole.Coordinator, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, new Mock<IFirebaseUserService>().Object);

        var result = await controller.GetById(user.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<AdminUserDto>>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Null(body.Data!.FirebaseAccount);
    }

    // ── Tenant first user ───────────────────────────────────────────────

    private static CreateTenantWithSetupDto TenantDto(bool withFirstUser = true) => new(
        "Brightside Care", "brightside.example.com", null,
        withFirstUser ? new CreateInitialUserDto("Jane", "Smith", "jane.smith@brightside.example.com", "jane.smith", "Admin", null) : null);

    private static async Task<(TenantCreatedDto Dto, OdipDbContext Db)> CreateTenant(Mock<IFirebaseUserService> firebase, bool withFirstUser = true)
    {
        var db = SuperAdminDb(ignoreInMemoryTransactions: true);
        var result = await new TenantsController(db, firebase.Object).CreateWithSetup(TenantDto(withFirstUser), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        return (Assert.IsType<ApiResponse<TenantCreatedDto>>(created.Value).Data!, db);
    }

    [Fact]
    public async Task Tenant_create_says_created_and_names_the_first_user_when_the_app_made_the_account()
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        var (dto, db) = await CreateTenant(firebase);
        using var _ = db;

        Assert.Equal("created", dto.FirebaseAccount);
        Assert.Equal((await db.Users.IgnoreQueryFilters().SingleAsync()).Id, dto.InitialUserId);
        Assert.Equal(1, dto.UserCount);
    }

    [Fact]
    public async Task Tenant_create_says_existing_when_the_first_users_account_was_already_there()
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(FirebaseTestExceptions.EmailAlreadyExists());

        var (dto, db) = await CreateTenant(firebase);
        using var _ = db;

        Assert.Equal("existing", dto.FirebaseAccount);
        Assert.NotNull(dto.InitialUserId);
    }

    [Fact]
    public async Task Tenant_create_says_failed_and_still_answers_201_when_Firebase_could_not_make_the_first_users_account()
    {
        // The tenant and the user are committed before Firebase is asked: a 500 here would hide a tenant that exists, and the admin would
        // try to create it again and be told its domain is taken.
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("simulated Firebase outage (e.g. TokenResponseException)"));
        var logger = new Mock<ILogger<TenantsController>>();
        using var db = SuperAdminDb(ignoreInMemoryTransactions: true);

        var result = await new TenantsController(db, firebase.Object, logger.Object).CreateWithSetup(TenantDto(), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        var dto = Assert.IsType<ApiResponse<TenantCreatedDto>>(created.Value).Data!;
        Assert.Equal("failed", dto.FirebaseAccount);
        Assert.Single(await db.Tenants.ToListAsync());
        Assert.Equal((await db.Users.IgnoreQueryFilters().SingleAsync()).Id, dto.InitialUserId);
        // Logged, so someone can find out why.
        logger.Verify(l => l.Log(LogLevel.Error, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<InvalidOperationException>(),
            It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
    }

    [Fact]
    public async Task Tenant_create_without_a_first_user_says_nothing_about_Firebase()
    {
        var firebase = new Mock<IFirebaseUserService>();

        var (dto, db) = await CreateTenant(firebase, withFirstUser: false);
        using var _ = db;

        Assert.Null(dto.FirebaseAccount);
        Assert.Null(dto.InitialUserId);
        Assert.Equal(0, dto.UserCount);
        firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
