using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Rostering.RosterStartWeekTests;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering's regulars (2026-10-16, L2, L5, L-a): setting or clearing a slot's regular, assigning anyone ending "regular away", and what the board says (weekStarted, the live
/// regular, the away reason). EF InMemory, the RosterStartWeekTests fixture.
/// </summary>
public class RosterRegularTests
{
    private static readonly JsonSerializerOptions ApiJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, Converters = { new JsonStringEnumConverter() },
    };

    private static Shift ShiftOf(OdipDbContext db, Guid participantId, Guid? userId, DateOnly day, Guid? patternId = null, ShiftStatus status = ShiftStatus.Draft, int from = 9, int to = 13) =>
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = participantId, UserId = userId, ServiceDate = day, StartTime = new TimeOnly(from, 0), EndTime = new TimeOnly(to, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status, ShiftPatternId = patternId,
        }).Entity;

    private static async Task<ActionResult<ApiResponse<ShiftPatternDto>>> SetRegularAsync(string dbName, Guid patternId, Guid shiftId, Guid? staffId)
    {
        using var db = TestDb.ForTenant(dbName, TenantA);
        return await Controller(db, TenantOf(TenantA)).SetRegular(patternId, new SetRegularDto { ShiftId = shiftId, StaffId = staffId }, default);
    }

    private static Shift Stored(string dbName, Guid shiftId)
    {
        using var db = TestDb.Create(dbName);
        return db.Shifts.AsNoTracking().Single(s => s.Id == shiftId);
    }

    private static async Task<RosterBoardDto> BoardAsync(string dbName, string groupBy = "participant")
    {
        using var db = TestDb.ForTenant(dbName, TenantA);
        var result = await Controller(db, TenantOf(TenantA)).GetBoard(Monday, groupBy, default);
        return Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    [Fact]
    public async Task SetRegular_SetsThePatternsDefaultWorker_AndChangesNoShift()
    {
        Guid kimId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday).Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday, patternId).Id;
        });

        var dto = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>((await SetRegularAsync(dbName, patternId, shiftId, kimId)).Result).Value).Data!;

        Assert.Equal(kimId, dto.DefaultStaffId);
        using var check = TestDb.Create(dbName);
        Assert.Equal(kimId, check.ShiftPatterns.Single(p => p.Id == patternId).DefaultUserId);
        Assert.Equal(kimId, Stored(dbName, shiftId).UserId);
    }

    [Fact]
    public async Task SetRegular_Null_ClearsIt()
    {
        Guid patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday, Worker(db, "Kim").Id).Id;
            shiftId = ShiftOf(db, mia.Id, null, Monday, patternId).Id;
        });

        Assert.IsType<OkObjectResult>((await SetRegularAsync(dbName, patternId, shiftId, null)).Result);
        using var check = TestDb.Create(dbName);
        Assert.Null(check.ShiftPatterns.Single(p => p.Id == patternId).DefaultUserId);
    }

    [Fact]
    public async Task SetRegular_AnotherOrganisationsPattern_IsNotFound()
    {
        Guid patternId = default, kimId = default;
        var dbName = NewDatabase(db => { kimId = Worker(db, "Kim").Id; patternId = Pattern(db, Person(db, "Bo", TenantB).Id, DayOfWeek.Monday, tenantId: TenantB).Id; });
        Assert.IsType<NotFoundObjectResult>((await SetRegularAsync(dbName, patternId, Guid.NewGuid(), kimId)).Result);
    }

    [Fact]
    public async Task SetRegular_AnInactiveWorker_IsRefused()
    {
        Guid patternId = default, kimId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim"); kim.IsActive = false; kimId = kim.Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday).Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday, patternId).Id;
        });

        var refused = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<BadRequestObjectResult>((await SetRegularAsync(dbName, patternId, shiftId, kimId)).Result).Value);
        Assert.Equal("Staff member not found.", Assert.Single(refused.Errors!));
    }

    private const string BoardChanged = "This shift changed after the board was loaded. Refresh the board and try again.";

    private static async Task<(ConflictObjectResult Conflict, ApiResponse<ShiftPatternDto> Body)> RefusedAsync(string dbName, Guid patternId, Guid shiftId, Guid? staffId)
    {
        var conflict = Assert.IsType<ConflictObjectResult>((await SetRegularAsync(dbName, patternId, shiftId, staffId)).Result);
        return (conflict, Assert.IsType<ApiResponse<ShiftPatternDto>>(conflict.Value));
    }

    [Theory]   // REV274 #1: an edited occurrence keeps its pattern link, so the server compares the shown shift with the pattern's own slot
    [InlineData("day")]
    [InlineData("participant")]
    [InlineData("start")]
    [InlineData("end")]
    [InlineData("endsNextDay")]
    public async Task SetRegular_ShiftEditedAwayFromTheSlot_IsRefused409_PatternUnchanged(string edited)
    {
        Guid kimId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday).Id;
            var shift = ShiftOf(db, edited == "participant" ? Person(db, "Bo").Id : mia.Id, kimId, edited == "day" ? Monday.AddDays(1) : Monday, patternId,
                from: edited == "start" ? 14 : 9, to: edited == "end" ? 20 : 13);
            shift.EndsNextDay = edited == "endsNextDay";
            shiftId = shift.Id;
        });

        var (_, body) = await RefusedAsync(dbName, patternId, shiftId, kimId);

        Assert.Equal(BoardChanged, Assert.Single(body.Errors!));
        using var check = TestDb.Create(dbName);
        Assert.Null(check.ShiftPatterns.Single(p => p.Id == patternId).DefaultUserId);
    }

    [Fact]
    public async Task SetRegular_ShiftOfAnotherPattern_IsRefused()
    {
        Guid kimId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday).Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday, Pattern(db, mia.Id, DayOfWeek.Monday).Id).Id;
        });

        var (_, body) = await RefusedAsync(dbName, patternId, shiftId, kimId);
        Assert.Equal(BoardChanged, Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task SetRegular_AMissingShift_IsRefused()
    {
        Guid kimId = default, patternId = default;
        var dbName = NewDatabase(db => { kimId = Worker(db, "Kim").Id; patternId = Pattern(db, Person(db, "Mia").Id, DayOfWeek.Monday).Id; });

        var (_, body) = await RefusedAsync(dbName, patternId, Guid.NewGuid(), kimId);
        Assert.Equal(BoardChanged, Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task SetRegular_MakeForSomeoneNotOnTheShift_IsRefused_ButStopNeedsNoStaff()
    {
        Guid kimId = default, leeId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            leeId = Worker(db, "Lee").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday, kimId).Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday, patternId).Id;
        });

        var (_, body) = await RefusedAsync(dbName, patternId, shiftId, leeId);
        Assert.Equal(BoardChanged, Assert.Single(body.Errors!));
        Assert.IsType<OkObjectResult>((await SetRegularAsync(dbName, patternId, shiftId, null)).Result);
    }

    [Theory]   // REV274 #1: Start no longer generates from an ended pattern, so its regular is meaningless
    [InlineData(false, true)]    // EffectiveTo yesterday (provider date is 2026-10-14)
    [InlineData(true, false)]    // switched off
    public async Task SetRegular_EndedPattern_IsRefused409_WithItsCode(bool ended, bool switchedOff)
    {
        Guid kimId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            var mia = Person(db, "Mia");
            var pattern = Pattern(db, mia.Id, DayOfWeek.Monday, effectiveTo: ended ? new DateOnly(2026, 10, 13) : null);
            pattern.IsActive = !switchedOff;
            patternId = pattern.Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday, patternId).Id;
        });

        var (conflict, body) = await RefusedAsync(dbName, patternId, shiftId, kimId);

        Assert.Equal("This shift's agreement pattern has ended, so it has no regular to change.", Assert.Single(body.Errors!));
        Assert.Equal(RosteringController.PatternEndedCode, body.Code);
        using var check = TestDb.Create(dbName);
        Assert.Null(check.ShiftPatterns.Single(p => p.Id == patternId).DefaultUserId);
    }

    [Fact]
    public async Task SetRegular_PatternEndingToday_IsStillLive()
    {
        Guid kimId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday, effectiveTo: new DateOnly(2026, 10, 14)).Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday, patternId).Id;
        });

        Assert.IsType<OkObjectResult>((await SetRegularAsync(dbName, patternId, shiftId, kimId)).Result);
    }

    [Fact]
    public async Task TheNextStart_AssignsTheRegular()
    {
        Guid kimId = default, patternId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            kimId = Worker(db, "Kim").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday).Id;
            shiftId = ShiftOf(db, mia.Id, kimId, Monday.AddDays(-7), patternId).Id;   // last week's occurrence of the slot, the one the coordinator was looking at
        });

        await SetRegularAsync(dbName, patternId, shiftId, kimId);
        Ok(await StartAsync(dbName, Monday));

        using var check = TestDb.Create(dbName);
        Assert.Equal(kimId, check.Shifts.Single(s => s.ServiceDate == Monday).UserId);
    }

    [Theory]
    [InlineData("assign")]
    [InlineData("put")]
    [InlineData("move")]
    public async Task Assigning_ClearsRegularAway(string how)
    {
        Guid leeId = default, flaggedId = default, leesOtherId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim");
            var lee = Worker(db, "Lee"); leeId = lee.Id;
            var mia = Person(db, "Mia");
            var flagged = ShiftOf(db, mia.Id, null, Monday, Pattern(db, mia.Id, DayOfWeek.Monday, kim.Id).Id);
            flagged.RegularUserId = kim.Id;
            flagged.RegularAwayReason = "x";
            flaggedId = flagged.Id;
            leesOtherId = ShiftOf(db, mia.Id, lee.Id, Monday.AddDays(2)).Id;
        });

        using (var db = TestDb.ForTenant(dbName, TenantA))
        {
            var controller = Controller(db, TenantOf(TenantA));
            var shift = await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == flaggedId);
            var result = how switch
            {
                "assign" => (await controller.AssignShift(flaggedId, new AssignShiftDto { StaffId = leeId }, default)).Result,
                "put" => (await controller.UpdateShift(flaggedId, new UpdateShiftDto
                {
                    ParticipantId = shift.ParticipantId, StaffId = leeId, ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime,
                    Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status,
                }, default)).Result,
                _ => (await controller.MoveStaff(new MoveStaffDto { FromShiftId = leesOtherId, ToShiftId = flaggedId, Mode = MoveStaffMode.Move }, default)).Result,
            };
            Assert.IsType<OkObjectResult>(result);
        }

        var after = Stored(dbName, flaggedId);
        Assert.Equal((leeId, (Guid?)null, (string?)null), (after.UserId!.Value, after.RegularUserId, after.RegularAwayReason));
    }

    [Fact]
    public async Task ClearingTheWorker_LeavesNoFlag()
    {
        Guid shiftId = default;
        var dbName = NewDatabase(db => { var mia = Person(db, "Mia"); shiftId = ShiftOf(db, mia.Id, Worker(db, "Kim").Id, Monday).Id; });

        using (var db = TestDb.ForTenant(dbName, TenantA))
            Assert.IsType<OkObjectResult>((await Controller(db, TenantOf(TenantA)).AssignShift(shiftId, new AssignShiftDto { StaffId = null }, default)).Result);

        var after = Stored(dbName, shiftId);
        Assert.Equal(((Guid?)null, (Guid?)null, (string?)null), (after.UserId, after.RegularUserId, after.RegularAwayReason));
    }

    [Theory]
    [InlineData("nothing", false)]
    [InlineData("one-off", false)]
    [InlineData("cancelled-pattern-shift", false)]
    [InlineData("draft-pattern-shift", true)]
    [InlineData("row", true)]
    public async Task TheBoard_WeekStarted_IsARowOrALivePatternShift(string holds, bool started)
    {
        var dbName = NewDatabase(db =>
        {
            var mia = Person(db, "Mia");
            switch (holds)
            {
                case "one-off": ShiftOf(db, mia.Id, null, Monday, status: ShiftStatus.Published); break;
                case "cancelled-pattern-shift": ShiftOf(db, mia.Id, null, Monday, Guid.NewGuid(), ShiftStatus.Cancelled); break;
                case "draft-pattern-shift": ShiftOf(db, mia.Id, null, Monday, Guid.NewGuid()); break;
                case "row": db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = TenantA, WeekStart = Monday }); break;
            }
        });

        Assert.Equal(started, (await BoardAsync(dbName)).WeekStarted);
        Assert.Equal(started, (await BoardAsync(dbName, "staff")).WeekStarted);
    }

    [Fact]
    public async Task TheBoard_CarriesTheLiveRegular_AndTheAwayReason()
    {
        Guid kimId = default, leeId = default, patternId = default, kimsId = default, flaggedId = default, leesId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim"); kimId = kim.Id;
            var lee = Worker(db, "Lee"); leeId = lee.Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday, kim.Id).Id;
            kimsId = ShiftOf(db, mia.Id, kim.Id, Monday, patternId, from: 7, to: 8).Id;
            var flagged = ShiftOf(db, mia.Id, null, Monday, patternId, from: 9, to: 10);
            flagged.RegularUserId = kim.Id;
            flagged.RegularAwayReason = "on approved leave";
            flaggedId = flagged.Id;
            leesId = ShiftOf(db, mia.Id, lee.Id, Monday, patternId).Id;
        });

        string Chip(RosterBoardDto board, Guid id) => JsonSerializer.Serialize(board.ParticipantRows!.SelectMany(r => r.Shifts).Single(s => s.Id == id), ApiJson);

        var before = await BoardAsync(dbName);
        foreach (var id in new[] { kimsId, flaggedId, leesId }) Assert.Contains($"\"regularUserId\":\"{kimId}\"", Chip(before, id));
        Assert.Contains("\"isRegular\":true", Chip(before, kimsId));
        Assert.DoesNotContain("isRegular", Chip(before, flaggedId));
        Assert.DoesNotContain("isRegular", Chip(before, leesId));
        Assert.Contains("\"regularAwayReason\":\"on approved leave\"", Chip(before, flaggedId));
        Assert.DoesNotContain("regularAwayReason", Chip(before, kimsId));
        Assert.DoesNotContain("regularAwayReason", Chip(before, leesId));

        await SetRegularAsync(dbName, patternId, leesId, leeId);

        var after = await BoardAsync(dbName);
        foreach (var id in new[] { kimsId, flaggedId, leesId }) Assert.Contains($"\"regularUserId\":\"{leeId}\"", Chip(after, id));
        Assert.Contains("\"isRegular\":true", Chip(after, leesId));
        Assert.DoesNotContain("isRegular", Chip(after, kimsId));
    }

    [Fact]
    public async Task TheBoard_DropsTheAwayReason_OnceTheSlotHasAnotherRegular_OrNone()   // DEEP-S3: the reason describes who was away, not whoever is the regular now
    {
        Guid leeId = default, patternId = default, flaggedId = default, leesId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim");
            leeId = Worker(db, "Lee").Id;
            var mia = Person(db, "Mia");
            patternId = Pattern(db, mia.Id, DayOfWeek.Monday, kim.Id).Id;
            var flagged = ShiftOf(db, mia.Id, null, Monday, patternId);
            flagged.RegularUserId = kim.Id;
            flagged.RegularAwayReason = "on approved leave";
            flaggedId = flagged.Id;
            leesId = ShiftOf(db, mia.Id, leeId, Monday, patternId).Id;
        });
        string Chip(RosterBoardDto board) => JsonSerializer.Serialize(board.ParticipantRows!.SelectMany(r => r.Shifts).Single(s => s.Id == flaggedId), ApiJson);

        await SetRegularAsync(dbName, patternId, leesId, leeId);
        var afterChange = Chip(await BoardAsync(dbName));
        await SetRegularAsync(dbName, patternId, leesId, null);
        var afterClear = Chip(await BoardAsync(dbName));

        Assert.Contains($"\"regularUserId\":\"{leeId}\"", afterChange);
        Assert.DoesNotContain("regularAwayReason", afterChange);
        Assert.DoesNotContain("regularAwayReason", afterClear);
    }

    [Fact]
    public async Task ToShiftDtoAsync_CarriesTheRegularFieldsToo()
    {
        Guid kimId = default, shiftId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim"); kimId = kim.Id;
            var mia = Person(db, "Mia");
            shiftId = ShiftOf(db, mia.Id, null, Monday, Pattern(db, mia.Id, DayOfWeek.Monday, kim.Id).Id).Id;
        });

        using var db = TestDb.ForTenant(dbName, TenantA);
        var result = await Controller(db, TenantOf(TenantA)).AssignShift(shiftId, new AssignShiftDto { StaffId = kimId }, default);

        var dto = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.True(dto.IsRegular);
        Assert.Equal(kimId, dto.RegularUserId);
    }
}
