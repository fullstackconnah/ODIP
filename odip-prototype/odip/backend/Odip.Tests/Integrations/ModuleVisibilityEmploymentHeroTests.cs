using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;

namespace Odip.Tests.Integrations;

/// <summary>Module visibility says whether this organisation is connected to Employment Hero, so the menu can show My payslips. The flag is presentation only: the payslip API refuses on its own.</summary>
public class ModuleVisibilityEmploymentHeroTests
{
    private static SettingsController Controller(OdipDbContext db, Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        return new SettingsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Synthetic Admin")], "Test")) } },
        };
    }

    private static ModuleVisibilityDto Data(ActionResult<ApiResponse<ModuleVisibilityDto>> response) =>
        Assert.IsType<ApiResponse<ModuleVisibilityDto>>(Assert.IsType<OkObjectResult>(response.Result).Value).Data!;

    [Fact]
    public async Task Says_whether_this_organisation_is_connected()
    {
        var name = Guid.NewGuid().ToString();
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        await using var dbA = Db(name, a);
        await using var dbB = Db(name, b);
        await ConnectAsync(dbA, a);

        Assert.True(Data(await Controller(dbA, a).GetModuleVisibility(default)).EmploymentHeroConnected);
        Assert.False(Data(await Controller(dbB, b).GetModuleVisibility(default)).EmploymentHeroConnected);
    }

    [Fact]
    public async Task The_PUT_answer_keeps_the_flag()
    {
        var a = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), a);
        await ConnectAsync(db, a);

        var data = Data(await Controller(db, a).UpdateModuleVisibility(new() { HiddenAccommodation = true, HiddenVehicles = false }, default));

        Assert.True(data.EmploymentHeroConnected);
        Assert.True(data.HiddenAccommodation);
    }

    [Fact]
    public async Task An_unscoped_SuperAdmin_gets_false()
    {
        var name = Guid.NewGuid().ToString();
        var a = Guid.NewGuid();
        await using (var dbA = Db(name, a)) await ConnectAsync(dbA, a);   // a connected organisation exists in the same database
        await using var unscoped = Db(name, Guid.Empty);

        Assert.False(Data(await Controller(unscoped, null).GetModuleVisibility(default)).EmploymentHeroConnected);
    }
}
