using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the staff member a shift was assigned to. Publish week tells a worker once about every shift of theirs it published (roster drag and drop, fix round 1): the first shift
/// is the main fields and the rest are <paramref name="MoreShifts"/>. A payload without it (every other sender, and rows already in the outbox) renders as the one-shift email.
/// <paramref name="FirstIsActivity"/> is set when the first line is a group activity part, so its name is the activity title, not a participant.
/// </summary>
public record ShiftAssignedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, IReadOnlyList<ShiftAssignedLine>? MoreShifts = null, bool FirstIsActivity = false);

/// <summary>One more shift in a <see cref="ShiftAssignedPayload"/>. <paramref name="IsActivity"/> marks a group activity part; it is optional so rows already in the outbox still read back (as shifts).</summary>
public record ShiftAssignedLine(string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool IsActivity = false);

public static class ShiftAssignedTemplate
{
    public static NotificationMessage Render(ShiftAssignedPayload p, string baseUrl)
    {
        if (p.MoreShifts is not { Count: > 0 } more)
            return p.FirstIsActivity ? new(
                RecipientAddress: p.RecipientEmail,
                Subject: $"New group activity: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
                PlainTextBody: $"You've been put on {p.ParticipantName} on {Html.Date(p.ServiceDate)} " +
                               $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.\n\nView it: {baseUrl}/portal",
                HtmlBody: $"<p>You've been put on {Html.E(p.ParticipantName)} on {Html.Date(p.ServiceDate)} " +
                          $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.</p>" +
                          $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View it</a></p>") : new(
                RecipientAddress: p.RecipientEmail,
                Subject: $"New shift: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
                PlainTextBody: $"You've been assigned a shift with {p.ParticipantName} on {Html.Date(p.ServiceDate)} " +
                               $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.\n\nView it: {baseUrl}/portal",
                HtmlBody: $"<p>You've been assigned a shift with {Html.E(p.ParticipantName)} on {Html.Date(p.ServiceDate)} " +
                          $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.</p>" +
                          $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View it</a></p>");

        var lines = new[] { new ShiftAssignedLine(p.ParticipantName, p.ServiceDate, p.StartTime, p.EndTime) }.Concat(more).ToList();
        var activities = (p.FirstIsActivity ? 1 : 0) + more.Count(l => l.IsActivity);
        var shifts = lines.Count - activities;
        // Counts are of kinds: with no activity the copy is the shifts-only wording; with any, it names both ("1 shift and 2 group activities").
        var (subject, lead) = activities == 0
            ? ($"New shifts: {lines.Count} shifts from {Html.Date(p.ServiceDate)}", $"You've been assigned {lines.Count} shifts:")
            : ($"New work: {Counted(shifts, activities)} from {Html.Date(p.ServiceDate)}", $"You've been put on {Counted(shifts, activities)}:");
        static string Line(ShiftAssignedLine l, string name) => $"{name}, {Html.Date(l.ServiceDate)} {Html.Time(l.StartTime)} to {Html.Time(l.EndTime)}";
        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: subject,
            PlainTextBody: lead + "\n" + string.Concat(lines.Select(l => $"- {Line(l, l.ParticipantName)}\n")) +
                           $"\nView them: {baseUrl}/portal",
            HtmlBody: $"<p>{lead}</p><ul>" + string.Concat(lines.Select(l => $"<li>{Line(l, Html.E(l.ParticipantName))}</li>")) + "</ul>" +
                      $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View them</a></p>");
    }

    private static string Counted(int shifts, int activities)
    {
        var a = activities == 1 ? "1 group activity" : $"{activities} group activities";
        return shifts == 0 ? a : $"{(shifts == 1 ? "1 shift" : $"{shifts} shifts")} and {a}";
    }
}
