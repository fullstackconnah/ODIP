using Odip.Domain.Rostering;
using Odip.Infrastructure.Integrations;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>What goes to Employment Hero for one approved leave (hours, category, marker, hash) and which waiting reasons the card lists.</summary>
public class EmploymentHeroLeaveRulesTests
{
    private static readonly EmploymentHeroLeave.LeaveMapping Mapped = new("5", "6", "6", "9");
    private static readonly Guid LeaveId = Guid.Parse("11111111-2222-3333-4444-555555555555");

    private static LeaveRequest ALeave(LeaveType type = LeaveType.Annual) => new()
    {
        Id = LeaveId, LeaveType = type, StartDate = new DateOnly(2026, 11, 2), EndDate = new DateOnly(2026, 11, 6), Status = LeaveStatus.Approved,
    };

    [Fact]
    public void Hours_count_weekdays_and_fall_back_to_7_6()
    {
        Assert.Equal((36.0m, false), EmploymentHeroLeave.Hours(new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 6), 7.2m));
        Assert.Equal((15.2m, true), EmploymentHeroLeave.Hours(new DateOnly(2026, 11, 6), new DateOnly(2026, 11, 9), null));
        Assert.Equal((15.2m, true), EmploymentHeroLeave.Hours(new DateOnly(2026, 11, 6), new DateOnly(2026, 11, 9), 0m));
        Assert.Equal(0m, EmploymentHeroLeave.Hours(new DateOnly(2026, 11, 7), new DateOnly(2026, 11, 8), 7.2m).Hours);
    }

    [Fact]
    public void The_cutoff_is_the_later_of_the_connection_and_the_epoch()
    {
        var epoch = EmploymentHeroLeave.LeaveSyncEpoch;
        Assert.Equal(epoch, EmploymentHeroLeave.Cutoff(epoch.AddDays(-30)));
        Assert.Equal(epoch.AddDays(30), EmploymentHeroLeave.Cutoff(epoch.AddDays(30)));
    }

    [Fact]
    public void A_leave_is_built_with_its_mapped_category_dates_and_marker()
    {
        var built = EmploymentHeroLeave.Build(ALeave(), "42", Mapped);

        Assert.Null(built.WaitReason);
        var line = built.Line!;
        Assert.Equal(new EhLeaveLine(null, 42, "2026-11-02T00:00:00", "2026-11-06T00:00:00", 5, 0m, $"Sent from ODIP (ref {LeaveId:D})", true), line);
        Assert.Equal(EmploymentHeroLeave.Marker(LeaveId), line.Notes);
    }

    [Fact]
    public void An_unmapped_type_an_unlinked_worker_or_an_unreadable_id_waits_with_its_reason()
    {
        var unmapped = new EmploymentHeroLeave.LeaveMapping("5", null, "6", "9");

        Assert.Equal("Choose the Employment Hero leave category for sick leave in Settings → Integrations.", EmploymentHeroLeave.Build(ALeave(LeaveType.Sick), "42", unmapped).WaitReason);
        Assert.Equal(EmploymentHeroTimesheets.NotLinkedReason, EmploymentHeroLeave.Build(ALeave(), null, Mapped).WaitReason);
        Assert.Equal("We can't read this worker's Employment Hero id. Link them again in Settings → Integrations.", EmploymentHeroLeave.Build(ALeave(), "abc", Mapped).WaitReason);
        Assert.Null(EmploymentHeroLeave.Build(ALeave(), "abc", Mapped).Line);
    }

    [Fact]
    public void The_hash_follows_employee_and_dates_only()
    {
        var a = EmploymentHeroLeave.Build(ALeave(), "42", Mapped).Line!;
        var same = EmploymentHeroLeave.Build(ALeave(), "42", Mapped).Line!;
        var moved = EmploymentHeroLeave.Build(new LeaveRequest { Id = LeaveId, LeaveType = LeaveType.Annual, StartDate = new DateOnly(2026, 11, 2), EndDate = new DateOnly(2026, 11, 7) }, "42", Mapped).Line!;
        var other = EmploymentHeroLeave.Build(ALeave(), "43", Mapped).Line!;

        Assert.Equal(EmploymentHeroLeave.Hash(a), EmploymentHeroLeave.Hash(same));
        Assert.NotEqual(EmploymentHeroLeave.Hash(a), EmploymentHeroLeave.Hash(moved));
        Assert.NotEqual(EmploymentHeroLeave.Hash(a), EmploymentHeroLeave.Hash(other));
        Assert.Equal(EmploymentHeroLeave.Hash(a), EmploymentHeroLeave.Hash(a with { LeaveCategoryId = 99, Hours = 12m, Notes = "other" }));
    }

    [Fact]
    public void An_EH_category_comes_in_as_the_first_ODIP_type_mapped_to_it()
    {
        Assert.Equal(LeaveType.Sick, EmploymentHeroLeave.TypeFor(6, Mapped));
        Assert.Equal(LeaveType.Other, EmploymentHeroLeave.TypeFor(9, new("5", "6", "6", null)));
        Assert.Equal(LeaveType.Annual, EmploymentHeroLeave.TypeFor(5, Mapped));
        Assert.Equal(LeaveType.Other, EmploymentHeroLeave.TypeFor(null, Mapped));
    }

    [Fact]
    public void The_marker_is_found_in_EHs_notes_and_parsed_back()
    {
        Assert.True(EmploymentHeroLeave.TryParseMarker($"Sent from ODIP (ref {LeaveId:D}) – edited in EH", out var id));
        Assert.Equal(LeaveId, id);
        Assert.False(EmploymentHeroLeave.TryParseMarker("Holiday in Bali", out _));
        Assert.False(EmploymentHeroLeave.TryParseMarker(null, out _));
        Assert.False(EmploymentHeroLeave.TryParseMarker("Sent from ODIP (ref not-a-guid-not-a-guid-not-a-guid-xxxx)", out _));
    }

    [Fact]
    public void Only_Builds_reasons_count_as_waiting()
    {
        Assert.True(EmploymentHeroLeave.IsWaiting(EmploymentHeroLeave.Build(ALeave(LeaveType.Sick), "42", new("5", null, null, null)).WaitReason));
        Assert.True(EmploymentHeroLeave.IsWaiting(EmploymentHeroLeave.Build(ALeave(), "abc", Mapped).WaitReason));
        Assert.False(EmploymentHeroLeave.IsWaiting(EmploymentHeroLeave.WeekendMessage));
        Assert.False(EmploymentHeroLeave.IsWaiting(EmploymentHeroTimesheets.BusyMessage));
        Assert.False(EmploymentHeroLeave.IsWaiting(EmploymentHeroTimesheets.NotLinkedReason));
        Assert.False(EmploymentHeroLeave.IsWaiting(null));
        Assert.True(EmploymentHeroLeave.IsWaiting("ODIP can't read this worker's Employment Hero id. Link them again in Settings → Integrations."));  // queued before the rename
    }
}
