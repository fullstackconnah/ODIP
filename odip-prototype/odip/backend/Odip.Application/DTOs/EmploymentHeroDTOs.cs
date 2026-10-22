using Odip.Domain.Integrations;

namespace Odip.Application.DTOs;

/// <summary>The Employment Hero card. No API-key field anywhere: the key is write-only.</summary>
public record EmploymentHeroStatusDto(bool Configured, bool Connected, string? BusinessId, string? BusinessName, DateTime? ConnectedAt, string? ConnectedByName,
    DateTime? LastSyncAt, string? LastSyncError, int StaffLinked, int StaffNotLinked, List<EmploymentHeroAttentionDto> Attention);

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
