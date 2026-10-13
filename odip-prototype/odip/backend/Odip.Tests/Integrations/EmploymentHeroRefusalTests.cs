using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Services;
using Odip.Tests.Imports;
using Xunit;
using static Odip.Tests.Integrations.EhFixture;

namespace Odip.Tests.Integrations;

/// <summary>A connected organisation's staff come from Employment Hero. ODIP's own create and staff import are refused on the server, and the frontend reads the flag.</summary>
public class EmploymentHeroRefusalTests
{
    private static StaffController StaffApi(Odip.Infrastructure.Data.OdipDbContext db, Guid tenant) =>
        new(db, currentTenant: ImportTestSupport.Tenant(tenant)) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = ImportTestSupport.Admin() } } };

    private static CreateStaffDto Kim() => new() { FirstName = "Kim", LastName = "Wu", Email = "kim@gmail.com" };

    [Fact]
    public async Task Creating_staff_is_refused_with_the_spec_message_when_the_organisation_is_connected()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);

        var result = await StaffApi(db, tenant).Create(Kim(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal("Staff come from Employment Hero for this organisation. Add them there; they appear here within 30 minutes.",
            Assert.Single(Assert.IsType<ApiResponse<StaffDetailDto>>(conflict.Value).Errors!));
        Assert.False(await db.Users.AnyAsync(u => u.Email == "kim@gmail.com"));
    }

    [Fact]
    public async Task Another_organisations_connection_does_not_stop_this_one_adding_staff()
    {
        var name = Guid.NewGuid().ToString();
        Guid connected = Guid.NewGuid(), mine = Guid.NewGuid();
        await using (var setup = Db(name, connected)) await ConnectAsync(setup, connected);
        await using var db = Db(name, mine);
        db.Tenants.Add(new Tenant { Id = mine, Name = "Bay Care", EmailDomain = "bay.org.au" });
        await db.SaveChangesAsync();

        var result = await StaffApi(db, mine).Create(Kim(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task The_staff_import_is_refused_for_a_connected_organisation()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);
        var imports = ImportTestSupport.Service(db, tenant);
        var csv = ImportTestSupport.Csv("First name,Last name,Email", "Kim,Wu,kim@gmail.com");

        var preview = await Assert.ThrowsAsync<ImportException>(() => imports.PreviewAsync(ImportKind.Staff, csv, "staff.csv", null, CancellationToken.None, ImportTestSupport.Admin()));
        var commit = await Assert.ThrowsAsync<ImportException>(() => imports.CommitAsync(ImportKind.Staff, csv, "staff.csv", null, null, "k-1", ImportTestSupport.Admin(), CancellationToken.None));

        Assert.Equal((409, EmploymentHeroStaffSync.StaffFromEmploymentHeroMessage), (preview.StatusCode, preview.Message));
        Assert.Equal((409, EmploymentHeroStaffSync.StaffFromEmploymentHeroMessage), (commit.StatusCode, commit.Message));
        Assert.False(await db.Users.AnyAsync(u => u.Email == "kim@gmail.com"));
    }

    [Fact]
    public async Task Provider_settings_say_whether_staff_come_from_Employment_Hero()
    {
        var tenant = Guid.NewGuid();
        await using var db = Db(Guid.NewGuid().ToString(), tenant);
        await ConnectAsync(db, tenant);   // adds the organisation's ProviderSettings row too
        var controller = new ProviderSettingsController(db, ImportTestSupport.Tenant(tenant));

        var connected = await controller.Get(CancellationToken.None);
        db.EmploymentHeroConnections.RemoveRange(db.EmploymentHeroConnections);
        await db.SaveChangesAsync();
        var disconnected = await controller.Get(CancellationToken.None);

        bool Flag(ActionResult<ApiResponse<ProviderSettingsDto>> r) => Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!.EmploymentHeroConnected;
        Assert.True(Flag(connected));
        Assert.False(Flag(disconnected));
    }
}
