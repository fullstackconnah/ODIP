using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the staff member a shift was assigned to. Publish week tells a worker once about every shift of theirs it published (roster drag and drop, fix round 1): the first shift
/// is the main fields and the rest are <paramref name="MoreShifts"/>. A payload without it (every other sender, and rows already in the outbox) renders as the one-shift email.
/// </summary>
public record ShiftAssignedPayload(
    string RecipientEmail, string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, IReadOnlyList<ShiftAssignedLine>? MoreShifts = null);

/// <summary>One more shift in a <see cref="ShiftAssignedPayload"/>.</summary>
public record ShiftAssignedLine(string ParticipantName, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime);

public static class ShiftAssignedTemplate
{
    public static NotificationMessage Render(ShiftAssignedPayload p, string baseUrl)
    {
        if (p.MoreShifts is not { Count: > 0 } more)
            return new(
                RecipientAddress: p.RecipientEmail,
                Subject: $"New shift: {p.ParticipantName} on {Html.Date(p.ServiceDate)}",
                PlainTextBody: $"You've been assigned a shift with {p.ParticipantName} on {Html.Date(p.ServiceDate)} " +
                               $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.\n\nView it: {baseUrl}/portal",
                HtmlBody: $"<p>You've been assigned a shift with {Html.E(p.ParticipantName)} on {Html.Date(p.ServiceDate)} " +
                          $"from {Html.Time(p.StartTime)} to {Html.Time(p.EndTime)}.</p>" +
                          $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View it</a></p>");

        var lines = new[] { new ShiftAssignedLine(p.ParticipantName, p.ServiceDate, p.StartTime, p.EndTime) }.Concat(more).ToList();
        static string Line(ShiftAssignedLine l, string name) => $"{name}, {Html.Date(l.ServiceDate)} {Html.Time(l.StartTime)} to {Html.Time(l.EndTime)}";
        return new(
            RecipientAddress: p.RecipientEmail,
            Subject: $"New shifts: {lines.Count} shifts from {Html.Date(p.ServiceDate)}",
            PlainTextBody: $"You've been assigned {lines.Count} shifts:\n" + string.Concat(lines.Select(l => $"- {Line(l, l.ParticipantName)}\n")) +
                           $"\nView them: {baseUrl}/portal",
            HtmlBody: $"<p>You've been assigned {lines.Count} shifts:</p><ul>" + string.Concat(lines.Select(l => $"<li>{Line(l, Html.E(l.ParticipantName))}</li>")) + "</ul>" +
                      $"<p><a href=\"{Html.Attr(baseUrl)}/portal\">View them</a></p>");
    }
}
