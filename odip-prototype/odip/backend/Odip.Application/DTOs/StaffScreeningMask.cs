using System.Security.Claims;

namespace Odip.Application.DTOs;

/// <summary>
/// The screening (clearance) number is private: managers and the person themselves see it, everyone else sees only that one is on file
/// (owner, 2026-10-31). The expiry date stays visible to all. A missing principal is masked (fail closed).
/// </summary>
public static class StaffScreeningMask
{
    public static bool CanSee(ClaimsPrincipal? user, Guid staffId) =>
        user?.IsInRole("SuperAdmin") == true || user?.IsInRole("Admin") == true || user?.IsInRole("Coordinator") == true
        || (Guid.TryParse(user?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var self) && self == staffId);

    /// <summary>Sets <c>WorkerScreeningRecorded</c> from the stored number, then hides the number from callers who may not see it.</summary>
    public static StaffListDto Apply(StaffListDto d, ClaimsPrincipal? user) => d with
    {
        WorkerScreeningRecorded = !string.IsNullOrWhiteSpace(d.WorkerScreeningNumber),
        WorkerScreeningNumber = CanSee(user, d.Id) ? d.WorkerScreeningNumber : null,
    };

    public static StaffDetailDto Apply(StaffDetailDto d, ClaimsPrincipal? user) => d with
    {
        WorkerScreeningRecorded = !string.IsNullOrWhiteSpace(d.WorkerScreeningNumber),
        WorkerScreeningNumber = CanSee(user, d.Id) ? d.WorkerScreeningNumber : null,
    };
}
