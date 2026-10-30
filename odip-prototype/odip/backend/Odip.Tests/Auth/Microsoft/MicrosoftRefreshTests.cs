using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using Odip.Api.Controllers;
using Odip.Api.Services.Microsoft;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Auth.Microsoft.MicrosoftAuthRig;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>POST microsoft/refresh: a fresh 30-minute session while the 12-hour cookie holds and everything it vouched for still holds.</summary>
public class MicrosoftRefreshTests
{
    private static readonly Guid Tid = MicrosoftTestTokens.OrgTid;

    private sealed record Refreshed(IActionResult Result, IReadOnlyList<SetCookieHeaderValue> Cookies)
    {
        public int? Status => (Result as ObjectResult)?.StatusCode;
        public SetCookieHeaderValue? Cookie(string name) => Cookies.FirstOrDefault(c => c.Name == name);
    }

    /// <summary>A linked org with one signed-in person; returns the refresh cookie header from their sign-in.</summary>
    private static async Task<(MicrosoftAuthRig Rig, Tenant Org, User Person, string Cookie)> SignedInAsync(UserRole role = UserRole.Coordinator)
    {
        var rig = new MicrosoftAuthRig();
        var org = rig.Org();
        rig.Link(org.Id);
        var person = rig.Person(org.Id, "pat@acme.test", role, tid: Tid, oid: PersonOid);
        var o = await rig.RunAsync(Token());
        return (rig, org, person, CookieHeader(o, MicrosoftAuthController.RefreshCookie)!);
    }

    private static async Task<Refreshed> RefreshAsync(MicrosoftAuthRig rig, string? cookie)
    {
        var http = rig.Http(null, cookie);
        var result = await rig.Controller(http).Refresh(CancellationToken.None);
        return new Refreshed(result, http.Response.Headers.SetCookie.Select(h => SetCookieHeaderValue.Parse(h!)).ToList());
    }

    private static void AssertEnded(Refreshed r)
    {
        Assert.Equal(401, r.Status);
        Assert.Equal(MicrosoftRefusal.MicrosoftSessionEnded, Assert.IsType<ApiResponse<object>>(((ObjectResult)r.Result).Value).Code);
        Assert.True(r.Cookie(MicrosoftAuthController.RefreshCookie)!.Expires < DateTimeOffset.UtcNow);
        Assert.Null(r.Cookie("odip_jwt"));
    }

    [Fact]
    public async Task F1_Off_404()
    {
        var (rig, _, _, cookie) = await SignedInAsync();
        rig.Settings["Microsoft:ClientId"] = "";
        Assert.IsType<NotFoundResult>((await RefreshAsync(rig, cookie)).Result);
    }

    [Fact]
    public async Task F2_Valid_MintsJwt_ReturnsDto_DoesNotReissueRefreshCookie()
    {
        var (rig, org, person, cookie) = await SignedInAsync();
        var r = await RefreshAsync(rig, cookie);

        Assert.Equal(200, r.Status);
        var dto = Assert.IsType<ApiResponse<AuthResponseDto>>(((ObjectResult)r.Result).Value).Data!;
        Assert.Equal((person.Id, org.Id, "Coordinator"), (dto.Id, dto.TenantId, dto.Role));
        Assert.False(string.IsNullOrEmpty(dto.Token));
        Assert.NotNull(r.Cookie("odip_jwt"));
        Assert.Null(r.Cookie(MicrosoftAuthController.RefreshCookie));
    }

    [Fact]
    public async Task F3_AbsoluteTwelveHours()
    {
        var (rig, _, _, cookie) = await SignedInAsync();

        rig.Clock.Offset = TimeSpan.FromHours(11);
        Assert.Equal(200, (await RefreshAsync(rig, cookie)).Status);

        rig.Clock.Offset = TimeSpan.FromHours(12) + TimeSpan.FromMinutes(1);
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F4_UserDeactivated_401_Cleared()
    {
        var (rig, _, person, cookie) = await SignedInAsync();
        person.IsActive = false;
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F5_LinkRemoved_401()
    {
        var (rig, _, _, cookie) = await SignedInAsync();
        rig.Db.MicrosoftTenantLinks.RemoveRange(await rig.Db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]).ToListAsync());
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F6_LinkTidChanged_401()
    {
        var (rig, _, _, cookie) = await SignedInAsync();
        (await rig.Db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]).SingleAsync()).MicrosoftTenantId = MicrosoftTestTokens.OtherTid;
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F2b_ExpiresAt_UsesInjectedClock()
    {
        var (rig, _, _, cookie) = await SignedInAsync();
        rig.Clock.Offset = TimeSpan.FromHours(1);
        var dto = Assert.IsType<ApiResponse<AuthResponseDto>>(((ObjectResult)(await RefreshAsync(rig, cookie)).Result).Value).Data!;
        Assert.InRange(dto.ExpiresAt, DateTime.UtcNow.AddMinutes(85), DateTime.UtcNow.AddMinutes(95));
    }

    [Fact]
    public async Task F7_AccountUnlinked_401()
    {
        var (rig, _, person, cookie) = await SignedInAsync();
        person.MicrosoftTenantId = null;
        person.MicrosoftObjectId = null;
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F7b_AccountRepointedInSameDirectory_401()
    {
        var (rig, _, person, cookie) = await SignedInAsync();
        person.MicrosoftObjectId = Guid.NewGuid();
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F8_RoleChanged_JwtHasNewRole()
    {
        var (rig, _, person, cookie) = await SignedInAsync();
        person.Role = UserRole.ReadOnly;
        await rig.Db.SaveChangesAsync();
        var r = await RefreshAsync(rig, cookie);
        Assert.Equal("ReadOnly", Assert.IsType<ApiResponse<AuthResponseDto>>(((ObjectResult)r.Result).Value).Data!.Role);
    }

    [Fact]
    public async Task F9_TamperedCookie_401()
    {
        var (rig, _, _, cookie) = await SignedInAsync();
        AssertEnded(await RefreshAsync(rig, cookie[..^4] + "AAAA"));
        AssertEnded(await RefreshAsync(rig, null));
    }

    [Fact]
    public async Task F10_CorrelationBlobAsRefresh_401()
    {
        var (rig, _, _, _) = await SignedInAsync();
        var start = await rig.StartAsync();
        var blob = CookieHeader(start, MicrosoftAuthController.CorrelationCookie)!.Replace(MicrosoftAuthController.CorrelationCookie, MicrosoftAuthController.RefreshCookie);
        AssertEnded(await RefreshAsync(rig, blob));
    }

    [Fact]
    public async Task F12_OrgInactive_401_Cleared()
    {
        var (rig, org, _, cookie) = await SignedInAsync();
        org.IsActive = false;
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F13_UserMovedToOtherOrg_401()
    {
        var (rig, _, person, cookie) = await SignedInAsync();
        person.TenantId = rig.Org("Other", "other.test").Id;
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }

    [Fact]
    public async Task F14_PromotedToSuperAdmin_401()
    {
        var (rig, _, person, cookie) = await SignedInAsync();
        person.Role = UserRole.SuperAdmin;
        await rig.Db.SaveChangesAsync();
        AssertEnded(await RefreshAsync(rig, cookie));
    }
}
