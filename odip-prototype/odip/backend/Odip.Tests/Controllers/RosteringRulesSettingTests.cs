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

/// <summary>Settings PR 3: the shift review minutes and the plan-expiry window are organisation settings; the PUT is presence-based so one section's save never touches another's fields.</summary>
public class RosteringRulesSettingTests
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

    private static AppSettings Stored(Guid tenantId) => new() { Id = Guid.NewGuid(), TenantId = tenantId, QualificationWarningDays = 21, WeeklyHoursWarning = 30, VarianceReviewMinutes = 20, PlanExpiryWarningDays = 14 };

    [Fact]
    public async Task Get_WithNoRow_Says15And30()
    {
        var (_, controller) = Create(A);
        var data = Data(await controller.Get(default));
        Assert.Equal((15, 30), (data.VarianceReviewMinutes, data.PlanExpiryWarningDays));
    }

    [Fact]
    public async Task Update_OfOnlyTheVarianceMinutes_StoresThem_AndKeepsEveryOtherField()
    {
        var (db, controller) = Create(A);
        db.AppSettings.Add(Stored(A));
        await db.SaveChangesAsync();

        var saved = Data(await controller.Update(new UpdateAppSettingsDto { VarianceReviewMinutes = 40 }, default));

        Assert.Equal((21, 30, 40, 14), (saved.QualificationWarningDays, saved.WeeklyHoursWarning, saved.VarianceReviewMinutes, saved.PlanExpiryWarningDays));
        var row = await db.AppSettings.SingleAsync();
        Assert.Equal((21, 30, 40, 14), (row.QualificationWarningDays, row.WeeklyHoursWarning, row.VarianceReviewMinutes, row.PlanExpiryWarningDays));
    }

    [Fact]
    public async Task Update_OfOnlyThePlanExpiryDays_StoresThem_AndKeepsEveryOtherField()
    {
        var (db, controller) = Create(A);
        db.AppSettings.Add(Stored(A));
        await db.SaveChangesAsync();

        var saved = Data(await controller.Update(new UpdateAppSettingsDto { PlanExpiryWarningDays = 60 }, default));

        Assert.Equal((21, 30, 20, 60), (saved.QualificationWarningDays, saved.WeeklyHoursWarning, saved.VarianceReviewMinutes, saved.PlanExpiryWarningDays));
        Assert.Equal(60, (await db.AppSettings.SingleAsync()).PlanExpiryWarningDays);
    }

    [Fact]
    public async Task Update_OfOnlyTheQualificationDays_KeepsTheRulesFields()
    {
        var (db, controller) = Create(A);
        db.AppSettings.Add(Stored(A));
        await db.SaveChangesAsync();

        Data(await controller.Update(new UpdateAppSettingsDto { QualificationWarningDays = 90 }, default));

        var row = await db.AppSettings.SingleAsync();
        Assert.Equal((90, 30, 20, 14), (row.QualificationWarningDays, row.WeeklyHoursWarning, row.VarianceReviewMinutes, row.PlanExpiryWarningDays));
    }

    [Fact]
    public async Task Update_WithNoRow_TakesTheDefaultsForEveryFieldLeftOut()
    {
        var (db, controller) = Create(A);

        Data(await controller.Update(new UpdateAppSettingsDto { VarianceReviewMinutes = 45 }, default));

        var row = await db.AppSettings.SingleAsync();
        Assert.Equal((30, 38, 45, 30), (row.QualificationWarningDays, row.WeeklyHoursWarning, row.VarianceReviewMinutes, row.PlanExpiryWarningDays));
    }

    [Theory]
    [InlineData(0, false)] [InlineData(1, true)] [InlineData(240, true)] [InlineData(241, false)]
    public void TheVarianceMinutes_AreBounded_1To240(int minutes, bool valid)
    {
        var dto = new UpdateAppSettingsDto { VarianceReviewMinutes = minutes };
        Assert.Equal(valid, Validator.TryValidateObject(dto, new ValidationContext(dto), null, true));
    }

    [Theory]
    [InlineData(0, false)] [InlineData(1, true)] [InlineData(365, true)] [InlineData(366, false)]
    public void ThePlanExpiryDays_AreBounded_1To365(int days, bool valid)
    {
        var dto = new UpdateAppSettingsDto { PlanExpiryWarningDays = days };
        Assert.Equal(valid, Validator.TryValidateObject(dto, new ValidationContext(dto), null, true));
    }

    [Fact]
    public async Task Update_ForOrganisationA_LeavesOrganisationBsRowUnchanged()
    {
        var (db, controller) = Create(A);
        db.AppSettings.Add(Stored(B));
        await db.SaveChangesAsync();

        Data(await controller.Update(new UpdateAppSettingsDto { VarianceReviewMinutes = 99, PlanExpiryWarningDays = 99 }, default));

        var b = await db.AppSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == B);
        Assert.Equal((20, 14), (b.VarianceReviewMinutes, b.PlanExpiryWarningDays));
        Assert.Equal(99, (await db.AppSettings.SingleAsync(s => s.TenantId == A)).VarianceReviewMinutes);
    }

    [Fact]
    public void ACoordinatorMayReadButNotChange()
    {
        static string[] Roles(string method) => typeof(SettingsController).GetMethod(method)!.GetCustomAttribute<AuthorizeAttribute>()!.Roles!.Split(',');
        Assert.Contains("Coordinator", Roles(nameof(SettingsController.Get)));
        Assert.DoesNotContain("Coordinator", Roles(nameof(SettingsController.Update)));
    }
}
