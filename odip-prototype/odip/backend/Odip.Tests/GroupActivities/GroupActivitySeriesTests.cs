using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DataExport;
using Odip.Infrastructure.Audit;
using Odip.Tests.Claims;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>Recurring group activities (PR A): create with Repeats, edit and cancel with scope.</summary>
public class GroupActivitySeriesTests
{
    private static readonly FixedClock Early = new(new DateTimeOffset(2026, 11, 10, 0, 0, 0, TimeSpan.Zero));

    private static CreateGroupActivityDto Repeating(GroupActivityInterval? repeats, DateOnly? until) =>
        new() { ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Repeats = repeats, Until = until };

    /// <summary>Four weekly Draft rows from the fixture day (16 and 23 and 30 Nov, 7 Dec), in date order.</summary>
    private static async Task<List<GroupActivity>> FourWeeks(GroupActivityFixture fx)
    {
        GroupActivityFixture.Body(await fx.Controller().Create(Repeating(GroupActivityInterval.Weekly, GroupActivityFixture.Day.AddDays(21)), default), 200);
        return await Rows(fx);
    }

    private static Task<List<GroupActivity>> Rows(GroupActivityFixture fx) => fx.Seed.GroupActivities.AsNoTracking().OrderBy(a => a.ServiceDate).ToListAsync();

    private static UpdateGroupActivityDto Req(GroupActivity a, GroupActivityScope scope, string? title = null, TimeOnly? start = null, TimeOnly? end = null, string? location = null,
        ShiftStatus? status = null, DateOnly? day = null) => new()
    {
        ServiceDate = day ?? a.ServiceDate, StartTime = start ?? a.StartTime, EndTime = end ?? a.EndTime, EndsNextDay = a.EndsNextDay, Title = title ?? a.Title, Status = status ?? a.Status,
        Location = location ?? a.Location, Notes = a.Notes, MinStaffRequired = a.MinStaffRequired, ActivityId = a.ActivityId, ServiceLocationId = a.ServiceLocationId, Scope = scope,
    };

