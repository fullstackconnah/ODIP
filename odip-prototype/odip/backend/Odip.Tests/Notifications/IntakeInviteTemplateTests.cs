using System.Globalization;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The email a contact gets for an intake visit: the brief's copy, invariant dates in the provider's zone, HtmlEncoded fields and the .ics.</summary>
public class IntakeInviteTemplateTests
{
    private const string Script = "<script>alert(1)</script>\"><img src=x>";

    // Fri 16 Oct 2026 10:00 in Sydney (AEDT, +11).
    private static IntakeInvitePayload Payload(string kind = IntakeWording.Booked) => new(
        Kind: kind, RecipientEmail: "priya.nair@example.com.au", PersonFirstName: "Noah", PersonFullName: "Noah Fitzgerald",
        ProviderName: "Sample Support Co", ProviderAddress: "1 George St, Sydney NSW 2000",
        StartsAtUtc: new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc), DurationMinutes: 90, TimeZoneId: "Australia/Sydney",
        Location: "12 Smith St, Parramatta", StaffFullName: "Sam Lee", ManagerName: "Alex Brown", ManagerPhone: "02 9000 0000",
        ReplyTo: "dana@provider.example", OrganizerName: "Dana Smith", Uid: "abc@odip", Sequence: 0,
        StampUtc: new DateTime(2026, 10, 14, 3, 5, 0, DateTimeKind.Utc), OrganizerEmail: "dana@provider.example");

    [Fact]
    public void A_booking_says_when_where_who_and_how_to_confirm()
    {
        var message = IntakeInviteTemplate.Render(Payload());

        Assert.Equal("priya.nair@example.com.au", message.RecipientAddress);
        Assert.Equal("Your intake visit with Sample Support Co: Fri 16 Oct, 10:00 am", message.Subject);
        Assert.StartsWith("Hello,", message.PlainTextBody);
        Assert.Contains("This confirms an intake visit for Noah Fitzgerald with Sample Support Co.", message.PlainTextBody);
        Assert.Contains("When: Friday 16 October 2026, 10:00 am to 11:30 am", message.PlainTextBody);
        Assert.Contains("Where: 12 Smith St, Parramatta", message.PlainTextBody);
        Assert.Contains("Who's coming: Sam Lee", message.PlainTextBody);
        Assert.Contains("It takes about 1 hour 30 minutes.", message.PlainTextBody);
        Assert.Contains("- Noah's NDIS plan, or their NDIS number", message.PlainTextBody);
        Assert.Contains("Please reply to this email to confirm, or call Alex Brown on 02 9000 0000.", message.PlainTextBody);
        Assert.Contains("This email includes a calendar invite, so you can add the visit to your calendar.", message.PlainTextBody);
        Assert.Contains("1 George St, Sydney NSW 2000", message.PlainTextBody);
        Assert.Equal("dana@provider.example", message.ReplyTo);
        Assert.Equal("REQUEST", message.Ics!.Method);
        Assert.Contains("mailto:priya.nair@example.com.au", message.Ics.Content.Replace("\r\n ", ""));
        Assert.Contains("ORGANIZER;CN=\"Dana Smith\":mailto:dana@provider.example", message.Ics.Content.Replace("\r\n ", ""));
    }

    [Fact]
    public void An_update_opens_with_the_change()
    {
        var message = IntakeInviteTemplate.Render(Payload(IntakeWording.Changed) with { Sequence = 1 });

        Assert.Equal("Updated: your intake visit with Sample Support Co is now Fri 16 Oct, 10:00 am", message.Subject);
        Assert.Contains("The intake visit for Noah Fitzgerald has changed. Here are the new details.", message.PlainTextBody);
        Assert.Contains("SEQUENCE:1", message.Ics!.Content);
    }

    [Fact]
    public void A_cancellation_sends_a_cancel_with_the_same_uid()
    {
        var message = IntakeInviteTemplate.Render(Payload(IntakeWording.Cancelled) with { Sequence = 2 });

        Assert.Equal("Cancelled: your intake visit with Sample Support Co on Fri 16 Oct", message.Subject);
        Assert.Contains("The intake visit for Noah Fitzgerald on Friday 16 October at 10:00 am is cancelled.", message.PlainTextBody);
        Assert.Contains("If you'd like a new time, reply to this email or call Alex Brown on 02 9000 0000.", message.PlainTextBody);
        Assert.DoesNotContain("When:", message.PlainTextBody);
        Assert.Equal("CANCEL", message.Ics!.Method);
        Assert.Contains("UID:abc@odip", message.Ics.Content);
        Assert.Contains("SEQUENCE:2", message.Ics.Content);
    }

    [Fact]
    public void Without_a_manager_phone_the_call_clause_is_left_out_not_left_blank()
    {
        var message = IntakeInviteTemplate.Render(Payload() with { ManagerPhone = " " });

        Assert.Contains("Please reply to this email to confirm.", message.PlainTextBody);
        Assert.DoesNotContain("call", message.PlainTextBody);
        Assert.Contains(@"To confirm\, reply to the invite email.", message.Ics!.Content.Replace("\r\n ", ""));
    }

    [Fact]
    public void Every_user_controlled_field_is_html_encoded()
    {
        var message = IntakeInviteTemplate.Render(Payload() with
        {
            PersonFirstName = Script, PersonFullName = Script, ProviderName = Script, ProviderAddress = Script,
            Location = Script, StaffFullName = Script, ManagerName = Script,
        });

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.DoesNotContain("\"><img", message.HtmlBody);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;", message.HtmlBody);
    }

    // The deploy image runs under invariant globalization; en-AU says "Sept". Every date here is formatted invariant, in the provider's zone.
    [Fact]
    public void Dates_are_invariant_whatever_the_current_culture()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("en-AU");
            // Tue 15 Sep 2026 10:00 in Sydney (AEST, +10).
            var message = IntakeInviteTemplate.Render(Payload() with { StartsAtUtc = new DateTime(2026, 9, 15, 0, 0, 0, DateTimeKind.Utc) });

            Assert.Equal("Your intake visit with Sample Support Co: Tue 15 Sep, 10:00 am", message.Subject);
            // "September" in the long date is fine; the culture's abbreviation "Sept" is not.
            Assert.DoesNotMatch(@"\bSept\b", message.PlainTextBody);
            Assert.DoesNotMatch(@"\bSept\b", message.HtmlBody);
            Assert.Contains("When: Tuesday 15 September 2026, 10:00 am to 11:30 am", message.PlainTextBody);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
