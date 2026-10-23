using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>What goes to Employment Hero for one approved shift (wire format, breaks, work type, externalId, hash) and the five words the Payroll page prints.</summary>
public class EmploymentHeroTimesheetPayloadTests
{
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");
    private static readonly EmploymentHeroTimesheets.TimesheetMapping Mapped = new("7", "8", "9", "10");

    private static Shift AShift(SleepoverType night = SleepoverType.None) => new()
    {
        Id = Guid.NewGuid(), ServiceDate = new DateOnly(2026, 10, 14), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), NightType = night, Ratio = SupportRatio.OneToOne,
    };

    private static ShiftCompletion ACompletion(string zone = "Australia/Sydney") => new()
    {
        Id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), ActualStart = new DateTime(2026, 10, 13, 22, 4, 31, DateTimeKind.Utc), ActualEnd = new DateTime(2026, 10, 14, 4, 10, 59, DateTimeKind.Utc), TimeZoneId = zone,
    };

    private static ShiftBreak Break(DateTime from, double minutes) => new() { StartedAt = from, EndedAt = from.AddMinutes(minutes) };

    private static EhTimesheetLine Built(Shift s, ShiftCompletion c, IEnumerable<ShiftBreak>? breaks = null, string? payrollId = "42", EmploymentHeroTimesheets.TimesheetMapping? map = null)
    {
        var built = EmploymentHeroTimesheets.Build(s, c, breaks ?? [], payrollId, map ?? Mapped, Sydney);
        Assert.Null(built.WaitReason);
        return built.Line!;
    }

    [Fact]
    public void Breaks_are_sent_as_unpaid_intervals_clamped_to_the_worked_span()
    {
        var c = ACompletion();
        var breaks = new[]
        {
            Break(c.ActualStart.AddHours(2), 30),
            Break(c.ActualStart.AddMinutes(-5), 15),       // 5 minutes before the shift started: clamped to 10
            Break(c.ActualStart.AddHours(4), 20d / 60),    // 20 seconds: skipped
        };

        var line = Built(AShift(), c, breaks);

        Assert.Equal(2, line.Breaks.Count);
        Assert.All(line.Breaks, b => Assert.False(b.IsPaidBreak));
        var minutes = line.Breaks.Sum(b => (DateTime.Parse(b.EndTime) - DateTime.Parse(b.StartTime)).TotalMinutes);
        Assert.Equal(40, minutes);
        Assert.Equal(40, ShiftBreakRules.NetWorked(c.ActualStart, c.ActualEnd, c.ActualEnd!.Value, breaks).BreakMinutes);
    }

    [Theory]
    [InlineData("Australia/Sydney", "2026-10-14T09:04:00", "2026-10-14T15:10:00")]
    [InlineData("Australia/Perth", "2026-10-14T06:04:00", "2026-10-14T12:10:00")]
    public void Times_are_local_wall_clock_in_the_completions_zone_to_the_minute(string zone, string start, string end)
    {
        var line = Built(AShift(), ACompletion(zone));

        Assert.Equal(start, line.StartTime);
        Assert.Equal(end, line.EndTime);
    }

    [Fact]
    public void A_sleepover_sends_its_rostered_times_and_no_breaks()
    {
        var s = AShift(SleepoverType.Sleepover);
        s.StartTime = new TimeOnly(22, 0);
        s.EndTime = new TimeOnly(7, 0);
        s.EndsNextDay = true;
        var c = ACompletion();

        var line = Built(s, c, [Break(c.ActualStart.AddHours(1), 30)]);

        Assert.Equal("2026-10-14T22:00:00", line.StartTime);
        Assert.Equal("2026-10-15T07:00:00", line.EndTime);
        Assert.Empty(line.Breaks);
        Assert.Equal(10, line.WorkTypeId);
    }

    [Theory]
    [InlineData(SleepoverType.None, 7)]
    [InlineData(SleepoverType.ActiveNight, 8)]
    [InlineData(SleepoverType.PassiveNight, 9)]
    [InlineData(SleepoverType.Sleepover, 10)]
    public void Each_night_kind_takes_its_mapped_work_type_and_day_shifts_may_have_none(SleepoverType night, int expected)
    {
        Assert.Equal(expected, Built(AShift(night), ACompletion()).WorkTypeId);
        Assert.Null(Built(AShift(), ACompletion(), map: new EmploymentHeroTimesheets.TimesheetMapping(null, null, null, null)).WorkTypeId);
    }

    [Fact]
    public void An_unmapped_night_kind_an_unlinked_worker_or_an_unreadable_id_waits_with_its_reason()
    {
        var unmapped = EmploymentHeroTimesheets.Build(AShift(SleepoverType.PassiveNight), ACompletion(), [], "42", new EmploymentHeroTimesheets.TimesheetMapping("7", "8", null, "10"), Sydney);
        var unlinked = EmploymentHeroTimesheets.Build(AShift(), ACompletion(), [], null, Mapped, Sydney);
        var unreadable = EmploymentHeroTimesheets.Build(AShift(), ACompletion(), [], "x", Mapped, Sydney);

        Assert.Null(unmapped.Line);
        Assert.Equal("Choose the Employment Hero work type for passive nights in Settings → Integrations.", unmapped.WaitReason);
        Assert.Null(unlinked.Line);
        Assert.Equal(EmploymentHeroTimesheets.NotLinkedReason, unlinked.WaitReason);
        Assert.Null(unreadable.Line);
        Assert.Equal("ODIP can't read this worker's Employment Hero id. Link them again in Settings → Integrations.", unreadable.WaitReason);
    }

    [Fact]
    public void The_external_id_is_the_completion_id_and_the_hash_follows_the_payload_only()
    {
        var c = ACompletion();
        var line = Built(AShift(), c);
        var same = Built(AShift(), c);

        Assert.Equal("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", line.ExternalId);
        Assert.Equal(HashOf(AShift(), c), HashOf(AShift(), c));
        Assert.NotEqual(HashOf(AShift(), c), HashOf(AShift(), c, payrollId: "43"));
        Assert.NotEqual(HashOf(AShift(), c), HashOf(AShift(SleepoverType.ActiveNight), c));
        var otherRatio = AShift();
        otherRatio.Ratio = SupportRatio.OneToTwo;
        Assert.Equal(HashOf(AShift(), c), HashOf(otherRatio, c));
        var later = ACompletion();
        later.ActualEnd = later.ActualEnd!.Value.AddMinutes(30);
        Assert.NotEqual(HashOf(AShift(), c), HashOf(AShift(), later));
    }

    [Fact]
    public void A_work_type_mapping_or_provider_time_zone_change_does_not_change_the_hash()
    {
        var shift = AShift();
        var noZone = ACompletion(zone: "");   // falls back to the provider zone
        var brisbane = TimeZoneInfo.FindSystemTimeZoneById("Australia/Brisbane");

        Assert.Equal(HashOf(shift, noZone), HashOf(shift, noZone, map: new("70", "80", "90", "100")));
        Assert.Equal(HashOf(shift, noZone), EmploymentHeroTimesheets.Build(shift, noZone, [], "42", Mapped, brisbane).Hash);
        Assert.NotEqual(Built(shift, noZone).StartTime, EmploymentHeroTimesheets.Build(shift, noZone, [], "42", Mapped, brisbane).Line!.StartTime);   // the strings do move
    }

    private static string? HashOf(Shift s, ShiftCompletion c, string? payrollId = "42", EmploymentHeroTimesheets.TimesheetMapping? map = null) =>
        EmploymentHeroTimesheets.Build(s, c, [], payrollId, map ?? Mapped, Sydney).Hash;

    private static readonly DateTime Retry = new(2026, 10, 14, 1, 1, 0, DateTimeKind.Utc);   // 12:01 pm in Sydney

    private static EmploymentHeroOutbox Row(EmploymentHeroOutboxStatus status, string? error = null, DateTime? sentAt = null) =>
        new() { Status = status, LastError = error, SentAt = sentAt, NextAttemptAt = Retry };

    public static TheoryData<EmploymentHeroOutbox?, bool, string?, PayrollShiftStatus, string?, bool> Statuses => new()
    {
        { null, false, null, PayrollShiftStatus.NotLinked, EmploymentHeroTimesheets.NotLinkedReason, false },
        { Row(EmploymentHeroOutboxStatus.Pending), false, null, PayrollShiftStatus.NotLinked, EmploymentHeroTimesheets.NotLinkedReason, false },
        { null, true, null, PayrollShiftStatus.Waiting, "Not queued yet. Send missing queues it.", true },
        { Row(EmploymentHeroOutboxStatus.Pending, EmploymentHeroTimesheets.BusyMessage), true, null, PayrollShiftStatus.Waiting, "Employment Hero is busy. ODIP tries again at 12:01 pm.", false },
        { Row(EmploymentHeroOutboxStatus.Pending, EmploymentHeroTimesheets.KeyRefusedReason), true, null, PayrollShiftStatus.Waiting, "Employment Hero didn't accept the API key. ODIP tries again at 12:01 pm.", false },
        { Row(EmploymentHeroOutboxStatus.Pending), true, "Choose the work type.", PayrollShiftStatus.Waiting, "Choose the work type.", false },
        { Row(EmploymentHeroOutboxStatus.Pending), true, null, PayrollShiftStatus.Waiting, "Queued. ODIP sends about 25 shifts a minute.", false },
        { Row(EmploymentHeroOutboxStatus.Pending, sentAt: Retry), true, null, PayrollShiftStatus.Waiting, "Changed in ODIP; the update is queued.", false },
        { Row(EmploymentHeroOutboxStatus.Failed, "Employment Hero couldn't be reached."), true, null, PayrollShiftStatus.Failed, "Employment Hero couldn't be reached. ODIP tries again at 12:01 pm.", true },
        { Row(EmploymentHeroOutboxStatus.NeedsAttention, EmploymentHeroTimesheets.FinalisedMessage), true, null, PayrollShiftStatus.Changed, EmploymentHeroTimesheets.FinalisedMessage, false },
        { Row(EmploymentHeroOutboxStatus.NeedsAttention, "Employment Hero refused it: no."), true, null, PayrollShiftStatus.Failed, "Employment Hero refused it: no.", true },
        { Row(EmploymentHeroOutboxStatus.Sent, sentAt: Retry), true, null, PayrollShiftStatus.Sent, null, false },
    };

    [Theory]
    [MemberData(nameof(Statuses))]
    public void StatusOf_gives_each_outbox_state_one_word(EmploymentHeroOutbox? row, bool linked, string? waitReason, PayrollShiftStatus word, string? reason, bool sendable)
    {
        var result = EmploymentHeroTimesheets.StatusOf(row, linked, waitReason, Sydney);

        Assert.Equal((word, reason, sendable), (result.Status, result.Reason, result.Sendable));
    }
}
