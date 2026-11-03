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
}

public record AutoRosterAlternateDto
{
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public AutoRosterPick Pick { get; init; }
    public int? Rank { get; init; }
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
