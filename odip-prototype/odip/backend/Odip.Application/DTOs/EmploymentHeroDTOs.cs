using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

/// <summary>The Employment Hero card. No API-key field anywhere: the key is write-only.</summary>
public record EmploymentHeroStatusDto(bool Configured, bool Connected, string? BusinessId, string? BusinessName, DateTime? ConnectedAt, string? ConnectedByName,
    DateTime? LastSyncAt, string? LastSyncError, int StaffLinked, int StaffNotLinked, List<EmploymentHeroAttentionDto> Attention,
    int TimesheetsSent, int TimesheetsWaiting, EmploymentHeroWorkTypesDto WorkTypes,
    int LeaveSent, int LeaveWaiting, EmploymentHeroLeaveCategoriesDto LeaveCategories, List<EmploymentHeroLeaveProblemDto> LeaveProblems);

/// <summary>One Needs-attention item; Kind (sent as its name) decides the action the card offers.</summary>
public record EmploymentHeroAttentionDto(Guid Id, EmploymentHeroAttentionKind Kind, Guid? UserId, string? EmployeeId, string Name, string Reason);

public record EmploymentHeroKeyDto(string? ApiKey);
public record EmploymentHeroConnectDto(string? ApiKey, string? BusinessId);
public record EmploymentHeroBusinessDto(string Id, string Name);
/// <summary>AddedBySync: the employee is linked to someone the sync itself created who has never signed in, so Link may move the id to the chosen person.</summary>
public record EmploymentHeroEmployeeDto(string Id, string Name, string? Email, bool AddedBySync = false);
public record EmploymentHeroLinkDto(string? EmployeeId);

/// <summary>The one word the Payroll page prints for a shift's hours, derived server side from the outbox row (EmploymentHeroTimesheets.StatusOf). Append-only.</summary>
public enum PayrollShiftStatus { Sent, Waiting, Failed, Changed, NotLinked }

/// <summary>The four Employment Hero work-type ids ODIP sends hours under. Null: not chosen. Day and evening shifts need Standard; each night kind needs its own before its shifts go.</summary>
public record EmploymentHeroWorkTypesDto(string? Standard, string? ActiveNight, string? PassiveNight, string? Sleepover);
public record EmploymentHeroWorkTypeDto(string Id, string Name);

public record PayPeriodDto(int PayScheduleId, string ScheduleName, DateOnly From, DateOnly To, bool Finalised);
public record PayPeriodsDto(bool Connected, DateOnly Today, List<PayPeriodDto> Periods);

public record PayrollShiftDto(Guid ShiftId, DateOnly ServiceDate, string ParticipantName, TimeOnly RosteredStart, TimeOnly RosteredEnd, bool EndsNextDay,
    int RosteredMinutes, DateTime ActualStart, DateTime? ActualEnd, string TimeZoneId, int BreakMinutes, int PaidMinutes, SleepoverType NightType,
    PayrollShiftStatus Status, string? Reason, DateTime? SentAt, bool Sendable);
public record PayrollWorkerDto(Guid UserId, string Name, bool Linked, int RosteredMinutes, int PaidMinutes, List<PayrollShiftDto> Shifts);
public record PayrollCheckDto(DateOnly From, DateOnly To, int Approved, int Sent, int Waiting, int Failed, int Changed, int NotLinked, int Sendable,
    int AwaitingApproval, List<PayrollWorkerDto> Workers);
public record PayrollRangeDto(DateOnly? From, DateOnly? To);
public record SendMissingResultDto(int Queued, PayrollCheckDto Check);

/// <summary>The four leave categories ODIP sends leave under; null is not chosen yet (that leave waits).</summary>
public record EmploymentHeroLeaveCategoriesDto(string? Annual, string? Sick, string? Personal, string? Other);
public record EmploymentHeroLeaveCategoryDto(string Id, string Name);

/// <summary>One leave ODIP could not send (or cancel) to Employment Hero. Waiting: it is held for a leave category, so there is no Try again.</summary>
public record EmploymentHeroLeaveProblemDto(Guid Id, Guid LeaveId, string Name, LeaveType LeaveType, DateOnly StartDate, DateOnly EndDate, bool Cancelling, bool Waiting, string Reason);

