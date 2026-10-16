namespace Odip.Application.Common;

/// <summary>The LEAVE_* ApiResponse.Fail codes LeaveController answers with, so a client can branch on the refusal (ShiftErrorCodes' pattern).</summary>
public static class LeaveErrorCodes
{
    /// <summary>The caller tried to approve or decline their own leave or recurring unavailability: someone else decides it.</summary>
    public const string LeaveOwnRequest = "LEAVE_OWN_REQUEST";
}
