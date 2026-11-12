using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>GAP-N2: <c>RefusalFor</c> indexes the refusal table, so a code with no entry would be a 500. A new code that reaches it without a table entry fails here instead.</summary>
public class GroupActivityRefusalCodeTests
{
    // Producers: GroupActivitiesController.ApplyAttendanceAsync (:517) returns GA_SHIFT_NOT_FOUND, AttendanceWindowCode, GA_ATTENDANCE_CLOSED, GA_SHIFT_LOCKED and
    // ShiftClaimLocked; PortalActivityShiftsController.RefuseAttendance (:91) passes those on (GA_SHIFT_NOT_FOUND remapped to GA_PARTICIPANT_NOT_FOUND) and is called
    // with the literal GA_ATTENDANCE_CLOSED (:87).
    private static IEnumerable<string> CodesTheCallersCanPass() =>
        new[] { "GA_PARTICIPANT_NOT_FOUND", "GA_ATTENDANCE_CLOSED", "GA_SHIFT_LOCKED", ShiftErrorCodes.ShiftClaimLocked,
            "GA_SERIES_INTERVAL", "GA_SERIES_END", "GA_SERIES_RANGE", "GA_SERIES_SCOPE", "GA_SERIES_DATE" }
            .Concat(Enum.GetValues<ShiftStatus>().Select(s => GroupActivitiesController.AttendanceWindowCode(new GroupActivity { Status = s })).OfType<string>());

    [Fact]
    public void Every_code_the_attendance_callers_can_pass_has_a_refusal_entry()
    {
        foreach (var code in CodesTheCallersCanPass().Distinct())
        {
            var (status, message) = GroupActivitiesController.RefusalFor(code);   // throws KeyNotFoundException for a missing entry
            Assert.InRange(status, 400, 499);
            Assert.False(string.IsNullOrWhiteSpace(message));
        }
    }
}
