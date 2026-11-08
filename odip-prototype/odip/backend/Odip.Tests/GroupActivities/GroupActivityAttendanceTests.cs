using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>GA attendance E13: a coordinator marks a participant as didn't attend while the activity is InProgress (the attached shifts are cancelled under the existing cancel rule) and can undo it until the last approval.</summary>
public class GroupActivityAttendanceTests
{
    private sealed class Rig
    {
        public GroupActivityFixture Fx { get; }
        public User Coordinator { get; }
        public GroupActivity Activity { get; }

        public Rig(ShiftStatus status = ShiftStatus.InProgress, bool enabled = true)
        {
            Fx = new GroupActivityFixture(enabled);
            Coordinator = Fx.AddUser("Cora");
            Activity = Fx.AddActivity(status, DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1));
        }

        /// <summary>A participant with one attached shift (two for 2:1), Published unless told otherwise.</summary>
        public (Participant Person, List<Shift> Shifts) Person(string first = "Pat", SupportRatio ratio = SupportRatio.OneToOne, ShiftStatus status = ShiftStatus.Published)
        {
            var person = Fx.AddParticipant(first);
            var shifts = new List<Shift>();
            for (var i = 0; i < (ratio == SupportRatio.TwoToOne ? 2 : 1); i++)
            {
                var s = Fx.AddShift(person, ratio, day: Activity.ServiceDate, status: status);
                var tracked = Fx.Seed.Shifts.Single(x => x.Id == s.Id);
                tracked.GroupActivityId = Activity.Id;
                Fx.Seed.SaveChanges();
                shifts.Add(tracked);
            }
            return (person, shifts);
        }

