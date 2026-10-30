using System.Security.Cryptography;
using System.Text;
using System.Web;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using NetSameSite = Microsoft.Net.Http.Headers.SameSiteMode;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Api.Services.Microsoft;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Auth.Microsoft.MicrosoftAuthRig;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>Start, callback and the sign-in branch of the Microsoft controller (spec 2026-10-26). Test ids follow PLAN-PR1.md.</summary>
public class MicrosoftAuthControllerTests
{
    private static readonly Guid Tid = MicrosoftTestTokens.OrgTid;

    // ── S: start ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Microsoft:ClientId", null)]
    [InlineData("Microsoft:ClientId", "")]
    [InlineData("Microsoft:ClientSecret", " ")]
    [InlineData("Microsoft:PublicBaseUrl", "")]
    [InlineData("Microsoft:PublicBaseUrl", "http://odip.example.test")]
    [InlineData("Microsoft:PublicBaseUrl", "/relative")]
    public void S1_Off_404(string key, string? value)
    {
        var rig = new MicrosoftAuthRig();
        rig.Settings[key] = value;
        Assert.IsType<NotFoundResult>(rig.Controller(rig.Http()).Start("signin", null));
    }

    [Fact]
    public async Task S2_SignIn_RedirectsToEntra()
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync();

        var uri = new Uri(start.Location);
        var q = HttpUtility.ParseQueryString(uri.Query);
        Assert.Equal("login.microsoftonline.com", uri.Host);
        Assert.Equal("/organizations/oauth2/v2.0/authorize", uri.AbsolutePath);
        Assert.Equal("query", q["response_mode"]);
        Assert.Equal("S256", q["code_challenge_method"]);
        Assert.Equal(PublicBase + "/api/v1/auth/microsoft/callback", q["redirect_uri"]);
        Assert.Equal("select_account", q["prompt"]);

        var cookie = start.Cookie(MicrosoftAuthController.CorrelationCookie)!;
        Assert.True(cookie.HttpOnly);
        Assert.True(cookie.Secure);
        Assert.Equal(NetSameSite.Lax, cookie.SameSite);
        Assert.Equal("/api/v1/auth/microsoft", cookie.Path.Value);

