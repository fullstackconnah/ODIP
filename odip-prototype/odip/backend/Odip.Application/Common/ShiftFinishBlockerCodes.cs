namespace Odip.Application.Common;

/// <summary>
/// The kind of each item in <c>PortalShiftDetailDto.finishBlockers</c> (and the <c>data.finishBlockers</c> of a
/// 422 SHIFT_FINISH_BLOCKED Finish response). These identify a checklist ITEM, not a response: the response code is
/// <see cref="ShiftErrorCodes.ShiftFinishBlocked"/>.
/// </summary>
public static class ShiftFinishBlockerCodes
{
    /// <summary>A dose due in the shift window has no outcome (and no "not given" reason).</summary>
    public const string DoseOutcomeMissing = "DOSE_OUTCOME_MISSING";

    /// <summary>A break is still running.</summary>
    public const string BreakRunning = "BREAK_RUNNING";
}
