using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The public holiday table is global: every tenant's quotes and claims read the same rows, and since the plan builder's pricing engine a row decides
/// whether a day is priced at the public holiday rate (+122% on a weekday). So the rows are the SuperAdmin's to change, the state of a row is one of
/// the eight codes, and every change is recoverable (review M6 of phase B).
/// </summary>
public class PublicHolidaysControllerTests
{
    private static readonly Guid SuperAdminId = Guid.NewGuid();

    /// <summary>The controller over an in-memory database with the audit interceptor on, called by a signed-in SuperAdmin.</summary>
    private static (OdipDbContext Db, PublicHolidaysController Controller) SetUp()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var identity = new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, SuperAdminId.ToString()), new Claim("fullName", "Sam Super") }, "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);
        return (db, new PublicHolidaysController(db, Mock.Of<IPublicHolidaySyncService>()));
    }

    private static CreatePublicHolidayDto Holiday(string? state) => new() { Date = new DateOnly(2026, 10, 12), Name = "Test day", State = state };

    private static PublicHolidayDto Created(ActionResult<ApiResponse<PublicHolidayDto>> result) =>
        Assert.IsType<ApiResponse<PublicHolidayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    // ── Who may change the table ──────────────────────────────────────────────────

    [Fact]
    public void Adding_deleting_and_syncing_holidays_is_for_a_SuperAdmin_and_reading_them_is_for_anyone_signed_in()
    {
        var type = typeof(PublicHolidaysController);

        Assert.Null(type.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        Assert.Null(type.GetMethod(nameof(PublicHolidaysController.GetAll))!.GetCustomAttribute<AuthorizeAttribute>());
        foreach (var route in new[] { nameof(PublicHolidaysController.Create), nameof(PublicHolidaysController.Delete), nameof(PublicHolidaysController.Sync) })
            Assert.Equal("SuperAdmin", type.GetMethod(route)!.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
    }

    // ── The state of a row ────────────────────────────────────────────────────────

    [Theory]
    [InlineData("XX")]
    [InlineData("Victoria")]
    [InlineData("AU-NSW")]
    [InlineData("NSW,VIC")]
    [InlineData("")]
    [InlineData("  ")]
    public async Task A_holiday_for_a_state_that_is_not_one_of_the_eight_is_refused_and_nothing_is_stored(string state)
    {
        var (db, controller) = SetUp();

        var result = await controller.Create(Holiday(state), default);

        var refused = Assert.IsType<ApiResponse<PublicHolidayDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Contains("ACT, NSW, NT, QLD, SA, TAS, VIC, WA", Assert.Single(refused.Errors!));
        Assert.Empty(db.PublicHolidays);
        Assert.Empty(db.AuditLogs);
    }

    [Theory]
    [InlineData("NSW", "NSW")]
    [InlineData(" vic ", "VIC")]
    [InlineData("wa", "WA")]
    [InlineData(null, null)]
    public async Task A_state_is_stored_in_capitals_and_no_state_at_all_is_a_holiday_in_every_state(string? sent, string? stored)
    {
        var (db, controller) = SetUp();

        var created = Created(await controller.Create(Holiday(sent), default));

        Assert.Equal(stored, created.State);
        Assert.Equal(stored, Assert.Single(db.PublicHolidays).State);
    }

    // ── Every change is recoverable ───────────────────────────────────────────────

    [Fact]
    public async Task Adding_and_deleting_a_holiday_each_leave_an_audit_row_that_names_the_SuperAdmin()
    {
        var (db, controller) = SetUp();

        var created = Created(await controller.Create(Holiday("NSW"), default));
        var added = Assert.Single(await db.AuditLogs.ToListAsync());
        Assert.Equal(("PublicHoliday", created.Id, AuditAction.Created, SuperAdminId, "Sam Super"),
            (added.EntityType, added.EntityId, added.Action, added.ChangedById, added.ChangedByName));
        Assert.Contains("Test day", added.Changes);
        Assert.Contains("NSW", added.Changes);

        Assert.IsType<OkObjectResult>((await controller.Delete(created.Id, default)).Result);
        var removed = Assert.Single(await db.AuditLogs.Where(l => l.Action == AuditAction.Deleted).ToListAsync());
        Assert.Equal(("PublicHoliday", created.Id, SuperAdminId), (removed.EntityType, removed.EntityId, removed.ChangedById));
        Assert.Contains("Test day", removed.Changes);
    }
}