        // The challenge is the S256 of the verifier sealed inside the cookie.
        var plain = rig.Dp.CreateProtector("Odip.MicrosoftSignIn.Correlation.v1").Unprotect(Uri.UnescapeDataString(cookie.Value.Value!));
        var verifier = System.Text.Json.JsonDocument.Parse(plain).RootElement.GetProperty("CodeVerifier").GetString()!;
        Assert.Equal(WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))), q["code_challenge"]);
    }

    [Fact]
    public async Task S3_LinkTenant_Anonymous_SignInRequired()
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync(MicrosoftIntent.LinkTenant);
        Assert.Equal(MicrosoftRefusal.SignInRequired, start.Code);
        Assert.StartsWith(MicrosoftSignInPaths.LinkTenant, start.Location);
        Assert.Null(start.Cookie(MicrosoftAuthController.CorrelationCookie));
    }

    [Theory]
    [InlineData(UserRole.Coordinator)]
    [InlineData(UserRole.SupportWorker)]
    [InlineData(UserRole.ReadOnly)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task S4_LinkTenant_NonAdmin_MicrosoftAdminOnly(UserRole role)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        var start = await rig.StartAsync(MicrosoftIntent.LinkTenant, user: Signed(Guid.NewGuid(), org.Id, role));
        Assert.Equal(MicrosoftRefusal.MicrosoftAdminOnly, start.Code);
    }

    [Fact]
    public async Task S5_LinkTenant_OrgAlreadyLinked_Refused()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id, Guid.NewGuid());
        var start = await rig.StartAsync(MicrosoftIntent.LinkTenant, user: Signed(Guid.NewGuid(), org.Id, UserRole.Admin));
        Assert.Equal(MicrosoftRefusal.MicrosoftOrgAlreadyLinked, start.Code);
    }

    [Fact]
    public async Task S6_LinkAccount_OrgNotLinked_MicrosoftNotLinked()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        var me = rig.Person(org.Id, "me@acme.test");
        var start = await rig.StartAsync(MicrosoftIntent.LinkAccount, user: Signed(me.Id, org.Id, UserRole.Coordinator));
        Assert.Equal(MicrosoftRefusal.MicrosoftNotLinked, start.Code);
        Assert.StartsWith(MicrosoftSignInPaths.LinkAccount, start.Location);
    }

    [Theory]
    [InlineData("nonsense")]
    [InlineData("")]
    public async Task S7_UnknownIntent_InvalidToken(string intent)
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync(intent);
        Assert.Equal(MicrosoftRefusal.InvalidToken, start.Code);
    }

    [Fact]
    public async Task S8_HostMismatch_RedirectsToPublicBase_NoCookie()
    {
        var rig = new MicrosoftAuthRig { RequestHost = "evil.example" };
        var start = await rig.StartAsync();
        Assert.StartsWith(PublicBase + "/api/v1/auth/microsoft/start", start.Location);
        Assert.Null(start.Cookie(MicrosoftAuthController.CorrelationCookie));
    }

    [Fact]
    public async Task S9_ReturnToIgnored_AtStartAndCallback()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var http = rig.Http();
        http.Request.QueryString = new QueryString("?returnTo=https://evil.example");
        var result = rig.Controller(http).Start("signin", null);
        Assert.Equal("login.microsoftonline.com", new Uri(Assert.IsType<RedirectResult>(result).Url).Host);

        var start = await rig.StartAsync();
        rig.Redeemer.Result = () => Token()(rig.Nonce);
        var cb = rig.Http(null, CookieHeader(start, MicrosoftAuthController.CorrelationCookie));
        cb.Request.QueryString = new QueryString("?returnTo=https://evil.example");
        var done = await rig.Controller(cb).Callback("code1", StateOf(start), null, CancellationToken.None);
        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, Assert.IsType<LocalRedirectResult>(done).Url);
    }

    // ── C: callback, common ──────────────────────────────────────────────

    [Fact]
    public async Task C1_Off_404()
    {
        var rig = new MicrosoftAuthRig();
        rig.Settings["Microsoft:ClientId"] = "";
        var http = rig.Http();
        Assert.IsType<NotFoundResult>(await rig.Controller(http).Callback("c", "s", null, CancellationToken.None));
    }

    [Fact]
    public async Task C2_NoCorrelationCookie_InvalidToken()
    {
        var rig = new MicrosoftAuthRig();
        var o = await rig.CallbackAsync(null, "state");
        Assert.Equal(MicrosoftRefusal.InvalidToken, o.Code);
    }

    [Fact]
    public async Task C3_StateMismatch_InvalidToken()
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync();
        var o = await rig.CallbackAsync(CookieHeader(start, MicrosoftAuthController.CorrelationCookie), "not-the-state");
        Assert.Equal(MicrosoftRefusal.InvalidToken, o.Code);
        Assert.Empty(rig.Redeemer.Calls);
    }

    [Fact]
    public async Task C4_Replay_SameCookieAndState_SecondRefused()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var start = await rig.StartAsync();
        rig.Redeemer.Result = () => Token()(rig.Nonce);
        var cookie = CookieHeader(start, MicrosoftAuthController.CorrelationCookie);

        var first = await rig.CallbackAsync(cookie, StateOf(start));
        var second = await rig.CallbackAsync(cookie, StateOf(start));

        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, first.Location);
        Assert.Equal(MicrosoftRefusal.InvalidToken, second.Code);
        Assert.Single(rig.Redeemer.Calls);
        Assert.Equal(1, await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).CountAsync());
    }

    [Fact]
    public async Task C5_CorrelationOlderThan10Min_InvalidToken()
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync();
        rig.Clock.Offset = TimeSpan.FromMinutes(10) + TimeSpan.FromSeconds(1);
        var o = await rig.CallbackAsync(CookieHeader(start, MicrosoftAuthController.CorrelationCookie), StateOf(start));
        Assert.Equal(MicrosoftRefusal.InvalidToken, o.Code);
        Assert.Empty(rig.Redeemer.Calls);
    }

    [Fact]
    public async Task C6_RefreshBlobAsCorrelation_InvalidToken()
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync();
        var blob = rig.Dp.CreateProtector("Odip.MicrosoftSignIn.Refresh.v1").Protect("{}");
        var o = await rig.CallbackAsync($"{MicrosoftAuthController.CorrelationCookie}={Uri.EscapeDataString(blob)}", StateOf(start));
        Assert.Equal(MicrosoftRefusal.InvalidToken, o.Code);
    }

    [Fact]
    public async Task C7_CorrelationCookieDeleted_OnSuccessAndOnRefusal()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var ok = await rig.RunAsync(Token());
        var refused = await rig.CallbackAsync(null, "x");

        foreach (var o in new[] { ok, refused })
        {
            var gone = o.Cookie(MicrosoftAuthController.CorrelationCookie)!;
            Assert.True(gone.Expires < DateTimeOffset.UtcNow);
            Assert.Equal("/api/v1/auth/microsoft", gone.Path.Value);
        }
    }

    [Fact]
    public async Task C8_RedeemReturnsNull_InvalidToken()
    {
        var rig = new MicrosoftAuthRig();
        var o = await rig.RunAsync(_ => null);
        Assert.Equal(MicrosoftRefusal.InvalidToken, o.Code);
        Assert.Single(rig.Redeemer.Calls);
    }

    [Fact]
    public async Task C9_EntraError_MicrosoftCancelled()
    {
        var rig = new MicrosoftAuthRig();
        var start = await rig.StartAsync();
        var o = await rig.CallbackAsync(CookieHeader(start, MicrosoftAuthController.CorrelationCookie), StateOf(start), code: null, error: "access_denied");
        Assert.Equal(MicrosoftRefusal.MicrosoftCancelled, o.Code);
        Assert.Empty(rig.Redeemer.Calls);
    }

    [Theory]
    [InlineData("aud", MicrosoftRefusal.InvalidToken)]
    [InlineData("consumer", MicrosoftRefusal.MicrosoftPersonalAccount)]
    [InlineData("guest-idp", MicrosoftRefusal.MicrosoftGuest)]
    [InlineData("acct", MicrosoftRefusal.MicrosoftGuest)]
    [InlineData("nonce", MicrosoftRefusal.InvalidToken)]
    public async Task C10_TokenRefusals_ReachTheController(string fault, string expected)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var o = await rig.RunAsync(nonce => fault switch
        {
            "aud" => MicrosoftTestTokens.Mint(nonce: nonce, aud: "someone-else"),
            "consumer" => MicrosoftTestTokens.Mint(MicrosoftTestTokens.Consumer, nonce: nonce),
            "guest-idp" => MicrosoftTestTokens.Mint(nonce: nonce, extra: new Dictionary<string, object> { ["idp"] = "https://sts.windows.net/other/" }),
            "acct" => MicrosoftTestTokens.Mint(nonce: nonce, extra: new Dictionary<string, object> { ["acct"] = 1 }),
            _ => MicrosoftTestTokens.Mint(nonce: "different"),
        });
        Assert.Equal(expected, o.Code);
        Assert.StartsWith("/login", o.Location);
        Assert.Null(o.Cookie("odip_jwt"));
        Assert.Equal(0, await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).CountAsync());
    }

    // ── I: sign-in branch ────────────────────────────────────────────────

    private static async Task<int> UserCount(MicrosoftAuthRig rig) => await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).CountAsync();

    [Fact]
    public async Task I1_TidNotLinked_MicrosoftNotLinked()
    {
        var rig = new MicrosoftAuthRig();
        var o = await rig.RunAsync(Token());
        Assert.Equal(MicrosoftRefusal.MicrosoftNotLinked, o.Code);
        Assert.Equal(0, await UserCount(rig));
    }

    [Fact]
    public async Task I2_LinkedUser_SignsInByTidOid_NotByEmail()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var row = rig.Person(org.Id, "a@acme.test", UserRole.Coordinator, tid: Tid, oid: PersonOid);

        var o = await rig.RunAsync(Token(email: "b@other.test"));

        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, o.Location);
        var jwt = Jwt(o);
        Assert.Equal(row.Id.ToString(), jwt.Claims.First(c => c.Type.EndsWith("nameidentifier")).Value);
        Assert.Equal("Coordinator", jwt.Claims.First(c => c.Type.EndsWith("/role")).Value);
        Assert.Equal(org.Id.ToString(), jwt.Claims.First(c => c.Type == "tenant_id").Value);
        Assert.Equal("a@acme.test", (await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync()).Email);
    }

    [Theory]
    [InlineData("same-active")]
    [InlineData("same-inactive")]
    [InlineData("other-org")]
    [InlineData("superadmin")]
    public async Task I3_EmailOnExistingRow_MicrosoftLinkFromAccount(string which)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var other = rig.Org("Other", "other.test");
        var existing = which switch
        {
            "same-active" => rig.Person(org.Id, "pat@contoso.example"),
            "same-inactive" => rig.Person(org.Id, "pat@contoso.example", active: false),
            "other-org" => rig.Person(other.Id, "pat@contoso.example"),
            _ => rig.Person(other.Id, "pat@contoso.example", UserRole.SuperAdmin),
        };

        var o = await rig.RunAsync(Token(email: "Pat@Contoso.example"));

        Assert.Equal(MicrosoftRefusal.MicrosoftLinkFromAccount, o.Code);
        Assert.Equal(1, await UserCount(rig));
        var after = await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync();
        Assert.Equal(existing.Id, after.Id);
        Assert.Null(after.MicrosoftTenantId);
        Assert.Null(after.MicrosoftObjectId);
    }

    [Fact]
    public async Task I4_InactiveLinkedRow_NoOdipAccount_NoSecondRow()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "pat@acme.test", active: false, tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token());
        Assert.Equal(MicrosoftRefusal.NoOdipAccount, o.Code);
        Assert.Equal(1, await UserCount(rig));
    }

    [Fact]
    public async Task I4b_SuperAdminRowWithIdentity_NoOdipAccount()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "boss@acme.test", UserRole.SuperAdmin, tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token());
        Assert.Equal(MicrosoftRefusal.NoOdipAccount, o.Code);
        Assert.Null(o.Cookie("odip_jwt"));
    }

    [Fact]
    public async Task I5_LinkedRowInOtherOrg_MicrosoftNotLinked()
    {
        var rig = new MicrosoftAuthRig();
        var a = rig.Org("A", "a.test");
        var b = rig.Org("B", "b.test");
        rig.Link(b.Id);
        rig.Person(a.Id, "pat@a.test", tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token());
        Assert.Equal(MicrosoftRefusal.MicrosoftNotLinked, o.Code);
        Assert.Null(o.Cookie("odip_jwt"));
    }

    [Fact]
    public async Task I6_OrgInactive_TenantInactive()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org(active: false);
        rig.Link(org.Id);
        var o = await rig.RunAsync(Token());
        Assert.Equal(MicrosoftRefusal.TenantInactive, o.Code);
        Assert.Equal(0, await UserCount(rig));
    }

    [Fact]
    public async Task I7_NewPerson_Created()
    {
        var rig = new MicrosoftAuthRig(audit: true);
        var org = rig.Org();
        rig.Link(org.Id, role: UserRole.SupportWorker);

        var o = await rig.RunAsync(Token(email: "Pat@Contoso.example"));

        var row = await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync();
        Assert.Equal(MicrosoftAuthController.AuditActor, Assert.Single(await rig.Db.AuditLogs.ToListAsync(), a => a.EntityType == "User" && a.EntityId == row.Id).ChangedByName);
        Assert.Equal(org.Id, row.TenantId);
        Assert.Equal(UserRole.SupportWorker, row.Role);
        Assert.True(row.IsActive);
        Assert.Equal("pat@contoso.example", row.Email);
        Assert.False(string.IsNullOrEmpty(row.Username));
        Assert.Equal((Tid, PersonOid), (row.MicrosoftTenantId, row.MicrosoftObjectId));
        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, o.Location);

        var jwt = Jwt(o);
        Assert.Equal("SupportWorker", jwt.Claims.First(c => c.Type.EndsWith("/role")).Value);
        Assert.Equal(org.Id.ToString(), jwt.Claims.First(c => c.Type == "tenant_id").Value);

        var refresh = o.Cookie(MicrosoftAuthController.RefreshCookie)!;
        Assert.True(refresh.HttpOnly);
        Assert.True(refresh.Secure);
        Assert.Equal(NetSameSite.Strict, refresh.SameSite);
        Assert.Equal("/api/v1/auth/microsoft", refresh.Path.Value);
        Assert.InRange(refresh.Expires!.Value, DateTimeOffset.UtcNow.AddHours(11.9), DateTimeOffset.UtcNow.AddHours(12.1));
    }

    [Fact]
    public async Task I8_NewPerson_EmailFromPreferredUsername()
    {
        var rig = new MicrosoftAuthRig();
        rig.Link(rig.Org().Id);
        var o = await rig.RunAsync(Token(email: null, upn: "pat@contoso.example"));
        Assert.Equal(MicrosoftSignInPaths.SignInSuccess, o.Location);
        Assert.Equal("pat@contoso.example", (await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync()).Email);
    }

    [Fact]
    public async Task I9_NoEmail_MicrosoftNoEmail_NoRow()
    {
        var rig = new MicrosoftAuthRig();
        rig.Link(rig.Org().Id);
        var o = await rig.RunAsync(Token(email: null));
        Assert.Equal(MicrosoftRefusal.MicrosoftNoEmail, o.Code);
        Assert.Equal(0, await UserCount(rig));
    }

    [Fact]
    public async Task I9b_DomainNotVerified_MicrosoftCannotCreate_NoRow()
    {
        var rig = new MicrosoftAuthRig();
        rig.Link(rig.Org().Id);
        var o = await rig.RunAsync(Token(verified: false));
        Assert.Equal(MicrosoftRefusal.MicrosoftCannotCreate, o.Code);
        Assert.Equal(0, await UserCount(rig));
    }

    [Fact]
    public async Task I10_SuperAdminDomainAddress_MicrosoftCannotCreate_NoRow()
    {
        var rig = new MicrosoftAuthRig();
        rig.Link(rig.Org().Id);
        var o = await rig.RunAsync(Token(email: "boss@" + PlatformDomain));
        Assert.Equal(MicrosoftRefusal.MicrosoftCannotCreate, o.Code);
        Assert.Equal(0, await UserCount(rig));
    }

    [Fact]
    public async Task I11_OtherOrganisationsDomain_MicrosoftCannotCreate_NoRow()
    {
        var rig = new MicrosoftAuthRig();
        rig.Link(rig.Org().Id);
        rig.Org("Other", "other.test");
        var o = await rig.RunAsync(Token(email: "pat@other.test"));
        Assert.Equal(MicrosoftRefusal.MicrosoftCannotCreate, o.Code);
        Assert.Equal(0, await UserCount(rig));
    }

    [Fact]
    public async Task I12_NewPerson_NotifiesOnlyActiveAdminsOfThatOrg()
    {
        var rig = new MicrosoftAuthRig();
        var a = rig.Org("A", "a.test");
        var b = rig.Org("B", "b.test");
        rig.Link(a.Id);
        var admin1 = rig.Person(a.Id, "one@a.test", UserRole.Admin);
        var admin2 = rig.Person(a.Id, "two@a.test", UserRole.Admin);
        rig.Person(a.Id, "gone@a.test", UserRole.Admin, active: false);
        rig.Person(a.Id, "coord@a.test", UserRole.Coordinator);
        rig.Person(b.Id, "other@b.test", UserRole.Admin);

        await rig.RunAsync(Token());

        var created = await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync(u => u.MicrosoftObjectId == PersonOid);
        var rows = await rig.Db.NotificationOutbox.IgnoreQueryFilters([TenantFilter.Name]).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r =>
        {
            Assert.Equal(NotificationEventType.StaffJoinedViaMicrosoft, r.EventType);
            Assert.Equal(created.Id, r.EntityId);
        });
        Assert.Equal(new[] { admin1.Id, admin2.Id }.OrderBy(x => x), rows.Select(r => r.RecipientUserId).OrderBy(x => x));
    }

    [Fact]
    public async Task I13_NoSavedRowHasEmptyTenantId()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "one@acme.test", UserRole.Admin);

        await rig.RunAsync(Token());

        var entries = rig.Db.ChangeTracker.Entries<ITenantEntity>().ToList();
        Assert.NotEmpty(entries);
        Assert.All(entries, e => Assert.NotEqual(Guid.Empty, e.Entity.TenantId));
        Assert.Equal(org.Id, (await rig.Db.Users.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync(u => u.MicrosoftObjectId == PersonOid)).TenantId);
    }

    [Fact]
    public async Task I14_NewPersonSignInIsSuccess_ResetsFailures()
    {
        var rig = new MicrosoftAuthRig();
        rig.Link(rig.Org().Id);
        await rig.RunAsync(Token());
    }
}
