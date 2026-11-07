using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The alert windows PUT and the session length PUT write one audit row per changed field, as module-visibility does.</summary>
public class SettingsAuditTests
{
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid Actor = Guid.NewGuid();

    private static async Task<(OdipDbContext Db, SettingsController Controller)> Create()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(A);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = A, QualificationWarningDays = 30, SessionLengthMinutes = 60 });
        await db.SaveChangesAsync();
        var identity = new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Actor.ToString()), new Claim("fullName", "Dana Admin") }, "test");
        var controller = new SettingsController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } }
        };
        return (db, controller);
    }

    [Fact]
    public async Task Changing_the_session_length_writes_one_row_with_old_and_new()
    {
        var (db, c) = await Create();
        Assert.IsType<OkObjectResult>((await c.UpdateSecurity(new UpdateSecuritySettingsDto { SessionLengthMinutes = 120 }, default)).Result);
        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal(nameof(AppSettings), row.EntityType);
        Assert.Contains("SessionLengthMinutes", row.Changes);
        Assert.Contains("\"60\"", row.Changes);
        Assert.Contains("\"120\"", row.Changes);
        Assert.Equal(Actor, row.ChangedById);
        Assert.Equal("Dana Admin", row.ChangedByName);
    }

    [Fact]
    public async Task Changing_one_alert_window_writes_one_row()
    {
        var (db, c) = await Create();
        await c.Update(new UpdateAppSettingsDto { QualificationWarningDays = 45, WeeklyHoursWarning = 38 }, default);
        var row = await db.AuditLogs.SingleAsync();
        Assert.Contains("QualificationWarningDays", row.Changes);
        Assert.Contains("\"30\"", row.Changes);
        Assert.Contains("\"45\"", row.Changes);
        Assert.Equal(Actor, row.ChangedById);
        Assert.Equal("Dana Admin", row.ChangedByName);
    }

    [Fact]
    public async Task Putting_the_same_values_writes_no_row()
    {
        var (db, c) = await Create();
        await c.UpdateSecurity(new UpdateSecuritySettingsDto { SessionLengthMinutes = 60 }, default);
        await c.Update(new UpdateAppSettingsDto { QualificationWarningDays = 30 }, default);
        Assert.Empty(db.AuditLogs);
    }
}
