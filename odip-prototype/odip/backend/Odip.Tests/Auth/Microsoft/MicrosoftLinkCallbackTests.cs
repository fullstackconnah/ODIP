using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Api.Services.Microsoft;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Auth.Microsoft.MicrosoftAuthRig;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>The link-tenant and link-account callbacks. The callback has no ODIP session, so what must hold is re-read from the database.</summary>
public class MicrosoftLinkCallbackTests
{
    private static readonly Guid Tid = MicrosoftTestTokens.OrgTid;

    private static async Task<Outcome> FinishAsync(MicrosoftAuthRig rig, Outcome start) =>
        await rig.CallbackAsync(CookieHeader(start, MicrosoftAuthController.CorrelationCookie), StateOf(start), "code1");

    private static Task<List<MicrosoftTenantLink>> Links(MicrosoftAuthRig rig) => rig.Db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]).ToListAsync();

    private static (MicrosoftAuthRig Rig, Tenant Org, User Admin) AdminRig()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        return (rig, org, rig.Person(org.Id, "admin@acme.test", UserRole.Admin));
    }

    [Fact]
    public async Task L1_LinkTenant_CreatesLinkFromTokenTid()
    {
        var (rig, org, admin) = AdminRig();
        var o = await rig.RunAsync(Token(), MicrosoftIntent.LinkTenant, "SupportWorker", Signed(admin.Id, org.Id, UserRole.Admin));

        var link = Assert.Single(await Links(rig));
        Assert.Equal((org.Id, Tid, UserRole.SupportWorker, admin.Id), (link.TenantId, link.MicrosoftTenantId, link.DefaultRole, link.LinkedByUserId));
        Assert.Contains(await rig.Db.AuditLogs.ToListAsync(), a => a.EntityType == nameof(MicrosoftTenantLink) && a.ChangedById == admin.Id);
        Assert.Equal("/settings?section=microsoft&microsoft=linked", o.Location);
        Assert.Null(o.Cookie("odip_jwt"));
        Assert.Null(o.Cookie(MicrosoftAuthController.RefreshCookie));
        Assert.Empty(rig.Tracker.Failures);
        Assert.Empty(rig.Tracker.Successes);
    }

    [Theory]
    [InlineData(false, null)]
    [InlineData(true, "11111111-0000-0000-0000-000000000001")] // some role, not a directory-admin one
    public async Task L1f_LinkTenant_NoDirectoryAdminRole_MicrosoftAdminOnly_NoLink(bool hasWids, string? role)
    {
        var (rig, org, admin) = AdminRig();
        var token = hasWids ? Token(extra: new Dictionary<string, object> { ["wids"] = new[] { role! } }) : Token(withWids: false);
        var o = await rig.RunAsync(token, MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));

        Assert.Equal(MicrosoftRefusal.MicrosoftAdminOnly, o.Code);
        Assert.Empty(await Links(rig));
        Assert.Null((await rig.Db.Users.FindAsync(admin.Id))!.MicrosoftObjectId);
    }

    [Theory]
    [InlineData("62e90394-69f5-4237-9190-012177145e10")] // Global Administrator
    [InlineData("e8611ab8-c189-46e8-94e1-60213ab1f814")] // Privileged Role Administrator
    [InlineData("9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3")] // Application Administrator
    [InlineData("158c047a-c907-4556-b7ef-446551a6b5f7")] // Cloud Application Administrator
    public async Task L1g_LinkTenant_DirectoryAdminRole_Linked(string role)
    {
        var (rig, org, admin) = AdminRig();
        var token = Token(extra: new Dictionary<string, object> { ["wids"] = new[] { "11111111-0000-0000-0000-000000000001", role } });
        await rig.RunAsync(token, MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        Assert.Single(await Links(rig));
    }

    [Fact]
    public async Task L1b_LinkTenant_NoDefaultRole_ReadOnly()
    {
        var (rig, org, admin) = AdminRig();
        await rig.RunAsync(Token(), MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        Assert.Equal(UserRole.ReadOnly, Assert.Single(await Links(rig)).DefaultRole);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    [InlineData("Nonsense")]
    public async Task L1c_LinkTenant_UngrantableDefaultRole_RefusedAtStart_InvalidToken(string role)
    {
        var (rig, org, admin) = AdminRig();
        var start = await rig.StartAsync(MicrosoftIntent.LinkTenant, role, Signed(admin.Id, org.Id, UserRole.Admin));
        Assert.Equal(MicrosoftRefusal.InvalidToken, start.Code);
        Assert.Single(rig.Tracker.Failures);
        Assert.Null(start.Cookie(MicrosoftAuthController.CorrelationCookie));
    }

    [Theory]
    [InlineData("demoted")]
    [InlineData("deactivated")]
    [InlineData("moved")]
    public async Task L2_LinkTenant_AdminChangedBeforeCallback_MicrosoftSessionChanged(string change)
    {
        var (rig, org, admin) = AdminRig();
        var start = await rig.StartAsync(MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        rig.Redeemer.Result = () => Token()(rig.Nonce);
        switch (change)
        {
            case "demoted": admin.Role = UserRole.Coordinator; break;
            case "deactivated": admin.IsActive = false; break;
            default: admin.TenantId = rig.Org("Elsewhere", "else.test").Id; break;
        }
        await rig.Db.SaveChangesAsync();

        var o = await FinishAsync(rig, start);

        Assert.Equal(MicrosoftRefusal.MicrosoftSessionChanged, o.Code);
        Assert.Empty(await Links(rig));
    }

    [Fact]
    public async Task L3_LinkTenant_TidLinkedElsewhere_MicrosoftTenantTaken()
    {
        var (rig, org, admin) = AdminRig();
        rig.Link(rig.Org("Other", "other.test").Id);
        var o = await rig.RunAsync(Token(), MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        Assert.Equal(MicrosoftRefusal.MicrosoftTenantTaken, o.Code);
        Assert.Single(await Links(rig));
    }

    [Fact]
    public async Task L4_LinkTenant_OrgLinkedMeanwhile_MicrosoftOrgAlreadyLinked()
    {
        var (rig, org, admin) = AdminRig();
        var start = await rig.StartAsync(MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        rig.Redeemer.Result = () => Token()(rig.Nonce);
        rig.Link(org.Id, Guid.NewGuid());
        var o = await FinishAsync(rig, start);
        Assert.Equal(MicrosoftRefusal.MicrosoftOrgAlreadyLinked, o.Code);
        Assert.Single(await Links(rig));
    }

    [Fact]
    public async Task L5_LinkTenant_ConsumerTid_MicrosoftPersonalAccount()
    {
        var (rig, org, admin) = AdminRig();
        var o = await rig.RunAsync(Token(tid: MicrosoftTestTokens.Consumer), MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        Assert.Equal(MicrosoftRefusal.MicrosoftPersonalAccount, o.Code);
        Assert.Empty(await Links(rig));
    }

    [Fact]
    public async Task L1d_LinkTenant_AlsoLinksTheAdminOwnRow_WhenFree()
    {
        var (rig, org, admin) = AdminRig();
        await rig.RunAsync(Token(), MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        var after = await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync(u => u.Id == admin.Id);
        Assert.Equal((Tid, PersonOid), (after.MicrosoftTenantId, after.MicrosoftObjectId));
    }

    [Fact]
    public async Task L1e_LinkTenant_AccountTakenByAnotherUser_StillLinksTenant_AdminRowUntouched()
    {
        var (rig, org, admin) = AdminRig();
        rig.Person(rig.Org("Other", "other.test").Id, "x@other.test", tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token(), MicrosoftIntent.LinkTenant, null, Signed(admin.Id, org.Id, UserRole.Admin));
        Assert.EndsWith("microsoft=linked", o.Location);
        Assert.Single(await Links(rig));
        Assert.Null((await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync(u => u.Id == admin.Id)).MicrosoftObjectId);
    }

    // ── link-account ─────────────────────────────────────────────────────

    private static (MicrosoftAuthRig Rig, Tenant Org, User Me) MemberRig(Guid? linkTid = null)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id, linkTid);
        return (rig, org, rig.Person(org.Id, "me@acme.test", UserRole.Coordinator));
    }

    [Fact]
    public async Task L6_LinkAccount_SetsOwnRowIdentity_ThenSignInUsesIt()
    {
        var (rig, org, me) = MemberRig();
        var o = await rig.RunAsync(Token(email: "someone@else.test"), MicrosoftIntent.LinkAccount, null, Signed(me.Id, org.Id, UserRole.Coordinator));

        Assert.Equal("/account?section=microsoft&microsoft=linked", o.Location);
        var row = await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync();
        Assert.Equal((Tid, PersonOid), (row.MicrosoftTenantId, row.MicrosoftObjectId));
        Assert.Contains(await rig.Db.AuditLogs.ToListAsync(), a => a.EntityId == me.Id && a.ChangedById == me.Id);

        var signedIn = await rig.RunAsync(Token(email: "someone@else.test"));
        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, signedIn.Location);
        Assert.Equal(me.Id.ToString(), Jwt(signedIn).Claims.First(c => c.Type.EndsWith("nameidentifier")).Value);
    }

    [Fact]
    public async Task L7_LinkAccount_WrongTid_MicrosoftWrongTenant()
    {
        var (rig, org, me) = MemberRig(MicrosoftTestTokens.OtherTid);
        var o = await rig.RunAsync(Token(), MicrosoftIntent.LinkAccount, null, Signed(me.Id, org.Id, UserRole.Coordinator));
        Assert.Equal(MicrosoftRefusal.MicrosoftWrongTenant, o.Code);
        Assert.Null((await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync()).MicrosoftObjectId);
    }

    [Fact]
    public async Task L8_LinkAccount_TidOidOnAnotherUser_MicrosoftAccountTaken()
    {
        var (rig, org, me) = MemberRig();
        rig.Person(org.Id, "other@acme.test", tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token(), MicrosoftIntent.LinkAccount, null, Signed(me.Id, org.Id, UserRole.Coordinator));
        Assert.Equal(MicrosoftRefusal.MicrosoftAccountTaken, o.Code);
        Assert.Null((await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync(u => u.Id == me.Id)).MicrosoftObjectId);
    }

    [Fact]
    public async Task L9_LinkAccount_UserDeactivatedBeforeCallback_MicrosoftSessionChanged()
    {
        var (rig, org, me) = MemberRig();
        var start = await rig.StartAsync(MicrosoftIntent.LinkAccount, null, Signed(me.Id, org.Id, UserRole.Coordinator));
        rig.Redeemer.Result = () => Token()(rig.Nonce);
        me.IsActive = false;
        await rig.Db.SaveChangesAsync();
        var o = await FinishAsync(rig, start);
        Assert.Equal(MicrosoftRefusal.MicrosoftSessionChanged, o.Code);
        Assert.Null(me.MicrosoftObjectId);
    }

    [Fact]
    public async Task L10_LinkAccount_AlreadyLinked_RefusedAtStart()
    {
        var (rig, org, me) = MemberRig();
        me.MicrosoftTenantId = Tid;
        me.MicrosoftObjectId = PersonOid;
        await rig.Db.SaveChangesAsync();
        var start = await rig.StartAsync(MicrosoftIntent.LinkAccount, null, Signed(me.Id, org.Id, UserRole.Coordinator));
        Assert.Equal(MicrosoftRefusal.MicrosoftAccountAlreadyLinked, start.Code);
    }
}
