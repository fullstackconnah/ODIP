using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Settings > Security: how long a sign-in lasts. Null = no limit, which is what every organisation has after deploy.</summary>
public class SecuritySettingsTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();

    private static (OdipDbContext Db, SettingsController Controller) Create(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, new SettingsController(db, tenant.Object));
    }

    private static AppSettingsDto Data(ActionResult<ApiResponse<AppSettingsDto>> r) =>
        Assert.IsType<ApiResponse<AppSettingsDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    private static Task<ActionResult<ApiResponse<AppSettingsDto>>> Put(SettingsController c, int? minutes) =>
        c.UpdateSecurity(new UpdateSecuritySettingsDto { SessionLengthMinutes = minutes }, default);

    private static bool Admits(string role)
    {
        var attrs = typeof(SettingsController).GetCustomAttributes<AuthorizeAttribute>(true)
            .Concat(typeof(SettingsController).GetMethod(nameof(SettingsController.UpdateSecurity))!.GetCustomAttributes<AuthorizeAttribute>(true))
            .Where(a => a.Roles != null).ToList();
        Assert.NotEmpty(attrs);
        return attrs.All(a => a.Roles!.Split(',').Select(r => r.Trim()).Contains(role));
    }

    [Theory]
    [InlineData("SuperAdmin", true)]
    [InlineData("Admin", true)]
    [InlineData("Coordinator", false)]
    [InlineData("ReadOnly", false)]
    [InlineData("SupportWorker", false)]
    public void Security_put_is_Admin_and_SuperAdmin_only(string role, bool admitted) => Assert.Equal(admitted, Admits(role));

    [Fact]
    public async Task Security_put_Admin_saves()
    {
        var (db, c) = Create(A);
        Assert.Equal(60, Data(await Put(c, 60)).SessionLengthMinutes);
        Assert.Equal(60, (await db.AppSettings.SingleAsync()).SessionLengthMinutes);
    }

    [Fact]
    public async Task Security_put_null_clears_the_limit()
    {
        var (db, c) = Create(A);
        await Put(c, 60);
        Assert.Null(Data(await Put(c, null)).SessionLengthMinutes);
        Assert.Null((await db.AppSettings.SingleAsync()).SessionLengthMinutes);
    }

    [Fact]
    public async Task Security_put_SuperAdmin_without_org_is_ChooseOrganisation()
    {
        var (db, c) = Create(null, superAdmin: true);
        var r = await Put(c, 60);
        Assert.IsType<BadRequestObjectResult>(r.Result);
        Assert.Empty(await db.AppSettings.IgnoreQueryFilters().ToListAsync());
    }

    [Theory]
    [InlineData(14, false)]
    [InlineData(481, false)]
    [InlineData(15, true)]
    [InlineData(480, true)]
    [InlineData(null, true)]
    public void Bounds(int? minutes, bool valid) =>
        Assert.Equal(valid, Validator.TryValidateObject(new UpdateSecuritySettingsDto { SessionLengthMinutes = minutes }, new ValidationContext(new UpdateSecuritySettingsDto { SessionLengthMinutes = minutes }), null, true));

    [Fact]
    public async Task Security_put_creates_the_row_with_other_defaults()
    {
        var (db, c) = Create(A);
        await Put(c, 120);
        var row = await db.AppSettings.SingleAsync();
        Assert.Equal((30, 38), (row.QualificationWarningDays, row.WeeklyHoursWarning));
    }

    [Fact]
    public async Task Security_put_writes_only_the_callers_tenant()
    {
        var (db, c) = Create(A);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = B, SessionLengthMinutes = 15 });
        await db.SaveChangesAsync();

        await Put(c, 480);

        var rows = await db.AppSettings.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        Assert.Equal(15, rows.Single(r => r.TenantId == B).SessionLengthMinutes);
        Assert.Equal(480, rows.Single(r => r.TenantId == A).SessionLengthMinutes);
    }

    [Fact]
    public async Task Security_put_leaves_the_alert_windows_alone()
    {
        var (db, c) = Create(A);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = A, QualificationWarningDays = 90, WeeklyHoursWarning = 20 });
        await db.SaveChangesAsync();

        var data = Data(await Put(c, 60));

        Assert.Equal((90, 20, 60), (data.QualificationWarningDays, data.WeeklyHoursWarning, data.SessionLengthMinutes));
    }

    [Fact]
    public async Task Get_returns_sessionLengthMinutes_to_a_Coordinator()
    {
        var (db, c) = Create(A);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = A, SessionLengthMinutes = 240 });
        await db.SaveChangesAsync();

        Assert.Equal(240, Data(await c.Get(default)).SessionLengthMinutes);
    }

    [Fact]
    public async Task Get_with_no_row_is_no_limit()
    {
        var (_, c) = Create(A);
        Assert.Null(Data(await c.Get(default)).SessionLengthMinutes);
    }
}
