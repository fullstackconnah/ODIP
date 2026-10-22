using System.ComponentModel.DataAnnotations;
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

/// <summary>QW7 (OPS-4, hours part): the weekly-hours warning is an organisation setting beside the qualification warning days; blank means the old 38.</summary>
public class WeeklyHoursSettingTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();

    private static (OdipDbContext Db, SettingsController Controller) Create(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, new SettingsController(db, tenant.Object));
    }

    private static AppSettingsDto Data(ActionResult<ApiResponse<AppSettingsDto>> r) => Assert.IsType<ApiResponse<AppSettingsDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    [Fact]
    public async Task Get_WithNoRow_Says38()
    {
        var (_, controller) = Create(A);
        Assert.Equal(38, Data(await controller.Get(default)).WeeklyHoursWarning);
    }

    [Fact]
    public async Task Update_StoresTheHours_ForTheCallersOrganisationOnly_AndGetReadsThemBack()
    {
        var (db, controller) = Create(A);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = B, WeeklyHoursWarning = 50 });
        await db.SaveChangesAsync();

        var saved = Data(await controller.Update(new UpdateAppSettingsDto { QualificationWarningDays = 21, WeeklyHoursWarning = 25 }, default));

        Assert.Equal((21, 25), (saved.QualificationWarningDays, saved.WeeklyHoursWarning));
        Assert.Equal(25, Data(await controller.Get(default)).WeeklyHoursWarning);
        Assert.Equal(25, (await db.AppSettings.SingleAsync(s => s.TenantId == A)).WeeklyHoursWarning);
        Assert.Equal(50, (await db.AppSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == B)).WeeklyHoursWarning);
    }

    [Fact]
    public async Task Update_LeavingTheHoursOut_KeepsTheStoredHours()
    {
        var (db, controller) = Create(A);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = A, WeeklyHoursWarning = 30 });
        await db.SaveChangesAsync();

        Assert.Equal(30, Data(await controller.Update(new UpdateAppSettingsDto { QualificationWarningDays = 14 }, default)).WeeklyHoursWarning);
        Assert.Equal(30, (await db.AppSettings.SingleAsync()).WeeklyHoursWarning);
    }

    [Theory]
    [InlineData(0, false)] [InlineData(1, true)] [InlineData(38, true)] [InlineData(100, true)] [InlineData(101, false)]
    public void TheHours_AreBounded_1To100(int hours, bool valid)
    {
        var dto = new UpdateAppSettingsDto { QualificationWarningDays = 30, WeeklyHoursWarning = hours };
        Assert.Equal(valid, Validator.TryValidateObject(dto, new ValidationContext(dto), null, true));
    }
}
