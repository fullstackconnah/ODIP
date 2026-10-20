using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
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

public class ModuleVisibilityTests
{
    private static readonly Guid A = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid B = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");
    private static readonly Guid Actor = Guid.Parse("cccccccc-0000-0000-0000-000000000003");
    private static (OdipDbContext Db, SettingsController Controller) Create(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var controller = new SettingsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, Actor.ToString()), new Claim("fullName", "Synthetic Admin")], "Test")) } },
        };
        return (db, controller);
    }
    private static ModuleVisibilityDto Data(ActionResult<ApiResponse<ModuleVisibilityDto>> response) =>
        Assert.IsType<ApiResponse<ModuleVisibilityDto>>(Assert.IsType<OkObjectResult>(response.Result).Value).Data!;

    [Fact]
    public async Task Missing_settings_are_visible_without_creating_a_row()
    {
        var (db, controller) = Create(A);
        var data = Data(await controller.GetModuleVisibility(default));
        Assert.False(data.HiddenAccommodation); Assert.False(data.HiddenVehicles);
        Assert.Empty(db.AppSettings); Assert.Empty(db.AuditLogs);
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task Reads_and_writes_are_explicitly_tenant_scoped_even_for_SuperAdmin(bool superAdmin)
    {
        var (db, controller) = Create(A, superAdmin);
        db.AppSettings.AddRange(new AppSettings { Id = Guid.NewGuid(), TenantId = B, HiddenAccommodation = true, HiddenVehicles = true }, new AppSettings { Id = Guid.NewGuid(), TenantId = A });
        await db.SaveChangesAsync();
        Assert.False(Data(await controller.GetModuleVisibility(default)).HiddenAccommodation);
        await controller.UpdateModuleVisibility(new() { HiddenAccommodation = true, HiddenVehicles = false }, default);
        var other = await db.AppSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == B);
        Assert.True(other.HiddenAccommodation); Assert.True(other.HiddenVehicles);
        var own = await db.AppSettings.SingleAsync(s => s.TenantId == A);
        Assert.True(own.HiddenAccommodation); Assert.False(own.HiddenVehicles);
        var audit = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal(own.Id, audit.EntityId); Assert.Equal(nameof(AppSettings), audit.EntityType); Assert.Equal(Actor, audit.ChangedById); Assert.Equal("Synthetic Admin", audit.ChangedByName);
        var change = Assert.Single(JsonDocument.Parse(audit.Changes).RootElement.EnumerateArray().ToArray());
        Assert.Equal("HiddenAccommodation", change.GetProperty("Field").GetString());
        Assert.Equal("False", change.GetProperty("Old").GetString()); Assert.Equal("True", change.GetProperty("New").GetString());
        await controller.UpdateModuleVisibility(new() { HiddenAccommodation = true, HiddenVehicles = false }, default);
        Assert.Single(await db.AuditLogs.ToListAsync());
        if (!superAdmin) await controller.Update(new() { QualificationWarningDays = 14 }, default);
        Assert.True(own.HiddenAccommodation); Assert.False(own.HiddenVehicles); if (!superAdmin) Assert.Equal(14, own.QualificationWarningDays);
        await controller.UpdateModuleVisibility(new() { HiddenAccommodation = false, HiddenVehicles = false }, default);
        Assert.False(Data(await controller.GetModuleVisibility(default)).HiddenAccommodation);
    }

    [Fact]
    public async Task No_organisation_never_reads_an_arbitrary_row_or_writes()
    {
        var (db, controller) = Create(null, true);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = B, HiddenVehicles = true }); await db.SaveChangesAsync();
        Assert.False(Data(await controller.GetModuleVisibility(default)).HiddenVehicles);
        Assert.IsType<BadRequestObjectResult>((await controller.UpdateModuleVisibility(new() { HiddenAccommodation = true, HiddenVehicles = true }, default)).Result);
        Assert.Single(db.AppSettings); Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Missing_fields_are_invalid_and_never_silently_clear_a_choice()
    {
        var dto = new UpdateModuleVisibilityDto { HiddenAccommodation = false };
        var errors = new List<ValidationResult>();
        Assert.False(Validator.TryValidateObject(dto, new ValidationContext(dto), errors, true));
        Assert.Contains(errors, e => e.MemberNames.Contains(nameof(dto.HiddenVehicles)));
        var (db, controller) = Create(A);
        Assert.IsType<BadRequestObjectResult>((await controller.UpdateModuleVisibility(dto, default)).Result);
        Assert.Empty(db.AppSettings); Assert.Empty(db.AuditLogs);
    }

    [Theory]
    [InlineData("Admin", true)] [InlineData("SuperAdmin", true)] [InlineData("Coordinator", false)] [InlineData("SupportWorker", false)] [InlineData("ReadOnly", false)]
    public void Only_existing_admin_roles_may_configure_but_every_authenticated_role_reads_its_menu(string role, bool mayWrite)
    {
        var type = typeof(SettingsController);
        Assert.NotEmpty(type.GetCustomAttributes<AuthorizeAttribute>());
        var write = type.GetMethod(nameof(SettingsController.UpdateModuleVisibility))!.GetCustomAttribute<AuthorizeAttribute>()!;
        Assert.Equal(mayWrite, write.Roles!.Split(',').Contains(role));
        Assert.Empty(type.GetMethod(nameof(SettingsController.GetModuleVisibility))!.GetCustomAttributes<AuthorizeAttribute>().Where(a => a.Roles != null));
    }
}


