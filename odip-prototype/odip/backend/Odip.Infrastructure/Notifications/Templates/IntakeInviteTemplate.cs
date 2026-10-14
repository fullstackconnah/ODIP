using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Notifications.Templates;

/// <summary>
/// Sent to the enquiry's contact: the invite (Booked), an updated invite (Changed) or a cancellation (Cancelled). The reader may be a family member
/// using their own inbox, so the greeting has no name and the person is named in the text. Reply-To is the coordinator who booked it.
/// </summary>
public record IntakeInvitePayload(
    string Kind, string RecipientEmail, string PersonFirstName, string PersonFullName, string ProviderName, string ProviderAddress,
    DateTime StartsAtUtc, int DurationMinutes, string TimeZoneId, string Location, string StaffFullName,
    string? ManagerName, string? ManagerPhone, string? ReplyTo, string? OrganizerName, string Uid, int Sequence, DateTime StampUtc,
    string? OrganizerEmail = null);

public static class IntakeInviteTemplate
{
    public static NotificationMessage Render(IntakeInvitePayload p)
    {
        var start = IntakeWording.Local(p.StartsAtUtc, p.TimeZoneId);
        var end = start.AddMinutes(p.DurationMinutes);
        var call = IntakeWording.CallClause(p.ManagerName, p.ManagerPhone);
        var cancelled = p.Kind == IntakeWording.Cancelled;
        var subject = IntakeWording.OneLine(p.Kind switch
        {
            IntakeWording.Cancelled => $"Cancelled: your intake visit with {p.ProviderName} on {IntakeWording.ShortDay(start)}",
            IntakeWording.Changed => $"Updated: your intake visit with {p.ProviderName} is now {IntakeWording.ShortDay(start)}, {IntakeWording.Time(start)}",
            _ => $"Your intake visit with {p.ProviderName}: {IntakeWording.ShortDay(start)}, {IntakeWording.Time(start)}",
        });

        var body = new EmailBody().Para("Hello,");
        if (cancelled)
        {
            body.Para($"The intake visit for {p.PersonFullName} on {IntakeWording.LongDayNoYear(start)} at {IntakeWording.Time(start)} is cancelled.")
                .Para($"If you'd like a new time, reply to this email{(call is null ? "" : " or " + call)}.");
        }
        else
        {
            body.Para(p.Kind == IntakeWording.Changed
                    ? $"The intake visit for {p.PersonFullName} has changed. Here are the new details."
                    : $"This confirms an intake visit for {p.PersonFullName} with {p.ProviderName}.")
                .Para($"{IntakeWording.LongDay(start)}, {IntakeWording.Time(start)} to {IntakeWording.Time(end)}", "When")
                .Para(p.Location, "Where")
                .Para(p.StaffFullName, "Who's coming")
                .Para($"We'll talk about the support {p.PersonFirstName} is looking for and fill in the intake form together. It takes about {IntakeWording.Duration(p.DurationMinutes)}.", "What it's for")
                .List("What to have ready, if you can:",
                [
                    $"{p.PersonFirstName}'s NDIS plan, or their NDIS number",
                    "a list of medicines and doses",
                    $"names and phone numbers for {p.PersonFirstName}'s doctors and emergency contacts",
                    "anything about health, behaviour or safety you'd like us to know",
                ])
                .Para($"Please reply to this email to confirm{(call is null ? "" : ", or " + call)}.")
                .Para("If the time doesn't suit, reply and we'll find another.")
                .Para("This email includes a calendar invite, so you can add the visit to your calendar.");
        }
        body.Lines(p.ProviderName, p.ProviderAddress);

        var ics = IntakeIcs.Build(cancelled ? IntakeIcs.Cancel : IntakeIcs.Request, IntakeWording.Event(
            p.Uid, p.Sequence, p.StartsAtUtc, p.DurationMinutes, p.PersonFullName, p.Location, p.StaffFullName, p.ProviderName,
            p.ManagerName, p.ManagerPhone, p.OrganizerName, p.OrganizerEmail, p.PersonFullName, p.RecipientEmail, p.StampUtc));
        return new NotificationMessage(p.RecipientEmail, subject, body.PlainText, body.HtmlText, ics, p.ReplyTo);
    }
}
