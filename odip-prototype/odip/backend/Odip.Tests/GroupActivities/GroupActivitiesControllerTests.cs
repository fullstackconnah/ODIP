using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>Shared seeding for the group-activity tests: one organisation, the switch on, and a controller scoped to it.</summary>
internal sealed class GroupActivityFixture
{
    public static readonly DateOnly Day = new(2026, 11, 16);
    public Guid TenantId { get; } = Guid.NewGuid();
    public string DbName { get; } = Guid.NewGuid().ToString();
    public OdipDbContext Seed { get; }

    public GroupActivityFixture(bool enabled = true)
    {
        Seed = TestDb.Create(DbName);
        Seed.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = TenantId, GroupActivitiesEnabled = enabled });
        Seed.SaveChanges();
    }

    public OdipDbContext Fresh() => TestDb.ForTenant(DbName, TenantId);

    public GroupActivitiesController Controller(OdipDbContext? db = null, Guid? tenantId = null, string role = "Admin", bool superAdminNoTenant = false, Guid? userId = null)
    {
        db ??= Fresh();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(superAdminNoTenant ? null : tenantId ?? TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdminNoTenant);
        var controller = new GroupActivitiesController(db, tenant.Object, new StaffUnavailabilityQuery(db));
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(Claims(role, userId), "test")) },
        };
        return controller;
    }

    private static List<Claim> Claims(string role, Guid? userId)
    {
        var claims = new List<Claim> { new(ClaimTypes.Role, role) };
        if (userId is { } id) claims.Add(new Claim(ClaimTypes.NameIdentifier, id.ToString()));
        return claims;
    }

    public Participant AddParticipant(string first = "Pat", bool active = true)
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = TenantId, FirstName = first, LastName = "Test", IsActive = active };
        Seed.Participants.Add(p);
        Seed.SaveChanges();
        return p;
    }

    public User AddUser(string first = "Wendy", bool active = true, Guid? tenantId = null)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, FirstName = first, LastName = "Worker", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, IsActive = active,
        };
        Seed.Users.Add(u);
        Seed.SaveChanges();
        return u;
    }

    public Shift AddShift(Participant p, SupportRatio ratio = SupportRatio.OneToOne, Guid? userId = null, DateOnly? day = null, ShiftStatus status = ShiftStatus.Draft,
        int startHour = 10, int endHour = 12)
    {
        var s = new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, UserId = userId, ServiceDate = day ?? Day, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
            Ratio = ratio, Status = status,
        };
        Seed.Shifts.Add(s);
        Seed.SaveChanges();
        return s;
    }

    public GroupActivity AddActivity(ShiftStatus status = ShiftStatus.Draft, DateOnly? day = null)
    {
        var a = new GroupActivity
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ServiceDate = day ?? Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = status,
        };
        Seed.GroupActivities.Add(a);
        Seed.SaveChanges();
        return a;
    }

    public static CreateGroupActivityDto NewActivity(string title = "Bowling", int startHour = 9, int endHour = 13) =>
        new() { ServiceDate = Day, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0), Title = title };

    public static T Body<T>(ActionResult<ApiResponse<T>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode ?? 200);
        return Assert.IsType<ApiResponse<T>>(obj.Value).Data!;
    }

    public static string? Error(ActionResult<ApiResponse<GroupActivityDto>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode);
        return Assert.IsType<ApiResponse<GroupActivityDto>>(obj.Value).Code;
    }
}

public class GroupActivityStaffingTests
{
    [Theory]
    [InlineData(new[] { SupportRatio.OneToOne }, null, 1)]
    [InlineData(new[] { SupportRatio.OneToTwo, SupportRatio.OneToTwo }, null, 1)]
    [InlineData(new[] { SupportRatio.OneToOne, SupportRatio.OneToTwo, SupportRatio.OneToTwo }, null, 2)]
    [InlineData(new[] { SupportRatio.TwoToOne }, null, 2)]
    [InlineData(new[] { SupportRatio.OneToTwo }, 3, 3)]
    public void StaffNeeded_RoundsSixtiethsUp_AndHonoursMinimum(SupportRatio[] ratios, int? min, int expected) =>
        Assert.Equal(expected, GroupActivityStaffing.StaffNeeded(ratios, min));
}

