using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Api.Rostering;

/// <summary>
/// The Blocking/RequiresReason/override gate every roster-checked write runs through, shared by
/// RosteringController (shifts) and StaffAssignmentsController (trip-side parity) so the two
/// controllers can't drift. Moved verbatim out of RosteringController, which now delegates to it
/// — see that controller's own EvaluateFindings/ApplyOverride, both now one-line wrappers.
/// </summary>
public static class RosterGate
{
    public static RosterFindingDto ToFindingDto(RosterFinding f) => new()
    {
        Code = f.Code, Severity = f.Severity, Message = f.Message, RequiresReason = f.RequiresReason
    };

    /// <summary>
    /// Any Blocking finding rejects the write regardless of <paramref name="overrideReason"/>; any
    /// finding with RequiresReason true needs a non-empty reason; a write whose findings are all
    /// RequiresReason == false may proceed with no reason at all (ComputeOverride still records
    /// their codes in AcknowledgedFindingCodes, so the UI can show why a cell looks tentative
    /// without ever having asked for input). Returns the 422 response body to return, or null when
    /// the write may proceed. <paramref name="subject"/> only changes the wording of the two
    /// rejection messages ("shift" for RosteringController, "trip assignment" for
    /// StaffAssignmentsController) — it keeps RosteringController's existing message text
    /// byte-identical when called with the default.
    /// </summary>
    public static ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason, string subject = "shift")
    {
        if (findings.Count == 0) return null;

        var findingDtos = findings.Select(ToFindingDto).ToList();
        var errors = findings.Select(f => f.Message).ToList();

        if (findings.Any(f => f.Severity == RosterFindingSeverity.Blocking))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, $"One or more blocking findings prevent this {subject} from being saved.");
        }

        if (findings.Any(f => f.RequiresReason) && string.IsNullOrWhiteSpace(overrideReason))
        {
            return ApiResponse<List<RosterFindingDto>>.Fail(
                findingDtos, errors, $"This {subject} has warnings that must be acknowledged with an override reason before it can be saved.");
        }

        return null;
    }

    /// <summary>
    /// Computes the (OverrideReason, AcknowledgedFindingCodes) pair a write should persist, given
    /// the findings EvaluateFindings already approved. Returns values rather than mutating an
    /// entity so both Shift and StaffAssignment (different entities, same two field names) can use
    /// it from their own controller.
    /// </summary>
    public static (string? OverrideReason, string? AcknowledgedFindingCodes) ComputeOverride(
        List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        if (findings.Count == 0) return (null, null);

        var codes = acknowledgedCodes is { Count: > 0 } ? acknowledgedCodes : findings.Select(f => f.Code).Distinct();
        // Spec §3: HasConflict = "a hard finding was overridden". A reason supplied when no finding
        // requires one is discarded so OverrideReason (and the HasConflict invariant derived from
        // it) only ever records a real override; the soft codes are still acknowledged.
        var reason = findings.Any(f => f.RequiresReason) && !string.IsNullOrWhiteSpace(overrideReason)
            ? overrideReason.Trim()
            : null;
        return (reason, string.Join(",", codes));
    }
}
