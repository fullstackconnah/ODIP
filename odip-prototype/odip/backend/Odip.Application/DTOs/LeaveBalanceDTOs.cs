namespace Odip.Application.DTOs;

/// <summary>One balance as Employment Hero reports it. Unit is EH's own word ("Hours" or "Days").</summary>
public record LeaveBalanceDto(string Category, decimal Amount, string Unit);

/// <summary>A person's balances. Status says why there are none: not connected, or the person isn't linked to an EH employee.</summary>
public record LeaveBalancesDto(string Status, List<LeaveBalanceDto> Balances)
{
    public const string NotConnected = "NotConnected", NotLinked = "NotLinked", Ready = "Ready";
}
