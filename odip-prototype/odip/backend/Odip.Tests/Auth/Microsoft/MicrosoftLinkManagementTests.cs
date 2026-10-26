using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Api.Services.Microsoft;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Auth.Microsoft.MicrosoftAuthRig;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>The signed-in management endpoints (link settings, own-account unlink) and the anonymous config. These run under the NORMAL tenant filter.</summary>
public class MicrosoftLinkManagementTests
{
    private static T? Data<T>(IActionResult result) => ((ApiResponse<T>)((ObjectResult)result).Value!).Data;
    private static int Status(IActionResult result) => ((ObjectResult)result).StatusCode ?? 200;

    private static (MicrosoftAuthRig Rig, Tenant Org, User Admin) Setup(bool linked = true, UserRole defaultRole = UserRole.SupportWorker)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        var admin = rig.Person(org.Id, "admin@acme.test", UserRole.Admin);
        // From here the database is read with the org's own tenant filter, as a signed-in request is.
        if (linked) rig.Link(org.Id, role: defaultRole, by: admin.Id);
        rig.AmbientTenant = org.Id;
        return (rig, org, admin);
    }

    private static MicrosoftAuthController As(MicrosoftAuthRig rig, User who, Tenant org, IFirebaseUserService? firebase = null) =>
        rig.Controller(rig.Http(Signed(who.Id, org.Id, who.Role)), firebase);

    [Fact]
    public async Task M1_GetLink_NullWhenUnlinked_DtoWhenLinked()
    {
        var (rig, org, admin) = Setup(linked: false);
        Assert.Null(Data<MicrosoftTenantLinkDto?>(await As(rig, admin, org).GetLink(default)));

        var link = rig.Link(org.Id, role: UserRole.Coordinator, by: admin.Id);
        var dto = Data<MicrosoftTenantLinkDto?>(await As(rig, admin, org).GetLink(default))!;
        Assert.Equal((link.MicrosoftTenantId, "Coordinator", "Jane Smith", link.UpdatedAt), (dto.MicrosoftTenantId, dto.DefaultRole, dto.LinkedByName, dto.UpdatedAt));
    }

    [Fact]
    public async Task M2_PutDefaultRole_Changes_AndAudits()
    {
        var (rig, org, admin) = Setup();
        var link = await rig.Db.MicrosoftTenantLinks.SingleAsync();
        var result = await As(rig, admin, org).PutLink(new UpdateMicrosoftLinkDto("Coordinator", link.UpdatedAt), default);

        Assert.Equal(200, Status(result));
        Assert.Equal(UserRole.Coordinator, (await rig.Db.MicrosoftTenantLinks.SingleAsync()).DefaultRole);
        Assert.Contains(await rig.Db.AuditLogs.ToListAsync(), a => a.EntityType == nameof(MicrosoftTenantLink) && a.ChangedById == admin.Id && a.Changes!.Contains("Default role"));
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    [InlineData("99")]
    [InlineData("")]
    [InlineData(null)]
    public async Task M3_PutDefaultRole_AdminOrSuperAdminOrUndefined_400(string? role)
    {
        var (rig, org, admin) = Setup();
        var link = await rig.Db.MicrosoftTenantLinks.SingleAsync();
        Assert.Equal(400, Status(await As(rig, admin, org).PutLink(new UpdateMicrosoftLinkDto(role, link.UpdatedAt), default)));
        Assert.Equal(UserRole.SupportWorker, (await rig.Db.MicrosoftTenantLinks.SingleAsync()).DefaultRole);
    }

    [Fact]
    public async Task M4_PutDefaultRole_Stale_409()
    {
        var (rig, org, admin) = Setup();
        var link = await rig.Db.MicrosoftTenantLinks.SingleAsync();
        Assert.Equal(409, Status(await As(rig, admin, org).PutLink(new UpdateMicrosoftLinkDto("Coordinator", link.UpdatedAt.AddMinutes(-1)), default)));
        Assert.Equal(UserRole.SupportWorker, (await rig.Db.MicrosoftTenantLinks.SingleAsync()).DefaultRole);
    }

    [Fact]
    public async Task M5_PutDefaultRole_NoLink_404()
    {
        var (rig, org, admin) = Setup(linked: false);
        Assert.Equal(404, Status(await As(rig, admin, org).PutLink(new UpdateMicrosoftLinkDto("Coordinator", DateTime.UtcNow), default)));
    }

    [Fact]
    public void M6_Authorization_AdminOnlyForLink_SignedInForAccount_AnonymousOnlyWhereNeeded()
    {
        var t = typeof(MicrosoftAuthController);
        string[] Roles(string name) => t.GetMethod(name)!.GetCustomAttributes<AuthorizeAttribute>().Select(a => a.Roles ?? "").ToArray();

        foreach (var name in new[] { nameof(MicrosoftAuthController.GetLink), nameof(MicrosoftAuthController.PutLink), nameof(MicrosoftAuthController.DeleteLink) })
            Assert.Equal(new[] { "Admin" }, Roles(name));
        foreach (var name in new[] { nameof(MicrosoftAuthController.GetAccount), nameof(MicrosoftAuthController.DeleteAccount) })
            Assert.Equal(new[] { "" }, Roles(name));

        var anonymous = t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttribute<AllowAnonymousAttribute>() is not null).Select(m => m.Name).OrderBy(n => n).ToArray();
        Assert.Equal(new[] { "Callback", "Config", "Refresh", "Start" }, anonymous);
    }

    [Fact]
    public async Task M7_DeleteLink_RemovesOnlyLink()
    {
        var (rig, org, admin) = Setup();
        var member = rig.Person(org.Id, "pat@acme.test", tid: MicrosoftTestTokens.OrgTid, oid: PersonOid);

        Assert.Equal(200, Status(await As(rig, admin, org).DeleteLink(default)));

        Assert.Empty(await rig.Db.MicrosoftTenantLinks.ToListAsync());
        var after = await rig.Db.Users.SingleAsync(u => u.Id == member.Id);
        Assert.Equal((MicrosoftTestTokens.OrgTid, PersonOid), (after.MicrosoftTenantId, after.MicrosoftObjectId));
        Assert.Contains(await rig.Db.AuditLogs.ToListAsync(), a => a.EntityType == nameof(MicrosoftTenantLink) && a.ChangedById == admin.Id);
        rig.AmbientTenant = null;
        Assert.Equal(MicrosoftRefusal.MicrosoftNotLinked, (await rig.RunAsync(Token())).Code);
    }

    private static Mock<IFirebaseUserService> Firebase(bool exists)
    {
        var fb = new Mock<IFirebaseUserService>();
        fb.Setup(f => f.ExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(exists);
        return fb;
    }

    [Fact]
    public async Task M8_UnlinkAccount_WithFirebaseAccount_Clears()
    {
        var (rig, org, _) = Setup();
        var me = rig.Person(org.Id, "me@acme.test", tid: MicrosoftTestTokens.OrgTid, oid: PersonOid);
        Assert.Equal(200, Status(await As(rig, me, org, Firebase(true).Object).DeleteAccount(default)));
        var after = await rig.Db.Users.SingleAsync(u => u.Id == me.Id);
        Assert.Null(after.MicrosoftTenantId);
        Assert.Null(after.MicrosoftObjectId);
    }

    [Fact]
    public async Task M9_UnlinkAccount_NoFirebaseAccount_409_MicrosoftOnlySignIn()
    {
        var (rig, org, _) = Setup();
        var me = rig.Person(org.Id, "me@acme.test", tid: MicrosoftTestTokens.OrgTid, oid: PersonOid);
        var result = await As(rig, me, org, Firebase(false).Object).DeleteAccount(default);
        Assert.Equal(409, Status(result));
        Assert.Equal(MicrosoftRefusal.MicrosoftOnlySignIn, ((ApiResponse<object>)((ObjectResult)result).Value!).Code);
        Assert.NotNull((await rig.Db.Users.SingleAsync(u => u.Id == me.Id)).MicrosoftObjectId);
    }

    [Fact]
    public async Task M9b_UnlinkAccount_NothingLinked_404()
    {
        var (rig, org, admin) = Setup();
        Assert.Equal(404, Status(await As(rig, admin, org, Firebase(true).Object).DeleteAccount(default)));
    }

    [Fact]
    public async Task M9c_GetAccount_ReportsOrgAndAccount()
    {
        var (rig, org, admin) = Setup();
        var dto = Data<MicrosoftAccountDto>(await As(rig, admin, org).GetAccount(default))!;
        Assert.Equal((true, false), (dto.OrgLinked, dto.AccountLinked));
    }

    [Fact]
    public void M10_Config_OffFalseNull_OnTrueAndStartUrl()
    {
        var rig = new MicrosoftAuthRig();
        var on = Data<AuthConfigDto>(rig.Controller(rig.Http()).Config())!;
        Assert.True(on.Microsoft);
        Assert.Equal(PublicBase + "/api/v1/auth/microsoft/start?intent=signin", on.MicrosoftStartUrl);

        rig.Settings["Microsoft:ClientSecret"] = "";
        var off = Data<AuthConfigDto>(rig.Controller(rig.Http()).Config())!;
        Assert.False(off.Microsoft);
        Assert.Null(off.MicrosoftStartUrl);
    }

    // ── X1: another organisation's link is invisible and untouchable ──

    [Fact]
    public async Task X1_CrossTenant_OtherOrgsLinkIsInvisibleAndUntouched()
    {
        var rig = new MicrosoftAuthRig();
        var orgA = rig.Org("A", "a.test");
        var orgB = rig.Org("B", "b.test");
        var adminA = rig.Person(orgA.Id, "admin@a.test", UserRole.Admin);
        var linkB = rig.Link(orgB.Id, role: UserRole.Coordinator);
        rig.AmbientTenant = orgA.Id;
        var asA = As(rig, adminA, orgA);

        Assert.Null(Data<MicrosoftTenantLinkDto?>(await asA.GetLink(default)));
        Assert.Equal(404, Status(await asA.PutLink(new UpdateMicrosoftLinkDto("ReadOnly", linkB.UpdatedAt), default)));
        Assert.Equal(404, Status(await asA.DeleteLink(default)));

        var still = await rig.Db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync();
        Assert.Equal(UserRole.Coordinator, still.DefaultRole);
    }
}