    private static string? FirstError(ActionResult<ApiResponse<GroupActivityDto>> r) =>
        Assert.IsType<ApiResponse<GroupActivityDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value).Errors?.FirstOrDefault();

    private static async Task SetStatus(GroupActivityFixture fx, Guid id, ShiftStatus status)
    {
        var row = await fx.Seed.GroupActivities.SingleAsync(a => a.Id == id);
        row.Status = status;
        await fx.Seed.SaveChangesAsync();
    }

    // ── create ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_Weekly_MakesOneSeriesAndADraftRowPerDate_AndReturnsTheFirst()
    {
        var fx = new GroupActivityFixture();
        var dto = GroupActivityFixture.Body(await fx.Controller().Create(Repeating(GroupActivityInterval.Weekly, GroupActivityFixture.Day.AddDays(21)), default), 200);
        var rows = await Rows(fx);
        Assert.Equal(4, rows.Count);
        Assert.All(rows, r => { Assert.Equal(ShiftStatus.Draft, r.Status); Assert.Equal(rows[0].SeriesId, r.SeriesId); });
        var series = await fx.Seed.GroupActivitySeries.AsNoTracking().SingleAsync();
        Assert.Equal((series.Id, GroupActivityInterval.Weekly, GroupActivityFixture.Day, GroupActivityFixture.Day.AddDays(21)), (rows[0].SeriesId!.Value, series.Interval, series.StartDate, series.EndDate));
        Assert.Equal(rows[0].Id, dto.Id);
        Assert.Equal(new GroupActivitySeriesDto(series.Id, GroupActivityInterval.Weekly, series.StartDate, series.EndDate), dto.Series);
    }

    [Fact]
    public async Task Create_WithoutRepeats_IsOneOff_AndUntilIsIgnored()
    {
        var fx = new GroupActivityFixture();
        var dto = GroupActivityFixture.Body(await fx.Controller().Create(Repeating(null, GroupActivityFixture.Day.AddDays(21)), default), 200);
        Assert.Null(dto.Series);
        Assert.Null((await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).SeriesId);
        Assert.Empty(fx.Seed.GroupActivitySeries);
    }

    [Fact]
    public async Task Create_UntilOnTheStartDay_IsStillASeriesOfOne()
    {
        var fx = new GroupActivityFixture();
        GroupActivityFixture.Body(await fx.Controller().Create(Repeating(GroupActivityInterval.Monthly, GroupActivityFixture.Day), default), 200);
        Assert.NotNull((await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).SeriesId);
        Assert.Single(fx.Seed.GroupActivitySeries);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(null)]
    public async Task Create_UntilBeforeStartOrBlank_GA_SERIES_END_StoresNothing(int? offset)
    {
        var fx = new GroupActivityFixture();
        var until = offset is { } o ? GroupActivityFixture.Day.AddDays(o) : (DateOnly?)null;
        Assert.Equal("GA_SERIES_END", GroupActivityFixture.Error(await fx.Controller().Create(Repeating(GroupActivityInterval.Weekly, until), default), 400));
        Assert.Empty(fx.Seed.GroupActivities);
        Assert.Empty(fx.Seed.GroupActivitySeries);
    }

    [Fact]
    public async Task Create_Exactly400Days_Gives58WeeklyRows_And401Days_GA_SERIES_RANGE()
    {
        var fx = new GroupActivityFixture();
        Assert.Equal("GA_SERIES_RANGE", GroupActivityFixture.Error(await fx.Controller().Create(Repeating(GroupActivityInterval.Weekly, GroupActivityFixture.Day.AddDays(401)), default), 400));
        Assert.Empty(fx.Seed.GroupActivities);
        GroupActivityFixture.Body(await fx.Controller().Create(Repeating(GroupActivityInterval.Weekly, GroupActivityFixture.Day.AddDays(400)), default), 200);
        Assert.Equal(58, await fx.Seed.GroupActivities.CountAsync());
    }

    [Fact]
    public async Task Create_UndefinedInterval_GA_SERIES_INTERVAL()
    {
        var fx = new GroupActivityFixture();
        Assert.Equal("GA_SERIES_INTERVAL", GroupActivityFixture.Error(await fx.Controller().Create(Repeating((GroupActivityInterval)9, GroupActivityFixture.Day.AddDays(7)), default), 400));
        Assert.Empty(fx.Seed.GroupActivities);
    }

    [Fact]
    public async Task Create_Repeats_FlagOff_StoresNothing()
    {
        var fx = new GroupActivityFixture(enabled: false);
        var result = await fx.Controller().Create(Repeating(GroupActivityInterval.Weekly, GroupActivityFixture.Day.AddDays(7)), default);
        Assert.InRange(Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode ?? 200, 400, 499);
        Assert.Empty(fx.Seed.GroupActivities);
        Assert.Empty(fx.Seed.GroupActivitySeries);
    }

    [Fact]
    public void TheSeriesTable_IsAudited_AndExported()
    {
        Assert.Contains(typeof(GroupActivitySeries), AuditedEntities.Types);
        Assert.Contains(ExportTables.All, t => t.EntityType == typeof(GroupActivitySeries));
        Assert.Contains(typeof(GroupActivitySeriesParticipant), AuditedEntities.Types);
        Assert.Contains(ExportTables.All, t => t.EntityType == typeof(GroupActivitySeriesParticipant));
    }

    // ── update ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_SeriesScope_ChangesEveryOtherUpcomingRow_IncludingEarlierOnes()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(rows[1].Id, Req(rows[1], GroupActivityScope.Series, title: "Mini golf"), default), 200);
        Assert.All(await Rows(fx), r => Assert.Equal("Mini golf", r.Title));
    }

    [Fact]
    public async Task Update_SeriesScope_LeavesRowsBeforeTodayAlone()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        var late = new FixedClock(new DateTimeOffset(2026, 11, 24, 0, 0, 0, TimeSpan.Zero));
        GroupActivityFixture.Body(await fx.Controller(clock: late).Update(rows[2].Id, Req(rows[2], GroupActivityScope.Series, title: "Mini golf"), default), 200);
        Assert.Equal(new[] { "Bowling", "Bowling", "Mini golf", "Mini golf" }, (await Rows(fx)).Select(r => r.Title));
    }

    [Fact]
    public async Task Update_SeriesScope_WritesOnlyChangedFields()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        var own = await fx.Seed.GroupActivities.SingleAsync(a => a.Id == rows[2].Id);
        own.Title = "Special";
        own.StartTime = new TimeOnly(8, 0);
        await fx.Seed.SaveChangesAsync();

        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series, end: new TimeOnly(14, 0), location: "The Alley"), default), 200);

        var after = await Rows(fx);
        Assert.Equal("Special", after[2].Title);                                  // its own earlier edit to an unchanged field survives
        Assert.Equal(new TimeOnly(8, 0), after[2].StartTime);
        Assert.All(after, r => { Assert.Equal(new TimeOnly(14, 0), r.EndTime); Assert.Equal("The Alley", r.Location); });
    }

    [Fact]
    public async Task Update_SeriesScope_NoChange_WritesNothingElsewhere()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series), default), 200);
        var after = await Rows(fx);
        Assert.Equal(rows.Skip(1).Select(r => r.UpdatedAt), after.Skip(1).Select(r => r.UpdatedAt));
    }

    [Fact]
    public async Task Update_SeriesScope_SkipsStartedRow()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        await SetStatus(fx, rows[2].Id, ShiftStatus.InProgress);
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series, title: "Mini golf"), default), 200);
        var after = await Rows(fx);
        Assert.Equal(new[] { "Mini golf", "Mini golf", "Bowling", "Mini golf" }, after.Select(r => r.Title));
        Assert.Equal(ShiftStatus.InProgress, after[2].Status);
    }

    [Fact]
    public async Task Update_SeriesScope_MergedTimesInvalidOnLaterRow_RefusesAll()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        var own = await fx.Seed.GroupActivities.SingleAsync(a => a.Id == rows[2].Id);
        own.EndTime = new TimeOnly(10, 0);
        await fx.Seed.SaveChangesAsync();

        var result = await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series, start: new TimeOnly(10, 30)), default);
        Assert.Equal("GA_TIMES", GroupActivityFixture.Error(result, 400));
        Assert.StartsWith("Mon 30 Nov: ", FirstError(result));
        Assert.All(await Rows(fx), r => Assert.Equal(new TimeOnly(9, 0), r.StartTime));
    }

    [Fact]
    public async Task Update_SeriesScope_JudgeRejectsLaterRow_422_NothingSaved()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        var worker = fx.AddUser();
        fx.Seed.GroupActivityStaff.Add(new GroupActivityStaff
        {
            Id = Guid.NewGuid(), TenantId = fx.TenantId, GroupActivityId = rows[2].Id, UserId = worker.Id, StartTime = rows[2].StartTime, EndTime = rows[2].EndTime,
        });
        fx.AddShift(fx.AddParticipant(), userId: worker.Id, day: rows[2].ServiceDate, startHour: 14, endHour: 15);   // clashes only once the row runs to 15:00
        var result = await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series, end: new TimeOnly(15, 0)), default);
        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.All(await Rows(fx), r => Assert.Equal(new TimeOnly(13, 0), r.EndTime));
    }

    [Fact]
    public async Task Update_SeriesScope_StatusChange_GA_SERIES_SCOPE_AndDateChange_GA_SERIES_DATE()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        var c = fx.Controller(clock: Early);
        Assert.Equal("GA_SERIES_SCOPE", GroupActivityFixture.Error(await c.Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series, status: ShiftStatus.Published), default), 400));
        Assert.Equal("GA_SERIES_DATE", GroupActivityFixture.Error(await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], GroupActivityScope.Series, day: rows[0].ServiceDate.AddDays(1)), default), 400));
        Assert.All(await Rows(fx), r => Assert.Equal(ShiftStatus.Draft, r.Status));
    }

    [Fact]
    public async Task Update_SeriesScope_OnOneOff_ActsAsOccurrence()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var other = fx.AddActivity(day: GroupActivityFixture.Day.AddDays(7));
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(a.Id, Req(a, GroupActivityScope.Series, title: "Mini golf"), default), 200);
        Assert.Equal(new[] { "Mini golf", "Bowling" }, (await Rows(fx)).Select(r => r.Title));
    }

    [Fact]
    public async Task Update_UnknownScopeInteger_ActsAsOccurrence()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(rows[0].Id, Req(rows[0], (GroupActivityScope)7, title: "Mini golf"), default), 200);
        Assert.Equal(new[] { "Mini golf", "Bowling", "Bowling", "Bowling" }, (await Rows(fx)).Select(r => r.Title));
    }

    [Fact]
    public async Task Update_OccurrenceScope_ChangesOnlyThatRow()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        GroupActivityFixture.Body(await fx.Controller(clock: Early).Update(rows[1].Id, Req(rows[1], GroupActivityScope.Occurrence, title: "Mini golf"), default), 200);
        Assert.Equal(new[] { "Bowling", "Mini golf", "Bowling", "Bowling" }, (await Rows(fx)).Select(r => r.Title));
    }

    // ── cancel ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Cancel_SeriesScope_CancelsThisAndLaterOnly()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        GroupActivityFixture.Body(await fx.Controller().Cancel(rows[1].Id, default, new GroupActivityScopeDto(GroupActivityScope.Series)), 200);
        Assert.Equal(new[] { ShiftStatus.Draft, ShiftStatus.Cancelled, ShiftStatus.Cancelled, ShiftStatus.Cancelled }, (await Rows(fx)).Select(r => r.Status));
    }

    [Fact]
    public async Task Cancel_SeriesScope_SkipsStartedRow()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        await SetStatus(fx, rows[2].Id, ShiftStatus.InProgress);
        GroupActivityFixture.Body(await fx.Controller().Cancel(rows[0].Id, default, new GroupActivityScopeDto(GroupActivityScope.Series)), 200);
        Assert.Equal(new[] { ShiftStatus.Cancelled, ShiftStatus.Cancelled, ShiftStatus.InProgress, ShiftStatus.Cancelled }, (await Rows(fx)).Select(r => r.Status));
    }

    [Fact]
    public async Task Cancel_NoBody_ActsAsOccurrence()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        GroupActivityFixture.Body(await fx.Controller().Cancel(rows[0].Id, default), 200);
        Assert.Equal(new[] { ShiftStatus.Cancelled, ShiftStatus.Draft, ShiftStatus.Draft, ShiftStatus.Draft }, (await Rows(fx)).Select(r => r.Status));
    }

    [Fact]
    public async Task Cancel_SeriesScope_OnAnAlreadyCancelledOpenedRow_Is200_AndChangesNothingElse()
    {
        var fx = new GroupActivityFixture();
        var rows = await FourWeeks(fx);
        await SetStatus(fx, rows[1].Id, ShiftStatus.Cancelled);
        GroupActivityFixture.Body(await fx.Controller().Cancel(rows[1].Id, default, new GroupActivityScopeDto(GroupActivityScope.Series)), 200);
        Assert.Equal(new[] { ShiftStatus.Draft, ShiftStatus.Cancelled, ShiftStatus.Draft, ShiftStatus.Draft }, (await Rows(fx)).Select(r => r.Status));
    }

    // ── tenant isolation ────────────────────────────────────────────────────────────────────────────

    /// <summary>A series and two Draft rows in another organisation; returns the other rows' ids.</summary>
    private static async Task<(Guid SeriesId, List<Guid> RowIds)> OtherTenantSeries(GroupActivityFixture fx, Guid? useSeriesId = null)
    {
        var other = Guid.NewGuid();
        var seriesId = useSeriesId ?? Guid.NewGuid();
        if (useSeriesId is null)
            fx.Seed.GroupActivitySeries.Add(new GroupActivitySeries { Id = seriesId, TenantId = other, Interval = GroupActivityInterval.Weekly, StartDate = GroupActivityFixture.Day, EndDate = GroupActivityFixture.Day.AddDays(7) });
        var ids = new List<Guid>();
        foreach (var i in new[] { 0, 7 })
        {
            var row = new GroupActivity
            {
                Id = Guid.NewGuid(), TenantId = other, SeriesId = seriesId, ServiceDate = GroupActivityFixture.Day.AddDays(i), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Theirs", Status = ShiftStatus.Draft,
            };
            fx.Seed.GroupActivities.Add(row);
            ids.Add(row.Id);
        }
        await fx.Seed.SaveChangesAsync();
        return (seriesId, ids);
    }

    [Fact]
    public async Task Series_OtherTenant_NeverSeen()
    {
        var fx = new GroupActivityFixture();
        var (seriesId, _) = await OtherTenantSeries(fx);
        var mine = fx.AddActivity();
        var tracked = await fx.Seed.GroupActivities.SingleAsync(a => a.Id == mine.Id);
        tracked.SeriesId = seriesId;                      // a stray pointer at another organisation's series
        await fx.Seed.SaveChangesAsync();
        Assert.Null(GroupActivityFixture.Body(await fx.Controller().Get(mine.Id, default), 200).Series);
    }

    [Fact]
    public async Task Series_OtherTenant_CannotEditOrCancel()
    {
        var fx = new GroupActivityFixture();
        var (_, ids) = await OtherTenantSeries(fx);
        var theirs = await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == ids[0]);
        var edit = await fx.Controller(clock: Early).Update(ids[0], Req(theirs, GroupActivityScope.Series, title: "Mine now"), default);
        Assert.InRange(Assert.IsAssignableFrom<ObjectResult>(edit.Result).StatusCode ?? 200, 400, 499);
        var cancel = await fx.Controller().Cancel(ids[0], default, new GroupActivityScopeDto(GroupActivityScope.Series));
        Assert.InRange(Assert.IsAssignableFrom<ObjectResult>(cancel.Result).StatusCode ?? 200, 400, 499);
        Assert.All(await Rows(fx), r => { Assert.Equal("Theirs", r.Title); Assert.Equal(ShiftStatus.Draft, r.Status); });
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Series_Targets_StayInTenant(bool superAdmin)
    {
        var fx = new GroupActivityFixture();
        var mine = await FourWeeks(fx);
        await OtherTenantSeries(fx, useSeriesId: mine[0].SeriesId);   // foreign rows that (wrongly) carry my series id
        // A SuperAdmin working inside the fixture organisation: the db has no tenant filter, so only the explicit tenant condition keeps foreign rows out.
        var c = superAdmin ? fx.Controller(db: TestDb.Create(fx.DbName, fx.TenantId), role: "SuperAdmin", clock: Early) : fx.Controller(clock: Early);
        GroupActivityFixture.Body(await c.Update(mine[0].Id, Req(mine[0], GroupActivityScope.Series, title: "Mini golf"), default), 200);
        var rows = await Rows(fx);
        Assert.Equal(4, rows.Count(r => r.Title == "Mini golf"));
        Assert.Equal(2, rows.Count(r => r.Title == "Theirs"));
        Assert.All(rows.Where(r => r.Title == "Theirs"), r => Assert.Equal(ShiftStatus.Draft, r.Status));
    }
}
