using System.Globalization;
using System.Text;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Infrastructure.Notifications;

/// <summary>
/// The bell item's title and link for one raised event (dashboard spec 2026-10-14, "The bell"). Plain text, never HTML: the
/// frontend renders it as text, so names are kept as typed. It matches on the payload's runtime type and never casts, so a
/// payload it does not know (an event type appended later, a reserved one, a test's anonymous object) gets the generic title
/// and no link instead of throwing inside the caller's save. The IncidentReported title names no participant, as its email
/// does not. Dates and times use the invariant culture (the deploy image runs with invariant globalization).
/// </summary>
public static class InAppNotificationText
{
    public const string GenericTitle = "You have a new notification.";

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static (string Title, string? LinkTo) Build(NotificationEventType type, Guid entityId, object? payload) =>
        (type, payload) switch
        {
            (NotificationEventType.LeaveRequestSubmitted, LeaveRequestSubmittedPayload p) =>
                ($"{Who(p.RequesterName)} asked for {Leave(p.LeaveType)}, {Range(p.StartDate, p.EndDate)}.", "/rostering/leave"),
            (NotificationEventType.LeaveRequestDecided, LeaveRequestDecidedPayload p) =>
                ($"Your {Leave(p.LeaveType)} for {Range(p.StartDate, p.EndDate)} was {(p.Approved ? "approved" : "declined")}.", "/portal/leave"),
            (NotificationEventType.ShiftAssigned, ShiftAssignedPayload p) =>
                ($"You're rostered with {Whom(p.ParticipantName)} on {Day(p.ServiceDate)} at {Clock(p.StartTime)}.", $"/portal/shifts/{entityId}"),
            // A cancelled shift still opens in the portal; a shift the worker came off is not theirs any more, so that one links to My shifts.
            (NotificationEventType.ShiftUnassigned, ShiftUnassignedPayload { Cancelled: true } p) =>
                ($"Your shift with {Whom(p.ParticipantName)} on {Day(p.ServiceDate)} at {Clock(p.StartTime)} was cancelled.", $"/portal/shifts/{entityId}"),
            (NotificationEventType.ShiftUnassigned, ShiftUnassignedPayload p) =>
                ($"You've been taken off {Whom(p.ParticipantName)} on {Day(p.ServiceDate)} at {Clock(p.StartTime)}.", "/portal"),
            (NotificationEventType.ShiftCompletionPendingReview, ShiftCompletionPendingReviewPayload p) =>
                ($"{Who(p.WorkerName)}'s shift with {Whom(p.ParticipantName)} on {Day(p.ServiceDate)} is ready for review.", "/rostering/completions"),
            // The entity is the completion, not the shift, so this links to the portal, as the email does.
            (NotificationEventType.ShiftCompletionReturned, ShiftCompletionReturnedPayload p) =>
                ($"Your shift with {Whom(p.ParticipantName)} on {Day(p.ServiceDate)} was returned. See why.", "/portal"),
            (NotificationEventType.WitnessRequested, WitnessRequestedPayload p) =>
                ($"{Who(p.AdministeringStaffName)} needs you to witness a medication for {Whom(p.ParticipantName)}.", "/portal/witness-approvals"),
            (NotificationEventType.CaregiverSubmissionReceived, CaregiverSubmissionReceivedPayload p) =>
                ($"{Who(p.CaregiverName)} sent a profile update for {Whom(p.ParticipantName)}.", $"/caregiver-submissions/{entityId}"),
            (NotificationEventType.IncidentReported, IncidentReportedPayload p) =>
                ($"{Who(p.ReportedByName)} reported an incident: {Words(p.IncidentType)}, {Words(p.Severity)} severity.", $"/incidents/{entityId}"),
            // The entity id is a fresh one per revision, so this links to My shifts, where the visit and Start intake are; same words as the email's subject.
            (NotificationEventType.IntakeBooked, IntakeVisitStaffPayload p) => (IntakeVisit(p), "/portal"),
            (NotificationEventType.StaffJoinedViaMicrosoft, StaffJoinedViaMicrosoftPayload p) =>
                ($"{Who(p.FullName)} joined with Microsoft sign-in as {Words(p.Role)}.", $"/staff/{entityId}"),
            _ => (GenericTitle, null),
        };

    private static string IntakeVisit(IntakeVisitStaffPayload p)
    {
        var local = IntakeWording.Local(p.StartsAtUtc, p.TimeZoneId);
        var verb = p.Kind switch { IntakeWording.Cancelled => "cancelled", IntakeWording.Changed => "changed", _ => "booked" };
        return $"Intake visit {verb}: {p.PersonFullName}, {IntakeWording.ShortDay(local)} at {IntakeWording.Time(local)}.";
    }

    /// <summary>A missing name reads as a neutral word, never as a gap in the sentence.</summary>
    private static string Who(string? name) => string.IsNullOrWhiteSpace(name) ? "Someone" : name;
    private static string Whom(string? participant) => string.IsNullOrWhiteSpace(participant) ? "a participant" : participant;

    /// <summary>"annual leave", but LeaveType.Other reads as plain "leave".</summary>
    private static string Leave(string leaveType) => leaveType == "Other" ? "leave" : $"{Words(leaveType)} leave";

    /// <summary>An enum name the payloads carry, in words: "BehaviourOfConcern" reads "behaviour of concern".</summary>
    private static string Words(string? name)
    {
        if (string.IsNullOrEmpty(name)) return string.Empty; // a null must not throw inside the caller's save
        var words = new StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            if (i > 0 && char.IsUpper(name[i])) words.Append(' ');
            words.Append(char.ToLowerInvariant(name[i]));
        }
        return words.ToString();
    }

    private static string Day(DateOnly d) => d.ToString("ddd d MMM", Inv);

    private static string Clock(TimeOnly t) => t.ToString("h:mm", Inv) + (t.Hour < 12 ? " am" : " pm");

    /// <summary>"20 Oct", "20 to 24 Oct", "30 Oct to 2 Nov", or with years when they differ.</summary>
    private static string Range(DateOnly start, DateOnly end)
    {
        if (start == end) return start.ToString("d MMM", Inv);
        if (start.Year != end.Year) return $"{start.ToString("d MMM yyyy", Inv)} to {end.ToString("d MMM yyyy", Inv)}";
        if (start.Month != end.Month) return $"{start.ToString("d MMM", Inv)} to {end.ToString("d MMM", Inv)}";
        return $"{start.Day.ToString(Inv)} to {end.ToString("d MMM", Inv)}";
    }
}
