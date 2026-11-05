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
    private static readonly DateTime LateUtc = new(2026, 11, 5, 23, 30, 0, DateTimeKind.Utc); // Nov 6 07:30 in Perth, Nov 6 10:30 in Sydney

    private static async Task<string?> TodayAsync(string? zone, bool withRow = true)
    {
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), Tenant);
        if (withRow) db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = "NSW", TimeZoneId = zone });
        await db.SaveChangesAsync();

        var result = await new ProviderTodayController(db, new FixedClock(LateUtc)).Get(CancellationToken.None);

        return Assert.IsType<ApiResponse<ProviderTodayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Date;
    }

    [Fact]
    public async Task A_Perth_organisation_late_in_the_UTC_day_gets_the_next_calendar_date() =>
        Assert.Equal("2026-11-06", await TodayAsync("Australia/Perth"));

    [Fact]
    public async Task An_organisation_with_no_settings_row_gets_the_Sydney_date() =>
        Assert.Equal("2026-11-06", await TodayAsync(null, withRow: false));

    [Fact]
    public async Task A_Darwin_organisation_keeps_the_earlier_date_than_Sydney() =>
        Assert.Equal("2026-11-06", await TodayAsync("Australia/Darwin")); // 09:00 on Nov 6 in Darwin

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
