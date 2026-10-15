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
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Editing a pattern an approved agreement made (agreement PR 1). Its day, times, ratio, night type, dates and participant are the agreement's: the server refuses a change to any of them, and its
/// delete, with a 409 <c>agreement-pattern</c> naming the revision (the change is made through POST .../pattern-change, which saves a new revision for approval). Default staff, notes and active are the
/// coordinator's own and still save. A hand-made pattern is edited and deleted exactly as before.
/// </summary>
public class RosteringPatternUpdateTests
{
    private static UpdateShiftPatternDto Same(ShiftPattern p) => new()
    {
        ParticipantId = p.ParticipantId, DefaultStaffId = p.DefaultUserId, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay,
        Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo, IsActive = p.IsActive, Notes = p.Notes,
    };

    private static UpdateShiftPatternDto Changed(UpdateShiftPatternDto d, string field) => field switch
    {
        "day" => d with { DayOfWeek = DayOfWeek.Saturday },
        "start" => d with { StartTime = T(8) },
        "end" => d with { EndTime = T(14) },
        "ends next day" => d with { EndTime = T(2), EndsNextDay = true },
        "ratio" => d with { Ratio = SupportRatio.TwoToOne },
        "night type" => d with { NightType = SleepoverType.ActiveNight },
        "effective from" => d with { EffectiveFrom = d.EffectiveFrom.AddDays(7) },
        "effective to" => d with { EffectiveTo = new DateOnly(2026, 11, 30) },
        "participant" => d with { ParticipantId = Guid.NewGuid() },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
    };

    private static async Task<(Fixture F, ShiftPattern Monday)> ApprovedAsync()
    {
        var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);
        return (f, await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == draft.Id && p.DayOfWeek == DayOfWeek.Monday));
    }

    private static RosteringController Controller(Fixture f) => new(f.Db, new StaffCompatibilityLinkService(f.Db), new StaffUnavailabilityQuery(f.Db));


    [Theory]
    [InlineData("day")]
    [InlineData("start")]
    [InlineData("end")]
    [InlineData("ends next day")]
    [InlineData("ratio")]
    [InlineData("night type")]
    [InlineData("effective from")]
    [InlineData("effective to")]
    [InlineData("participant")]
    public async Task A_change_to_what_the_agreement_set_is_a_409_agreement_pattern_naming_the_revision_and_changes_nothing(string field)
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;

        var result = await Controller(f).UpdatePattern(monday.Id, Changed(Same(monday), field), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<AgreementPatternConflictDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal((false, "agreement-pattern", monday.SourceDraftId!.Value), (body.Success, body.Code, body.Data!.DraftId));
        Assert.Contains("change it through the agreement", Assert.Single(body.Errors!));
        var stored = await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == monday.Id);
        Assert.Equal((monday.ParticipantId, monday.DayOfWeek, monday.StartTime, monday.EndTime, monday.EndsNextDay, monday.Ratio, monday.NightType, monday.EffectiveFrom, monday.EffectiveTo),
            (stored.ParticipantId, stored.DayOfWeek, stored.StartTime, stored.EndTime, stored.EndsNextDay, stored.Ratio, stored.NightType, stored.EffectiveFrom, stored.EffectiveTo));
    }

    [Fact]
    public async Task Default_staff_notes_and_active_are_the_coordinators_own_and_still_save()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        var staff = Guid.NewGuid();
        f.Db.Users.Add(new User { Id = staff, TenantId = TenantA, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
        await f.Db.SaveChangesAsync();

        var result = await Controller(f).UpdatePattern(monday.Id, Same(monday) with { DefaultStaffId = staff, Notes = "Ben prefers mornings", IsActive = false }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(((Guid?)staff, "Ben prefers mornings", false, monday.SourceDraftId), (body.Data!.DefaultStaffId, body.Data.Notes, body.Data.IsActive, body.Data.SourceDraftId));
    }

    [Fact]
    public async Task Deleting_an_agreement_pattern_is_a_409_agreement_pattern_and_the_pattern_stays()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;

        var result = await Controller(f).DeletePattern(monday.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<AgreementPatternConflictDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal(("agreement-pattern", monday.SourceDraftId!.Value), (body.Code, body.Data!.DraftId));
        Assert.Contains("ends through the agreement", Assert.Single(body.Errors!));
        Assert.True(await f.Db.ShiftPatterns.AnyAsync(p => p.Id == monday.Id));
    }

    [Fact]
    public async Task A_hand_made_pattern_is_edited_and_deleted_exactly_as_before()
    {
        await using var f = await SetUpAsync();
        var handMade = new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = T(9), EndTime = T(12), EffectiveFrom = new DateOnly(2026, 1, 1), IsActive = true };
        f.Db.ShiftPatterns.Add(handMade);
        await f.Db.SaveChangesAsync();

        var updated = await Controller(f).UpdatePattern(handMade.Id, Same(handMade) with { DayOfWeek = DayOfWeek.Sunday, EndTime = T(13), Ratio = SupportRatio.TwoToOne }, CancellationToken.None);
        var deleted = await Controller(f).DeletePattern(handMade.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>(updated.Result).Value);
        Assert.Equal((DayOfWeek.Sunday, T(13), SupportRatio.TwoToOne), (body.Data!.DayOfWeek, body.Data.EndTime, body.Data.Ratio));
        Assert.IsType<OkObjectResult>(deleted.Result);
        Assert.False(await f.Db.ShiftPatterns.AnyAsync(p => p.Id == handMade.Id));
    }
}
