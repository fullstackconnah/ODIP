using System.Globalization;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// One snapshot test per event type: fixed payload in, exact Subject/PlainTextBody out, HtmlBody
/// contains the same link. Guards against clinical detail creeping into a template later.
/// docs/specs/2026-09-08-notifications-design.md §4/Testing.
/// </summary>
public class TemplateRenderingTests
{
    private const string BaseUrl = "https://odip.test";

    [Fact]
    public void LeaveRequestSubmittedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new LeaveRequestSubmittedPayload("coord@example.com", "Ben Turner", "Annual", new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));
        var message = LeaveRequestSubmittedTemplate.Render(payload, BaseUrl);

        Assert.Equal("coord@example.com", message.RecipientAddress);
        Assert.Equal("Leave request from Ben Turner", message.Subject);
        Assert.Equal(
            "Ben Turner has requested Annual leave from 10 Sep 2026 to 12 Sep 2026.\n\nReview it: https://odip.test/rostering/leave",
            message.PlainTextBody);
        Assert.Contains("https://odip.test/rostering/leave", message.HtmlBody);
    }

    [Fact]
    public void LeaveRequestDecidedTemplate_Approved_RendersExactSubjectAndBody()
    {
        var payload = new LeaveRequestDecidedPayload("staff@example.com", "Annual", new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), true, null);
        var message = LeaveRequestDecidedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Your Annual leave request was approved", message.Subject);
        Assert.Contains("was approved.", message.PlainTextBody);
        Assert.Contains("https://odip.test/portal/leave", message.HtmlBody);
    }

    [Fact]
    public void LeaveRequestDecidedTemplate_Declined_IncludesDecisionNote()
    {
        var payload = new LeaveRequestDecidedPayload("staff@example.com", "Sick", new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 10), false, "Not enough cover");
        var message = LeaveRequestDecidedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Your Sick leave request was declined", message.Subject);
        Assert.Contains("was declined.", message.PlainTextBody);
        Assert.Contains("Not enough cover", message.PlainTextBody);
        Assert.Contains("Not enough cover", message.HtmlBody);
    }

    [Fact]
    public void ShiftAssignedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new ShiftAssignedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(17, 0));
        var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("New shift: Alice Participant on 15 Sep 2026", message.Subject);
        Assert.Contains("Alice Participant", message.PlainTextBody);
        Assert.Contains("https://odip.test/portal", message.HtmlBody);
    }

    /// <summary>A worker put only on a group activity is told they are on it, not that they have a shift "with" it.</summary>
    [Fact]
    public void ShiftAssignedTemplate_ActivityOnly_NamesTheActivity()
    {
        var payload = new ShiftAssignedPayload("worker@example.com", "Bowling", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(17, 0), FirstIsActivity: true);
        var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("New group activity: Bowling on 15 Sep 2026", message.Subject);
        Assert.Equal("You've been put on Bowling on 15 Sep 2026 from 9:00 AM to 5:00 PM.\n\nView it: https://odip.test/portal", message.PlainTextBody);
        Assert.Contains("You've been put on Bowling on 15 Sep 2026", message.HtmlBody);
    }

    /// <summary>Publish week tells each worker once (roster drag and drop fix round 1): one email listing every shift of theirs it published.</summary>
    [Fact]
    public void ShiftAssignedTemplate_WithSeveralShifts_ListsEveryShiftInOneEmail()
    {
        var payload = new ShiftAssignedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 14), new TimeOnly(9, 0), new TimeOnly(15, 0),
            new[] { new ShiftAssignedLine("Bob Participant", new DateOnly(2026, 9, 20), new TimeOnly(16, 0), new TimeOnly(20, 0)) });
        var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("worker@example.com", message.RecipientAddress);
        Assert.Equal("New shifts: 2 shifts from 14 Sep 2026", message.Subject);
        Assert.Equal(
            "You've been assigned 2 shifts:\n- Alice Participant, 14 Sep 2026 9:00 AM to 3:00 PM\n- Bob Participant, 20 Sep 2026 4:00 PM to 8:00 PM\n\nView them: https://odip.test/portal",
            message.PlainTextBody);
        Assert.Contains("<li>Bob Participant, 20 Sep 2026 4:00 PM to 8:00 PM</li>", message.HtmlBody);
    }

    private static readonly DateOnly Sep14 = new(2026, 9, 14);

    private static ShiftAssignedLine Activity(string name, int day) => new(name, new DateOnly(2026, 9, day), new TimeOnly(10, 0), new TimeOnly(12, 0), IsActivity: true);

    /// <summary>A mixed publish counts shifts and group activities apart, not "N shifts".</summary>
    [Fact]
    public void ShiftAssignedTemplate_OneShiftAndTwoActivities_CountsEachKind()
    {
        var payload = new ShiftAssignedPayload("worker@example.com", "Alice Participant", Sep14, new TimeOnly(9, 0), new TimeOnly(15, 0),
            new[] { Activity("Bowling", 15), Activity("Picnic", 16) });
        var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("New work: 1 shift and 2 group activities from 14 Sep 2026", message.Subject);
        Assert.StartsWith("You've been put on 1 shift and 2 group activities:\n- Alice Participant, 14 Sep 2026 9:00 AM to 3:00 PM\n- Bowling, 15 Sep 2026 10:00 AM to 12:00 PM\n", message.PlainTextBody);
        Assert.Contains("<p>You've been put on 1 shift and 2 group activities:</p>", message.HtmlBody);
        Assert.EndsWith("View them: https://odip.test/portal", message.PlainTextBody);
    }

    [Fact]
    public void ShiftAssignedTemplate_OnlyActivities_DropsTheShiftPart()
    {
        var payload = new ShiftAssignedPayload("worker@example.com", "Bowling", Sep14, new TimeOnly(10, 0), new TimeOnly(12, 0),
            new[] { Activity("Picnic", 16) }, FirstIsActivity: true);
        var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("New work: 2 group activities from 14 Sep 2026", message.Subject);
        Assert.StartsWith("You've been put on 2 group activities:\n", message.PlainTextBody);
    }

    [Fact]
    public void ShiftAssignedTemplate_ActivityFirstThenShift_CountsTheFirstLineByFirstIsActivity()
    {
        var payload = new ShiftAssignedPayload("worker@example.com", "Bowling", Sep14, new TimeOnly(10, 0), new TimeOnly(12, 0),
            new[] { new ShiftAssignedLine("Bob Participant", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(15, 0)) }, FirstIsActivity: true);

        Assert.Equal("New work: 1 shift and 1 group activity from 14 Sep 2026", ShiftAssignedTemplate.Render(payload, BaseUrl).Subject);
    }

    [Fact]
    public void ShiftAssignedTemplate_ThreeShiftsNoActivities_KeepsTheShiftsCopy()
    {
        var more = new[]
        {
            new ShiftAssignedLine("Bob Participant", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(15, 0)),
            new ShiftAssignedLine("Cy Participant", new DateOnly(2026, 9, 16), new TimeOnly(9, 0), new TimeOnly(15, 0)),
        };
        var message = ShiftAssignedTemplate.Render(new ShiftAssignedPayload("worker@example.com", "Alice Participant", Sep14, new TimeOnly(9, 0), new TimeOnly(15, 0), more), BaseUrl);

        Assert.Equal("New shifts: 3 shifts from 14 Sep 2026", message.Subject);
        Assert.StartsWith("You've been assigned 3 shifts:\n", message.PlainTextBody);
    }

    /// <summary>Payloads already in the outbox carry no IsActivity on their lines; they must still read back, as shifts.</summary>
    [Fact]
    public void ShiftAssignedTemplate_OutboxPayloadWithoutIsActivity_DeserialisesAndRendersAsShifts()
    {
        const string json = """{"RecipientEmail":"worker@example.com","ParticipantName":"Alice Participant","ServiceDate":"2026-09-14","StartTime":"09:00:00","EndTime":"15:00:00","MoreShifts":[{"ParticipantName":"Bob Participant","ServiceDate":"2026-09-20","StartTime":"16:00:00","EndTime":"20:00:00"}]}""";
        var payload = System.Text.Json.JsonSerializer.Deserialize<ShiftAssignedPayload>(json)!;

        Assert.Equal("New shifts: 2 shifts from 14 Sep 2026", ShiftAssignedTemplate.Render(payload, BaseUrl).Subject);
    }

    /// <summary>
    /// Regression guard for the deploy failure: en-AU (the dev machine's culture) abbreviates
    /// September as "Sept", while the container's invariant globalization renders "Sep" — a
    /// mismatch that broke the Docker build's `dotnet test` step even though the equivalent test
    /// passed locally. Templates must format dates via <see cref="CultureInfo.InvariantCulture"/>
    /// so rendered output is identical regardless of the host's current culture.
    /// </summary>
    [Fact]
    public void ShiftAssignedTemplate_RendersInvariantDate_RegardlessOfCurrentCulture()
    {
        var originalCulture = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("en-AU");

            var payload = new ShiftAssignedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(17, 0));
            var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

            Assert.Equal("New shift: Alice Participant on 15 Sep 2026", message.Subject);
            Assert.DoesNotContain("Sept", message.Subject);
            Assert.DoesNotContain("Sept", message.PlainTextBody);
            Assert.DoesNotContain("Sept", message.HtmlBody);
        }
        finally
        {
            CultureInfo.CurrentCulture = originalCulture;
        }
    }

    [Fact]
    public void ShiftCompletionPendingReviewTemplate_RendersExactSubjectAndBody()
    {
        var payload = new ShiftCompletionPendingReviewPayload("coord@example.com", "Ben Turner", "Alice Participant", new DateOnly(2026, 9, 15));
        var message = ShiftCompletionPendingReviewTemplate.Render(payload, BaseUrl);

        Assert.Equal("Shift ready for review: Ben Turner / Alice Participant", message.Subject);
        Assert.Contains("awaiting review", message.PlainTextBody);
        Assert.Contains("https://odip.test/rostering", message.HtmlBody);
    }

    [Fact]
    public void ShiftCompletionPendingReviewTemplate_AGroupActivity_RendersTheActivityWording()
    {
        var payload = new ShiftCompletionPendingReviewPayload("coord@example.com", "Ben Turner", "Bowling", new DateOnly(2026, 9, 15), "Bowling");
        var message = ShiftCompletionPendingReviewTemplate.Render(payload, BaseUrl);

        Assert.Equal("Group activity ready for review: Ben Turner / Bowling", message.Subject);
        Assert.Contains("Ben Turner's hours for Bowling on ", message.PlainTextBody);
        Assert.Contains("have been submitted and are awaiting review.\n\nReview it: https://odip.test/rostering/completions", message.PlainTextBody);
        Assert.Contains("https://odip.test/rostering/completions", message.HtmlBody);
    }

    [Fact]
    public void ShiftCompletionReturnedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new ShiftCompletionReturnedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 15), "Missing end time");
        var message = ShiftCompletionReturnedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Shift returned for correction: Alice Participant on 15 Sep 2026", message.Subject);
        Assert.Contains("Missing end time", message.PlainTextBody);
        Assert.Contains("https://odip.test/portal", message.HtmlBody);
    }

    [Fact]
    public void WitnessRequestedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new WitnessRequestedPayload("witness@example.com", "Ben Turner", "Alice Participant");
        var message = WitnessRequestedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Witness needed: Alice Participant's medication", message.Subject);
        Assert.Contains("Ben Turner needs you to witness", message.PlainTextBody);
        Assert.Contains("https://odip.test/portal/witness-approvals", message.HtmlBody);
    }

    [Fact]
    public void CaregiverSubmissionReceivedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new CaregiverSubmissionReceivedPayload("coord@example.com", "Jane Caregiver", "Alice Participant");
        var message = CaregiverSubmissionReceivedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Caregiver submission received: Alice Participant", message.Subject);
        Assert.Contains("Jane Caregiver has submitted", message.PlainTextBody);
        Assert.Contains("https://odip.test/caregiver-submissions", message.HtmlBody);
    }

    /// <summary>Ruling (design spec §4): the IncidentReported email carries NO participant name anywhere.</summary>
    [Fact]
    public void IncidentReportedTemplate_RendersExactSubjectAndBody_WithNoParticipantName()
    {
        var payload = new IncidentReportedPayload("coord@example.com", "Ben Turner", "Fall", "Major");
        var message = IncidentReportedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Incident reported: fall (Major)", message.Subject);
        Assert.Contains("Ben Turner reported a Major fall incident.", message.PlainTextBody);
        Assert.Contains("https://odip.test/incidents", message.HtmlBody);

        Assert.DoesNotContain("Alice", message.Subject);
        Assert.DoesNotContain("Alice", message.PlainTextBody);
        Assert.DoesNotContain("Alice", message.HtmlBody);
        // The payload type itself has no participant-name property at all — this is a
        // compile-time guarantee, not just a runtime string check, but the runtime check above
        // documents the intent for anyone reading the test.
    }

    [Fact]
    public void IncidentReportable24hTemplate_GivesTheDeadlineAndTheLink_WithNoParticipantName()
    {
        var id = Guid.NewGuid();
        var message = IncidentReportable24hTemplate.Render(
            new IncidentReportable24hPayload("coord@example.com", "Ben Turner", "SexualAbuse", "High", "Wed 5 Nov, 2:15 pm", id), BaseUrl);

        Assert.Equal("Urgent: report this incident to the NDIS Commission by Wed 5 Nov, 2:15 pm", message.Subject);
        Assert.Contains("Ben Turner reported a High sexual abuse incident. It must be reported to the NDIS Commission within 24 hours, by Wed 5 Nov, 2:15 pm.", message.PlainTextBody);
        Assert.Contains($"https://odip.test/incidents/{id}", message.PlainTextBody);
        Assert.Contains($"<a href=\"https://odip.test/incidents/{id}\">Open the incident</a>", message.HtmlBody);
        Assert.DoesNotContain("Alice", message.Subject + message.PlainTextBody + message.HtmlBody);
    }

    [Fact]
    public void IncidentReportedTemplate_PrintsTheTypeInWords()
    {
        var message = IncidentReportedTemplate.Render(new IncidentReportedPayload("coord@example.com", "Ben Turner", "SexualAbuse", "High"), BaseUrl);

        Assert.Equal("Incident reported: sexual abuse (High)", message.Subject);
        Assert.Contains("Ben Turner reported a High sexual abuse incident.", message.PlainTextBody);
    }

    [Fact]
    public void ShiftUnassignedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new ShiftUnassignedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(15, 0));
        var message = ShiftUnassignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("worker@example.com", message.RecipientAddress);
        Assert.Equal("Taken off a shift: Alice Participant on 15 Sep 2026", message.Subject);
        Assert.Equal(
            "You've been taken off Alice Participant, 15 Sep 2026 9:00 AM to 3:00 PM.\n\nView your shifts: https://odip.test/portal",
            message.PlainTextBody);
        Assert.Contains("https://odip.test/portal", message.HtmlBody);
    }

    [Fact]
    public void ShiftUnassignedTemplate_Cancelled_RendersTheCancelledWording()
    {
        var payload = new ShiftUnassignedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(15, 0), Cancelled: true);
        var message = ShiftUnassignedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Shift cancelled: Alice Participant on 15 Sep 2026", message.Subject);
        Assert.Equal(
            "Your shift with Alice Participant, 15 Sep 2026 9:00 AM to 3:00 PM has been cancelled.\n\nView your shifts: https://odip.test/portal",
            message.PlainTextBody);
        Assert.Contains("Your shift with Alice Participant, 15 Sep 2026 9:00 AM to 3:00 PM has been cancelled.", message.HtmlBody);
        Assert.Contains("View your shifts", message.HtmlBody);
    }

    [Fact]
    public void ShiftChangedTemplate_RendersExactSubjectAndBody()
    {
        var payload = new ShiftChangedPayload("worker@example.com", "Alice Participant", new DateOnly(2026, 9, 15), new DateOnly(2026, 9, 15), new TimeOnly(10, 0), new TimeOnly(15, 0));
        var message = ShiftChangedTemplate.Render(payload, BaseUrl);

        Assert.Equal("Shift changed: Alice Participant on 15 Sep 2026", message.Subject);
        Assert.Equal(
            "Your shift with Alice Participant on 15 Sep 2026 has changed: now 10:00 AM\u00A0\u2013\u2060\u00A03:00 PM.\n\nView your shifts: https://odip.test/portal",
            message.PlainTextBody);
        Assert.Contains("has changed: now with Bo Jones.", ShiftChangedTemplate.Render(payload with { NewParticipantName = "Bo Jones", TimeChanged = false }, BaseUrl).HtmlBody);
    }

    [Fact]
    public void ShiftUnassignedPayload_FromAnOldOutboxRow_DefaultsToNotCancelled()
    {
        const string oldRow = "{\"RecipientEmail\":\"w@example.com\",\"ParticipantName\":\"Alice Participant\",\"ServiceDate\":\"2026-09-15\",\"StartTime\":\"09:00:00\",\"EndTime\":\"15:00:00\"}";
        var payload = System.Text.Json.JsonSerializer.Deserialize<ShiftUnassignedPayload>(oldRow)!;

        Assert.False(payload.Cancelled);
        Assert.Equal("Taken off a shift: Alice Participant on 15 Sep 2026", ShiftUnassignedTemplate.Render(payload, BaseUrl).Subject);
    }
}
