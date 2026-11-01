using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Odip.Api.Controllers;
using Odip.Api.Services.Microsoft;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Xunit;
using static Odip.Tests.Auth.Microsoft.MicrosoftAuthRig;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>The organisation's session length on the Microsoft paths: the sign-in token, the refresh cap and the refusal. Null = today (30 minutes, 12 hours).</summary>
public class MicrosoftSessionLengthTests
{
    private static readonly Guid Tid = MicrosoftTestTokens.OrgTid;

    private static void SeedLimit(MicrosoftAuthRig rig, Guid orgId, int? minutes)
    {
        rig.Db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = orgId, SessionLengthMinutes = minutes });
        rig.Db.SaveChanges();
    }

    private static async Task<(MicrosoftAuthRig Rig, string Cookie, DateTime SignedInAt)> SignedInAsync(int? limit)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "pat@acme.test", tid: Tid, oid: PersonOid);
        SeedLimit(rig, org.Id, limit);
        var signedInAt = DateTime.UtcNow;
        var o = await rig.RunAsync(Token());
        return (rig, CookieHeader(o, MicrosoftAuthController.RefreshCookie)!, signedInAt);
    }

    private static async Task<(IActionResult Result, IReadOnlyList<SetCookieHeaderValue> Cookies)> RefreshAsync(MicrosoftAuthRig rig, string cookie)
    {
        var http = rig.Http(null, cookie);
        var result = await rig.Controller(http).Refresh(CancellationToken.None);
        return (result, http.Response.Headers.SetCookie.Select(h => SetCookieHeaderValue.Parse(h!)).ToList());
    }

    private static double MinutesFromNow(DateTime t) => (t - DateTime.UtcNow).TotalMinutes;

    [Fact]
    public async Task Sign_in_token_expiry_is_capped_by_the_org_limit()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "pat@acme.test", tid: Tid, oid: PersonOid);
        SeedLimit(rig, org.Id, 15);

        var o = await rig.RunAsync(Token());

        Assert.InRange(MinutesFromNow(Jwt(o).ValidTo), 14, 15.1);
    }

    // The first sign-in of a new person builds the token through the same StartSession as every other path.
    [Fact]
    public async Task A_first_sign_in_that_creates_the_row_is_capped_too()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        SeedLimit(rig, org.Id, 15);

        var o = await rig.RunAsync(Token(email: "pat@acme.test"));

        Assert.NotNull(o.Cookie("odip_jwt"));
        Assert.InRange(MinutesFromNow(Jwt(o).ValidTo), 14, 15.1);
    }

    // GUARD: no limit, the sign-in token is the 30 minutes it always was.
    [Fact]
    public async Task With_no_limit_the_sign_in_token_is_30_minutes()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "pat@acme.test", tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token());
        Assert.InRange(MinutesFromNow(Jwt(o).ValidTo), 29, 30.1);
    }

    // GUARD: a settings row with a null limit is the same as no row.
    [Fact]
    public async Task With_a_null_limit_row_the_sign_in_token_is_30_minutes()
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        rig.Person(org.Id, "pat@acme.test", tid: Tid, oid: PersonOid);
        SeedLimit(rig, org.Id, null);
        var o = await rig.RunAsync(Token());
        Assert.InRange(MinutesFromNow(Jwt(o).ValidTo), 29, 30.1);
    }

    [Fact]
    public async Task Refresh_under_the_org_limit_issues_a_token_capped_at_the_limit()
    {
        var (rig, cookie, signedInAt) = await SignedInAsync(60);
        rig.Clock.Offset = TimeSpan.FromMinutes(50);

        var (result, _) = await RefreshAsync(rig, cookie);

        var dto = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(result).Value).Data!;
        var cap = signedInAt.AddMinutes(60);
        Assert.InRange(Math.Abs((dto.ExpiresAt - cap).TotalSeconds), 0, 5);
        Assert.InRange(Math.Abs((new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(dto.Token).ValidTo - cap).TotalSeconds), 0, 5);
    }

    [Fact]
    public async Task Refresh_at_the_org_limit_is_refused_SessionLengthReached_and_drops_the_cookie()
    {
        var (rig, cookie, _) = await SignedInAsync(60);
        rig.Clock.Offset = TimeSpan.FromMinutes(61);

        var (result, cookies) = await RefreshAsync(rig, cookie);

        var refused = Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Equal(MicrosoftRefusal.SessionLengthReached, Assert.IsType<ApiResponse<object>>(refused.Value).Code);
        Assert.True(cookies.First(c => c.Name == MicrosoftAuthController.RefreshCookie).Expires < DateTimeOffset.UtcNow);
        Assert.DoesNotContain(cookies, c => c.Name == "odip_jwt");
    }

    // GUARD: no limit, a refresh at 11 hours still works and 12 hours and a minute still ends it, as before.
    [Fact]
    public async Task Refresh_with_no_limit_still_ends_at_12_hours()
    {
        var (rig, cookie, _) = await SignedInAsync(null);

        rig.Clock.Offset = TimeSpan.FromHours(11);
        var (ok, _) = await RefreshAsync(rig, cookie);
        var dto = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(ok).Value).Data!;
        Assert.InRange((dto.ExpiresAt - rig.Clock.GetUtcNow().UtcDateTime).TotalMinutes, 29, 30.1);

        rig.Clock.Offset = TimeSpan.FromHours(12) + TimeSpan.FromMinutes(1);
        var (ended, _) = await RefreshAsync(rig, cookie);
        Assert.Equal(MicrosoftRefusal.MicrosoftSessionEnded, Assert.IsType<ApiResponse<object>>(Assert.IsType<UnauthorizedObjectResult>(ended).Value).Code);
    }
}
