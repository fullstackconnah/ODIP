using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// A pattern has to make shifts that have a length (phase 3 review, N2): a hand-made pattern that ends at or before its start without "Ends the next day" would make shifts the budget cannot price, so the overnight cost
/// would never reach a forecast or a warning. The rule is the shift's own: refused when the pattern is made, and when an edit changes its times (an edit that leaves the times alone, such as deactivating a pattern
/// saved before the rule, is never refused).
/// </summary>
public class RosteringPatternLengthTests
{
    private const string EndsBeforeItStarts = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift.";

    private static RosteringController Controller(Odip.Infrastructure.Data.OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static async Task<(Fixture F, ShiftPattern Monday)> ApprovedAsync()
    {
        var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);
        return (f, await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == draft.Id && p.DayOfWeek == DayOfWeek.Monday));
    }

    private static UpdateShiftPatternDto Edit(ShiftPattern pattern) => new()
    {
        ParticipantId = pattern.ParticipantId, DayOfWeek = pattern.DayOfWeek, StartTime = pattern.StartTime, EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay, Ratio = pattern.Ratio,
        NightType = pattern.NightType, EffectiveFrom = pattern.EffectiveFrom, EffectiveTo = pattern.EffectiveTo, IsActive = pattern.IsActive, Notes = pattern.Notes,
    };

    private static string Said<T>(ActionResult<ApiResponse<T>> result) => Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!);

    private static string? CodeOf<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Code;

    [Theory]
    [InlineData(22, 6)]   // an overnight pattern, the box not ticked: a length of minus sixteen hours
    [InlineData(9, 9)]    // nothing at all
    public async Task CreatePattern_RefusesAPatternWithNoLength_AndSavesNothing(int startHour, int endHour)
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var before = await db.ShiftPatterns.CountAsync();
        var dto = new CreateShiftPatternDto
        {
            ParticipantId = monday.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0), Ratio = monday.Ratio, NightType = monday.NightType,
            EffectiveFrom = monday.EffectiveFrom,
        };

        var result = await Controller(db).CreatePattern(dto, CancellationToken.None);

        Assert.Equal(EndsBeforeItStarts, Said(result));
        Assert.Equal(before, await db.ShiftPatterns.CountAsync());
    }

    [Fact]
    public async Task ThePatternRefusalsForNoLength_CarryTheCodeShiftNoLength_TheOneTheShiftsOwnRefusalsCarry()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var create = new CreateShiftPatternDto
        {
            ParticipantId = monday.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(9, 0), Ratio = monday.Ratio, NightType = monday.NightType,
            EffectiveFrom = monday.EffectiveFrom,
        };

        var created = await Controller(db).CreatePattern(create, CancellationToken.None);
        var updated = await Controller(db).UpdatePattern(monday.Id, Edit(monday) with { EndTime = monday.StartTime }, CancellationToken.None);

        Assert.Equal("shift-no-length", CodeOf(created));
        Assert.Equal("shift-no-length", CodeOf(updated));
    }

    [Fact]
    public async Task CreatePattern_AcceptsAnOvernightPatternWithTheBoxTicked()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var dto = new CreateShiftPatternDto
        {
            ParticipantId = monday.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true, Ratio = monday.Ratio,
            NightType = monday.NightType, EffectiveFrom = monday.EffectiveFrom,
        };

        var result = await Controller(db).CreatePattern(dto, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task UpdatePattern_RefusesAnEditThatGivesThePatternNoLength_AndLeavesItAsItWas()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);

        var result = await Controller(db).UpdatePattern(monday.Id, Edit(monday) with { EndTime = monday.StartTime }, CancellationToken.None);

        Assert.Equal(EndsBeforeItStarts, Said(result));
        Assert.Equal(monday.EndTime, (await db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == monday.Id)).EndTime);
    }

    [Fact]
    public async Task UpdatePattern_NeverRefusesAPatternSavedBeforeTheRule_WhileItsTimesAreLeftAlone()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using (var seed = NewDb(f.DbName))
        {
            var legacy = await seed.ShiftPatterns.SingleAsync(p => p.Id == monday.Id);
            legacy.EndTime = legacy.StartTime;
            await seed.SaveChangesAsync();
        }
        await using var db = NewDb(f.DbName);
        var stored = await db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == monday.Id);

        var deactivated = await Controller(db).UpdatePattern(monday.Id, Edit(stored) with { IsActive = false, Notes = "Stopped while the agreement is reviewed" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(deactivated.Result);
    }
}