        /// <summary>A finished worker row, not yet approved.</summary>
        public GroupActivityStaff Row()
        {
            var worker = Fx.AddUser("Wendy" + Guid.NewGuid().ToString("N")[..4]);
            var end = DateTime.UtcNow.AddHours(-1);
            var row = new GroupActivityStaff
            {
                Id = Guid.NewGuid(), TenantId = Fx.TenantId, GroupActivityId = Activity.Id, UserId = worker.Id, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0),
                ActualStart = end - TimeSpan.FromHours(4), ActualEnd = end, StartedAt = end - TimeSpan.FromHours(4), SubmittedAt = end, TimeZoneId = "Australia/Sydney",
            };
            Fx.Seed.GroupActivityStaff.Add(row);
            Fx.Seed.SaveChanges();
            return row;
        }

        public GroupActivitiesController Controller() => Fx.Controller(userId: Coordinator.Id);
        public Task<ActionResult<ApiResponse<GroupActivityDto>>> Mark(Guid personId, bool attended, Guid? activityId = null) =>
            Controller().SetAttendance(activityId ?? Activity.Id, personId, new SetAttendanceDto { Attended = attended }, default);
        public Task<ActionResult<ApiResponse<List<GroupStaffApproveResultDto>>>> Approve(params Guid[] rowIds) => Controller().ApproveStaffRows(new GroupStaffApproveDto { RowIds = rowIds.ToList() }, default);
        public Task<Shift> Saved(Guid shiftId) => Fx.Fresh().Shifts.AsNoTracking().SingleAsync(s => s.Id == shiftId);
        public Task<ShiftStatus> ActivityStatus() => Fx.Fresh().GroupActivities.AsNoTracking().Where(a => a.Id == Activity.Id).Select(a => a.Status).SingleAsync();
    }

    [Fact]
    public async Task DidNotAttend_SetsCancelledAtNow_AndIsIdempotent()
    {
        var rig = new Rig();
        var (person, shifts) = rig.Person();
        var before = DateTime.UtcNow.AddSeconds(-1);
        var dto = GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);
        var saved = await rig.Saved(shifts[0].Id);
        Assert.Equal(ShiftStatus.Cancelled, saved.Status);
        Assert.InRange(saved.CancelledAt!.Value, before, DateTime.UtcNow.AddSeconds(1));
        Assert.True(dto.Participants.Single().DidNotAttend);

        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);
        var again = await rig.Saved(shifts[0].Id);
        Assert.Equal((saved.CancelledAt, saved.UpdatedAt), (again.CancelledAt, again.UpdatedAt));
    }

    [Fact]
    public async Task DidNotAttend_TwoToOne_CancelsBothSiblings()
    {
        var rig = new Rig();
        var (person, shifts) = rig.Person(ratio: SupportRatio.TwoToOne);
        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);
        foreach (var s in shifts)
        {
            var saved = await rig.Saved(s.Id);
            Assert.Equal(ShiftStatus.Cancelled, saved.Status);
            Assert.NotNull(saved.CancelledAt);
        }
    }

    [Fact]
    public async Task Undo_RestoresPublished_ThenLastApprovalCompletesIt()
    {
        var rig = new Rig();
        var (person, shifts) = rig.Person();
        var row = rig.Row();
        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);
        GroupActivityFixture.Body(await rig.Mark(person.Id, true), 200);
        var restored = await rig.Saved(shifts[0].Id);
        Assert.Equal(ShiftStatus.Published, restored.Status);
        Assert.Null(restored.CancelledAt);

        GroupActivityFixture.Body(await rig.Approve(row.Id), 200);
        Assert.Equal(ShiftStatus.Completed, (await rig.Saved(shifts[0].Id)).Status);
        Assert.Equal(ShiftStatus.Completed, await rig.ActivityStatus());
        Assert.Equal(ReviewOutcome.Approved, (await rig.Fx.Fresh().ShiftCompletions.AsNoTracking().SingleAsync(c => c.ShiftId == shifts[0].Id)).ReviewOutcome);
    }

    [Fact]
    public async Task DidNotAttend_ThenLastApproval_LeavesItCancelled_WithNoCompletion()
    {
        var rig = new Rig();
        var (gone, goneShifts) = rig.Person("Gone");
        var (_, hereShifts) = rig.Person("Here");
        var row = rig.Row();
        GroupActivityFixture.Body(await rig.Mark(gone.Id, false), 200);
        GroupActivityFixture.Body(await rig.Approve(row.Id), 200);
        Assert.Equal(ShiftStatus.Cancelled, (await rig.Saved(goneShifts[0].Id)).Status);
        Assert.Empty(await rig.Fx.Fresh().ShiftCompletions.AsNoTracking().Where(c => c.ShiftId == goneShifts[0].Id).ToListAsync());
        Assert.Equal(ShiftStatus.Completed, (await rig.Saved(hereShifts[0].Id)).Status);
    }

    [Fact]
    public async Task AfterLastApproval_UndoAndMark_Refused_AndNothingChanges()
    {
        var rig = new Rig();
        var (gone, goneShifts) = rig.Person("Gone");
        var (here, hereShifts) = rig.Person("Here");
        var row = rig.Row();
        GroupActivityFixture.Body(await rig.Mark(gone.Id, false), 200);
        GroupActivityFixture.Body(await rig.Approve(row.Id), 200);

        Assert.Equal("GA_ATTENDANCE_CLOSED", GroupActivityFixture.Error(await rig.Mark(gone.Id, true), 409));
        Assert.Equal("GA_ATTENDANCE_CLOSED", GroupActivityFixture.Error(await rig.Mark(here.Id, false), 409));
        Assert.Equal(ShiftStatus.Cancelled, (await rig.Saved(goneShifts[0].Id)).Status);
        Assert.Equal(ShiftStatus.Completed, (await rig.Saved(hereShifts[0].Id)).Status);
    }

    [Fact]
    public async Task DidNotAttend_OnACompletedShiftOfAnInProgressActivity_Refused()
    {
        var rig = new Rig();
        var (person, shifts) = rig.Person(status: ShiftStatus.Completed);
        Assert.Equal("GA_ATTENDANCE_CLOSED", GroupActivityFixture.Error(await rig.Mark(person.Id, false), 409));
        Assert.Equal(ShiftStatus.Completed, (await rig.Saved(shifts[0].Id)).Status);
    }

    [Fact]
    public async Task DidNotAttend_OnADraftAttachedShift_IsShiftLocked()
    {
        var rig = new Rig();
        var (person, shifts) = rig.Person(status: ShiftStatus.Draft);
        Assert.Equal("GA_SHIFT_LOCKED", GroupActivityFixture.Error(await rig.Mark(person.Id, false), 409));
        Assert.Equal(ShiftStatus.Draft, (await rig.Saved(shifts[0].Id)).Status);
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Published)]
    public async Task Mark_BeforeTheActivityStarts_Refused(ShiftStatus status)
    {
        var rig = new Rig(status);
        var (person, shifts) = rig.Person();
        Assert.Equal("GA_NOT_STARTED", GroupActivityFixture.Error(await rig.Mark(person.Id, false), 409));
        Assert.Equal(ShiftStatus.Published, (await rig.Saved(shifts[0].Id)).Status);
    }

    [Fact]
    public async Task Mark_CancelledActivity_Refused()
    {
        var rig = new Rig(ShiftStatus.Cancelled);
        var (person, _) = rig.Person();
        Assert.Equal("GA_CANCELLED", GroupActivityFixture.Error(await rig.Mark(person.Id, false), 409));
    }

    [Fact]
    public async Task Mark_OtherTenantsActivity_NotFound_AndAParticipantNotInTheActivity_NotFound()
    {
        var rig = new Rig();
        var (person, shifts) = rig.Person();
        var other = new GroupActivity { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ServiceDate = rig.Activity.ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Theirs", Status = ShiftStatus.InProgress };
        rig.Fx.Seed.GroupActivities.Add(other);
        rig.Fx.Seed.SaveChanges();
        Assert.Equal("GA_NOT_FOUND", GroupActivityFixture.Error(await rig.Mark(person.Id, false, other.Id), 404));
        Assert.Equal("GA_SHIFT_NOT_FOUND", GroupActivityFixture.Error(await rig.Mark(Guid.NewGuid(), false), 404));
        Assert.Equal(ShiftStatus.Published, (await rig.Saved(shifts[0].Id)).Status);
    }

    [Fact]
    public async Task Mark_FlagOff_Refused()
    {
        var rig = new Rig(enabled: false);
        var (person, shifts) = rig.Person();
        Assert.Equal("GA_DISABLED", GroupActivityFixture.Error(await rig.Mark(person.Id, false), 409));
        Assert.Equal(ShiftStatus.Published, (await rig.Saved(shifts[0].Id)).Status);
    }

    [Fact]
    public async Task Reader_StartedActivity_ListsDidNotAttend_AndStaffNeededIgnoresThem()
    {
        var rig = new Rig();
        var (gone, _) = rig.Person("Ann");
        rig.Person("Bea");
        var before = GroupActivityFixture.Body(await rig.Controller().Get(rig.Activity.Id, default), 200);
        var after = GroupActivityFixture.Body(await rig.Mark(gone.Id, false), 200);
        Assert.Equal(2, before.StaffNeeded);
        Assert.Equal(before.StaffNeeded, after.StaffNeeded);
        Assert.Equal(2, after.Participants.Count);
        Assert.Equal([true, false], after.Participants.Select(p => p.DidNotAttend));
    }

    [Fact]
    public async Task Reader_PublishedActivity_StillHidesACancelledShift()
    {
        var rig = new Rig(ShiftStatus.Published);
        rig.Person("Ann");
        rig.Person("Bea", status: ShiftStatus.Cancelled);
        var dto = GroupActivityFixture.Body(await rig.Controller().Get(rig.Activity.Id, default), 200);
        Assert.Equal("Ann Test", Assert.Single(dto.Participants).ParticipantName);
    }

    [Fact]
    public async Task StaffReviews_CountsParticipantsWhoDidNotAttend()
    {
        var rig = new Rig();
        var (gone, _) = rig.Person("Ann");
        rig.Person("Bea");
        rig.Person("Cy", ratio: SupportRatio.TwoToOne);
        rig.Row();
        GroupActivityFixture.Body(await rig.Mark(gone.Id, false), 200);
        var row = Assert.Single(GroupActivityFixture.Body(await rig.Controller().StaffReviews(null, null, default), 200).Rows);
        Assert.Equal(1, row.DidNotAttendCount);
    }
}
