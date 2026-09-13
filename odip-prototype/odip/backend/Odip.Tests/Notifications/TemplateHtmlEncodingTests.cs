using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// HTML-injection regression coverage: every payload field that can contain user/DB-controlled
/// text (staff/participant/requester names, decision notes, return reasons, incident labels)
/// must be HTML-encoded before landing in <c>HtmlBody</c>. A display name or free-text note of
/// <c>&lt;script&gt;alert(1)&lt;/script&gt;"&gt;&lt;img src=x&gt;</c> must never appear as live
/// markup in the rendered email.
/// </summary>
public class TemplateHtmlEncodingTests
{
    private const string BaseUrl = "https://odip.test";
    private const string Payload = "<script>alert(1)</script>\"><img src=x>";
    private const string Encoded = "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x&gt;";

    [Fact]
    public void LeaveRequestSubmittedTemplate_EncodesRequesterNameAndLeaveType()
    {
        var payload = new LeaveRequestSubmittedPayload(
            "coord@example.com", Payload, Payload, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));
        var message = LeaveRequestSubmittedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void LeaveRequestDecidedTemplate_EncodesLeaveTypeAndDecisionNote()
    {
        var payload = new LeaveRequestDecidedPayload(
            "staff@example.com", Payload, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), false, Payload);
        var message = LeaveRequestDecidedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void ShiftAssignedTemplate_EncodesParticipantName()
    {
        var payload = new ShiftAssignedPayload(
            "worker@example.com", Payload, new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(17, 0));
        var message = ShiftAssignedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void WitnessRequestedTemplate_EncodesStaffAndParticipantNames()
    {
        var payload = new WitnessRequestedPayload("witness@example.com", Payload, Payload);
        var message = WitnessRequestedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void CaregiverSubmissionReceivedTemplate_EncodesCaregiverAndParticipantNames()
    {
        var payload = new CaregiverSubmissionReceivedPayload("coord@example.com", Payload, Payload);
        var message = CaregiverSubmissionReceivedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void IncidentReportedTemplate_EncodesReportedByNameIncidentTypeAndSeverity()
    {
        var payload = new IncidentReportedPayload("coord@example.com", Payload, Payload, Payload);
        var message = IncidentReportedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void ShiftCompletionPendingReviewTemplate_EncodesWorkerAndParticipantNames()
    {
        var payload = new ShiftCompletionPendingReviewPayload(
            "coord@example.com", Payload, Payload, new DateOnly(2026, 9, 15));
        var message = ShiftCompletionPendingReviewTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void ShiftCompletionReturnedTemplate_EncodesParticipantNameAndReturnReason()
    {
        var payload = new ShiftCompletionReturnedPayload(
            "worker@example.com", Payload, new DateOnly(2026, 9, 15), Payload);
        var message = ShiftCompletionReturnedTemplate.Render(payload, BaseUrl);

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.Contains("&lt;script&gt;", message.HtmlBody);
        Assert.Contains(BaseUrl, message.HtmlBody);
    }

    [Fact]
    public void AllTemplates_ExactEncodedFieldAppearsInHtmlBody()
    {
        var leaveSubmitted = LeaveRequestSubmittedTemplate.Render(
            new LeaveRequestSubmittedPayload("a@example.com", Payload, "Annual", new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12)),
            BaseUrl);
        Assert.Contains(Encoded, leaveSubmitted.HtmlBody);

        var leaveDecided = LeaveRequestDecidedTemplate.Render(
            new LeaveRequestDecidedPayload("a@example.com", "Annual", new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), false, Payload),
            BaseUrl);
        Assert.Contains(Encoded, leaveDecided.HtmlBody);

        var shiftAssigned = ShiftAssignedTemplate.Render(
            new ShiftAssignedPayload("a@example.com", Payload, new DateOnly(2026, 9, 15), new TimeOnly(9, 0), new TimeOnly(17, 0)),
            BaseUrl);
        Assert.Contains(Encoded, shiftAssigned.HtmlBody);

        var witness = WitnessRequestedTemplate.Render(
            new WitnessRequestedPayload("a@example.com", Payload, "Alice Participant"),
            BaseUrl);
        Assert.Contains(Encoded, witness.HtmlBody);

        var caregiver = CaregiverSubmissionReceivedTemplate.Render(
            new CaregiverSubmissionReceivedPayload("a@example.com", Payload, "Alice Participant"),
            BaseUrl);
        Assert.Contains(Encoded, caregiver.HtmlBody);

        var incident = IncidentReportedTemplate.Render(
            new IncidentReportedPayload("a@example.com", Payload, "Fall", "Major"),
            BaseUrl);
        Assert.Contains(Encoded, incident.HtmlBody);

        var pendingReview = ShiftCompletionPendingReviewTemplate.Render(
            new ShiftCompletionPendingReviewPayload("a@example.com", Payload, "Alice Participant", new DateOnly(2026, 9, 15)),
            BaseUrl);
        Assert.Contains(Encoded, pendingReview.HtmlBody);

        var returned = ShiftCompletionReturnedTemplate.Render(
            new ShiftCompletionReturnedPayload("a@example.com", "Alice Participant", new DateOnly(2026, 9, 15), Payload),
            BaseUrl);
        Assert.Contains(Encoded, returned.HtmlBody);
    }
}
