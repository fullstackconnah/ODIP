using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>GA PR3 C1-C3: the coordinator reviews finished rows, approves them in a batch, and records times for a row that needs it. A refusal saves nothing.</summary>
public class GroupActivityReviewTests
{
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private sealed class Rig
    {
        public GroupActivityFixture Fx { get; } = new();
        public User Coordinator { get; }
        public Guid CoordinatorId => Coordinator.Id;

        public Rig() => Coordinator = Fx.AddUser("Cora");

        public GroupActivity Activity(ShiftStatus status = ShiftStatus.InProgress, int daysAgo = 1)
        {
            var a = Fx.AddActivity(status, Today.AddDays(-daysAgo));
            return a;
        }

        /// <summary>A worker row, finished (4 hours ending an hour ago) unless told otherwise.</summary>
        public GroupActivityStaff Row(GroupActivity a, bool finished = true, ReviewOutcome? outcome = null, TimeSpan? span = null)
        {
            var worker = Fx.AddUser("Wendy" + Guid.NewGuid().ToString("N")[..4]);
            var end = DateTime.UtcNow.AddHours(-1);
            var row = new GroupActivityStaff
            {
                Id = Guid.NewGuid(), TenantId = Fx.TenantId, GroupActivityId = a.Id, UserId = worker.Id, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0),
                ActualStart = finished ? end - (span ?? TimeSpan.FromHours(4)) : null, ActualEnd = finished ? end : null,
                StartedAt = finished ? end - (span ?? TimeSpan.FromHours(4)) : null, SubmittedAt = finished ? end : null, ReviewOutcome = outcome,
                TimeZoneId = "Australia/Sydney",
            };
            Fx.Seed.GroupActivityStaff.Add(row);
            Fx.Seed.SaveChanges();
            return row;
        }

        public Shift Participant(GroupActivity a, ShiftStatus status = ShiftStatus.InProgress)
        {
            var s = Fx.AddShift(Fx.AddParticipant("Pat" + Guid.NewGuid().ToString("N")[..4]), day: a.ServiceDate, status: status);
            var tracked = Fx.Seed.Shifts.Single(x => x.Id == s.Id);
            tracked.GroupActivityId = a.Id;
            Fx.Seed.SaveChanges();
            return tracked;
        }

