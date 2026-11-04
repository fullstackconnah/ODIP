using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>IC6 (2026-11-04): the urgent in-app alert when an incident becomes 24-hour reportable. Once per incident, to the incident's own tenant only.</summary>
public class IncidentUrgentAlertTests
{
    // Monday 2 Nov 2026, 11:30 in Sydney (AEDT, UTC+11); the 24-hour due is Tue 3 Nov, 11:30 am.
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 0, 30, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static User Seed(OdipDbContext db, Guid tenantId, string name, UserRole role, bool active = true)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = name, LastName = "Test", Username = name.ToLowerInvariant(),
            Email = $"{name.ToLowerInvariant()}@example.com", Role = role, IsActive = active,
        };
        db.Users.Add(u);
        db.SaveChanges();
        return u;
    }

    /// <summary>Tenant A: an admin (the reporter), a coordinator, an inactive admin, a support worker. Tenant B: an admin.</summary>
    private sealed record World(OdipDbContext Db, IncidentsController Controller, Guid TenantA, User Reporter, User Coordinator, User TenantBAdmin);

    private static World Arrange(bool superAdminViewingAsA = false)
    {
        var tenantA = Guid.NewGuid();
        var db = TestDb.Create(Guid.NewGuid().ToString(), superAdminViewingAsA ? tenantA : null);
        var reporter = Seed(db, tenantA, "Reporter", UserRole.Admin);
        var coordinator = Seed(db, tenantA, "Cara", UserRole.Coordinator);
        Seed(db, tenantA, "Gone", UserRole.Admin, active: false);
        Seed(db, tenantA, "Sam", UserRole.SupportWorker);
        var other = Seed(db, Guid.NewGuid(), "Otto", UserRole.Admin);
        return new World(db, new IncidentsController(db, clock: new FixedClock(Now)), tenantA, reporter, coordinator, other);
    }

    private static CreateIncidentDto Dto(Guid reporterId, IncidentSeverity severity) => new()
    {
        ReportedByStaffId = reporterId, IncidentType = IncidentType.PropertyDamage, Severity = severity, Title = "Incident title", Description = "What happened.",
        IncidentDateTime = new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc),
    };

    private static UpdateIncidentDto UpdateDto(IncidentReport i) => new()
    {
        ReportedByStaffId = i.ReportedByUserId, IncidentType = i.IncidentType, Severity = i.Severity, Status = IncidentStatus.Draft,
        Title = i.Title, Description = i.Description, IncidentDateTime = i.IncidentDateTime,
    };

    private static Task<List<NotificationOutbox>> Urgent(OdipDbContext db) =>
        db.NotificationOutbox.Where(o => o.EventType == NotificationEventType.IncidentReportable24h).ToListAsync();

    private static async Task<IncidentReport> CreateAsync(World w, IncidentSeverity severity)
    {
        await w.Controller.Create(Dto(w.Reporter.Id, severity), CancellationToken.None);
        return await w.Db.IncidentReports.SingleAsync();
    }

    [Fact]
    public async Task Create_Within24h_RaisesUrgentAlert_ToActiveAdminsAndCoordinatorsOfItsTenantOnly()
    {
        var w = Arrange();
        using var _ = w.Db;

        var saved = await CreateAsync(w, IncidentSeverity.Critical);

        var rows = await Urgent(w.Db);
        Assert.Equal(new[] { w.Reporter.Id, w.Coordinator.Id }.Order(), rows.Select(r => r.RecipientUserId).Order());
        Assert.All(rows, r => Assert.Equal(w.TenantA, r.TenantId));
        Assert.Equal(Now.UtcDateTime, saved.UrgentAlertSentAt);
        // The bell shows it too, with the due time in the title and no participant.
        var bell = await w.Db.InAppNotifications.Where(n => n.EventType == NotificationEventType.IncidentReportable24h).ToListAsync();
        Assert.Equal(2, bell.Count);
        Assert.All(bell, n => Assert.Equal("Urgent: report an incident to the NDIS Commission by Tue 3 Nov, 11:30 am.", n.Title));
        Assert.All(bell, n => Assert.Equal($"/incidents/{saved.Id}", n.LinkTo));
    }

    [Fact]
    public async Task Create_Within24h_RaisesUrgentInsteadOfIncidentReported()
    {
        var w = Arrange();
        using var _ = w.Db;

        await CreateAsync(w, IncidentSeverity.Critical);

        Assert.DoesNotContain(await w.Db.NotificationOutbox.ToListAsync(), o => o.EventType == NotificationEventType.IncidentReported);
    }

    [Fact]
    public async Task Create_AsSuperAdminViewingAsTenantA_AlertsOnlyTenantA_ForBothAlerts()
    {
        // A SuperAdmin context bypasses the Users tenant filter; the explicit tenant match must still keep tenant B's admin out.
        var w = Arrange(superAdminViewingAsA: true);
        using var _ = w.Db;

        await w.Controller.Create(Dto(w.Reporter.Id, IncidentSeverity.Critical), CancellationToken.None);
        await w.Controller.Create(Dto(w.Reporter.Id, IncidentSeverity.Medium), CancellationToken.None);

        var rows = await w.Db.NotificationOutbox.ToListAsync();
        Assert.Contains(rows, r => r.EventType == NotificationEventType.IncidentReportable24h);
        Assert.Contains(rows, r => r.EventType == NotificationEventType.IncidentReported);
        Assert.DoesNotContain(rows, r => r.RecipientUserId == w.TenantBAdmin.Id);
    }

    [Fact]
    public async Task Create_NotWithin24h_NoUrgentAlert_AndTheUsualIncidentReportedGoes()
    {
        var w = Arrange();
        using var _ = w.Db;

        var saved = await CreateAsync(w, IncidentSeverity.Medium);

        Assert.Empty(await Urgent(w.Db));
        Assert.Null(saved.UrgentAlertSentAt);
        Assert.Equal(2, await w.Db.NotificationOutbox.CountAsync(o => o.EventType == NotificationEventType.IncidentReported));
    }

    [Fact]
    public async Task Update_ReclassifiedToWithin24h_RaisesAlertOnce()
    {
        var w = Arrange();
        using var _ = w.Db;
        var created = await CreateAsync(w, IncidentSeverity.Medium);
        var dto = UpdateDto(created) with { ReportableClass = ReportableClass.Within24h, ReportableClassReason = "The Commission asked for it." };

        await w.Controller.Update(created.Id, dto, CancellationToken.None);
        var first = await Urgent(w.Db);
        await w.Controller.Update(created.Id, dto, CancellationToken.None);

        Assert.Equal(2, first.Count);
        Assert.Equal(2, (await Urgent(w.Db)).Count);
        Assert.NotNull((await w.Db.IncidentReports.SingleAsync()).UrgentAlertSentAt);
    }

    [Fact]
    public async Task Update_Within24hToNoneAndBack_NoSecondAlert()
    {
        var w = Arrange();
        using var _ = w.Db;
        var created = await CreateAsync(w, IncidentSeverity.Critical);

        await w.Controller.Update(created.Id, UpdateDto(created) with { ReportableClass = ReportableClass.None, ReportableClassReason = "Not reportable." }, CancellationToken.None);
        await w.Controller.Update(created.Id, UpdateDto(created) with { ReportableClass = ReportableClass.Within24h }, CancellationToken.None);

        Assert.Equal(2, (await Urgent(w.Db)).Count); // the two from Create, none since
    }

    [Fact]
    public async Task Update_LegacyRowReadAsWithin24h_NoAlert()
    {
        var w = Arrange();
        using var _ = w.Db;
        var legacy = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = w.TenantA, ReportedByUserId = w.Reporter.Id, IncidentType = IncidentType.Abuse, Severity = IncidentSeverity.High,
            Status = IncidentStatus.Submitted, Title = "Legacy", Description = "What happened.", IncidentDateTime = Now.UtcDateTime.AddDays(-2),
            CreatedAt = Now.UtcDateTime.AddHours(-30), QscReportingStatus = QscReportingStatus.Required, IsActive = true,
        };
        w.Db.IncidentReports.Add(legacy);
        w.Db.SaveChanges();

        await w.Controller.Update(legacy.Id, UpdateDto(legacy), CancellationToken.None);

        Assert.Empty(await Urgent(w.Db));
        Assert.Null((await w.Db.IncidentReports.SingleAsync()).UrgentAlertSentAt);
    }

    [Fact]
    public async Task Update_AlreadyReportedToTheCommission_NoAlert()
    {
        var w = Arrange();
        using var _ = w.Db;
        var created = await CreateAsync(w, IncidentSeverity.Medium);

        await w.Controller.Update(created.Id, UpdateDto(created) with
        {
            ReportableClass = ReportableClass.Within24h, ReportableClassReason = "The Commission asked for it.", QscReportedAt = new DateTime(2026, 11, 2, 11, 0, 0),
        }, CancellationToken.None);

        Assert.Empty(await Urgent(w.Db));
    }

    [Fact]
    public async Task Update_ClosedIncident_NoAlert()
    {
        var w = Arrange();
        using var _ = w.Db;
        var created = await CreateAsync(w, IncidentSeverity.Medium);

        await w.Controller.Update(created.Id, UpdateDto(created) with
        {
            ReportableClass = ReportableClass.Within24h, ReportableClassReason = "The Commission asked for it.", Status = IncidentStatus.Closed,
        }, CancellationToken.None);

        Assert.Empty(await Urgent(w.Db));
    }
}
