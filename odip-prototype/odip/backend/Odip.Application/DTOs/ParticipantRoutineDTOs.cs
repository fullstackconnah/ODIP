using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT ROUTINES DTOs
// ══════════════════════════════════════════════════════════════

public record ParticipantRoutineDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public RoutineCategory Category { get; init; }
    public DayOfWeek? DayOfWeek { get; init; }
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public bool IsCritical { get; init; }
    public bool IsActive { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateParticipantRoutineDto
{
    [Required, StringLength(200)]
    public string Title { get; init; } = string.Empty;

    [Required, StringLength(2000)]
    public string Description { get; init; } = string.Empty;

    public RoutineCategory Category { get; init; }
    public DayOfWeek? DayOfWeek { get; init; }
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public bool IsCritical { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateParticipantRoutineDto
{
    [Required, StringLength(200)]
    public string Title { get; init; } = string.Empty;

    [Required, StringLength(2000)]
    public string Description { get; init; } = string.Empty;

    public RoutineCategory Category { get; init; }
    public DayOfWeek? DayOfWeek { get; init; }
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public bool IsCritical { get; init; }
    public bool IsActive { get; init; }
}
