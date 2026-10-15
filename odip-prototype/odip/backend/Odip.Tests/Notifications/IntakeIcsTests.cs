using System.Text;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The intake visit's iCalendar text: iTIP REQUEST and CANCEL, stable UID, SEQUENCE, UTC times with Z, RFC 5545 escaping and folding.</summary>
public class IntakeIcsTests
{
    // Fri 16 Oct 2026 10:00-11:30 in Sydney (AEDT, +11) is 15 Oct 23:00Z to 16 Oct 00:30Z.
    private static IntakeIcsEvent Visit() => new(
        Uid: "abc123@odip", Sequence: 2,
        StartsAtUtc: new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc),
        EndsAtUtc: new DateTime(2026, 10, 16, 0, 30, 0, DateTimeKind.Utc),
        Summary: "Intake visit: Noah Fitzgerald", Location: "12 Smith St Parramatta",
        Description: "With Sam Lee", OrganizerName: "Dana Smith", OrganizerEmail: "dana@provider.example",
        AttendeeName: "Noah Fitzgerald", AttendeeEmail: "priya.nair@example.com.au",
        StampUtc: new DateTime(2026, 10, 14, 3, 5, 0, DateTimeKind.Utc));

    private static string Unfold(string content) => content.Replace("\r\n ", "");
    private static string[] Lines(string content) => Unfold(content).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

    [Fact]
    public void A_request_carries_uid_sequence_method_and_utc_times()
    {
        var calendar = IntakeIcs.Build(IntakeIcs.Request, Visit());
        var lines = Lines(calendar.Content);

        Assert.Equal("REQUEST", calendar.Method);
        Assert.Equal("BEGIN:VCALENDAR", lines[0]);
        Assert.Equal("END:VCALENDAR", lines[^1]);
        Assert.Contains("METHOD:REQUEST", lines);
        Assert.Contains("UID:abc123@odip", lines);
        Assert.Contains("SEQUENCE:2", lines);
        Assert.Contains("DTSTAMP:20261014T030500Z", lines);
        Assert.Contains("DTSTART:20261015T230000Z", lines);
        Assert.Contains("DTEND:20261016T003000Z", lines);
        Assert.Contains("STATUS:CONFIRMED", lines);
        Assert.Contains("ORGANIZER;CN=\"Dana Smith\":mailto:dana@provider.example", lines);
        Assert.Contains("ATTENDEE;CN=\"Noah Fitzgerald\";ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:priya.nair@example.com.au", lines);
    }

    [Fact]
    public void A_cancel_keeps_the_uid_and_says_cancelled()
    {
        var calendar = IntakeIcs.Build(IntakeIcs.Cancel, Visit() with { Sequence = 3 });
        var lines = Lines(calendar.Content);

        Assert.Equal("CANCEL", calendar.Method);
        Assert.Contains("METHOD:CANCEL", lines);
        Assert.Contains("STATUS:CANCELLED", lines);
        Assert.Contains("UID:abc123@odip", lines);
        Assert.Contains("SEQUENCE:3", lines);
    }

    // Postgres hands instants back with Kind Unspecified (legacy timestamp mode): they are UTC already and must not be shifted.
    [Fact]
    public void An_instant_read_back_with_kind_unspecified_is_written_as_the_same_utc_time()
    {
        var start = DateTime.SpecifyKind(new DateTime(2026, 10, 15, 23, 0, 0), DateTimeKind.Unspecified);
        var lines = Lines(IntakeIcs.Build(IntakeIcs.Request, Visit() with { StartsAtUtc = start }).Content);

        Assert.Contains("DTSTART:20261015T230000Z", lines);
    }

    [Fact]
    public void Text_values_escape_backslash_semicolon_comma_and_line_breaks()
    {
        var location = "Unit 2; 12 Smith St, Parramatta\nBack door " + '\u005C' + " side gate";
        var lines = Lines(IntakeIcs.Build(IntakeIcs.Request, Visit() with { Location = location }).Content);

        // BB stands for the escaped backslash (two of them): written this way so no doubled backslash has to survive a copy.
        var expected = @"LOCATION:Unit 2\; 12 Smith St\, Parramatta\nBack door BB side gate".Replace("BB", new string('\u005C', 2));
        Assert.Contains(expected, lines);
    }

    [Fact]
    public void A_name_with_quotes_or_a_line_break_cannot_break_out_of_its_parameter()
    {
        var lines = Lines(IntakeIcs.Build(IntakeIcs.Request, Visit() with { AttendeeName = "Noah \"The Kid\"\nFitzgerald" }).Content);

        Assert.Contains(lines, l => l.StartsWith("ATTENDEE;CN=\"Noah 'The Kid' Fitzgerald\";", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not an address")]
    public void No_organizer_line_without_a_usable_organizer_email(string organizerEmail)
    {
        var lines = Lines(IntakeIcs.Build(IntakeIcs.Request, Visit() with { OrganizerEmail = organizerEmail }).Content);

        Assert.DoesNotContain(lines, l => l.StartsWith("ORGANIZER", StringComparison.Ordinal));
    }

    [Fact]
    public void Lines_end_in_crlf_and_fold_at_75_octets_without_splitting_a_character()
    {
        var description = string.Concat(Enumerable.Repeat("Café visit é ", 20));
        var content = IntakeIcs.Build(IntakeIcs.Request, Visit() with { Description = description }).Content;

        Assert.EndsWith("\r\n", content);
        Assert.DoesNotContain("\n", content.Replace("\r\n", ""));
        foreach (var line in content.Split("\r\n"))
            Assert.True(Encoding.UTF8.GetByteCount(line) <= 75, $"{Encoding.UTF8.GetByteCount(line)} octets: {line}");
        Assert.Contains("DESCRIPTION:" + description, Lines(content));
    }
}