        public GroupActivitiesController Controller() => Fx.Controller(userId: CoordinatorId);
        public Task<GroupActivityStaff> SavedAsync(Guid rowId) => Fx.Fresh().GroupActivityStaff.AsNoTracking().SingleAsync(r => r.Id == rowId);
        public Task<ShiftStatus> ActivityStatusAsync(Guid id) => Fx.Fresh().GroupActivities.AsNoTracking().Where(a => a.Id == id).Select(a => a.Status).SingleAsync();
        public Task<ShiftStatus> ShiftStatusAsync(Guid id) => Fx.Fresh().Shifts.AsNoTracking().Where(s => s.Id == id).Select(s => s.Status).SingleAsync();
    }

    private static string? ErrorCode<T>(ActionResult<ApiResponse<T>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode);
        return ((dynamic)obj.Value!).Code;   // refusals carry an ApiResponse of the controller's own body type
    }

    private static GroupStaffApproveDto Ids(params Guid[] ids) => new() { RowIds = ids.ToList() };

    // ── C1 ──

    [Fact]
    public async Task Review_ListsEveryUnapprovedRowUpToToday_OldestFirst_Including30DayOldOnes()
    {
        var rig = new Rig();
        var old = rig.Row(rig.Activity(daysAgo: 30));
        var recent = rig.Row(rig.Activity(daysAgo: 1));
        var approved = rig.Row(rig.Activity(daysAgo: 2), outcome: ReviewOutcome.Approved);
        var future = rig.Row(rig.Activity(daysAgo: -3));
        var cancelled = rig.Row(rig.Activity(ShiftStatus.Cancelled));
        var draft = rig.Row(rig.Activity(ShiftStatus.Draft), finished: false);
        var notStarted = rig.Row(rig.Activity(ShiftStatus.Published, daysAgo: 0), finished: false);

        var list = GroupActivityFixture.Body(await rig.Controller().StaffReviews(null, null, default), 200);

        Assert.Equal(new[] { old.Id, recent.Id, notStarted.Id }, list.Rows.Select(r => r.RowId));
        Assert.Equal(3, list.Total);
        Assert.Equal("Finished", list.Rows[0].State);
        Assert.Equal("NotStarted", list.Rows[2].State);
        Assert.DoesNotContain(list.Rows, r => r.RowId == approved.Id || r.RowId == future.Id || r.RowId == cancelled.Id || r.RowId == draft.Id);
    }

    [Fact]
    public async Task Review_FromNarrowsTheList()
    {
        var rig = new Rig();
        rig.Row(rig.Activity(daysAgo: 30));
        var recent = rig.Row(rig.Activity(daysAgo: 1));
        var list = GroupActivityFixture.Body(await rig.Controller().StaffReviews(Today.AddDays(-5), null, default), 200);
        Assert.Equal(new[] { recent.Id }, list.Rows.Select(r => r.RowId));
    }

    [Fact]
    public async Task Review_CapsAt200_AndReportsTheTotal()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var worker = rig.Fx.AddUser();
        for (var i = 0; i < 205; i++)
            rig.Fx.Seed.GroupActivityStaff.Add(new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = rig.Fx.TenantId, GroupActivityId = a.Id, UserId = worker.Id, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(11, 0) });
        rig.Fx.Seed.SaveChanges();
        var list = GroupActivityFixture.Body(await rig.Controller().StaffReviews(null, null, default), 200);
        Assert.Equal(200, list.Rows.Count);
        Assert.Equal(205, list.Total);
    }

    [Fact]
    public async Task Review_FlagsOffRosterAndCountsNonCancelledParticipants()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a);   // ended an hour ago, nowhere near the 14:00 roster
        rig.Participant(a);
        rig.Participant(a, ShiftStatus.Cancelled);
        var dto = GroupActivityFixture.Body(await rig.Controller().StaffReviews(null, null, default), 200).Rows.Single(r => r.RowId == row.Id);
        Assert.True(dto.OffRoster);
        Assert.Equal(1, dto.ParticipantCount);
        Assert.False(dto.PayrollLinked);
    }

    [Fact]
    public async Task Review_UnscopedSuperAdmin_GetsAnEmptyList()
    {
        var rig = new Rig();
        rig.Row(rig.Activity());
        var list = GroupActivityFixture.Body(await rig.Fx.Controller(superAdminNoTenant: true).StaffReviews(null, null, default), 200);
        Assert.Empty(list.Rows);
        Assert.Equal(0, list.Total);
    }

    // ── C2 ──

    [Fact]
    public async Task Approve_LastRow_ApprovesCompletesTheParticipantShiftsAndTheActivity()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a);
        var shift = rig.Participant(a);

        var results = GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200);

        Assert.True(results.Single().Ok);
        var saved = await rig.SavedAsync(row.Id);
        Assert.Equal(ReviewOutcome.Approved, saved.ReviewOutcome);
        Assert.Equal(rig.CoordinatorId, saved.ReviewedByUserId);
        Assert.NotNull(saved.ReviewedAt);
        Assert.Equal(ShiftStatus.Completed, await rig.ActivityStatusAsync(a.Id));
        Assert.Equal(ShiftStatus.Completed, await rig.ShiftStatusAsync(shift.Id));
        var completion = await rig.Fx.Fresh().ShiftCompletions.AsNoTracking().SingleAsync(c => c.ShiftId == shift.Id);
        Assert.Equal(ReviewOutcome.Approved, completion.ReviewOutcome);
        Assert.Equal(rig.CoordinatorId, completion.SubmittedByUserId);
    }

    [Fact]
    public async Task Approve_OneOfTwoRows_LeavesTheActivityInProgress()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var first = rig.Row(a);
        rig.Row(a);
        var shift = rig.Participant(a);
        GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(first.Id), default), 200);
        Assert.Equal(ShiftStatus.InProgress, await rig.ActivityStatusAsync(a.Id));
        Assert.Equal(ShiftStatus.InProgress, await rig.ShiftStatusAsync(shift.Id));
    }

    [Fact]
    public async Task Approve_NotFinishedRow_ReportsItsCode_AndTheOthersStillApprove()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var open = rig.Row(a, finished: false);
        var done = rig.Row(a);

        var results = GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(open.Id, done.Id), default), 200);

        Assert.Equal("GA_STAFF_NOT_FINISHED", results[0].Code);
        Assert.False(results[0].Ok);
        Assert.True(results[1].Ok);
        Assert.Null((await rig.SavedAsync(open.Id)).ReviewOutcome);
        Assert.Equal(ReviewOutcome.Approved, (await rig.SavedAsync(done.Id)).ReviewOutcome);
        Assert.Equal(ShiftStatus.InProgress, await rig.ActivityStatusAsync(a.Id));
    }

    [Fact]
    public async Task Approve_SpanOver24h_RefusedUntilRecorded()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a, span: TimeSpan.FromHours(30));
        var results = GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200);
        Assert.Equal("GA_ACTUALS_LONG", results.Single().Code);
        Assert.Null((await rig.SavedAsync(row.Id)).ReviewOutcome);

        var fixedTimes = new SetGroupStaffActualsDto { ActualStart = DateTime.UtcNow.AddHours(-5), ActualEnd = DateTime.UtcNow.AddHours(-1), Reason = "Forgot to finish" };
        GroupActivityFixture.Body(await rig.Controller().SetStaffActuals(a.Id, row.Id, fixedTimes, default), 200);
        Assert.True(GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200).Single().Ok);
    }

    [Fact]
    public async Task Approve_AlreadyApproved_IsAReplayThatChangesNothing()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a);
        rig.Row(a);   // keeps the activity open
        GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200);
        var first = await rig.SavedAsync(row.Id);
        var again = GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200);
        Assert.True(again.Single().Ok);
        Assert.Equal(first.ReviewedAt, (await rig.SavedAsync(row.Id)).ReviewedAt);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(101)]
    public async Task Approve_BatchSizeOutOfRange_Refused(int count)
    {
        var rig = new Rig();
        var ids = Enumerable.Range(0, count).Select(_ => Guid.NewGuid()).ToList();
        Assert.Equal("GA_BATCH_SIZE", ErrorCode(await rig.Controller().ApproveStaffRows(new GroupStaffApproveDto { RowIds = ids }, default), 400));
    }

    [Fact]
    public async Task Approve_UnknownRow_ReportsNotFound_AndAnotherOrganisationsRowIsUnknownToo()
    {
        var rig = new Rig();
        var other = new Rig();
        var theirs = other.Row(other.Activity());
        var results = GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(Guid.NewGuid(), theirs.Id), default), 200);
        Assert.All(results, r => Assert.Equal("GA_STAFF_ROW_NOT_FOUND", r.Code));
        Assert.Null((await other.SavedAsync(theirs.Id)).ReviewOutcome);
    }

    [Fact]
    public async Task Approve_CancelledActivity_IsRefused()
    {
        var rig = new Rig();
        var a = rig.Activity(ShiftStatus.Cancelled);
        var row = rig.Row(a);
        Assert.Equal("GA_CANCELLED", GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200).Single().Code);
    }

    [Fact]
    public async Task Trigger_ParticipantShiftCancelledBeforeIt_StaysCancelled()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a);
        var live = rig.Participant(a);
        var gone = rig.Participant(a, ShiftStatus.Cancelled);
        GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200);
        Assert.Equal(ShiftStatus.Completed, await rig.ShiftStatusAsync(live.Id));
        Assert.Equal(ShiftStatus.Cancelled, await rig.ShiftStatusAsync(gone.Id));
        Assert.Empty(await rig.Fx.Fresh().ShiftCompletions.AsNoTracking().Where(c => c.ShiftId == gone.Id).ToListAsync());
    }

    [Fact]
    public async Task Approve_LastRow_CancelledParticipantShiftUntouched()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a);
        var live = rig.Participant(a);
        var gone = rig.Participant(a, ShiftStatus.Cancelled);
        var before = await rig.Fx.Fresh().Shifts.AsNoTracking().SingleAsync(s => s.Id == gone.Id);
        GroupActivityFixture.Body(await rig.Controller().ApproveStaffRows(Ids(row.Id), default), 200);
        Assert.Equal(ShiftStatus.Completed, await rig.ActivityStatusAsync(a.Id));
        var after = await rig.Fx.Fresh().Shifts.AsNoTracking().SingleAsync(s => s.Id == gone.Id);
        Assert.Equal((ShiftStatus.Cancelled, before.UpdatedAt, before.CancelledAt), (after.Status, after.UpdatedAt, after.CancelledAt));
        Assert.Empty(await rig.Fx.Fresh().ShiftCompletions.AsNoTracking().Where(c => c.ShiftId == gone.Id).ToListAsync());
        Assert.Single(await rig.Fx.Fresh().ShiftCompletions.AsNoTracking().Where(c => c.ShiftId == live.Id).ToListAsync());
    }

    [Fact]
    public async Task RemoveStaff_LastUnapprovedRow_CompletesTheActivity_AndAnApprovedRowCannotBeRemoved()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var approved = rig.Row(a, outcome: ReviewOutcome.Approved);
        var open = rig.Row(a, finished: false);
        var shift = rig.Participant(a);

        Assert.Equal("GA_STAFF_APPROVED", ErrorCode(await rig.Controller().RemoveStaff(a.Id, approved.Id, default), 409));
        Assert.NotNull(await rig.Fx.Fresh().GroupActivityStaff.FindAsync(approved.Id));

        GroupActivityFixture.Body(await rig.Controller().RemoveStaff(a.Id, open.Id, default), 200);
        Assert.Equal(ShiftStatus.Completed, await rig.ActivityStatusAsync(a.Id));
        Assert.Equal(ShiftStatus.Completed, await rig.ShiftStatusAsync(shift.Id));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RemoveStaff_StartedOrFinishedRow_409GaStaffStarted_RowAndTimesStay(bool finished)
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a, finished: true);
        if (!finished)
        {
            var tracked = rig.Fx.Seed.GroupActivityStaff.Single(r => r.Id == row.Id);
            tracked.SubmittedAt = null;
            tracked.ActualEnd = null;
            rig.Fx.Seed.SaveChanges();
        }
        var before = await rig.SavedAsync(row.Id);

        Assert.Equal("GA_STAFF_STARTED", ErrorCode(await rig.Controller().RemoveStaff(a.Id, row.Id, default), 409));

        var after = await rig.SavedAsync(row.Id);
        Assert.Equal(before.ActualStart, after.ActualStart);
        Assert.Equal(before.ActualEnd, after.ActualEnd);
        Assert.Equal(before.SubmittedAt, after.SubmittedAt);
        Assert.Equal(ShiftStatus.InProgress, await rig.ActivityStatusAsync(a.Id));
    }

    [Fact]
    public async Task Review_NotStartedRow_CarriesTheZoneTheServerWillStamp()
    {
        var rig = new Rig();
        rig.Fx.Seed.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = rig.Fx.TenantId, RegistrationNumber = "PR001", ABN = "12345678901", OrganisationName = "Test", Address = "1 Test St", State = "QLD", TimeZoneId = "Australia/Brisbane" });
        rig.Fx.Seed.SaveChanges();
        var a = rig.Activity(ShiftStatus.Published, daysAgo: 0);
        var row = rig.Row(a, finished: false);
        var tracked = rig.Fx.Seed.GroupActivityStaff.Single(r => r.Id == row.Id);
        tracked.TimeZoneId = null;
        rig.Fx.Seed.SaveChanges();

        var list = GroupActivityFixture.Body(await rig.Controller().StaffReviews(null, null, default), 200);

        Assert.Equal("Australia/Brisbane", list.Rows.Single(r => r.RowId == row.Id).TimeZoneId);
        var one = GroupActivityFixture.Body(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(), default), 200);
        Assert.Equal("Australia/Brisbane", one.TimeZoneId);
        Assert.Equal("Australia/Brisbane", (await rig.SavedAsync(row.Id)).TimeZoneId);
    }

    // ── C3 ──

    private SetGroupStaffActualsDto Times(double startHoursAgo = 5, double endHoursAgo = 1, string? reason = "Forgot to tap Finish") =>
        new() { ActualStart = DateTime.UtcNow.AddHours(-startHoursAgo), ActualEnd = DateTime.UtcNow.AddHours(-endHoursAgo), Reason = reason };

    [Fact]
    public async Task SetActuals_SavesTimesReasonAndWhoAdjusted_AndStartsAPublishedActivity()
    {
        var rig = new Rig();
        var a = rig.Activity(ShiftStatus.Published);
        var row = rig.Row(a, finished: false);
        var dto = GroupActivityFixture.Body(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(), default), 200);
        Assert.Equal("Finished", dto.State);
        var saved = await rig.SavedAsync(row.Id);
        Assert.NotNull(saved.ActualStart);
        Assert.NotNull(saved.ActualEnd);
        Assert.Equal("Forgot to tap Finish", saved.AdjustmentReason);
        Assert.Equal(rig.CoordinatorId, saved.AdjustedByUserId);
        Assert.NotNull(saved.SubmittedAt);
        Assert.Equal(ShiftStatus.InProgress, await rig.ActivityStatusAsync(a.Id));
    }

    [Theory]
    [InlineData(null, "GA_REASON")]
    [InlineData("   ", "GA_REASON")]
    public async Task SetActuals_BlankReason_RefusedAndNothingSaved(string? reason, string code)
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a, finished: false);
        Assert.Equal(code, ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(reason: reason), default), 400));
        Assert.Null((await rig.SavedAsync(row.Id)).ActualEnd);
    }

    [Fact]
    public async Task SetActuals_BadInputs_AreRefused()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var row = rig.Row(a, finished: false);
        Assert.Equal("GA_TOO_LONG", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(reason: new string('x', 501)), default), 400));
        Assert.Equal("GA_TIMES", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(startHoursAgo: 1, endHoursAgo: 2), default), 400));
        Assert.Equal("GA_ACTUALS_LONG", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(startHoursAgo: 30, endHoursAgo: 1), default), 409));
        Assert.Equal("GA_ACTUALS_FUTURE", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, Times(startHoursAgo: 1, endHoursAgo: -1), default), 400));
        var halfBreak = Times() with { BreakStart = DateTime.UtcNow.AddHours(-3) };
        Assert.Equal("GA_BREAK", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, halfBreak, default), 400));
        var outside = Times() with { BreakStart = DateTime.UtcNow.AddHours(-8), BreakEnd = DateTime.UtcNow.AddHours(-7) };
        Assert.Equal("GA_BREAK_RANGE", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, row.Id, outside, default), 400));
        Assert.Null((await rig.SavedAsync(row.Id)).ActualEnd);
    }

    [Fact]
    public async Task SetActuals_ApprovedRowCancelledOrDraftActivityOrOtherRow_Refused()
    {
        var rig = new Rig();
        var a = rig.Activity();
        var approved = rig.Row(a, outcome: ReviewOutcome.Approved);
        var before = await rig.SavedAsync(approved.Id);
        Assert.Equal("GA_STAFF_APPROVED", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, approved.Id, Times(), default), 409));
        Assert.Equal(before.ActualEnd, (await rig.SavedAsync(approved.Id)).ActualEnd);

        var cancelled = rig.Activity(ShiftStatus.Cancelled);
        Assert.Equal("GA_CANCELLED", ErrorCode(await rig.Controller().SetStaffActuals(cancelled.Id, rig.Row(cancelled).Id, Times(), default), 409));
        var draft = rig.Activity(ShiftStatus.Draft);
        Assert.Equal("GA_NOT_PUBLISHED", ErrorCode(await rig.Controller().SetStaffActuals(draft.Id, rig.Row(draft, finished: false).Id, Times(), default), 409));
        Assert.Equal("GA_STAFF_ROW_NOT_FOUND", ErrorCode(await rig.Controller().SetStaffActuals(a.Id, Guid.NewGuid(), Times(), default), 404));
    }
}
