using System.Text.Json;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The email the assigned staff member gets: when, where, the contact, the internal notes, and the same visit in their calendar.</summary>
public class IntakeVisitStaffTemplateTests
{
    private const string BaseUrl = "https://odip.test";
    private const string Script = "<script>alert(1)</script>\"><img src=x>";

    private static IntakeVisitStaffPayload Payload(string kind = IntakeWording.Booked) => new(
        Kind: kind, RecipientEmail: "sam.lee@provider.example", StaffFullName: "Sam Lee", PersonFullName: "Noah Fitzgerald",
        StartsAtUtc: new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc), DurationMinutes: 90, TimeZoneId: "Australia/Sydney",
        Location: "12 Smith St, Parramatta", ContactPhone: "0412 555 010", ContactEmail: "priya.nair@example.com.au",
        Notes: "Bring the consent forms", BookedByName: "Dana Smith", OrganizerEmail: "dana@provider.example",
        ProviderName: "Sample Support Co", ManagerName: "Alex Brown", ManagerPhone: "02 9000 0000", Uid: "abc@odip", Sequence: 0,
        StampUtc: new DateTime(2026, 10, 14, 3, 5, 0, DateTimeKind.Utc), ReplyTo: "dana@provider.example");

    [Fact]
    public void A_booking_tells_the_staff_member_everything_including_the_notes()
    {
        var message = IntakeVisitStaffTemplate.Render(Payload(), BaseUrl);

        Assert.Equal("sam.lee@provider.example", message.RecipientAddress);
        Assert.Equal("Intake visit booked: Noah Fitzgerald, Fri 16 Oct at 10:00 am", message.Subject);
        // Fix round 1, N3: when the staff member is also the booker, their own copy names no ORGANIZER (calendar apps treat an invite you organised
        // as yours to send, not one to add).
        var own = IntakeVisitStaffTemplate.Render(Payload() with { OrganizerEmail = "Sam.Lee@provider.example" }, BaseUrl);
        Assert.DoesNotContain("ORGANIZER", own.Ics!.Content);
        Assert.Contains("ORGANIZER", message.Ics.Content); // someone else booked: they stay the organizer
        // Fix round 1, S1: a line break typed into a name never reaches the Subject header.
        Assert.Equal("Intake visit booked: Noah Fitzgerald, Fri 16 Oct at 10:00 am",
            IntakeVisitStaffTemplate.Render(Payload() with { PersonFullName = "Noah\r\nFitzgerald" }, BaseUrl).Subject);
        Assert.Contains("When: Friday 16 October 2026, 10:00 am to 11:30 am", message.PlainTextBody);
        Assert.Contains("Where: 12 Smith St, Parramatta", message.PlainTextBody);
        Assert.Contains("Contact: 0412 555 010 · priya.nair@example.com.au", message.PlainTextBody);
        Assert.Contains("Notes: Bring the consent forms", message.PlainTextBody);
        Assert.Contains("Booked by Dana Smith", message.PlainTextBody);
        Assert.Contains("https://odip.test/portal", message.HtmlBody);
        Assert.Equal("REQUEST", message.Ics!.Method);
        Assert.Contains("mailto:sam.lee@provider.example", message.Ics.Content.Replace("\r\n ", ""));
        // The notes are internal: the .ics is the same event the contact receives, so they are never in it.
        Assert.DoesNotContain("consent", message.Ics.Content.Replace("\r\n ", ""));
        Assert.DoesNotContain("reply to the invite email", message.Ics.Content.Replace("\r\n ", "")); // staff never received the invite email
        Assert.Equal("dana@provider.example", message.ReplyTo);
    }

    [Theory]
    [InlineData(IntakeWording.Changed, "Intake visit changed: Noah Fitzgerald, Fri 16 Oct at 10:00 am", "REQUEST")]
    [InlineData(IntakeWording.Cancelled, "Intake visit cancelled: Noah Fitzgerald, Fri 16 Oct at 10:00 am", "CANCEL")]
    public void A_change_or_cancellation_says_so_and_updates_the_calendar(string kind, string subject, string method)
    {
        var message = IntakeVisitStaffTemplate.Render(Payload(kind) with { Sequence = 1 }, BaseUrl);

        Assert.Equal(subject, message.Subject);
        Assert.Equal(method, message.Ics!.Method);
        Assert.Contains("SEQUENCE:1", message.Ics.Content);
    }

    [Fact]
    public void Missing_notes_and_contact_details_are_said_not_left_blank()
    {
        var message = IntakeVisitStaffTemplate.Render(Payload() with { Notes = null, ContactPhone = null, ContactEmail = " " }, BaseUrl);

        Assert.Contains("Notes: No notes", message.PlainTextBody);
        Assert.Contains("Contact: No contact details", message.PlainTextBody);
    }

    [Fact]
    public void Every_user_controlled_field_is_html_encoded()
    {
        var message = IntakeVisitStaffTemplate.Render(Payload() with
        {
            PersonFullName = Script, Location = Script, ContactPhone = Script, ContactEmail = Script, Notes = Script, BookedByName = Script, StaffFullName = Script,
        }, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;", message.HtmlBody);
    }

    // The outbox stores the payload as JSON; the dispatcher renders it later.
    [Fact]
    public void The_payload_survives_the_outbox_json_round_trip()
    {
        var restored = JsonSerializer.Deserialize<IntakeVisitStaffPayload>(JsonSerializer.Serialize(Payload()))!;

        Assert.Equal(IntakeVisitStaffTemplate.Render(Payload(), BaseUrl).Subject, IntakeVisitStaffTemplate.Render(restored, BaseUrl).Subject);
    }
}
