using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// AUTO-ROSTER (R7): a draft of who could take a week's open shifts. Nothing here is saved;
// enums serialise as strings (the global JsonStringEnumConverter).
// ══════════════════════════════════════════════════════════════

public record AutoRosterDraftDto
{
    public DateOnly WeekStart { get; init; }
    public DateTime GeneratedAt { get; init; }
    public List<AutoRosterChangeDto> Changes { get; init; } = new();
    public List<AutoRosterHoursDto> Hours { get; init; } = new();
    public List<AutoRosterUncoveredDto> Uncovered { get; init; } = new();
    /// <summary>Shifts two people cover between them (PR3): no longer in <see cref="Uncovered"/>.</summary>
    public List<AutoRosterSplitDto> Splits { get; init; } = new();
}

/// <summary>One shift split where the first person's availability ends: <see cref="First"/> works <see cref="StartTime"/> to <see cref="CutAt"/>, <see cref="Second"/> works <see cref="CutAt"/> to <see cref="EndTime"/>.</summary>
public record AutoRosterSplitDto
{
    public Guid ShiftId { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public TimeOnly CutAt { get; init; }
    public AutoRosterSegmentDto First { get; init; } = new();
    public AutoRosterSegmentDto Second { get; init; } = new();
    /// <summary>Either part is past the organisation's auto-roster reach; omitted when false so the default draft is unchanged.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool NeedsLook { get; init; }
}

public record AutoRosterSegmentDto
{
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
}

/// <summary>One proposed placement: <see cref="StaffId"/> on <see cref="ShiftId"/>, why, what to look at, and up to three other people who could take it.</summary>
public record AutoRosterChangeDto
{
    public Guid ShiftId { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public AutoRosterPick Pick { get; init; }
    /// <summary>The person's rank on the participant's list; omitted when they have none.</summary>
    public int? Rank { get; init; }
    public bool UnderGoal { get; init; }
    /// <summary>Set when the shift's regular was away and someone else was proposed: "Sam Lee is away: on approved leave".</summary>
    public string? RegularAway { get; init; }
    public List<RosterFindingDto> Warnings { get; init; } = new();
    public List<AutoRosterAlternateDto> Alternates { get; init; } = new();
    /// <summary>A non-regular pick past the organisation's auto-roster reach ("Needs a look"); omitted when false so the default draft is unchanged.</summary>
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool NeedsLook { get; init; }
}

public record AutoRosterAlternateDto
{
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public AutoRosterPick Pick { get; init; }
    public int? Rank { get; init; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool NeedsLook { get; init; }
}

/// <summary>One person's week: their goal (and whether it is the default for their employment type), what is already rostered and what this draft adds.</summary>
public record AutoRosterHoursDto
{
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public EmploymentType? EmploymentType { get; init; }
    public decimal GoalHours { get; init; }
    public bool GoalIsDefault { get; init; }
    public decimal RosteredHours { get; init; }
    public decimal DraftHours { get; init; }
}

public record AutoRosterUncoveredDto
{
    public Guid ShiftId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public UncoveredReason Reason { get; init; }
    /// <summary>Display-only: the coordinator acts on the board, where the normal assign path asks for any override reason.</summary>
    public List<AutoRosterRecommendationDto> Recommendations { get; init; } = new();
}

public record AutoRosterRecommendationDto
{
    public AutoRosterRecommendationKind Kind { get; init; }
    public Guid? StaffId { get; init; }
    public string Text { get; init; } = string.Empty;
}

/// <summary>The rows a coordinator kept from a draft, in the order to apply them. Each is judged again under the board's locks; none is trusted from the draft.</summary>
public record AutoRosterApplyDto
{
    public List<AutoRosterApplyRowDto> Rows { get; init; } = new();
    /// <summary>Kept splits (PR3). Each is applied as a unit under the same locks: both halves, or neither.</summary>
    public List<AutoRosterApplySplitDto> Splits { get; init; } = new();
}

/// <summary>A kept split: the shift as the draft saw it (<see cref="StartTime"/>, <see cref="EndTime"/>, so a shift edited since is skipped), where to cut it, and who takes each part.</summary>
public record AutoRosterApplySplitDto
{
    public Guid ShiftId { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public TimeOnly CutAt { get; init; }
    public Guid FirstStaffId { get; init; }
    public Guid SecondStaffId { get; init; }
}

public record AutoRosterApplyRowDto
{
    public Guid ShiftId { get; init; }
    public Guid StaffId { get; init; }
}

public record AutoRosterApplyResultDto
{
    public List<Guid> Applied { get; init; } = new();
    /// <summary>Rows left as they were (changed since the draft, now refused, not found): not a failure, and the other rows still apply.</summary>
    public List<AutoRosterSkippedDto> Skipped { get; init; } = new();
}

public record AutoRosterSkippedDto
{
    public Guid ShiftId { get; init; }
    public string Message { get; init; } = string.Empty;
}
