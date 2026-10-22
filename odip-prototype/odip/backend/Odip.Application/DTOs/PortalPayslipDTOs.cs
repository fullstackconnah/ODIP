namespace Odip.Application.DTOs;

/// <summary>
/// One payslip in a staff member's own list: dates only. Net pay and the payer are in EH's PDF; ODIP never binds, stores or logs a figure.
/// DateOnly on purpose: EH's dates carry no zone.
/// </summary>
public record PortalPayslipDto(int PayRunId, DateOnly? DatePaid, DateOnly? PeriodStart, DateOnly? PeriodEnd, string? PaySchedule);

/// <summary>The caller's payslips, or why there are none to show: <see cref="NotConnected"/>, <see cref="NotLinked"/> or <see cref="Ready"/>.</summary>
public record PortalPayslipsDto(string Status, List<PortalPayslipDto> Payslips)
{
    public const string NotConnected = "NotConnected";
    public const string NotLinked = "NotLinked";
    public const string Ready = "Ready";
}
