using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Claims;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>Group activities part 2: a participant on a whole series (scope), attach-or-create against the agreement's shifts, and the agreement warnings.</summary>
public class GroupActivitySeriesParticipantTests
{
    private static readonly FixedClock Early = new(new DateTimeOffset(2026, 11, 10, 0, 0, 0, TimeSpan.Zero));
    private static readonly FixedClock Late = new(new DateTimeOffset(2026, 11, 24, 0, 0, 0, TimeSpan.Zero));
    private static readonly DateOnly Day = GroupActivityFixture.Day;

    private static async Task<List<GroupActivity>> Weeks(GroupActivityFixture fx, int extraWeeks = 3, GroupActivityInterval interval = GroupActivityInterval.Weekly)
    {
        var dto = new CreateGroupActivityDto { ServiceDate = Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Repeats = interval, Until = Day.AddDays(7 * extraWeeks * (interval == GroupActivityInterval.Fortnightly ? 2 : 1)) };
        GroupActivityFixture.Body(await fx.Controller().Create(dto, default), 200);
        return await fx.Seed.GroupActivities.AsNoTracking().OrderBy(a => a.ServiceDate).ToListAsync();
    }

    private static Task<ActionResult<ApiResponse<GroupActivityDto>>> Add(GroupActivityFixture fx, Guid activityId, Participant p, GroupActivityScope? scope, SupportRatio ratio = SupportRatio.OneToOne,
        TimeProvider? clock = null, OdipDbContext? db = null, string role = "Admin") =>
        fx.Controller(db: db, role: role, clock: clock ?? Early).AddParticipant(activityId, new AddGroupParticipantDto { ParticipantId = p.Id, Ratio = ratio, Scope = scope }, default);

    private static Task<ActionResult<ApiResponse<GroupActivityDto>>> Remove(GroupActivityFixture fx, Guid activityId, Guid shiftId, GroupActivityScope? scope, TimeProvider? clock = null) =>
        fx.Controller(clock: clock ?? Early).DetachShift(activityId, shiftId, scope, default);

