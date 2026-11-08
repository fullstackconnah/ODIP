using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>GA PR3 pay adapter: an approved staff row becomes a transient shift, completion and break for the unchanged timesheet builder.</summary>
public class GroupActivityWorkPayTests
{
    private static readonly EmploymentHeroTimesheets.TimesheetMapping Mapped = new("7", "8", "9", "10");
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");

    private static (GroupActivity A, GroupActivityStaff R) Row(bool actuals = true, bool withBreak = false)
    {
        var a = new GroupActivity { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), ServiceDate = new DateOnly(2026, 11, 2) };
        var r = new GroupActivityStaff
        {
            Id = Guid.NewGuid(), TenantId = a.TenantId, GroupActivityId = a.Id, UserId = Guid.NewGuid(),
            StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), TimeZoneId = "Australia/Sydney",
            ActualStart = actuals ? new DateTime(2026, 11, 1, 23, 0, 0, DateTimeKind.Utc) : null,   // 10:00 Sydney (AEDT, +11)
            ActualEnd = actuals ? new DateTime(2026, 11, 2, 3, 0, 0, DateTimeKind.Utc) : null,
            BreakStartedAt = withBreak ? new DateTime(2026, 11, 2, 1, 0, 0, DateTimeKind.Utc) : null,
            BreakEndedAt = withBreak ? new DateTime(2026, 11, 2, 1, 30, 0, DateTimeKind.Utc) : null,
            ReviewOutcome = ReviewOutcome.Approved,
        };
        return (a, r);
    }

    [Fact]
    public void ForStaffRow_without_actual_times_is_null_not_a_throw()
    {
        var (a, r) = Row(actuals: false);
        Assert.Null(EmploymentHeroTimesheets.ForStaffRow(a, r));
    }

    [Fact]
    public void ForStaffRow_builds_a_standard_line_whose_external_id_is_the_row_id()
    {
        var (a, r) = Row(withBreak: true);
        var (s, c, breaks) = EmploymentHeroTimesheets.ForStaffRow(a, r)!.Value;
        var built = EmploymentHeroTimesheets.Build(s, c, breaks, "42", Mapped, Sydney);
        Assert.Null(built.WaitReason);
        Assert.Equal("2026-11-02T10:00:00", built.Line!.StartTime);
        Assert.Equal("2026-11-02T14:00:00", built.Line.EndTime);
        Assert.Equal(7, built.Line.WorkTypeId);
        Assert.Equal(r.Id.ToString(), built.Line.ExternalId);
        Assert.Single(built.Line.Breaks);
    }

    [Fact]
    public void Enqueue_kind_is_the_group_staff_kind_with_the_row_id()
    {
        var row = EmploymentHeroTimesheets.NewRow(Guid.NewGuid(), Guid.NewGuid(), DateTime.UtcNow, EmploymentHeroOutboxKind.GroupStaffTimesheet);
        Assert.Equal(EmploymentHeroOutboxKind.GroupStaffTimesheet, row.Kind);
        Assert.Equal(3, (int)row.Kind);
    }
}
