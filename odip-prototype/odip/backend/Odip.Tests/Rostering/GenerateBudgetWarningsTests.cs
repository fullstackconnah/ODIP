using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The Generate button's result says where the shifts it just made take a pool past its funding (budget phase 3): a warning for each pool and period, never a reason to refuse. Fixed clock: 4 Oct 2026. A pattern for
/// Mondays 9 to 5 in NSW makes shifts of $480; Monday 12 Oct to 30 Nov is eight of them, $3,840.
/// </summary>
public class GenerateBudgetWarningsTests : IDisposable
{
    private readonly LedgerKit _kit = LedgerKit.Create();
    public void Dispose() => _kit.Dispose();

    private (RosteringController Controller, ShiftPattern Pattern, Participant Participant) Rig(decimal october, BudgetLimitMode mode = BudgetLimitMode.Warn, bool withPlan = true, bool withTenant = true)
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant();
        if (withPlan) _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, october), LedgerKit.Q(3, 5000m)));
        if (mode != BudgetSettings.DefaultMode)
        {
            _kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = _kit.TenantId, Mode = mode });
            _kit.Db.SaveChanges();
        }
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = _kit.TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        _kit.Db.ShiftPatterns.Add(pattern);
        _kit.Db.SaveChanges();

        var db = _kit.Db;
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: _kit.Clock, tenant: withTenant ? _kit.Tenant : null)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "Coordinator") }, "test")) } },
        };
        return (controller, pattern, participant);
    }

    private static GeneratePatternResultDto Ok(ActionResult<ApiResponse<GeneratePatternResultDto>> result) => ((ApiResponse<GeneratePatternResultDto>)Assert.IsType<OkObjectResult>(result.Result).Value!).Data!;

    private static readonly DateOnly From = new(2026, 10, 12);
    private static readonly DateOnly To = new(2026, 11, 30);

    [Fact]
    public async Task ShiftsThatTakeThePoolPastItsFunding_ComeBackWithAWarningForThePeriod_AndAreMadeAnyway()
    {
        var (controller, pattern, _) = Rig(october: 1000m);

        var result = Ok(await controller.GeneratePattern(pattern.Id, From, To, default));

        Assert.Equal(8, result.Created);
        Assert.Equal(8, _kit.Db.Shifts.Count());
        var warning = Assert.Single(result.BudgetWarnings!);
        Assert.Equal(("Core (flexible)", new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31)), (warning.PoolName, warning.PeriodStart, warning.PeriodEnd));
        Assert.Equal((1000m, 3840m, 3840m, 2840m, 8), (warning.Available, warning.Forecast, warning.Added, warning.OverBy, warning.Count));
        Assert.Equal("These 8 shifts take Core (flexible) to $3,840.00 of $1,000.00 for 1\u00A0Oct\u00A0\u2013\u2060\u00A031\u00A0Dec\u00A02026, $2,840.00 over.", warning.Message);
    }

    [Fact]
    public async Task UnderAHardLimit_GeneratingIsStillNeverBlocked_ItOnlyWarns()
    {
        var (controller, pattern, _) = Rig(october: 1000m, BudgetLimitMode.HardLimit);

        var result = Ok(await controller.GeneratePattern(pattern.Id, From, To, default));

        Assert.Equal(8, result.Created);
        Assert.Single(result.BudgetWarnings!);
    }

    [Fact]
    public async Task ShiftsWithinTheFunding_OrForAParticipantWithNoBudget_OrWithoutAnOrganisation_HaveNoWarnings()
    {
        var (roomy, roomyPattern, _) = Rig(october: 5000m);
        Assert.Null(Ok(await roomy.GeneratePattern(roomyPattern.Id, From, To, default)).BudgetWarnings);

        using var other = LedgerKit.Create();
        other.SeedProvider("NSW");
        other.SeedCommunityAccessCatalogue();
        var noBudget = other.SeedParticipant();
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = other.TenantId, ParticipantId = noBudget.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        other.Db.ShiftPatterns.Add(pattern);
        other.Db.SaveChanges();
        var controller = new RosteringController(other.Db, new StaffCompatibilityLinkService(other.Db), new StaffUnavailabilityQuery(other.Db), clock: other.Clock, tenant: other.Tenant);
        Assert.Null(Ok(await controller.GeneratePattern(pattern.Id, From, To, default)).BudgetWarnings);
    }

    [Fact]
    public async Task AGenerateWithNoOrganisationOnTheRequest_HasNoBudgetWarnings()
    {
        var (controller, pattern, _) = Rig(october: 1000m, withTenant: false);

        var result = Ok(await controller.GeneratePattern(pattern.Id, From, To, default));

        Assert.Equal(8, result.Created);
        Assert.Null(result.BudgetWarnings);
    }

    [Fact]
    public async Task RunningItAgain_MakesNothingNew_AndSaysNothingNew()
    {
        var (controller, pattern, _) = Rig(october: 1000m);
        Ok(await controller.GeneratePattern(pattern.Id, From, To, default));

        var again = Ok(await controller.GeneratePattern(pattern.Id, From, To, default));

        Assert.Equal((0, 8), (again.Created, again.Skipped));
        Assert.Null(again.BudgetWarnings);   // nothing was made, so there is nothing to warn about
    }
}
