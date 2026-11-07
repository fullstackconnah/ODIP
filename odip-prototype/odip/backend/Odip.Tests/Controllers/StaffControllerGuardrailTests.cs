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
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Design spec §4.1 guardrail matrix for StaffController's write endpoints (Create/Update/Delete):
/// a tenant Admin or Coordinator can only manage users within their own tenant (free from
/// OdipDbContext's ambient tenant query filter — proven here rather than re-tested), can never
/// grant or edit a SuperAdmin account, and a Coordinator specifically can never assign the Admin
/// role (only an Admin actor can). SuperAdmin actors are unrestricted. See
/// StaffController.ValidateRoleGuardrails for the implementation these tests exercise.
/// </summary>
public class StaffControllerGuardrailTests
{
    private static (OdipDbContext Db, Guid TenantId) CreateDb()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return (new OdipDbContext(options, tenant.Object), tenantId);
    }

    private static StaffController MakeController(OdipDbContext db, string actorRole)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, actorRole)], "Test");
        return new StaffController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, UserRole role, string firstName = "Existing", string lastName = "User")
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = firstName, LastName = lastName,
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = role, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static CreateStaffDto MinimalCreateDto(UserRole role, string email) => new()
    {
        FirstName = "New", LastName = "Staff", Email = email, Role = role, Position = Position.SupportWorker, IsActive = true,
    };

    // ── Create: role guardrails ──────────────────────────────────────────

    [Fact]
    public async Task Create_CoordinatorCreatesSupportWorker_Succeeds()
    {
        var (db, tenantId) = CreateDb();
        var controller = MakeController(db, "Coordinator");

        var result = await controller.Create(MinimalCreateDto(UserRole.SupportWorker, "sw@example.com"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Create_CoordinatorAttemptsSuperAdmin_ReturnsBadRequest()
    {
        var (db, _) = CreateDb();
        var controller = MakeController(db, "Coordinator");

        var result = await controller.Create(MinimalCreateDto(UserRole.SuperAdmin, "sa@example.com"), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value);
        Assert.Contains("SuperAdmin", body.Errors![0]);
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Fact]
    public async Task Create_CoordinatorAttemptsAdmin_ReturnsBadRequest()
    {
        var (db, _) = CreateDb();
        var controller = MakeController(db, "Coordinator");

        var result = await controller.Create(MinimalCreateDto(UserRole.Admin, "admin@example.com"), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value);
        Assert.Contains("Only an Admin", body.Errors![0]);
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Fact]
    public async Task Create_AdminAssignsAdminRole_Succeeds()
    {
        var (db, _) = CreateDb();
        var controller = MakeController(db, "Admin");

        var result = await controller.Create(MinimalCreateDto(UserRole.Admin, "admin2@example.com"), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(created.Value);
        Assert.Equal(UserRole.Admin, body.Data!.Role);
    }

    [Fact]
    public async Task Create_SuperAdminActorAssignsSuperAdminRole_Succeeds()
    {
        var (db, _) = CreateDb();
        var controller = MakeController(db, "SuperAdmin");

        var result = await controller.Create(MinimalCreateDto(UserRole.SuperAdmin, "sa2@example.com"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    // ── Update: Coordinator cannot promote to Admin ──────────────────────

    [Fact]
    public async Task Update_CoordinatorAttemptsToPromoteExistingSupportWorkerToAdmin_ReturnsBadRequest()
    {
        var (db, tenantId) = CreateDb();
        var existing = SeedUser(db, tenantId, UserRole.SupportWorker, "Regular", "Worker");
        var controller = MakeController(db, "Coordinator");

        var dto = new UpdateStaffDto
        {
            FirstName = existing.FirstName, LastName = existing.LastName, Email = existing.Email,
            Role = UserRole.Admin, Position = Position.SupportWorker, IsActive = true,
        };
        var result = await controller.Update(existing.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value);
        Assert.Contains("Only an Admin", body.Errors![0]);

        var reloaded = await db.Users.SingleAsync(u => u.Id == existing.Id);
        Assert.Equal(UserRole.SupportWorker, reloaded.Role); // unchanged
    }

    [Fact]
    public async Task Update_AdminPromotesSupportWorkerToAdmin_Succeeds()
    {
        var (db, tenantId) = CreateDb();
        var existing = SeedUser(db, tenantId, UserRole.SupportWorker, "Regular", "Worker");
        var controller = MakeController(db, "Admin");

        var dto = new UpdateStaffDto
        {
            FirstName = existing.FirstName, LastName = existing.LastName, Email = existing.Email,
            Role = UserRole.Admin, Position = Position.SupportWorker, IsActive = true,
        };
        var result = await controller.Update(existing.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(ok.Value);
        Assert.Equal(UserRole.Admin, body.Data!.Role);
    }

    // ── Update: cannot edit an existing SuperAdmin account ───────────────

    [Fact]
    public async Task Update_CoordinatorTargetsExistingSuperAdmin_ReturnsBadRequest_EvenWithoutRoleChange()
    {
        var (db, tenantId) = CreateDb();
        var superAdmin = SeedUser(db, tenantId, UserRole.SuperAdmin, "Super", "Admin");
        var controller = MakeController(db, "Coordinator");

        var dto = new UpdateStaffDto
        {
            FirstName = superAdmin.FirstName, LastName = superAdmin.LastName, Email = superAdmin.Email,
            Role = UserRole.SuperAdmin, Position = Position.SupportWorker, IsActive = true,
        };
        var result = await controller.Update(superAdmin.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value);
        Assert.Contains("SuperAdmin", body.Errors![0]);
    }

    [Fact]
    public async Task Delete_CoordinatorTargetsExistingSuperAdmin_ReturnsBadRequest_AccountStaysActive()
    {
        var (db, tenantId) = CreateDb();
        var superAdmin = SeedUser(db, tenantId, UserRole.SuperAdmin, "Super", "Admin");
        var controller = MakeController(db, "Coordinator");

        var result = await controller.Delete(superAdmin.Id, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<bool>>(badRequest.Value);
        Assert.Contains("SuperAdmin", body.Errors![0]);

        var reloaded = await db.Users.SingleAsync(u => u.Id == superAdmin.Id);
        Assert.True(reloaded.IsActive);
    }

    // ── Own-tenant only: a cross-tenant target 404s (free via OdipDbContext's tenant filter) ──

    [Fact]
    public async Task Update_TargetInAnotherTenant_ReturnsNotFound()
    {
        var (db, _) = CreateDb();
        var otherTenantId = Guid.NewGuid();
        var foreignUser = SeedUser(db, otherTenantId, UserRole.SupportWorker, "Foreign", "User");
        var controller = MakeController(db, "Coordinator");

        var dto = new UpdateStaffDto
        {
            FirstName = "Changed", LastName = "Name", Email = foreignUser.Email,
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        var result = await controller.Update(foreignUser.Id, dto, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetById_TargetInAnotherTenant_ReturnsNotFound()
    {
        var (db, _) = CreateDb();
        var otherTenantId = Guid.NewGuid();
        var foreignUser = SeedUser(db, otherTenantId, UserRole.SupportWorker, "Foreign", "User");
        var controller = MakeController(db, "Coordinator");

        var result = await controller.GetById(foreignUser.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ── Admin accounts: only an Admin may change or archive one; an organisation keeps one active Admin ──

    private static UpdateStaffDto EditOf(User u, UserRole? role = null, bool? isActive = null, string? mobile = null) => new()
    {
        FirstName = u.FirstName, LastName = u.LastName, Email = u.Email, Mobile = mobile ?? u.Mobile,
        Role = role ?? u.Role, Position = Position.SupportWorker, IsActive = isActive ?? u.IsActive,
    };

    private static string Error<T>(ActionResult<ApiResponse<T>> result)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<T>>(badRequest.Value).Errors![0];
    }

    private const string LastAdminMessage = "Add another Admin first. An organisation needs at least one active Admin.";

    [Fact]
    public async Task Update_CoordinatorDemotesAdmin_ReturnsBadRequest_RowUnchanged()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Coordinator").Update(admin.Id, EditOf(admin, role: UserRole.Coordinator), CancellationToken.None);

        Assert.Equal("Only an Admin can change an Admin's role.", Error(result));
        Assert.Equal(UserRole.Admin, (await db.Users.SingleAsync(u => u.Id == admin.Id)).Role);
    }

    [Fact]
    public async Task Update_CoordinatorArchivesAdmin_ReturnsBadRequest_RowUnchanged()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Coordinator").Update(admin.Id, EditOf(admin, isActive: false), CancellationToken.None);

        Assert.Equal("Only an Admin can archive an Admin.", Error(result));
        Assert.True((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }

    [Fact]
    public async Task Update_CoordinatorChangesOnlyAdminsPhone_Succeeds()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Coordinator").Update(admin.Id, EditOf(admin, mobile: "0400 000 000"), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("0400 000 000", (await db.Users.SingleAsync(u => u.Id == admin.Id)).Mobile);
    }

    [Fact]
    public async Task Delete_CoordinatorTargetsAdmin_SaysOnlyAnAdminCanArchive()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Coordinator").Delete(admin.Id, CancellationToken.None);

        Assert.Equal("Only an Admin can archive an Admin.", Error(result));
        Assert.True((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }

    [Fact]
    public async Task Update_SoleAdminDemotesSelf_ReturnsLastAdminError()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Admin").Update(admin.Id, EditOf(admin, role: UserRole.Coordinator), CancellationToken.None);

        Assert.Equal(LastAdminMessage, Error(result));
        Assert.Equal(UserRole.Admin, (await db.Users.SingleAsync(u => u.Id == admin.Id)).Role);
    }

    [Fact]
    public async Task Update_SoleAdminArchivesSelf_ReturnsLastAdminError()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Admin").Update(admin.Id, EditOf(admin, isActive: false), CancellationToken.None);

        Assert.Equal(LastAdminMessage, Error(result));
        Assert.True((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }

    [Fact]
    public async Task Delete_SoleAdminArchivesSelf_ReturnsLastAdminError()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Admin").Delete(admin.Id, CancellationToken.None);

        Assert.Equal(LastAdminMessage, Error(result));
        Assert.True((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }

    [Fact]
    public async Task Delete_AdminArchivesOtherAdmin_ThenLastAdminCannotArchiveSelf()
    {
        var (db, tenantId) = CreateDb();
        var a = SeedUser(db, tenantId, UserRole.Admin);
        var b = SeedUser(db, tenantId, UserRole.Admin);
        var controller = MakeController(db, "Admin");

        Assert.IsType<OkObjectResult>((await controller.Delete(b.Id, CancellationToken.None)).Result);
        Assert.False((await db.Users.SingleAsync(u => u.Id == b.Id)).IsActive);

        Assert.Equal(LastAdminMessage, Error(await controller.Delete(a.Id, CancellationToken.None)));
    }

    [Fact]
    public async Task Delete_SuperAdminArchivesSoleAdmin_Succeeds()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "SuperAdmin").Delete(admin.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.False((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }
}
