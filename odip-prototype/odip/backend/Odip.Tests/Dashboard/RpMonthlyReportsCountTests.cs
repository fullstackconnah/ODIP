using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Dashboard;

/// <summary>
/// The dashboard's overdue monthly restrictive practice reports tile. At 2026-12-10 October (due 6 Nov) is overdue, November (due 8 Dec) is overdue and December has not ended.
/// Only the roles that can lodge a report see the count.
/// </summary>
public class RpMonthlyReportsCountTests
{
    private static RestrictivePractice Practice(OdipDbContext db, Guid tenantId, Action<RestrictivePractice>? tweak = null)
    {
        var participant = Participant(db, tenantId);
        var rp = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Type = RestrictivePracticeType.PhysicalRestraint, Description = "Hold", IsActive = true,
            AuthorisedBy = "Dr Lee", AuthorisationDate = new DateOnly(2026, 1, 1), ReportingFromMonth = new DateOnly(2026, 10, 1),
        };
        tweak?.Invoke(rp);
        db.RestrictivePractices.Add(rp);
        db.SaveChanges();
        return rp;
    }

    private static void Lodge(OdipDbContext db, RestrictivePractice rp, DateOnly month)
    {
        db.RestrictivePracticeMonthlyReports.Add(new RestrictivePracticeMonthlyReport
        {
            Id = Guid.NewGuid(), TenantId = rp.TenantId, RestrictivePracticeId = rp.Id, Month = month, ReportType = RestrictivePracticeReportType.NotUsed, LodgedOn = month.AddMonths(1).AddDays(1),
            LodgedByName = "Sam Hill", PracticeType = rp.Type, PracticeDescription = rp.Description,
        });
        db.SaveChanges();
    }

    private static async Task<DashboardSummaryDto> SummaryAsync(OdipDbContext db, string role)
    {
        var controller = new DashboardController(db, FakeClock.AtUtc(2026, 12, 10, 2, 0))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) },
            },
        };
        var result = await controller.GetSummary(CancellationToken.None);
        return Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SuperAdmin")]
    public async Task Summary_LodgingRoles_CountOverdueLinesOnly(string role)
    {
        using var db = Db();
        var rp = Practice(db, A);
        Lodge(db, rp, new DateOnly(2026, 10, 1));   // October lodged; November is the one overdue line
        var second = Practice(db, A);
        Lodge(db, second, new DateOnly(2026, 10, 1));
        Lodge(db, second, new DateOnly(2026, 11, 1));   // fully lodged

        Assert.Equal(1, (await SummaryAsync(db, role)).RpMonthlyReportsOverdueCount);
    }

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task Summary_OtherRoles_ZeroCount(string role)
    {
        using var db = Db();
        Practice(db, A);

        Assert.Equal(0, (await SummaryAsync(db, role)).RpMonthlyReportsOverdueCount);
    }

    [Fact]
    public async Task Summary_CountExcludesOtherTenant()
    {
        using var db = Db();
        Practice(db, B);

        Assert.Equal(0, (await SummaryAsync(db, "Admin")).RpMonthlyReportsOverdueCount);
    }

    [Fact]
    public async Task Summary_DeactivatedAsNeededPractice_MonthWithUse_Counts()
    {
        using var db = Db();
        var rp = Practice(db, A, e => { e.UseKind = RestrictivePracticeUseKind.Prn; e.IsActive = false; });
        db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = A, ReportedByUserId = Guid.NewGuid(), IncidentType = IncidentType.RestrictivePracticeUse, RestrictivePracticeId = rp.Id, IsRestrictivePracticeAuthorised = true,
            Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft, Title = "Use", Description = "Use", IncidentDateTime = new DateTime(2026, 10, 12, 9, 0, 0),
            CreatedAt = new DateTime(2026, 10, 12, 9, 0, 0), IsActive = true,
        });
        db.SaveChanges();

        Assert.Equal(1, (await SummaryAsync(db, "Admin")).RpMonthlyReportsOverdueCount);
    }
}
