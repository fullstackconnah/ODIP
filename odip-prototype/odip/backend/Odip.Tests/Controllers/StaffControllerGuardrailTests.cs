using System.Security.Claims;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
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

    // Always a mock: a controller built without one would reach the real Firebase service on every archive or reactivation.
    private static StaffController MakeController(OdipDbContext db, string actorRole, Mock<IFirebaseUserService>? firebase = null)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, actorRole)], "Test");
        return new StaffController(db, firebaseUserService: (firebase ?? new Mock<IFirebaseUserService>()).Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, UserRole role, string firstName = "Existing", string lastName = "User", bool signedIn = true)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = firstName, LastName = lastName,
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = role, IsActive = true, LastLoginAt = signedIn ? DateTime.UtcNow : null,
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

        Assert.Equal("Only an Admin can edit an Admin account.", Error(result));
        Assert.Equal(UserRole.Admin, (await db.Users.SingleAsync(u => u.Id == admin.Id)).Role);
    }

    [Fact]
    public async Task Update_CoordinatorArchivesAdmin_ReturnsBadRequest_RowUnchanged()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Coordinator").Update(admin.Id, EditOf(admin, isActive: false), CancellationToken.None);

        Assert.Equal("Only an Admin can edit an Admin account.", Error(result));
        Assert.True((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }

    [Fact]
    public async Task Update_CoordinatorRestoresArchivedAdmin_IsRefused_StaysArchived()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        admin.IsActive = false;
        db.SaveChanges();
        var result = await MakeController(db, "Coordinator").Update(admin.Id, EditOf(admin, isActive: true), CancellationToken.None);

        Assert.Equal("Only an Admin can edit an Admin account.", Error(result));
        Assert.False((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
    }

    [Fact]
    public async Task Update_CoordinatorChangesOnlyAdminsPhone_IsRefused()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var result = await MakeController(db, "Coordinator").Update(admin.Id, EditOf(admin, mobile: "0400 000 000"), CancellationToken.None);

        Assert.Equal("Only an Admin can edit an Admin account.", Error(result));
        Assert.NotEqual("0400 000 000", (await db.Users.SingleAsync(u => u.Id == admin.Id)).Mobile);
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
    public async Task SoleSignedInAdmin_WithAnInvitedAdminWhoNeverSignedIn_CannotBeDemotedOrArchived()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        SeedUser(db, tenantId, UserRole.Admin, signedIn: false);
        var controller = MakeController(db, "Admin");

        Assert.Equal(LastAdminMessage, Error(await controller.Update(admin.Id, EditOf(admin, role: UserRole.Coordinator), CancellationToken.None)));
        Assert.Equal(LastAdminMessage, Error(await controller.Update(admin.Id, EditOf(admin, isActive: false), CancellationToken.None)));
        Assert.Equal(LastAdminMessage, Error(await controller.Delete(admin.Id, CancellationToken.None)));
        var row = await db.Users.SingleAsync(u => u.Id == admin.Id);
        Assert.True(row.IsActive);
        Assert.Equal(UserRole.Admin, row.Role);
    }

    [Fact]
    public async Task SoleAdmin_CannotArchiveSelf_EvenWhenAnotherOrganisationHasASignedInAdmin()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        SeedUser(db, Guid.NewGuid(), UserRole.Admin);

        Assert.Equal(LastAdminMessage, Error(await MakeController(db, "Admin").Delete(admin.Id, CancellationToken.None)));
        Assert.True((await db.Users.SingleAsync(u => u.Id == admin.Id)).IsActive);
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

    // ── Active flips keep the Firebase account in step (as AdminUsers does) ──

    private static void VerifyDisabled(Mock<IFirebaseUserService> firebase, string email, bool disabled) =>
        firebase.Verify(f => f.UpdateUserByEmailAsync(email, It.IsAny<string>(), disabled, It.IsAny<CancellationToken>()), Times.Once);

    private static void VerifyNoFirebaseCall(Mock<IFirebaseUserService> firebase) =>
        firebase.Verify(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);

    [Fact]
    public async Task Update_ReactivatingAnArchivedMember_EnablesTheirFirebaseAccount()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        worker.IsActive = false;
        db.SaveChanges();
        var firebase = new Mock<IFirebaseUserService>();

        var result = await MakeController(db, "Admin", firebase).Update(worker.Id, EditOf(worker, isActive: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        VerifyDisabled(firebase, worker.Email, disabled: false);
        Assert.True((await db.Users.SingleAsync(u => u.Id == worker.Id)).IsActive);
    }

    [Fact]
    public async Task Update_ArchivingAMember_DisablesTheirFirebaseAccount()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await MakeController(db, "Admin", firebase).Update(worker.Id, EditOf(worker, isActive: false), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        VerifyDisabled(firebase, worker.Email, disabled: true);
    }

    [Fact]
    public async Task Delete_ArchivingAMember_DisablesTheirFirebaseAccount()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await MakeController(db, "Admin", firebase).Delete(worker.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        VerifyDisabled(firebase, worker.Email, disabled: true);
        Assert.False((await db.Users.SingleAsync(u => u.Id == worker.Id)).IsActive);
    }

    [Fact]
    public async Task Update_NotChangingActive_MakesNoFirebaseCall()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await MakeController(db, "Admin", firebase).Update(worker.Id, EditOf(worker, mobile: "0400 000 000"), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        VerifyNoFirebaseCall(firebase);
    }

    [Fact]
    public async Task RefusedLastAdminArchive_MakesNoFirebaseCall()
    {
        var (db, tenantId) = CreateDb();
        var admin = SeedUser(db, tenantId, UserRole.Admin);
        var firebase = new Mock<IFirebaseUserService>();
        var controller = MakeController(db, "Admin", firebase);

        Assert.Equal(LastAdminMessage, Error(await controller.Update(admin.Id, EditOf(admin, isActive: false), CancellationToken.None)));
        Assert.Equal(LastAdminMessage, Error(await controller.Delete(admin.Id, CancellationToken.None)));
        VerifyNoFirebaseCall(firebase);
    }

    [Fact]
    public async Task Archiving_WhenFirebaseFails_SavesNothingAndSaysWhereToTurn()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("service account unusable"));
        var controller = MakeController(db, "Admin", firebase);

        var update = Assert.IsType<ObjectResult>((await controller.Update(worker.Id, EditOf(worker, isActive: false), CancellationToken.None)).Result);
        var delete = Assert.IsType<ObjectResult>((await controller.Delete(worker.Id, CancellationToken.None)).Result);

        Assert.Equal(502, update.StatusCode);
        Assert.Equal(502, delete.StatusCode);
        Assert.True((await db.Users.SingleAsync(u => u.Id == worker.Id)).IsActive);
    }

    // ── A database failure after the Firebase flip undoes the flip (as AdminUsers does) ──

    private sealed class SaveThrowsDb(DbContextOptions<OdipDbContext> options, ICurrentTenant tenant, Func<bool> fail) : OdipDbContext(options, tenant)
    {
        public override Task<int> SaveChangesAsync(CancellationToken ct = default) =>
            fail() ? throw new DbUpdateException("simulated save failure") : base.SaveChangesAsync(ct);
    }

    private static (SaveThrowsDb Db, Guid TenantId, Action Break) CreateBreakableDb()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var broken = false;
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new SaveThrowsDb(options, tenant.Object, () => broken), tenantId, () => broken = true);
    }

    [Fact]
    public async Task Archiving_WhenTheDatabaseSaveThrows_PutsTheFirebaseAccountBack()
    {
        var (db, tenantId, breakSave) = CreateBreakableDb();
        var (edited, deleted) = (SeedUser(db, tenantId, UserRole.SupportWorker), SeedUser(db, tenantId, UserRole.SupportWorker));
        var firebase = new Mock<IFirebaseUserService>();
        var controller = MakeController(db, "Admin", firebase);
        breakSave();

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Update(edited.Id, EditOf(edited, isActive: false), CancellationToken.None));
        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Delete(deleted.Id, CancellationToken.None));

        foreach (var worker in new[] { edited, deleted })
        {
            var name = $"{worker.FirstName} {worker.LastName}";
            firebase.Verify(f => f.UpdateUserByEmailAsync(worker.Email, name, true, It.IsAny<CancellationToken>()), Times.Once);
            firebase.Verify(f => f.UpdateUserByEmailAsync(worker.Email, name, false, It.IsAny<CancellationToken>()), Times.Once);
        }
    }

    [Fact]
    public async Task Update_RenamingAndArchivingTogether_GivesFirebaseTheNewDisplayName()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await MakeController(db, "Admin", firebase).Update(worker.Id, EditOf(worker, isActive: false) with { FirstName = "Renamed" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        firebase.Verify(f => f.UpdateUserByEmailAsync(worker.Email, $"Renamed {worker.LastName}", true, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── The Firebase paths an archive can skip or refuse, and what a failed save undoes ──

    private static Mock<IFirebaseUserService> FirebaseThrowing(Exception failure)
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);
        return firebase;
    }

    private static void VerifyFirebaseCalls(Mock<IFirebaseUserService> firebase, int times) =>
        firebase.Verify(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Exactly(times));

    [Fact]
    public async Task Archiving_AMemberWithNoFirebaseAccountYet_StillArchives()
    {
        var (db, tenantId) = CreateDb();
        var (edited, deleted) = (SeedUser(db, tenantId, UserRole.SupportWorker, signedIn: false), SeedUser(db, tenantId, UserRole.SupportWorker, signedIn: false));
        var controller = MakeController(db, "Admin", FirebaseThrowing(FirebaseTestExceptions.WithCode(AuthErrorCode.UserNotFound)));

        Assert.IsType<OkObjectResult>((await controller.Update(edited.Id, EditOf(edited, isActive: false), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.Delete(deleted.Id, CancellationToken.None)).Result);

        Assert.False((await db.Users.SingleAsync(u => u.Id == edited.Id)).IsActive);
        Assert.False((await db.Users.SingleAsync(u => u.Id == deleted.Id)).IsActive);
    }

    [Fact]
    public async Task Archiving_WhenFirebaseRefusesTheStoredAddress_IsRefusedAndTheMemberStaysActive()
    {
        var (db, tenantId) = CreateDb();
        var (edited, deleted) = (SeedUser(db, tenantId, UserRole.SupportWorker), SeedUser(db, tenantId, UserRole.SupportWorker));
        var controller = MakeController(db, "Admin", FirebaseThrowing(FirebaseTestExceptions.InvalidEmail()));

        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>((await controller.Update(edited.Id, EditOf(edited, isActive: false), CancellationToken.None)).Result).StatusCode);
        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>((await controller.Delete(deleted.Id, CancellationToken.None)).Result).StatusCode);

        Assert.True((await db.Users.SingleAsync(u => u.Id == edited.Id)).IsActive);
        Assert.True((await db.Users.SingleAsync(u => u.Id == deleted.Id)).IsActive);
    }

    [Fact]
    public async Task Update_ArchivingWhileCorrectingARefusedAddress_SkipsTheSyncAndSaves()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var corrected = $"{Guid.NewGuid()}@example.com";

        var result = await MakeController(db, "Admin", FirebaseThrowing(FirebaseTestExceptions.InvalidEmail()))
            .Update(worker.Id, EditOf(worker, isActive: false) with { Email = corrected, AddressConfirmed = true }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.Users.SingleAsync(u => u.Id == worker.Id);
        Assert.False(saved.IsActive);
        Assert.Equal(corrected, saved.Email);
    }

    [Fact]
    public async Task Archiving_WhenTheSyncWasSkippedAndTheSaveThrows_MakesNoRevertCall()
    {
        var (db, tenantId, breakSave) = CreateBreakableDb();
        var (edited, deleted) = (SeedUser(db, tenantId, UserRole.SupportWorker, signedIn: false), SeedUser(db, tenantId, UserRole.SupportWorker, signedIn: false));
        var firebase = FirebaseThrowing(FirebaseTestExceptions.WithCode(AuthErrorCode.UserNotFound));
        var controller = MakeController(db, "Admin", firebase);
        breakSave();

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Update(edited.Id, EditOf(edited, isActive: false), CancellationToken.None));
        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Delete(deleted.Id, CancellationToken.None));

        VerifyFirebaseCalls(firebase, 2);   // the two skipped forward attempts, nothing sent back
    }

    [Fact]
    public async Task Update_RenamingOnly_GivesFirebaseTheNewDisplayName()
    {
        var (db, tenantId) = CreateDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();

        var result = await MakeController(db, "Admin", firebase).Update(worker.Id, EditOf(worker) with { FirstName = "Renamed" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        firebase.Verify(f => f.UpdateUserByEmailAsync(worker.Email, $"Renamed {worker.LastName}", false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_RenamingOnly_WhenTheSaveThrows_PutsTheOldNameBack()
    {
        var (db, tenantId, breakSave) = CreateBreakableDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();
        var controller = MakeController(db, "Admin", firebase);
        var (email, original, last) = (worker.Email, $"{worker.FirstName} {worker.LastName}", worker.LastName);
        breakSave();

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Update(worker.Id, EditOf(worker) with { FirstName = "Renamed" }, CancellationToken.None));

        firebase.Verify(f => f.UpdateUserByEmailAsync(email, $"Renamed {last}", false, It.IsAny<CancellationToken>()), Times.Once);
        firebase.Verify(f => f.UpdateUserByEmailAsync(email, original, false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_RenamingAndArchiving_WhenTheSaveThrows_PutsBackTheDisabledValueAndTheOriginalName()
    {
        var (db, tenantId, breakSave) = CreateBreakableDb();
        var worker = SeedUser(db, tenantId, UserRole.SupportWorker);
        var firebase = new Mock<IFirebaseUserService>();
        var controller = MakeController(db, "Admin", firebase);
        var (email, original, last) = (worker.Email, $"{worker.FirstName} {worker.LastName}", worker.LastName);
        breakSave();

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Update(worker.Id, EditOf(worker, isActive: false) with { FirstName = "Renamed" }, CancellationToken.None));

        firebase.Verify(f => f.UpdateUserByEmailAsync(email, $"Renamed {last}", true, It.IsAny<CancellationToken>()), Times.Once);
        firebase.Verify(f => f.UpdateUserByEmailAsync(email, original, false, It.IsAny<CancellationToken>()), Times.Once);
    }
}
