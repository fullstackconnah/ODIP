using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the worker of a Published shift when a coordinator changes its time, day or participant (shift-change-notice, 2026-10-29); the same channel as the cancel notice.
/// <paramref name="ParticipantName"/> and <paramref name="OldDate"/> say which shift it was; <paramref name="NewParticipantName"/> is null unless the participant changed;
/// <paramref name="TimeChanged"/> is false for a participant-only change, which leaves the time out of the sentence.
/// </summary>
public record ShiftChangedPayload(
    string RecipientEmail, string ParticipantName, DateOnly OldDate, DateOnly NewDate, TimeOnly StartTime, TimeOnly EndTime, string? NewParticipantName = null, bool TimeChanged = true);

/// <summary>The one sentence both the email and the bell say, so the two cannot drift. The caller passes its own day, clock and name formatting.</summary>
public static class ShiftChangedWording
{
    // A no-break space each side of the en dash and a word joiner after it, as ShiftBudgetAssessor.Period does: the range wraps only as a block.
    private const string Dash = "\u00A0\u2013\u2060\u00A0";

    public static string Sentence(ShiftChangedPayload p, Func<DateOnly, string> day, Func<TimeOnly, string> clock, Func<string, string> name)
    {
        var now = new List<string>();
        if (p.NewParticipantName is { } who) now.Add($"with {name(who)}");
        var dateMoved = p.NewDate != p.OldDate;
        if (dateMoved) now.Add(day(p.NewDate));
        if (p.TimeChanged || dateMoved) now.Add($"{clock(p.StartTime)}{Dash}{clock(p.EndTime)}");
        return $"Your shift with {name(p.ParticipantName)} on {day(p.OldDate)} has changed: now {string.Join(", ", now)}.";
    }
}

public static class ShiftChangedTemplate
{
    public static NotificationMessage Render(ShiftChangedPayload p, string baseUrl) => new(
        RecipientAddress: p.RecipientEmail,
        Subject: $"Shift changed: {p.ParticipantName} on {Html.Date(p.OldDate)}",
        PlainTextBody: ShiftChangedWording.Sentence(p, Html.Date, Html.Time, n => n) + $"\n\nView your shifts: {baseUrl}/portal",
        HtmlBody: $"<p>{ShiftChangedWording.Sentence(p, Html.Date, Html.Time, Html.E)}</p><p><a href=\"{Html.Attr(baseUrl)}/portal\">View your shifts</a></p>");
}
