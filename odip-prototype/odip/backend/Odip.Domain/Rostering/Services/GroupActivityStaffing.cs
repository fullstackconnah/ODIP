using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>How many workers a group activity needs (group activities D1): each participant's share of a worker, summed and rounded up, never below the activity's minimum.</summary>
public static class GroupActivityStaffing
{
    // Shares in sixtieths, so three 1:3 participants add to exactly one worker. SharedSupport and Other add nothing: MinStaffRequired covers them.
    public static int Sixtieths(SupportRatio ratio) => ratio switch
    {
        SupportRatio.OneToOne => 60, SupportRatio.TwoToOne => 120, SupportRatio.OneToTwo => 30,
        SupportRatio.OneToThree => 20, SupportRatio.OneToFour => 15, SupportRatio.OneToFive => 12, _ => 0,
    };

    /// <summary>One ratio per participant: callers collapse 2:1 sibling shifts first (GroupBy ParticipantId).</summary>
    public static int StaffNeeded(IEnumerable<SupportRatio> participantRatios, int? minStaff) =>
        Math.Max((participantRatios.Sum(Sixtieths) + 59) / 60, minStaff ?? 0);
}
