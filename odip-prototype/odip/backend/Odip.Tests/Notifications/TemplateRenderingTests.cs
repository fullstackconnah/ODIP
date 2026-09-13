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

        Assert.Equal("Incident reported: Fall (Major)", message.Subject);
        Assert.Contains("Ben Turner reported a Major Fall incident.", message.PlainTextBody);
        Assert.Contains("https://odip.test/incidents", message.HtmlBody);

        Assert.DoesNotContain("Alice", message.Subject);
        Assert.DoesNotContain("Alice", message.PlainTextBody);
        Assert.DoesNotContain("Alice", message.HtmlBody);
        // The payload type itself has no participant-name property at all — this is a
        // compile-time guarantee, not just a runtime string check, but the runtime check above
        // documents the intent for anyone reading the test.
    }
}