    private static ShiftPattern Block(GroupActivityFixture fx, Participant p, int startHour, int endHour, Guid? tenantId = null, bool group = true, bool fromAgreement = true,
        SupportRatio ratio = SupportRatio.OneToOne, bool active = true)
    {
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? fx.TenantId, ParticipantId = p.Id, DayOfWeek = Day.DayOfWeek, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
            Ratio = ratio, EffectiveFrom = Day.AddDays(-60), IsActive = active,
            SupportGroupCode = group ? CatalogueGroups.GroupActivitiesGroupCode : null, SourceDraftId = fromAgreement ? Guid.NewGuid() : null,
        };
        fx.Seed.ShiftPatterns.Add(pattern);
        fx.Seed.SaveChanges();
        return pattern;
    }

    private static Shift PatternShift(GroupActivityFixture fx, Participant p, ShiftPattern pattern, DateOnly? date = null, ShiftStatus status = ShiftStatus.Draft, Guid? userId = null,
        Guid? tenantId = null, SupportRatio? ratio = null)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? fx.TenantId, ParticipantId = p.Id, UserId = userId, ServiceDate = date ?? Day, StartTime = pattern.StartTime, EndTime = pattern.EndTime,
            Ratio = ratio ?? pattern.Ratio, Status = status, ShiftPatternId = pattern.Id, SupportGroupCode = pattern.SupportGroupCode,
        };
        fx.Seed.Shifts.Add(shift);
        fx.Seed.SaveChanges();
        return shift;
    }

    private static Task<List<Shift>> ShiftsOf(GroupActivityFixture fx, Participant p) => fx.Seed.Shifts.AsNoTracking().Where(s => s.ParticipantId == p.Id).OrderBy(s => s.ServiceDate).ToListAsync();

    private static async Task SetActivity(GroupActivityFixture fx, Guid id, Action<GroupActivity> change)
    {
        var row = await fx.Seed.GroupActivities.SingleAsync(a => a.Id == id);
        change(row);
        await fx.Seed.SaveChangesAsync();
    }

    private static string? Message(ActionResult<ApiResponse<GroupActivityDto>> r) =>
        Assert.IsType<ApiResponse<GroupActivityDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value).Errors?.FirstOrDefault();

    // ── scope on add ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Add_NoScope_TodayBehaviour()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        Assert.Single(await ShiftsOf(fx, p));
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task Add_UnknownScopeInteger_ActsAsOccurrence()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, (GroupActivityScope)7), 200);
        Assert.Single(await ShiftsOf(fx, p));
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public void Add_UnknownScopeString_400()
    {
        // The app's JSON options use JsonStringEnumConverter; a name it does not know fails binding, which [ApiController] answers with 400.
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<AddGroupParticipantDto>("{\"scope\":\"Weekly\"}", options));
        Assert.Equal(GroupActivityScope.Series, JsonSerializer.Deserialize<AddGroupParticipantDto>("{\"scope\":\"Series\"}", options)!.Scope);
    }

    [Fact]
    public async Task AddSeries_OnOneOff_ActsAsOccurrence()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, a.Id, p, GroupActivityScope.Series), 200);
        Assert.Single(await ShiftsOf(fx, p));
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_AddsToOpenedAndLaterNonCancelled_SkipsPastStartedCancelled()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx, extraWeeks: 5); // 16, 23, 30 Nov and 7, 14, 21 Dec
        await SetActivity(fx, rows[2].Id, a => a.Status = ShiftStatus.Cancelled);
        await SetActivity(fx, rows[3].Id, a => a.Status = ShiftStatus.InProgress);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series, clock: Late), 200);
        // Late is 24 Nov: 23 Nov is past, 30 Nov cancelled, 7 Dec started. The opened day is always done.
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(new[] { rows[0].Id, rows[4].Id, rows[5].Id }, shifts.Select(s => s.GroupActivityId!.Value).ToArray());
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_AlreadyMemberEverywhere_Refused()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        var again = await Add(fx, rows[0].Id, p, GroupActivityScope.Series);
        Assert.Equal("GA_PARTICIPANT_IN", GroupActivityFixture.Error(again, 409));
        Assert.Equal("That participant is already on every upcoming activity in this series.", Message(again));
        Assert.Equal(4, (await ShiftsOf(fx, p)).Count);
    }

    [Fact]
    public async Task AddSeries_ExistingMember_FillsMissingTargets()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        var third = (await ShiftsOf(fx, p))[2];
        GroupActivityFixture.Body(await Remove(fx, rows[2].Id, third.Id, null), 200);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(4, shifts.Count); // the left shift is taken back, not duplicated
        Assert.All(shifts, s => Assert.NotNull(s.GroupActivityId));
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_OtherTenantParticipant_NotFound()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var other = new Participant { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Out", LastName = "Sider", IsActive = true };
        fx.Seed.Participants.Add(other);
        await fx.Seed.SaveChangesAsync();
        Assert.Equal("GA_PARTICIPANT_NOT_FOUND", GroupActivityFixture.Error(await Add(fx, rows[0].Id, other, GroupActivityScope.Series), 400));
        Assert.Empty(await fx.Seed.Shifts.ToListAsync());
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_TargetAlreadyHoldsParticipant_Skipped()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[2].Id, p, null), 200);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        Assert.Equal(4, (await ShiftsOf(fx, p)).Count);
    }

    [Fact]
    public async Task AddSeries_TwoToOne_TwoShiftsPerOccurrence()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series, SupportRatio.TwoToOne), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(8, shifts.Count);
        Assert.All(shifts.GroupBy(s => s.GroupActivityId), g => Assert.Equal(2, g.Count()));
        Assert.Equal(SupportRatio.TwoToOne, (await fx.Seed.GroupActivitySeriesParticipants.SingleAsync()).Ratio);
    }

    [Fact]
    public async Task AddSeries_LaterTargetCompatibilityRefuses_AllOrNothing()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var worker = fx.AddUser();
        GroupActivityFixture.Body(await fx.Controller().AddStaff(rows[2].Id, new AddGroupStaffDto { StaffId = worker.Id }, default), 200);
        fx.Seed.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), TenantId = fx.TenantId, UserId = worker.Id, ParticipantId = p.Id, Level = CompatibilityLevel.Excluded });
        await fx.Seed.SaveChangesAsync();
        var refused = await Add(fx, rows[0].Id, p, GroupActivityScope.Series);
        Assert.IsType<UnprocessableEntityObjectResult>(refused.Result);
        Assert.Empty(await fx.Seed.Shifts.ToListAsync());
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_LaterTargetWorkerConflict_AllOrNothing()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var other = fx.AddParticipant("Other");
        var worker = fx.AddUser();
        var block = Block(fx, p, 9, 13);
        PatternShift(fx, p, block, rows[2].ServiceDate, userId: worker.Id);
        fx.AddShift(other, userId: worker.Id, day: rows[2].ServiceDate, startHour: 10, endHour: 12); // the worker is already booked then
        var refused = await Add(fx, rows[0].Id, p, GroupActivityScope.Series);
        Assert.IsType<UnprocessableEntityObjectResult>(refused.Result);
        Assert.Contains("Mon 30 Nov", Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<UnprocessableEntityObjectResult>(refused.Result).Value).Errors![0]);
        Assert.Single(await ShiftsOf(fx, p)); // only the untouched pattern shift
        Assert.Null((await ShiftsOf(fx, p))[0].GroupActivityId);
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_LaterStartedPatternShift_SkipsThatOccurrence()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        PatternShift(fx, p, Block(fx, p, 9, 13), rows[2].ServiceDate, ShiftStatus.InProgress);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.DoesNotContain(shifts, s => s.GroupActivityId == rows[2].Id);
        Assert.Equal(4, shifts.Count); // three activities plus the started shift left alone
        Assert.Equal(ShiftStatus.InProgress, shifts.Single(s => s.ServiceDate == rows[2].ServiceDate).Status);
    }

    [Fact]
    public async Task Add_StartedPatternShift_Refused()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        PatternShift(fx, p, Block(fx, p, 9, 13), rows[0].ServiceDate, ShiftStatus.Completed);
        var refused = await Add(fx, rows[0].Id, p, GroupActivityScope.Series);
        Assert.Equal("GA_PARTICIPANT_SHIFT_STARTED", GroupActivityFixture.Error(refused, 409));
        Assert.Equal("This person's shift at this time has already started. Add them to a later activity.", Message(refused));
        Assert.Single(await ShiftsOf(fx, p));
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    // ── scope on remove, cancel ────────────────────────────────────────────────────────────────

    private static async Task<(GroupActivityFixture Fx, List<GroupActivity> Rows, Participant P)> SeriesWithMember()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        return (fx, rows, p);
    }

    [Fact]
    public async Task RemoveSeries_DetachesFromLaterTargets_DeletesMembership()
    {
        var (fx, rows, p) = await SeriesWithMember();
        var first = (await ShiftsOf(fx, p))[0];
        GroupActivityFixture.Body(await Remove(fx, rows[0].Id, first.Id, GroupActivityScope.Series), 200);
        Assert.All(await ShiftsOf(fx, p), s => Assert.Null(s.GroupActivityId));
        Assert.Empty(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task RemoveOccurrence_KeepsMembership()
    {
        var (fx, rows, p) = await SeriesWithMember();
        var first = (await ShiftsOf(fx, p))[0];
        GroupActivityFixture.Body(await Remove(fx, rows[0].Id, first.Id, GroupActivityScope.Occurrence), 200);
        Assert.Equal(3, (await ShiftsOf(fx, p)).Count(s => s.GroupActivityId != null));
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task AddSeries_ReAddAtNewRatio_EveryReAddedDayAndMembershipTakeIt_DaysStillOnKeepTheirs()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series, SupportRatio.TwoToOne), 200);
        foreach (var i in new[] { 1, 2 })
            GroupActivityFixture.Body(await Remove(fx, rows[i].Id, (await ShiftsOf(fx, p)).First(s => s.GroupActivityId == rows[i].Id).Id, GroupActivityScope.Occurrence), 200);
        // A removed shift stays as a loose one and is taken back on re-add at its own ratio; cancelled, it is not, so the re-add makes new shifts.
        foreach (var s in await fx.Seed.Shifts.Where(s => s.ParticipantId == p.Id && s.GroupActivityId == null).ToListAsync()) s.Status = ShiftStatus.Cancelled;
        await fx.Seed.SaveChangesAsync();
        GroupActivityFixture.Body(await Add(fx, rows[1].Id, p, GroupActivityScope.Series, SupportRatio.OneToOne), 200);
        var onDay = (await ShiftsOf(fx, p)).Where(s => s.GroupActivityId != null).ToLookup(s => s.GroupActivityId);
        Assert.All(onDay[rows[1].Id].Concat(onDay[rows[2].Id]), s => Assert.Equal(SupportRatio.OneToOne, s.Ratio));
        Assert.Equal(2, onDay[rows[0].Id].Count(s => s.Ratio == SupportRatio.TwoToOne)); // still on: untouched
        Assert.Equal(SupportRatio.OneToOne, (await fx.Seed.GroupActivitySeriesParticipants.SingleAsync()).Ratio);
    }

    [Fact]
    public async Task AddSeries_AlreadyOnEveryDay_RefusedAndMembershipRatioKept()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series, SupportRatio.TwoToOne), 200);
        Assert.Equal("GA_PARTICIPANT_IN", GroupActivityFixture.Error(await Add(fx, rows[0].Id, p, GroupActivityScope.Series, SupportRatio.OneToOne), 409));
        Assert.Equal(SupportRatio.TwoToOne, (await fx.Seed.GroupActivitySeriesParticipants.SingleAsync()).Ratio);
    }

    [Fact]
    public async Task Remove_UnknownScopeInteger_ActsAsOccurrence()
    {
        var (fx, rows, p) = await SeriesWithMember();
        var first = (await ShiftsOf(fx, p))[0];
        GroupActivityFixture.Body(await Remove(fx, rows[0].Id, first.Id, (GroupActivityScope)9), 200);
        Assert.Equal(3, (await ShiftsOf(fx, p)).Count(s => s.GroupActivityId != null));
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task RemoveSeries_Repeat_ShiftNotFound()
    {
        var (fx, rows, p) = await SeriesWithMember();
        var first = (await ShiftsOf(fx, p))[0];
        GroupActivityFixture.Body(await Remove(fx, rows[0].Id, first.Id, GroupActivityScope.Series), 200);
        Assert.Equal("GA_SHIFT_NOT_FOUND", GroupActivityFixture.Error(await Remove(fx, rows[0].Id, first.Id, GroupActivityScope.Series), 404));
    }

    [Fact]
    public async Task RemoveSeries_LockedShiftOnLaterTarget_RefusesAll()
    {
        var (fx, rows, p) = await SeriesWithMember();
        var shifts = await ShiftsOf(fx, p);
        var locked = await fx.Seed.Shifts.SingleAsync(s => s.Id == shifts[2].Id);
        locked.Status = ShiftStatus.InProgress;
        await fx.Seed.SaveChangesAsync();
        var refused = await Remove(fx, rows[0].Id, shifts[0].Id, GroupActivityScope.Series);
        Assert.Equal("GA_SHIFT_LOCKED", GroupActivityFixture.Error(refused, 409));
        Assert.StartsWith("Mon 30 Nov: ", Message(refused));
        Assert.All(await ShiftsOf(fx, p), s => Assert.NotNull(s.GroupActivityId));
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task RemoveSeries_ThenAddSeries_OneShiftPerOccurrence()
    {
        var (fx, rows, p) = await SeriesWithMember();
        GroupActivityFixture.Body(await Remove(fx, rows[0].Id, (await ShiftsOf(fx, p))[0].Id, GroupActivityScope.Series), 200);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(4, shifts.Count);
        Assert.Equal(4, shifts.Select(s => s.GroupActivityId).Distinct().Count());
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    [Fact]
    public async Task RemoveOneOff_ThenAdd_OneShift()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, a.Id, p, null), 200);
        GroupActivityFixture.Body(await Remove(fx, a.Id, (await ShiftsOf(fx, p))[0].Id, null), 200);
        GroupActivityFixture.Body(await Add(fx, a.Id, p, null), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Single(shifts);
        Assert.Equal(a.Id, shifts[0].GroupActivityId);
    }

    [Fact]
    public async Task CancelSeries_LeavesMembership()
    {
        var (fx, rows, _) = await SeriesWithMember();
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Cancel(rows[0].Id, default, new GroupActivityScopeDto(GroupActivityScope.Series)), 200);
        Assert.Single(await fx.Seed.GroupActivitySeriesParticipants.ToListAsync());
    }

    // ── both orders ────────────────────────────────────────────────────────────────────────────

    private static async Task<int> GenerateAsync(GroupActivityFixture fx, Participant p, ShiftPattern[] patterns)
    {
        var result = await new RosterShiftGenerator().GenerateAsync(fx.Seed, p.Id, patterns.Select(x => x.Id).ToList(), Day, Day.AddDays(21), CancellationToken.None);
        return result.Created;
    }

    [Fact]
    public async Task SeriesFirst_ThenPatternGenerated_OneShiftPerOccurrence()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var block = Block(fx, p, 9, 13);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        Assert.Equal(0, await GenerateAsync(fx, p, [block]));
        Assert.Equal(4, (await ShiftsOf(fx, p)).Count);
    }

    [Fact]
    public async Task PatternFirst_ThenSeriesAdd_AttachesNoNewShift()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        Assert.Equal(4, await GenerateAsync(fx, p, [Block(fx, p, 9, 13)]));
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(4, shifts.Count);
        Assert.All(shifts, s => { Assert.NotNull(s.GroupActivityId); Assert.NotNull(s.ShiftPatternId); });
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TwoToOne_BothOrders_TwoShiftsPerOccurrence(bool seriesFirst)
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var blocks = new[] { Block(fx, p, 9, 13, ratio: SupportRatio.TwoToOne), Block(fx, p, 9, 13, ratio: SupportRatio.TwoToOne) };
        if (!seriesFirst) await GenerateAsync(fx, p, blocks);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series, SupportRatio.TwoToOne), 200);
        if (seriesFirst) Assert.Equal(0, await GenerateAsync(fx, p, blocks));
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(8, shifts.Count);
        Assert.All(shifts.GroupBy(s => s.ServiceDate), g => Assert.Equal(2, g.Count()));
        Assert.All(shifts, s => Assert.NotNull(s.GroupActivityId));
    }

    // ── attach edges ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Attach_PatternOutsideTime_CreatesNewShift_AndWarnsTime()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var block = Block(fx, p, 14, 16);
        var pattern = PatternShift(fx, p, block, rows[0].ServiceDate);
        var dto = GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(2, shifts.Count);
        Assert.Null(shifts.Single(s => s.Id == pattern.Id).GroupActivityId);
        Assert.Equal(new GroupActivityParticipantFindingDto(p.Id, RosterConflictService.ActivityAgreementTime), Assert.Single(dto.ParticipantFindings));
    }

    [Fact]
    public async Task Attach_PartialOverlap_AttachesAndWarnsTime()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        await SetActivity(fx, rows[0].Id, a => (a.StartTime, a.EndTime) = (new TimeOnly(10, 0), new TimeOnly(12, 0)));
        var p = fx.AddParticipant();
        var pattern = PatternShift(fx, p, Block(fx, p, 11, 15), rows[0].ServiceDate);
        var dto = GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        var shift = Assert.Single(await ShiftsOf(fx, p));
        Assert.Equal((pattern.Id, rows[0].Id), (shift.Id, shift.GroupActivityId!.Value));
        Assert.Equal((new TimeOnly(10, 0), new TimeOnly(12, 0)), (shift.StartTime, shift.EndTime));
        Assert.Equal(RosterConflictService.ActivityAgreementTime, Assert.Single(dto.ParticipantFindings).Code);
    }

    [Fact]
    public async Task Attach_CancelledPatternShift_NotAttached()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var cancelled = PatternShift(fx, p, Block(fx, p, 9, 13), rows[0].ServiceDate, ShiftStatus.Cancelled);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(2, shifts.Count);
        Assert.Null(shifts.Single(s => s.Id == cancelled.Id).GroupActivityId);
    }

    [Fact]
    public async Task Attach_LockedPatternShift_NotAttachedNorRetimed()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var locked = PatternShift(fx, p, Block(fx, p, 11, 15), rows[0].ServiceDate, ShiftStatus.PendingReview);
        var refused = await Add(fx, rows[0].Id, p, GroupActivityScope.Series);
        Assert.Equal("GA_PARTICIPANT_SHIFT_STARTED", GroupActivityFixture.Error(refused, 409));
        var shift = Assert.Single(await ShiftsOf(fx, p));
        Assert.Equal((locked.Id, null, new TimeOnly(11, 0), new TimeOnly(15, 0)), (shift.Id, shift.GroupActivityId, shift.StartTime, shift.EndTime));
    }

    [Fact]
    public async Task Attach_OtherTenantsLeftBehindShiftWithoutPattern_NeverUsed()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var other = Guid.NewGuid();
        var theirs = new Shift
        {
            Id = Guid.NewGuid(), TenantId = other, ParticipantId = p.Id, ServiceDate = rows[0].ServiceDate, StartTime = new TimeOnly(11, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, Status = ShiftStatus.Draft, ShiftPatternId = null, SupportGroupCode = CatalogueGroups.GroupActivitiesGroupCode,
        };
        fx.Seed.Shifts.Add(theirs);
        fx.Seed.SaveChanges();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null, db: fx.Seed, role: "SuperAdmin"), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(2, shifts.Count);
        var kept = shifts.Single(s => s.Id == theirs.Id);
        Assert.Equal((other, null, new TimeOnly(11, 0), new TimeOnly(15, 0)), (kept.TenantId, kept.GroupActivityId, kept.StartTime, kept.EndTime));
        Assert.Equal((fx.TenantId, rows[0].Id), (shifts.Single(s => s.Id != theirs.Id).TenantId, shifts.Single(s => s.Id != theirs.Id).GroupActivityId!.Value));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Attach_OtherTenantsPattern_NeverUsed(bool asSuperAdmin)
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var theirs = Block(fx, p, 9, 13, tenantId: Guid.NewGuid());
        var theirShift = PatternShift(fx, p, theirs, rows[0].ServiceDate, tenantId: theirs.TenantId);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null, db: asSuperAdmin ? fx.Seed : null, role: asSuperAdmin ? "SuperAdmin" : "Admin"), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(2, shifts.Count);
        Assert.Null(shifts.Single(s => s.Id == theirShift.Id).GroupActivityId);
        Assert.Equal(fx.TenantId, shifts.Single(s => s.Id != theirShift.Id).TenantId);
    }

    [Fact]
    public async Task Attach_PatternWithWorker_AddsStaffRow()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var worker = fx.AddUser();
        var pattern = PatternShift(fx, p, Block(fx, p, 9, 13), rows[0].ServiceDate, userId: worker.Id);
        var dto = GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        Assert.Equal(worker.Id, Assert.Single(dto.Staff).StaffId);
        var shift = await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == pattern.Id);
        Assert.Null(shift.UserId);
        Assert.Equal(rows[0].Id, shift.GroupActivityId);
    }

    [Fact]
    public async Task Attach_AgreementRatioWins()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        PatternShift(fx, p, Block(fx, p, 9, 13, ratio: SupportRatio.SharedSupport), rows[0].ServiceDate);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null, SupportRatio.OneToOne), 200);
        Assert.Equal(SupportRatio.SharedSupport, Assert.Single(await ShiftsOf(fx, p)).Ratio);
    }

    [Fact]
    public async Task Attach_CommunityAccessPolicyPattern_NotUsed()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var community = PatternShift(fx, p, Block(fx, p, 9, 13, group: false), rows[0].ServiceDate);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(2, shifts.Count);
        Assert.Null(shifts.Single(s => s.Id == community.Id).GroupActivityId);
    }

    [Fact]
    public async Task Attach_TwoOverlappingBlocks_AttachesFirstOnly()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var later = PatternShift(fx, p, Block(fx, p, 10, 12), rows[0].ServiceDate);
        var earlier = PatternShift(fx, p, Block(fx, p, 9, 11), rows[0].ServiceDate);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(rows[0].Id, shifts.Single(s => s.Id == earlier.Id).GroupActivityId);
        Assert.Null(shifts.Single(s => s.Id == later.Id).GroupActivityId);
    }

    [Fact]
    public async Task Attach_PublishedPatternShift_ToDraftActivity()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        PatternShift(fx, p, Block(fx, p, 9, 13), rows[0].ServiceDate, ShiftStatus.Published);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        // Same as E6 attach: the shift keeps its own status. Publishing the activity later does not unpublish it.
        Assert.Equal(ShiftStatus.Published, Assert.Single(await ShiftsOf(fx, p)).Status);
    }

    [Fact]
    public async Task Attach_DraftPatternShift_ToPublishedActivity_Publishes()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        await SetActivity(fx, rows[0].Id, a => a.Status = ShiftStatus.Published);
        var p = fx.AddParticipant();
        PatternShift(fx, p, Block(fx, p, 9, 13), rows[0].ServiceDate);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        Assert.Equal(ShiftStatus.Published, Assert.Single(await ShiftsOf(fx, p)).Status);
    }

    [Fact]
    public async Task Add_OneOff_CreatesAsToday()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, a.Id, p, null, SupportRatio.TwoToOne), 200);
        var shifts = await ShiftsOf(fx, p);
        Assert.Equal(2, shifts.Count);
        Assert.All(shifts, s => { Assert.Equal(a.Id, s.GroupActivityId); Assert.Equal(ShiftStatus.Draft, s.Status); Assert.Equal(CatalogueGroups.GroupActivitiesGroupCode, s.SupportGroupCode); Assert.Null(s.ShiftPatternId); });
    }

    [Fact]
    public async Task Add_OneOff_AttachesTheAgreementShift()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var p = fx.AddParticipant();
        var pattern = PatternShift(fx, p, Block(fx, p, 9, 13), a.ServiceDate);
        var dto = GroupActivityFixture.Body(await Add(fx, a.Id, p, null), 200);
        Assert.Equal(a.Id, Assert.Single(await ShiftsOf(fx, p)).GroupActivityId);
        Assert.Empty(dto.ParticipantFindings); // a one-off carries no agreement warning
        Assert.NotEqual(Guid.Empty, pattern.Id);
    }

    // ── findings ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Findings_SeriesOccurrence_NoBlock_And_Time()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var bare = fx.AddParticipant("Bare");
        var offTime = fx.AddParticipant("Off");
        Block(fx, offTime, 14, 16);
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, offTime, null), 200);
        var dto = GroupActivityFixture.Body(await Add(fx, rows[0].Id, bare, null), 200);
        Assert.Equal(2, dto.ParticipantFindings.Count);
        Assert.Contains(new GroupActivityParticipantFindingDto(bare.Id, RosterConflictService.ActivityAgreementNoBlock), dto.ParticipantFindings);
        Assert.Contains(new GroupActivityParticipantFindingDto(offTime.Id, RosterConflictService.ActivityAgreementTime), dto.ParticipantFindings);
    }

    [Fact]
    public async Task Findings_ApprovedTimeChange_ShowsTime()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var block = Block(fx, p, 9, 13);
        Assert.Empty(GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200).ParticipantFindings);
        var row = await fx.Seed.ShiftPatterns.SingleAsync(x => x.Id == block.Id);
        (row.StartTime, row.EndTime) = (new TimeOnly(10, 0), new TimeOnly(14, 0)); // a later approved revision moves the block
        await fx.Seed.SaveChangesAsync();
        var dto = GroupActivityFixture.Body(await fx.Controller(clock: Early).Get(rows[0].Id, default), 200);
        Assert.Equal(RosterConflictService.ActivityAgreementTime, Assert.Single(dto.ParticipantFindings).Code);
    }

    [Fact]
    public async Task Findings_PendingRevision_NoWarning()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        Block(fx, p, 9, 13);
        Block(fx, p, 15, 17, fromAgreement: false); // a pending revision makes no pattern; a hand-made one is not an agreement block
        var dto = GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        Assert.Empty(dto.ParticipantFindings);
    }

    [Fact]
    public async Task Findings_OneOffPastCancelled_Empty()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var oneOff = fx.AddActivity(day: Day.AddDays(1));
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        GroupActivityFixture.Body(await Add(fx, rows[1].Id, p, null), 200);
        GroupActivityFixture.Body(await Add(fx, oneOff.Id, p, null), 200);
        Assert.Empty(GroupActivityFixture.Body(await fx.Controller(clock: Early).Get(oneOff.Id, default), 200).ParticipantFindings);
        Assert.Empty(GroupActivityFixture.Body(await fx.Controller(clock: Late).Get(rows[0].Id, default), 200).ParticipantFindings); // 16 Nov is before Late's today
        await SetActivity(fx, rows[1].Id, a => a.Status = ShiftStatus.Cancelled);
        Assert.Empty(GroupActivityFixture.Body(await fx.Controller(clock: Early).Get(rows[1].Id, default), 200).ParticipantFindings);
        Assert.Single(GroupActivityFixture.Body(await fx.Controller(clock: Early).Get(rows[0].Id, default), 200).ParticipantFindings);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Findings_OtherTenantPatterns_Ignored(bool asSuperAdmin)
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        Block(fx, p, 9, 13, tenantId: Guid.NewGuid()); // would fit, but it is another organisation's
        GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, null), 200);
        var read = fx.Controller(db: asSuperAdmin ? fx.Seed : null, role: asSuperAdmin ? "SuperAdmin" : "Admin", clock: Early);
        Assert.Equal(RosterConflictService.ActivityAgreementNoBlock, Assert.Single(GroupActivityFixture.Body(await read.Get(rows[0].Id, default), 200).ParticipantFindings).Code);
    }

    [Fact]
    public async Task Findings_FortnightlySeries_MatchesOnWeekday()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx, extraWeeks: 2, interval: GroupActivityInterval.Fortnightly);
        var p = fx.AddParticipant();
        Block(fx, p, 8, 14);
        Assert.Empty(GroupActivityFixture.Body(await Add(fx, rows[1].Id, p, null), 200).ParticipantFindings);
    }

    [Fact]
    public async Task Findings_NeverRefuses()
    {
        var fx = new GroupActivityFixture();
        var rows = await Weeks(fx);
        var p = fx.AddParticipant();
        var dto = GroupActivityFixture.Body(await Add(fx, rows[0].Id, p, GroupActivityScope.Series), 200); // no agreement at all
        Assert.Equal(RosterConflictService.ActivityAgreementNoBlock, Assert.Single(dto.ParticipantFindings).Code);
        Assert.Equal(4, (await ShiftsOf(fx, p)).Count);
    }
}
