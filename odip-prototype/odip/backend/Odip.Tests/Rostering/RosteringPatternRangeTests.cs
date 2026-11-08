using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Pattern windows and notes (polish batch 34, H42-2 and H42-3): a generate window past 400 days or ending before it starts is refused before any lock or load; a pattern note is held to the column's 2000
/// characters at the door; a pattern whose end is before its start would save and make nothing, so create and update refuse it and save nothing.
/// </summary>
public class RosteringPatternRangeTests
{
    private const string BackwardsMessage = "Choose an end date on or after the start date.";
    private static readonly DateOnly From = new(2026, 10, 1);

    private static RosteringController Controller(Odip.Infrastructure.Data.OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static string Said<T>(ActionResult<ApiResponse<T>> result) => Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors!);

    // ── Generate ──

    private static (RosteringController Controller, ShiftPattern Pattern, LedgerKit Kit) GenerateRig()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var participant = kit.SeedParticipant();
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        };
        kit.Db.ShiftPatterns.Add(pattern);
        kit.Db.SaveChanges();
        return (new RosteringController(kit.Db, new StaffCompatibilityLinkService(kit.Db), new StaffUnavailabilityQuery(kit.Db), clock: kit.Clock, tenant: kit.Tenant), pattern, kit);
    }

    [Theory]
    [InlineData(401, "Choose a date range of 400 days or less.")]
    [InlineData(-1, BackwardsMessage)]
    public async Task GeneratePattern_RefusesATooLongOrBackwardsWindow_AndMakesNoShifts(int days, string message)
    {
        var (controller, pattern, kit) = GenerateRig();
        using var _ = kit;

        var result = await controller.GeneratePattern(pattern.Id, From, From.AddDays(days), default);

        Assert.Equal(message, Said(result));
        Assert.Equal(0, kit.Db.Shifts.Count());
    }

    [Fact]
    public async Task GeneratePattern_StillMakesShiftsForAWindowOf400Days()
    {
        var (controller, pattern, kit) = GenerateRig();
        using var _ = kit;

        var result = await controller.GeneratePattern(pattern.Id, From, From.AddDays(400), default);

        var ok = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(ok.Data!.Created > 50);
    }

    // ── Create and update ──

    private static async Task<(Fixture F, ShiftPattern Monday)> ApprovedAsync()
    {
        var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);
        return (f, await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == draft.Id && p.DayOfWeek == DayOfWeek.Monday));
    }

    private static CreateShiftPatternDto NewPattern(ShiftPattern monday, string? notes = null, DateOnly? to = null) => new()
    {
        ParticipantId = monday.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = monday.Ratio, NightType = monday.NightType,
        EffectiveFrom = monday.EffectiveFrom, EffectiveTo = to, Notes = notes,
    };

    private static UpdateShiftPatternDto Edit(ShiftPattern pattern) => new()
    {
        ParticipantId = pattern.ParticipantId, DayOfWeek = pattern.DayOfWeek, StartTime = pattern.StartTime, EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay, Ratio = pattern.Ratio,
        NightType = pattern.NightType, EffectiveFrom = pattern.EffectiveFrom, EffectiveTo = pattern.EffectiveTo, IsActive = pattern.IsActive, Notes = pattern.Notes,
    };

    private static bool Valid(object dto) => Validator.TryValidateObject(dto, new ValidationContext(dto), null, true);

    [Fact]
    public async Task ThePatternNote_IsHeldTo2000Characters_OnCreateAndUpdate()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);

        Assert.True(Valid(NewPattern(monday, new string('a', 2000))));
        Assert.False(Valid(NewPattern(monday, new string('a', 2001))));
        Assert.True(Valid(Edit(monday) with { Notes = new string('a', 2000) }));
        Assert.False(Valid(Edit(monday) with { Notes = new string('a', 2001) }));

        Assert.IsType<CreatedAtActionResult>((await Controller(db).CreatePattern(NewPattern(monday, new string('a', 2000)), CancellationToken.None)).Result);
        Assert.Equal(2000, (await db.ShiftPatterns.SingleAsync(p => p.DayOfWeek == DayOfWeek.Saturday)).Notes!.Length);
    }

    [Fact]
    public async Task CreatePattern_RefusesAnEndBeforeTheStart_AndSavesNothing()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var before = await db.ShiftPatterns.CountAsync();

        var result = await Controller(db).CreatePattern(NewPattern(monday, to: monday.EffectiveFrom.AddDays(-1)), CancellationToken.None);

        Assert.Equal(BackwardsMessage, Said(result));
        Assert.Equal(before, await db.ShiftPatterns.CountAsync());
    }

    [Fact]
    public async Task UpdatePattern_RefusesAnEndBeforeTheStart_AndLeavesTheRowAlone()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);

        var result = await Controller(db).UpdatePattern(monday.Id, Edit(monday) with { EffectiveTo = monday.EffectiveFrom.AddDays(-1) }, CancellationToken.None);

        Assert.Equal(BackwardsMessage, Said(result));
        Assert.Equal(monday.EffectiveTo, (await db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == monday.Id)).EffectiveTo);
    }
}
