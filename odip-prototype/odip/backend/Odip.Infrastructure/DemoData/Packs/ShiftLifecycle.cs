using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// How a demo shift is closed out once it has been worked (plan 5.2): a shift that has ended is moved to PendingReview, with the worker's
/// completion row, and three provider days later to Completed, approved by Sarah. Past shifts are created already in the right state on the
/// first run; later ticks move the ones that were future when they were created. Both go through the same two functions, so a shift looks
/// the same whichever way it got there.
///
/// Rostered times are provider-local wall clock; every instant on a completion goes through the one conversion
/// (<see cref="DemoAnchors.LocalToUtc(DateTime)"/>), and variance is the signed minutes against the rostered instant, as
/// <see cref="ShiftVarianceCalculator"/> defines it.
/// </summary>
internal static class ShiftLifecycle
{
    /// <summary>Wait after the rostered end before closing a shift out, so a late finish plus the submit lag is never in the future.</summary>
    public const int CloseOutBufferMinutes = 45;

    /// <summary>Provider days after the shift date at which a PendingReview shift is approved.</summary>
    public const int ApproveAfterDays = 3;

    private static readonly string[] Handovers =
    {
        "Settled well. Lunch eaten and the afternoon walk done. Nothing outstanding.",
        "A quiet shift. The pharmacy delivery is due on Thursday.",
        "A bit unsettled after lunch; headphones and a quiet room helped. Worth keeping an eye on tomorrow.",
        "All routines completed. Family rang at 3pm and will visit on the weekend.",
        "Transport to the community centre went smoothly. Wheelchair battery is on the charger.",
        "Declined the evening walk but happy to do puzzles. Dinner eaten.",
        "Slept poorly according to the overnight notes; may need a slower start.",
        "Out of the usual snacks. The shopping list is on the fridge.",
        "Appointment confirmed for next week. The letter is in the folder.",
    };

    /// <summary>True once the rostered end plus <see cref="CloseOutBufferMinutes"/> has passed on the provider's clock.</summary>
    public static bool HasEnded(DemoAnchors anchors, Shift shift)
    {
        var (_, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
        return anchors.LocalToUtc(endLocal).AddMinutes(CloseOutBufferMinutes) <= anchors.NowUtc;
    }

    /// <summary>Completed once the shift date is <see cref="ApproveAfterDays"/> or more provider days ago, otherwise waiting for review.</summary>
    public static ShiftStatus ClosedStatus(DemoAnchors anchors, Shift shift) =>
        anchors.D0.DayNumber - shift.ServiceDate.DayNumber >= ApproveAfterDays ? ShiftStatus.Completed : ShiftStatus.PendingReview;

    /// <summary>The worker's completion of <paramref name="shift"/> (which must be filled), submitted shortly after the shift ended.</summary>
    public static ShiftCompletion BuildCompletion(DemoRun run, Shift shift)
    {
        var anchors = run.Anchors;
        var id = DemoIds.For("shift-completion", shift.Id);
        var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
        var rosteredStart = anchors.LocalToUtc(startLocal);
        var rosteredEnd = anchors.LocalToUtc(endLocal);

        var actualStart = rosteredStart.AddMinutes(DemoIds.Pick(id, "variance-start", -5, 12));
        var actualEnd = rosteredEnd.AddMinutes(DemoIds.Pick(id, "variance-end", -8, 25));
        var submittedAt = actualEnd.AddMinutes(DemoIds.Pick(id, "submit-lag", 2, 14));

        // One completion in ten had its start entered by hand (the worker forgot to tap Start), one in ten declined location sharing.
        var geo = DemoIds.Pick(id, "geo", 0, 9);
        var manualStart = geo == 0;
        var declined = geo == 1;
        var handover = Handovers.ElementAtOrDefault(DemoIds.Pick(id, "handover", 0, Handovers.Length));

        var completion = new ShiftCompletion
        {
            Id = id,
            TenantId = run.TenantId,
            ShiftId = shift.Id,
            ActualStart = actualStart,
            ActualEnd = actualEnd,
            TimeZoneId = anchors.Provider.Id,
            GeolocationDeclined = declined,
            StartWasManual = manualStart,
            SubmittedByUserId = shift.UserId!.Value,
            StartedAt = manualStart ? submittedAt : actualStart,
            SubmittedAt = submittedAt,
            VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(actualStart, rosteredStart),
            VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(actualEnd, rosteredEnd),
            HandoverText = handover,
            NothingToHandOver = handover is null,
            NothingToNoteConfirmed = true,
            IsActive = true,
            CreatedAt = submittedAt,
            UpdatedAt = submittedAt,
        };

        if (geo >= 2)
        {
            // Around the provider's office, a few hundred metres apart: plausible, and nowhere real.
            completion.StartLatitude = -33.8688m + DemoIds.Pick(id, "lat-start", -30, 30) / 1000m;
            completion.StartLongitude = 151.2093m + DemoIds.Pick(id, "lon-start", -30, 30) / 1000m;
            completion.EndLatitude = -33.8688m + DemoIds.Pick(id, "lat-end", -30, 30) / 1000m;
            completion.EndLongitude = 151.2093m + DemoIds.Pick(id, "lon-end", -30, 30) / 1000m;
        }
        return completion;
    }

    /// <summary>Stamps the office's approval on a submitted completion (and keeps it after the submission and before now).</summary>
    public static void Approve(DemoRun run, Shift shift, ShiftCompletion completion, Guid reviewerId)
    {
        var anchors = run.Anchors;
        var morningAfter = anchors.LocalToUtc(shift.ServiceDate.AddDays(1), new TimeOnly(9, 30))
            .AddMinutes(DemoIds.Pick(completion.Id, "review-lag", 0, 180));
        var submitted = completion.SubmittedAt ?? completion.CreatedAt;
        var reviewedAt = morningAfter > submitted ? morningAfter : submitted.AddMinutes(1);
        if (reviewedAt > anchors.NowUtc) reviewedAt = anchors.NowUtc;

        completion.ReviewedByUserId = reviewerId;
        completion.ReviewedAt = reviewedAt;
        completion.ReviewOutcome = ReviewOutcome.Approved;
        completion.UpdatedAt = reviewedAt;
    }
}