public class GroupActivitiesControllerTests
{
    [Fact]
    public async Task Create_Valid_SavesDraftActivity()
    {
        var fx = new GroupActivityFixture();
        var dto = GroupActivityFixture.Body(await fx.Controller().Create(GroupActivityFixture.NewActivity(" Bowling "), default), 200);
        Assert.Equal("Bowling", dto.Title);
        Assert.Equal(ShiftStatus.Draft, dto.Status);
        var saved = await fx.Seed.GroupActivities.SingleAsync();
        Assert.Equal(fx.TenantId, saved.TenantId);
    }

    [Theory]
    [InlineData("", 9, 13, "GA_TITLE")]
    [InlineData("Bowling", 13, 9, "GA_TIMES")]
    public async Task Create_Invalid_RefusesAndSavesNothing(string title, int start, int end, string code)
    {
        var fx = new GroupActivityFixture();
        Assert.Equal(code, GroupActivityFixture.Error(await fx.Controller().Create(GroupActivityFixture.NewActivity(title, start, end), default), 400));
        Assert.Empty(fx.Seed.GroupActivities);
    }

    [Fact]
    public async Task FlagOff_EveryWrite_409()
    {
        var fx = new GroupActivityFixture(enabled: false);
        var a = fx.AddActivity();
        var c = fx.Controller();
        Assert.Equal("GA_DISABLED", GroupActivityFixture.Error(await c.Create(GroupActivityFixture.NewActivity(), default), 409));
        Assert.Equal("GA_DISABLED", GroupActivityFixture.Error(await c.Cancel(a.Id, default), 409));
        Assert.Equal("GA_DISABLED", GroupActivityFixture.Error(await c.AddStaff(a.Id, new AddGroupStaffDto { StaffId = Guid.NewGuid() }, default), 409));
        Assert.Equal(1, await fx.Seed.GroupActivities.CountAsync());
        Assert.Empty(fx.Seed.GroupActivityStaff);
    }

