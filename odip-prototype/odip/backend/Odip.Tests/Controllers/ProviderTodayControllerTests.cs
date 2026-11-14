using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Every signed-in role (SupportWorker and ReadOnly included) reads the provider's calendar date, which the settings endpoint hides from them. The date comes
/// from the same resolver the server's calendar rules use, so the browser and the server cannot disagree about "today".
/// </summary>
public class ProviderTodayControllerTests
{
    private sealed class FixedClock(DateTime utc) : TimeProvider { public override DateTimeOffset GetUtcNow() => new(utc); }

    private static readonly Guid Tenant = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly DateTime LateUtc = new(2026, 11, 5, 14, 0, 0, DateTimeKind.Utc); // Nov 6 01:00 in Sydney, Nov 5 23:30 in Darwin, Nov 5 22:00 in Perth

    private static async Task<ProviderTodayDto> ReadAsync(string? zone, bool withRow = true, string state = "NSW", string role = "Admin")
    {
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), Tenant);
        if (withRow) db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = state, TimeZoneId = zone });
        await db.SaveChangesAsync();

        var controller = new ProviderTodayController(db, new FixedClock(LateUtc))
        {
            ControllerContext = new() { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) } },
        };
        var result = await controller.Get(CancellationToken.None);

        return Assert.IsType<ApiResponse<ProviderTodayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static async Task<string?> TodayAsync(string? zone, bool withRow = true) => (await ReadAsync(zone, withRow)).Date;

    [Fact]
    public async Task A_Perth_organisation_keeps_the_earlier_date_than_Sydney() =>
        Assert.Equal("2026-11-05", await TodayAsync("Australia/Perth"));

    [Fact]
    public async Task An_organisation_with_no_settings_row_gets_the_Sydney_date() =>
        Assert.Equal("2026-11-06", await TodayAsync(null, withRow: false));

    [Fact]
    public async Task A_Darwin_organisation_keeps_the_earlier_date_than_Sydney() =>
        Assert.Equal("2026-11-05", await TodayAsync("Australia/Darwin"));

    [Fact]
    public async Task The_stored_zone_is_returned_with_the_date() =>
        Assert.Equal("Australia/Perth", (await ReadAsync("Australia/Perth")).TimeZoneId);

    [Fact]
    public async Task With_no_stored_zone_the_States_default_zone_is_returned() =>
        Assert.Equal("Australia/Perth", (await ReadAsync(null, state: "WA")).TimeZoneId);

    [Fact]
    public async Task With_no_settings_row_the_Sydney_zone_is_returned() =>
        Assert.Equal("Australia/Sydney", (await ReadAsync(null, withRow: false)).TimeZoneId);

    [Fact]
    public async Task A_SupportWorker_gets_both_the_date_and_the_zone()
    {
        var dto = await ReadAsync("Australia/Perth", role: "SupportWorker");
        Assert.Equal("2026-11-05", dto.Date);
        Assert.Equal("Australia/Perth", dto.TimeZoneId);
    }

    private static bool Allows(string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = typeof(ProviderTodayController).GetCustomAttributes<AuthorizeAttribute>(true)
            .Concat(typeof(ProviderTodayController).GetMethod(nameof(ProviderTodayController.Get))!.GetCustomAttributes<AuthorizeAttribute>(true)).ToList();
        return attributes.Count > 0 && attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    [Theory]
    [InlineData("SuperAdmin")]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public void Every_signed_in_role_may_read_it(string role) => Assert.True(Allows(role));

    [Fact]
    public void Anonymous_is_refused_because_the_controller_requires_a_sign_in()
    {
        Assert.NotEmpty(typeof(ProviderTodayController).GetCustomAttributes<AuthorizeAttribute>(true));
        Assert.Empty(typeof(ProviderTodayController).GetCustomAttributes<AllowAnonymousAttribute>(true));
    }
}
