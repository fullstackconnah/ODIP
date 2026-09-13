namespace Odip.Application.Common;

/// <summary>
/// Every SHIFT_* ApiResponse.Fail code used by PortalController/RosteringController's
/// shift-completion surface, centralised so the two controllers can't drift and a code can't
/// silently break the SHIFT_* prefix (critique P2 — STATUS_TRANSITION_VIA_COMPLETION did).
/// </summary>
public static class ShiftErrorCodes
{
    public const string ShiftNotStartable = "SHIFT_NOT_STARTABLE";
    public const string ShiftAlreadyFinished = "SHIFT_ALREADY_FINISHED";
    public const string ShiftAlreadyCompleted = "SHIFT_ALREADY_COMPLETED";
    public const string ShiftCancelled = "SHIFT_CANCELLED";
    public const string ShiftNotPublished = "SHIFT_NOT_PUBLISHED";
    public const string ShiftNotInProgress = "SHIFT_NOT_IN_PROGRESS";
    public const string ShiftNoteRequired = "SHIFT_NOTE_REQUIRED";
    public const string ShiftActualStartInFuture = "SHIFT_ACTUAL_START_IN_FUTURE";
    public const string ShiftActualStartTooEarly = "SHIFT_ACTUAL_START_TOO_EARLY";
    public const string ShiftNotPendingReview = "SHIFT_NOT_PENDING_REVIEW";
    public const string ShiftReturnReasonRequired = "SHIFT_RETURN_REASON_REQUIRED";
    public const string ShiftReturnReasonTooLong = "SHIFT_RETURN_REASON_TOO_LONG";
    public const string ShiftStatusLocked = "SHIFT_STATUS_LOCKED";
    public const string ShiftTimesLocked = "SHIFT_TIMES_LOCKED";
    public const string ShiftBatchSizeInvalid = "SHIFT_BATCH_SIZE_INVALID";
    public const string ShiftCompletionNotFound = "SHIFT_COMPLETION_NOT_FOUND";
    public const string ShiftAlreadyClaimed = "SHIFT_ALREADY_CLAIMED";
}
