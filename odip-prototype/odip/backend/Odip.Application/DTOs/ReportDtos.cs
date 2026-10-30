using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// Reports page (/reports). Hours are decimals to 2 dp, rounded once from summed minutes. No participant data, and no leave Reason or DecisionNote.

/// <summary>One worker's hours in the range. <see cref="ApprovedShifts"/> and <see cref="ApprovedHours"/> count approved completions only; <see cref="AwaitingApprovalHours"/> is shifts finished but not yet reviewed.</summary>
public record HoursByWorkerRowDto(Guid WorkerId, string WorkerName, int ApprovedShifts, decimal ApprovedHours, decimal AwaitingApprovalHours);

/// <summary>One Monday-to-Sunday week. <see cref="PartWeek"/> is true when the range cuts the week, so the counts cover only the days inside it. <see cref="FillRatePercent"/> is null when nothing needed filling.</summary>
public record ShiftFulfilmentWeekDto(DateOnly WeekStart, int Shifts, int Filled, int Unstaffed, int Cancelled, int? FillRatePercent, bool PartWeek);

/// <summary>Approved leave overlapping the range. <see cref="From"/> and <see cref="To"/> are the leave's own dates; <see cref="DaysInRange"/> counts only the calendar days inside the range.</summary>
public record LeaveTakenRowDto(Guid LeaveId, Guid WorkerId, string WorkerName, LeaveType Type, DateOnly From, DateOnly To, int DaysInRange);
