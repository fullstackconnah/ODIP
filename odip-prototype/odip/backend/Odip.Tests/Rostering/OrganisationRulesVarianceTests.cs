using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Settings PR 3: the shift review minutes come from each shift's own organisation, not a config key. The context is a SuperAdmin's (the query filter is off and sees both
/// organisations), so a reader that picked the wrong organisation's figure, or the default, would fail here.
/// </summary>
public class OrganisationRulesVarianceTests
{
    private static readonly Guid OrgA = Guid.Parse("a1000000-0000-0000-0000-000000000001"), OrgB = Guid.Parse("b2000000-0000-0000-0000-000000000002");
    private static readonly Guid StaffId = Guid.NewGuid();

    private static RosteringController MakeController(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, StaffId.ToString())], "Test")) }
            }
        };

    /// <summary>One pending-review shift in <paramref name="org"/> whose completion drifted <paramref name="start"/> minutes at the start.</summary>
    private static Shift SeedPending(OdipDbContext db, Guid org, int start, int day = 8)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = org, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = org, ParticipantId = participant.Id, UserId = StaffId, ServiceDate = new DateOnly(2026, 9, day),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        db.Participants.Add(participant);
        db.Shifts.Add(shift);
        db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = org, ShiftId = shift.Id, ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = StaffId, StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow, VarianceMinutesStart = start, VarianceMinutesEnd = 0, IsActive = true,
        });
        db.SaveChanges();
        return shift;
    }

    private static void SeedRules(OdipDbContext db, Guid org, int minutes)
    {
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = org, VarianceReviewMinutes = minutes });
        db.SaveChanges();
    }

    private static async Task<List<CompletionQueueItemDto>> Queue(RosteringController c) =>
        Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(Assert.IsType<OkObjectResult>((await c.GetCompletions(null, null, null, 1, 50, default)).Result).Value).Data!.Items.ToList();

    [Theory]
    [InlineData(29, false)] [InlineData(30, false)] [InlineData(31, true)] // strict ">"
    public async Task TheQueue_FlagsAnOutlier_OnlyPastTheOrganisationsOwnMinutes(int variance, bool outlier)
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, 30);
        SeedPending(db, OrgA, variance);

        var item = Assert.Single(await Queue(MakeController(db)));

        Assert.Equal(outlier, item.IsOutlierVariance);
        Assert.Equal(30, item.VarianceReviewMinutes);
    }

    [Theory]
    [InlineData(0, 1)] [InlineData(500, 240)]
    public async Task TheQueue_ClampsAStoredFigureOutsideTheBounds(int stored, int clamped)
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, stored);
        SeedPending(db, OrgA, 0);

        Assert.Equal(clamped, Assert.Single(await Queue(MakeController(db))).VarianceReviewMinutes);
    }

    [Fact]
    public async Task TheQueue_JudgesEachShiftByItsOwnOrganisation_AndPutsTheOutlierFirst()
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, 60);   // A: 20 minutes is fine
        var a = SeedPending(db, OrgA, 20, day: 8);
        var b = SeedPending(db, OrgB, 20, day: 9); // B has no row: 15, so 20 is an outlier, and it sorts first despite the later date

        var items = await Queue(MakeController(db));

        Assert.Equal([b.Id, a.Id], items.Select(i => i.ShiftId));
        Assert.Equal([(true, 15), (false, 60)], items.Select(i => (i.IsOutlierVariance, i.VarianceReviewMinutes)));
    }

    [Fact]
    public async Task AnotherOrganisationsFigure_NeverChangesThisOnesFlag()
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgB, 240);  // B raises its bar; A has no row and keeps 15
        SeedPending(db, OrgA, 20);

        var item = Assert.Single(await Queue(MakeController(db)));

        Assert.True(item.IsOutlierVariance);
        Assert.Equal(15, item.VarianceReviewMinutes);
    }

    [Fact]
    public async Task TheDetail_CarriesTheShiftsOrganisationFigure()
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, 45);
        var shift = SeedPending(db, OrgA, 50);

        var ok = Assert.IsType<OkObjectResult>((await MakeController(db).GetShiftCompletions(shift.Id, default)).Result);
        var dto = Assert.Single(Assert.IsType<ApiResponse<List<ShiftCompletionDto>>>(ok.Value).Data!);

        Assert.Equal((45, true), (dto.VarianceReviewMinutes, dto.IsOutlierVariance));
    }

    [Fact]
    public async Task OrganisationRules_ReadsTheLowestIdRow_AndFallsBackToTheDefaults()
    {
        using var db = TestDb.Create();
        db.AppSettings.Add(new AppSettings { Id = new Guid("00000000-0000-0000-0000-000000000009"), TenantId = OrgA, VarianceReviewMinutes = 90, PlanExpiryWarningDays = 90 });
        db.AppSettings.Add(new AppSettings { Id = new Guid("00000000-0000-0000-0000-000000000001"), TenantId = OrgA, VarianceReviewMinutes = 20, PlanExpiryWarningDays = 60 });
        db.SaveChanges();

        var rules = await OrganisationRules.ForAsync(db, [OrgA, OrgB], default);

        Assert.Equal(new OrganisationRules(20, 60), OrganisationRules.For(rules, OrgA));
        Assert.Equal(OrganisationRules.Default, OrganisationRules.For(rules, OrgB));
        Assert.Equal(new OrganisationRules(15, 30), OrganisationRules.Default);
    }

    [Fact]
    public async Task TheCleanOnlyApproveGate_JudgesMixedShiftsByTheirOwnOrganisation()
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, 60);
        var a = SeedPending(db, OrgA, 20);
        var b = SeedPending(db, OrgB, 20);   // no row: 15
        var rows = new[] { a, b }.Select(s => (s, db.ShiftCompletions.Single(c => c.ShiftId == s.Id))).ToList();

        var flagged = await ShiftCompletionMapper.ShiftsNeedingReviewAsync(db, rows, default);

        Assert.Equal([b.Id], flagged);
    }

    [Fact]
    public async Task TheStaffOverviewQueue_CarriesEachShiftsOrganisationFigure()
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, 45);
        var a = SeedPending(db, OrgA, 20);

        var item = Assert.Single(await ShiftCompletionMapper.BuildQueueItemsAsync(db, db.Shifts.Where(s => s.Id == a.Id), default));

        Assert.Equal((45, false), (item.VarianceReviewMinutes, item.IsOutlierVariance));
    }

    [Theory]
    [InlineData(0, 1)] [InlineData(500, 240)]
    public async Task TheStaffOverviewQueue_ClampsAStoredFigure_WhichItNeverDidBefore(int stored, int clamped)
    {
        using var db = TestDb.Create();
        SeedRules(db, OrgA, stored);
        var a = SeedPending(db, OrgA, 0);

        Assert.Equal(clamped, Assert.Single(await ShiftCompletionMapper.BuildQueueItemsAsync(db, db.Shifts.Where(s => s.Id == a.Id), default)).VarianceReviewMinutes);
    }
}