    [Fact]
    public async Task NoTenant_AsSuperAdmin_AsksToChooseAnOrganisation()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var c = fx.Controller(superAdminNoTenant: true, role: "SuperAdmin");
        Assert.Equal("GA_CHOOSE_ORG", GroupActivityFixture.Error(await c.Create(GroupActivityFixture.NewActivity(), default), 400));
        Assert.Equal("GA_CHOOSE_ORG", GroupActivityFixture.Error(await c.Cancel(a.Id, default), 400));
        Assert.Equal(ShiftStatus.Draft, (await fx.Seed.GroupActivities.SingleAsync()).Status);
    }

    [Fact]
    public async Task FromShift_MovesTheWorkerToAStaffRow_AndAttachesBothTwoToOneShifts()
    {
        var fx = new GroupActivityFixture();
        var p = fx.AddParticipant();
        var worker = fx.AddUser();
        var one = fx.AddShift(p, SupportRatio.TwoToOne, worker.Id);
        var two = fx.AddShift(p, SupportRatio.TwoToOne);
        var dto = GroupActivityFixture.Body(await fx.Controller().FromShift(one.Id, new ConvertShiftDto(), default), 200);
        Assert.Equal("Group activity", dto.Title);
        Assert.Single(dto.Participants);
        Assert.Equal(2, dto.Participants[0].ShiftIds.Count);
        Assert.Equal(worker.Id, Assert.Single(dto.Staff).StaffId);
        var shifts = await fx.Seed.Shifts.AsNoTracking().ToListAsync();
        Assert.All(shifts, s => { Assert.Equal(dto.Id, s.GroupActivityId); Assert.Null(s.UserId); });
        Assert.Equal(2, dto.StaffNeeded);
        Assert.Equal(1, dto.StaffAssigned);
    }

    [Fact]
    public async Task AttachShifts_OnAnotherDay_RefusesAndSavesNothing()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant(), day: GroupActivityFixture.Day.AddDays(1));
        Assert.Equal("GA_SHIFT_OTHER_DAY", GroupActivityFixture.Error(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 400));
        Assert.Null((await fx.Seed.Shifts.AsNoTracking().SingleAsync()).GroupActivityId);
    }

    [Fact]
    public async Task AttachShifts_AlreadyInAnotherActivity_409()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var b = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant());
        GroupActivityFixture.Body(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 200);
        Assert.Equal("GA_SHIFT_IN_OTHER", GroupActivityFixture.Error(await fx.Controller().AttachShifts(b.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 409));
    }

    [Fact]
    public async Task AttachShifts_TakesTheActivityTimes()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant(), startHour: 10, endHour: 11);
        GroupActivityFixture.Body(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 200);
        var saved = await fx.Seed.Shifts.AsNoTracking().SingleAsync();
        Assert.Equal(new TimeOnly(9, 0), saved.StartTime);
        Assert.Equal(new TimeOnly(13, 0), saved.EndTime);
    }

    [Fact]
    public async Task AddParticipant_TwoToOne_CreatesTwoShiftsAndCountsOnePerson()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity(ShiftStatus.Published);
        var p = fx.AddParticipant();
        var dto = GroupActivityFixture.Body(await fx.Controller().AddParticipant(a.Id, new AddGroupParticipantDto { ParticipantId = p.Id, Ratio = SupportRatio.TwoToOne }, default), 200);
        Assert.Single(dto.Participants);
        var shifts = await fx.Seed.Shifts.AsNoTracking().ToListAsync();
        Assert.Equal(2, shifts.Count);
        Assert.All(shifts, s => { Assert.Equal(ShiftStatus.Published, s.Status); Assert.Null(s.UserId); Assert.Null(s.ShiftPatternId); });
        Assert.Equal(2, dto.StaffNeeded);
    }

    [Fact]
    public async Task AddParticipant_Twice_409_AndArchived_400()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var p = fx.AddParticipant();
        var c = () => fx.Controller();
        GroupActivityFixture.Body(await c().AddParticipant(a.Id, new AddGroupParticipantDto { ParticipantId = p.Id, Ratio = SupportRatio.OneToTwo }, default), 200);
        Assert.Equal("GA_PARTICIPANT_IN", GroupActivityFixture.Error(await c().AddParticipant(a.Id, new AddGroupParticipantDto { ParticipantId = p.Id, Ratio = SupportRatio.OneToTwo }, default), 409));
        var archived = fx.AddParticipant("Old", active: false);
        Assert.Equal("GA_PARTICIPANT_ARCHIVED", GroupActivityFixture.Error(await c().AddParticipant(a.Id, new AddGroupParticipantDto { ParticipantId = archived.Id, Ratio = SupportRatio.OneToOne }, default), 400));
        Assert.Equal(1, await fx.Seed.Shifts.CountAsync());
    }

    [Fact]
    public async Task SetRatio_ToOrFromTwoToOne_Refused_OtherChangesSave()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var p = fx.AddParticipant();
        GroupActivityFixture.Body(await fx.Controller().AddParticipant(a.Id, new AddGroupParticipantDto { ParticipantId = p.Id, Ratio = SupportRatio.OneToTwo }, default), 200);
        Assert.Equal("GA_RATIO_TWO_TO_ONE", GroupActivityFixture.Error(await fx.Controller().SetRatio(a.Id, p.Id, new SetGroupRatioDto { Ratio = SupportRatio.TwoToOne }, default), 400));
        GroupActivityFixture.Body(await fx.Controller().SetRatio(a.Id, p.Id, new SetGroupRatioDto { Ratio = SupportRatio.OneToThree }, default), 200);
        Assert.Equal(SupportRatio.OneToThree, (await fx.Seed.Shifts.AsNoTracking().SingleAsync()).Ratio);
    }

    [Fact]
    public async Task AddStaff_Saves_ThenDuplicateIs409_AndOtherTenantUserIs400()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var worker = fx.AddUser();
        var foreign = fx.AddUser("Eve", tenantId: Guid.NewGuid());
        var dto = GroupActivityFixture.Body(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = worker.Id, Role = " Driver " }, default), 200);
        Assert.Equal("Driver", Assert.Single(dto.Staff).Role);
        Assert.Equal("GA_STAFF_IN", GroupActivityFixture.Error(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = worker.Id }, default), 409));
        Assert.Equal("GA_STAFF_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = foreign.Id }, default), 400));
        Assert.Equal(1, await fx.Seed.GroupActivityStaff.CountAsync());
    }

    private static UpdateGroupActivityDto Put(GroupActivity a, ShiftStatus status) => new()
    {
        ServiceDate = a.ServiceDate, StartTime = a.StartTime, EndTime = a.EndTime, Title = a.Title, Status = status,
    };

    [Fact]
    public async Task Update_DraftToPublished_PublishesAttachedDraftShifts_ButNotCancelledOnes_AndBackToDraftLeavesThem()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var draft = fx.AddShift(fx.AddParticipant());
        var cancelled = fx.AddShift(fx.AddParticipant("Quinn"), status: ShiftStatus.Cancelled);
        draft.GroupActivityId = cancelled.GroupActivityId = a.Id;
        await fx.Seed.SaveChangesAsync();

        GroupActivityFixture.Body(await fx.Controller().Update(a.Id, Put(a, ShiftStatus.Published), default), 200);
        var shifts = await fx.Seed.Shifts.AsNoTracking().ToDictionaryAsync(s => s.Id);
        Assert.Equal(ShiftStatus.Published, shifts[draft.Id].Status);
        Assert.Equal(ShiftStatus.Cancelled, shifts[cancelled.Id].Status);

        GroupActivityFixture.Body(await fx.Controller().Update(a.Id, Put(a, ShiftStatus.Draft), default), 200);
        Assert.Equal(ShiftStatus.Draft, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).Status);
        Assert.Equal(ShiftStatus.Published, (await fx.Seed.Shifts.AsNoTracking().SingleAsync(s => s.Id == draft.Id)).Status);
    }

    [Fact]
    public async Task Get_IgnoresCancelledAttachedShifts_ForParticipantsAndStaffNeeded()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var live = fx.AddShift(fx.AddParticipant());
        var cancelled = fx.AddShift(fx.AddParticipant("Quinn"), status: ShiftStatus.Cancelled);
        live.GroupActivityId = cancelled.GroupActivityId = a.Id;
        await fx.Seed.SaveChangesAsync();
        var dto = GroupActivityFixture.Body(await fx.Controller().Get(a.Id, default), 200);
        Assert.Single(dto.Participants);
        Assert.Equal(1, dto.StaffNeeded);
    }

    [Fact]
    public async Task AddStaff_OneTimeWithoutTheOther_400()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var worker = fx.AddUser();
        Assert.Equal("GA_STAFF_TIMES", GroupActivityFixture.Error(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = worker.Id, StartTime = new TimeOnly(9, 0) }, default), 400));
        Assert.Empty(fx.Seed.GroupActivityStaff);
    }

    [Fact]
    public async Task RemoveStaff_DeletesTheRow()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var dto = GroupActivityFixture.Body(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = fx.AddUser().Id }, default), 200);
        GroupActivityFixture.Body(await fx.Controller().RemoveStaff(a.Id, dto.Staff[0].Id, default), 200);
        Assert.Empty(fx.Seed.GroupActivityStaff);
    }

    [Fact]
    public async Task RemoveStaff_RowGoneBetweenLoadAndSave_404_NotAConcurrency500()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var other = fx.AddUser("Olly");
        var dto = GroupActivityFixture.Body(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = fx.AddUser().Id }, default), 200);
        GroupActivityFixture.Body(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = other.Id }, default), 200);
        var rowId = dto.Staff.Single(r => r.StaffId != other.Id).Id;
        // The second coordinator loaded the row, then the first removed it before the second one saved.
        var db = fx.Fresh();
        var removed = false;
        db.ChangeTracker.Tracked += (_, e) =>
        {
            if (removed || e.Entry.Entity is not GroupActivityStaff row || row.Id != rowId) return;
            removed = true;
            fx.Seed.GroupActivityStaff.Remove(fx.Seed.GroupActivityStaff.Single(r => r.Id == rowId));
            fx.Seed.SaveChanges();
        };
        Assert.Equal("GA_STAFF_ROW_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller(db).RemoveStaff(a.Id, rowId, default), 404));
        Assert.Equal(1, await fx.Seed.GroupActivityStaff.CountAsync());
    }

    [Fact]
    public async Task Cancel_DetachesShifts_KeepsStaffRows_AndIsIdempotent()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant());
        GroupActivityFixture.Body(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 200);
        GroupActivityFixture.Body(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = fx.AddUser().Id }, default), 200);
        var dto = GroupActivityFixture.Body(await fx.Controller().Cancel(a.Id, default), 200);
        Assert.Equal(ShiftStatus.Cancelled, dto.Status);
        Assert.Null((await fx.Seed.Shifts.AsNoTracking().SingleAsync()).GroupActivityId);
        Assert.Equal(1, await fx.Seed.GroupActivityStaff.CountAsync());
        Assert.NotNull((await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).CancelledAt);
        GroupActivityFixture.Body(await fx.Controller().Cancel(a.Id, default), 200);
        Assert.Equal("GA_CANCELLED", GroupActivityFixture.Error(await fx.Controller().AddStaff(a.Id, new AddGroupStaffDto { StaffId = fx.AddUser("Bob").Id }, default), 409));
    }

    [Fact]
    public async Task Update_MovingDayWithParticipants_400_ButTimesCopyToShifts()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant());
        GroupActivityFixture.Body(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 200);
        var update = new UpdateGroupActivityDto
        {
            ServiceDate = GroupActivityFixture.Day.AddDays(1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.Draft,
        };
        Assert.Equal("GA_MOVE_DAY", GroupActivityFixture.Error(await fx.Controller().Update(a.Id, update, default), 400));
        update = new UpdateGroupActivityDto { ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Title = "Bowling", Status = ShiftStatus.Draft };
        GroupActivityFixture.Body(await fx.Controller().Update(a.Id, update, default), 200);
        Assert.Equal(new TimeOnly(15, 0), (await fx.Seed.Shifts.AsNoTracking().SingleAsync()).EndTime);
    }

    [Fact]
    public async Task Update_StatusOtherThanDraftOrPublished_400()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var update = new UpdateGroupActivityDto { ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.Completed };
        Assert.Equal("GA_STATUS", GroupActivityFixture.Error(await fx.Controller().Update(a.Id, update, default), 400));
    }

    [Fact]
    public async Task DetachShift_ClearsTheLink()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant());
        GroupActivityFixture.Body(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [shift.Id] }, default), 200);
        GroupActivityFixture.Body(await fx.Controller().DetachShift(a.Id, shift.Id, default), 200);
        Assert.Null((await fx.Seed.Shifts.AsNoTracking().SingleAsync()).GroupActivityId);
    }

    [Fact]
    public async Task Get_Unknown_404()
    {
        var fx = new GroupActivityFixture();
        Assert.Equal("GA_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller().Get(Guid.NewGuid(), default), 404));
    }

    [Fact]
    public void Controller_IsGatedLikeTheRosterBoard()
    {
        var attr = typeof(GroupActivitiesController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();
        Assert.Equal("SuperAdmin,Admin,Coordinator", attr.Roles);
    }

    [Fact]
    public void Attendance_IsCoordinatorOnly_NoSupportWorker_NoPerMethodOverride()
    {
        var method = typeof(GroupActivitiesController).GetMethod(nameof(GroupActivitiesController.SetAttendance))!;
        Assert.Empty(method.GetCustomAttributes(typeof(AuthorizeAttribute), false));
        Assert.Empty(method.GetCustomAttributes(typeof(AllowAnonymousAttribute), false));
        Assert.Equal("POST", method.GetCustomAttributes(typeof(HttpPostAttribute), false).Cast<HttpPostAttribute>().Single().HttpMethods.Single());
        Assert.DoesNotContain("SupportWorker", typeof(GroupActivitiesController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single().Roles);
    }
}

public class GroupActivityTenantTests
{
    [Fact]
    public async Task ActivityOfAnotherOrganisation_IsNotFound_ForReadAndEveryWrite_AndNothingChanges()
    {
        var fx = new GroupActivityFixture();
        var other = new GroupActivity { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Theirs" };
        fx.Seed.GroupActivities.Add(other);
        fx.Seed.SaveChanges();
        var worker = fx.AddUser();
        Assert.Equal("GA_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller().Get(other.Id, default), 404));
        Assert.Equal("GA_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller().Cancel(other.Id, default), 404));
        Assert.Equal("GA_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller().AddStaff(other.Id, new AddGroupStaffDto { StaffId = worker.Id }, default), 404));
        Assert.Equal(ShiftStatus.Draft, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).Status);
        Assert.Empty(fx.Seed.GroupActivityStaff);
    }

    [Fact]
    public async Task SuperAdminViewingAsAnOrganisation_CannotTouchAnotherOrganisationsActivity()
    {
        var fx = new GroupActivityFixture();
        var other = new GroupActivity { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Theirs" };
        fx.Seed.GroupActivities.Add(other);
        fx.Seed.SaveChanges();
        var db = TestDb.Create(fx.DbName, viewingAs: fx.TenantId);
        Assert.Equal("GA_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller(db, role: "SuperAdmin").Cancel(other.Id, default), 404));
        Assert.Equal(ShiftStatus.Draft, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).Status);
    }

    [Fact]
    public async Task AttachingAnotherOrganisationsShift_IsNotFound()
    {
        var fx = new GroupActivityFixture();
        var a = fx.AddActivity();
        var foreignShift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), ServiceDate = GroupActivityFixture.Day, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(12, 0),
        };
        fx.Seed.Shifts.Add(foreignShift);
        fx.Seed.SaveChanges();
        Assert.Equal("GA_SHIFT_NOT_FOUND", GroupActivityFixture.Error(await fx.Controller().AttachShifts(a.Id, new AttachShiftsDto { ShiftIds = [foreignShift.Id] }, default), 404));
        Assert.Null((await fx.Seed.Shifts.AsNoTracking().SingleAsync()).GroupActivityId);
    }
}
