using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent through the outbox to the staff member going to an intake visit: the visit, the contact, the coordinator's internal notes, and the same
/// calendar event (UID and SEQUENCE) the contact gets, addressed to them. Kind picks the subject and REQUEST or CANCEL.
/// </summary>
public record IntakeVisitStaffPayload(
    string Kind, string RecipientEmail, string StaffFullName, string PersonFullName, DateTime StartsAtUtc, int DurationMinutes, string TimeZoneId,
    string Location, string? ContactPhone, string? ContactEmail, string? Notes, string BookedByName, string? OrganizerEmail,
    string ProviderName, string? ManagerName, string? ManagerPhone, string Uid, int Sequence, DateTime StampUtc, string? ReplyTo = null, string? ContactName = null);

public static class IntakeVisitStaffTemplate
{
    public static NotificationMessage Render(IntakeVisitStaffPayload p, string baseUrl)
    {
        var start = IntakeWording.Local(p.StartsAtUtc, p.TimeZoneId);
        var end = start.AddMinutes(p.DurationMinutes);
        var cancelled = p.Kind == IntakeWording.Cancelled;
        var verb = p.Kind switch { IntakeWording.Cancelled => "cancelled", IntakeWording.Changed => "changed", _ => "booked" };
        var subject = IntakeWording.OneLine($"Intake visit {verb}: {p.PersonFullName}, {IntakeWording.ShortDay(start)} at {IntakeWording.Time(start)}");

        var body = new EmailBody();
        if (cancelled)
        {
            body.Para($"The intake visit with {p.PersonFullName} on {IntakeWording.LongDayNoYear(start)} at {IntakeWording.Time(start)} is cancelled. It's off My shifts.");
        }
        else
        {
            var contact = string.Join(" · ", new[] { p.ContactName, p.ContactPhone, p.ContactEmail }.Where(v => !string.IsNullOrWhiteSpace(v)));
            body.Para($"{IntakeWording.LongDay(start)}, {IntakeWording.Time(start)} to {IntakeWording.Time(end)}", "When")
                .Para(p.Location, "Where")
                .Para(contact.Length > 0 ? contact : "No contact details", "Contact")
                .Para(string.IsNullOrWhiteSpace(p.Notes) ? "No notes" : p.Notes, "Notes")
                .Para($"Booked by {p.BookedByName}")
                .Link("It's on My shifts, with Start intake.", $"{baseUrl}/portal");
        }

        var ics = IntakeIcs.Build(cancelled ? IntakeIcs.Cancel : IntakeIcs.Request, IntakeWording.Event(
            p.Uid, p.Sequence, p.StartsAtUtc, p.DurationMinutes, p.PersonFullName, p.Location, p.StaffFullName, p.ProviderName,
            p.ManagerName, p.ManagerPhone, p.BookedByName, OwnCopy(p) ? null : p.OrganizerEmail, p.StaffFullName, p.RecipientEmail, p.StampUtc, forContact: false));
        return new NotificationMessage(p.RecipientEmail, subject, body.PlainText, body.HtmlText, ics, p.ReplyTo, p.ProviderName);
    }

    // The booker going themselves: calendar apps treat an invite you organised as yours to send, not one to add, so their copy names no ORGANIZER.
    private static bool OwnCopy(IntakeVisitStaffPayload p) => string.Equals(p.OrganizerEmail?.Trim(), p.RecipientEmail.Trim(), StringComparison.OrdinalIgnoreCase);
}
