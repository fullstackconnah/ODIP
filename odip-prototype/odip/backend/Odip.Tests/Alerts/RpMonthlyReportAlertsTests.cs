using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Alerts;

/// <summary>
/// The two monthly report alert rules. Practices are authorised from 2026-01-01 and report from October 2026 (ReportingFromMonth is set, because CreatedAt defaults to the real
/// clock). At 2026-11-03 October is due on 6 Nov; at 2026-11-09 it is overdue.
/// </summary>
public class RpMonthlyReportAlertsTests
{
    private static Participant SeedParticipant(OdipDbContext db, Guid? tenantId = null)
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        if (tenantId != null) p.TenantId = tenantId.Value;
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static RestrictivePractice SeedEntry(OdipDbContext db, Participant p, Action<RestrictivePractice>? tweak = null)
    {
        var rp = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, Type = RestrictivePracticeType.PhysicalRestraint, Description = "Hold", IsActive = true,
            AuthorisedBy = "Dr Lee", AuthorisationDate = new DateOnly(2026, 1, 1), ReportingFromMonth = new DateOnly(2026, 10, 1),
        };
        tweak?.Invoke(rp);
        db.RestrictivePractices.Add(rp);
        db.SaveChanges();
        return rp;
    }

    private static void Lodged(OdipDbContext db, RestrictivePractice rp, DateOnly month)
    {
        db.RestrictivePracticeMonthlyReports.Add(new RestrictivePracticeMonthlyReport
        {
            Id = Guid.NewGuid(), TenantId = rp.TenantId, RestrictivePracticeId = rp.Id, Month = month, ReportType = RestrictivePracticeReportType.NotUsed, LodgedOn = month.AddMonths(1).AddDays(1),
            LodgedByName = "Sam Hill", PracticeType = rp.Type, PracticeDescription = rp.Description,
        });
        db.SaveChanges();
    }

    private static async Task<List<Odip.Application.DTOs.ParticipantAlertDto>> Alerts(OdipDbContext db, int day, Guid? participantId = null) =>
        (await new ParticipantAlertsService(db, FakeClock.AtUtc(2026, 11, day, 2, 0)).GetAlertsAsync(participantId))
            .SelectMany(a => a.Alerts).Where(a => a.Type.StartsWith("rp-monthly-report")).ToList();

    [Fact]
    public async Task OverdueMonth_OneCriticalPerPractice()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p);

        var alert = Assert.Single(await Alerts(db, 9, p.Id));

        Assert.Equal("rp-monthly-report-overdue", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("restrictive-practices", alert.DeepLinkTab);
    }

    [Fact]
    public async Task TwoOverdueMonths_StillOneAlert_CountInMessage()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p);

        var december = Assert.Single(await new ParticipantAlertsService(db, FakeClock.AtUtc(2026, 12, 10, 2, 0)).GetAlertsAsync(p.Id));
        var overdue = Assert.Single(december.Alerts, a => a.Type == "rp-monthly-report-overdue");
        Assert.Contains("2 months", overdue.Message);
        Assert.Contains("06/11/2026", overdue.Message);
    }

    [Fact]
    public async Task DueNotOverdue_Warning()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        SeedEntry(db, p);

        var alert = Assert.Single(await Alerts(db, 3, p.Id));

        Assert.Equal(("rp-monthly-report-due", AlertSeverity.Warning), (alert.Type, alert.Severity));
        Assert.Contains("06/11/2026", alert.Message);
    }

    [Fact]
    public async Task AllLodged_NoAlert()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        Lodged(db, SeedEntry(db, p), new DateOnly(2026, 10, 1));

        Assert.Empty(await Alerts(db, 9, p.Id));
    }

    [Fact]
    public async Task AggregateCall_StaysWithinTenant()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), a);
        var mine = SeedParticipant(db, a);
        var theirs = SeedParticipant(db, b);
        SeedEntry(db, mine);
        SeedEntry(db, theirs);

        var all = (await new ParticipantAlertsService(db, FakeClock.AtUtc(2026, 11, 9, 2, 0)).GetAlertsAsync(null, activeOnly: true))
            .Where(x => x.Alerts.Any(al => al.Type.StartsWith("rp-monthly-report"))).ToList();

        Assert.Equal(mine.Id, Assert.Single(all).ParticipantId);
    }

    [Fact]
    public async Task DeactivatedAsNeededPractice_MonthWithUse_StillAlerts()
    {
        using var db = TestDb.Create(Guid.NewGuid().ToString());
        var p = SeedParticipant(db);
        var rp = SeedEntry(db, p, e => { e.UseKind = RestrictivePracticeUseKind.Prn; e.IsActive = false; });
        db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = rp.TenantId, ReportedByUserId = Guid.NewGuid(), IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeId = rp.Id,
            IsRestrictivePracticeAuthorised = true, Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, Title = "Use", Description = "Use",
            IncidentDateTime = new DateTime(2026, 10, 12, 9, 0, 0), CreatedAt = new DateTime(2026, 10, 12, 9, 0, 0), IsActive = true,
        });
        db.SaveChanges();

        var alert = Assert.Single(await Alerts(db, 9, p.Id));

        Assert.Equal("rp-monthly-report-overdue", alert.Type);
    }
}
