namespace Odip.Infrastructure.DemoData;

/// <summary>
/// A submitted, active completion with the facts of its shift that the app's handover rule orders by (<c>ShiftHandoverService.GetAsync</c>): the material for
/// choosing which handover a reader of a later shift is shown.
/// </summary>
public sealed record HandoverSource(
    Guid CompletionId, Guid ShiftId, Guid ParticipantId, DateOnly ServiceDate, TimeOnly StartTime, DateTime SubmittedAt,
    string? HandoverText, bool NothingToHandOver, Guid? ShiftUserId)
{
    /// <summary>True when there is something to read: the portal asks the next worker to acknowledge a handover that has text, and nothing else.</summary>
    public bool HasHandover => !string.IsNullOrWhiteSpace(HandoverText) && !NothingToHandOver;
}

/// <summary>
/// Which handover a reader is shown, by the app's own rule (PR 2 review L3), so a read the top-up writes is a read the portal agrees with. The app takes the
/// completion of the most recent shift of the participant that STARTED BEFORE the reader's own, across every shift of the participant (not just the story's
/// own previous day), by service date and then start time with the submission time only a tiebreak; the latest completion's handover is the latest handover
/// even when it says nothing, and an older one is never resurrected.
/// </summary>
public static class HandoverSourceRule
{
    /// <summary>True when a shift (a date and a start time) starts before another: the order the app's rule goes by.</summary>
    public static bool StartsBefore(DateOnly date, TimeOnly start, DateOnly otherDate, TimeOnly otherStart) => date < otherDate || (date == otherDate && start < otherStart);

    /// <summary>
    /// The handover shown to the reader of a shift (<paramref name="serviceDate"/>, <paramref name="startTime"/>) of the participant, or null when no earlier
    /// shift has a submitted completion.
    /// </summary>
    public static HandoverSource? LatestBefore(IEnumerable<HandoverSource> sources, Guid participantId, Guid shiftId, DateOnly serviceDate, TimeOnly startTime) =>
        sources
            .Where(s => s.ParticipantId == participantId && s.ShiftId != shiftId && StartsBefore(s.ServiceDate, s.StartTime, serviceDate, startTime))
            .OrderByDescending(s => s.ServiceDate).ThenByDescending(s => s.StartTime).ThenByDescending(s => s.SubmittedAt).ThenBy(s => s.CompletionId)
            .FirstOrDefault();
}
