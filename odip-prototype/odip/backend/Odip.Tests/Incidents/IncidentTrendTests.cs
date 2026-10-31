using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>GET api/v1/incidents/trend: live, non-Draft reports by the month they happened, last 6 months. IncidentDateTime is wall clock, so the provider's zone only decides which month is "this month".</summary>
public class IncidentTrendTests
{
    private static readonly Guid Tenant = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");

    // Mid-October 2026, midday in Sydney and Perth alike.
    private static FakeClock October() => FakeClock.AtUtc(2026, 10, 15, 2, 0);

    private static IncidentTrendController Controller(OdipDbContext db, FakeClock? clock = null) => new(db, clock ?? October());

    private static void Add(OdipDbContext db, string when, IncidentType type = IncidentType.Other, IncidentStatus status = IncidentStatus.Submitted, bool active = true)
    {
        db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = Guid.NewGuid(), Title = "T", Description = "D", IncidentType = type, Status = status, IsActive = active,
            IncidentDateTime = DateTime.Parse(when, CultureInfo.InvariantCulture)
        });
        db.SaveChanges();
    }

    private static async Task<IncidentTrendDto> Trend(IncidentTrendController c)
    {
        var result = await c.GetTrend(CancellationToken.None);
        return Assert.IsType<ApiResponse<IncidentTrendDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    [Fact]
    public async Task GetTrend_EmptyDb_ReturnsSixZeroMonths_OldestFirst_EndingThisMonth()
    {
        using var db = TestDb.Create();

        var trend = await Trend(Controller(db));

        Assert.Equal(new DateOnly(2026, 10, 15), trend.Today);
        Assert.Equal(new[] { "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10" }, trend.Months.Select(m => m.Month));
        Assert.All(trend.Months, m => Assert.Equal((0, 0, 0), (m.Incidents, m.RpUses, m.OtherIncidents)));
    }

    [Fact]
    public async Task GetTrend_DraftAndArchived_AreExcluded_ClosedIsIncluded()
    {
        using var db = TestDb.Create();
        Add(db, "2026-10-02T09:00", status: IncidentStatus.Draft);
        Add(db, "2026-10-03T09:00", active: false);
        Add(db, "2026-10-04T09:00", status: IncidentStatus.Closed);
        Add(db, "2026-10-05T09:00", status: IncidentStatus.Resolved);
        Add(db, "2026-10-06T09:00");

        Assert.Equal(3, (await Trend(Controller(db))).Months[5].Incidents);
    }

    [Fact]
    public async Task GetTrend_RpUses_AreTheRestrictivePracticeUseType_OtherIsTheRest()
    {
        using var db = TestDb.Create();
        Add(db, "2026-09-10T09:00", IncidentType.RestrictivePracticeUse);
        Add(db, "2026-09-11T09:00");
        Add(db, "2026-10-10T09:00", IncidentType.RestrictivePracticeUse);
        Add(db, "2026-10-11T09:00");
        Add(db, "2026-10-12T09:00");
        // A register entry is not a use.
        db.RestrictivePractices.Add(new RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), Type = RestrictivePracticeType.PhysicalRestraint, Description = "Register", IsActive = true });
        db.SaveChanges();

        var months = (await Trend(Controller(db))).Months;

        Assert.Equal((2, 1, 1), (months[4].Incidents, months[4].RpUses, months[4].OtherIncidents));
        Assert.Equal((3, 1, 2), (months[5].Incidents, months[5].RpUses, months[5].OtherIncidents));
        Assert.All(months, m => Assert.Equal(m.Incidents, m.RpUses + m.OtherIncidents));
    }

    // 31 Oct 14:00 UTC is 1 Nov 01:00 in Sydney and 31 Oct 22:00 in Perth.
    [Fact]
    public async Task GetTrend_MonthBoundary_UsesThePerthProvidersMonth_AndTheStoredWallClock()
    {
        using var db = TestDb.Create(viewingAs: Tenant);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = Tenant, State = "NSW", TimeZoneId = "Australia/Perth" });
        db.SaveChanges();
        Add(db, "2026-10-31T23:30");
        Add(db, "2026-11-01T00:30");

        var trend = await Trend(Controller(db, FakeClock.AtUtc(2026, 10, 31, 14, 0)));

        Assert.Equal(new DateOnly(2026, 10, 31), trend.Today);
        Assert.Equal("2026-10", trend.Months[5].Month);
        Assert.Equal(1, trend.Months[5].Incidents);
        Assert.Equal(1, trend.Months.Sum(m => m.Incidents));
    }

    [Fact]
    public async Task GetTrend_SameClock_SydneyProvider_EndsInNovember()
    {
        using var db = TestDb.Create(viewingAs: Tenant);
        Add(db, "2026-10-31T23:30");
        Add(db, "2026-11-01T00:30");

        var months = (await Trend(Controller(db, FakeClock.AtUtc(2026, 10, 31, 14, 0)))).Months;

        Assert.Equal("2026-11", months[5].Month);
        Assert.Equal(1, months[5].Incidents);
        Assert.Equal(1, months[4].Incidents);
    }

    [Fact]
    public async Task GetTrend_WindowEdges_AreHalfOpen()
    {
        using var db = TestDb.Create();
        Add(db, "2026-05-01T00:00");
        Add(db, "2026-04-30T23:59:59");
        Add(db, "2026-11-01T00:00");

        var months = (await Trend(Controller(db))).Months;

        Assert.Equal(1, months[0].Incidents);
        Assert.Equal(1, months.Sum(m => m.Incidents));
    }

    [Fact]
    public async Task GetTrend_OtherTenantsIncidents_AreNotCounted()
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        // The (null, 1) seed is the fail-closed NULL-tenant row.
        foreach (var (tenant, count) in new (Guid?, int)[] { (tenantB, 3), (tenantA, 1), (null, 1) })
        {
            var ambient = new Mock<ICurrentTenant>();
            ambient.Setup(t => t.TenantId).Returns(tenant);
            ambient.Setup(t => t.IsSuperAdmin).Returns(tenant is null);
            using var seed = new OdipDbContext(options, ambient.Object);
            for (var i = 0; i < count; i++)
                seed.IncidentReports.Add(new IncidentReport { Id = Guid.NewGuid(), TenantId = tenant, ReportedByUserId = Guid.NewGuid(), Title = "T", Description = "D", Status = IncidentStatus.Submitted, IsActive = true, IncidentDateTime = new DateTime(2026, 10, 10, 9, 0, 0) });
            await seed.SaveChangesAsync();
        }
        var reader = new Mock<ICurrentTenant>();
        reader.Setup(t => t.TenantId).Returns(tenantA);
        reader.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(options, reader.Object);

        Assert.Equal(1, (await Trend(Controller(db))).Months.Sum(m => m.Incidents));
    }
}
