using Odip.Domain.Notifications;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>The bell's text (dashboard spec 2026-10-14): one plain sentence per event, a route to the thing, and a safe fallback.</summary>
public class InAppNotificationTextTests
{
    private static readonly Guid Id = Guid.Parse("11111111-2222-3333-4444-555555555555");
    private static readonly DateOnly Oct13 = new(2026, 10, 13);

    public static TheoryData<NotificationEventType, object, string, string> EveryWiredEvent => new()
    {
        { NotificationEventType.LeaveRequestSubmitted, new LeaveRequestSubmittedPayload("a@x.au", "Sam Lee", "Annual", new(2026, 10, 20), new(2026, 10, 24)),
            "Sam Lee asked for annual leave, 20 to 24 Oct.", "/rostering/leave" },
        { NotificationEventType.LeaveRequestDecided, new LeaveRequestDecidedPayload("a@x.au", "Annual", new(2026, 10, 20), new(2026, 10, 24), true, null),
            "Your annual leave for 20 to 24 Oct was approved.", "/portal/leave" },
        { NotificationEventType.LeaveRequestDecided, new LeaveRequestDecidedPayload("a@x.au", "Sick", new(2026, 10, 20), new(2026, 10, 20), false, "No cover"),
            "Your sick leave for 20 Oct was declined.", "/portal/leave" },
        { NotificationEventType.ShiftAssigned, new ShiftAssignedPayload("a@x.au", "Grace Palmer-Hughes", new(2026, 9, 15), new(9, 0), new(17, 0)),
            "You're rostered with Grace Palmer-Hughes on Tue 15 Sep at 9:00 am.", $"/portal/shifts/{Id}" },
        { NotificationEventType.ShiftUnassigned, new ShiftUnassignedPayload("a@x.au", "Grace Palmer-Hughes", new(2026, 9, 15), new(9, 0), new(17, 0)),
            "You've been taken off Grace Palmer-Hughes on Tue 15 Sep at 9:00 am.", "/portal" },
        { NotificationEventType.ShiftUnassigned, new ShiftUnassignedPayload("a@x.au", "Grace Palmer-Hughes", new(2026, 9, 15), new(13, 30), new(17, 0), Cancelled: true),
            "Your shift with Grace Palmer-Hughes on Tue 15 Sep at 1:30 pm was cancelled.", $"/portal/shifts/{Id}" },
        { NotificationEventType.ShiftUnassigned, new ShiftUnassignedPayload("a@x.au", "Grace Palmer-Hughes", new(2026, 9, 15), new(13, 30), new(17, 0), Cancelled: true, StillTheirs: false),
            "Your shift with Grace Palmer-Hughes on Tue 15 Sep at 1:30 pm was cancelled.", "/portal" },
        { NotificationEventType.ShiftChanged, new ShiftChangedPayload("a@x.au", "Grace Palmer-Hughes", new(2026, 9, 15), new(2026, 9, 15), new(13, 30), new(17, 0)),
            "Your shift with Grace Palmer-Hughes on Tue 15 Sep has changed: now 1:30 pm\u00A0\u2013\u2060\u00A05:00 pm.", $"/portal/shifts/{Id}" },
        { NotificationEventType.ShiftChanged, new ShiftChangedPayload("a@x.au", "Grace Palmer-Hughes", new(2026, 9, 15), new(2026, 9, 16), new(13, 30), new(17, 0), "Sam Lee"),
            "Your shift with Grace Palmer-Hughes on Tue 15 Sep has changed: now with Sam Lee, Wed 16 Sep, 1:30 pm\u00A0\u2013\u2060\u00A05:00 pm.", $"/portal/shifts/{Id}" },
        { NotificationEventType.ShiftCompletionPendingReview, new ShiftCompletionPendingReviewPayload("a@x.au", "Sam Lee", "Grace Palmer-Hughes", Oct13),
            "Sam Lee's shift with Grace Palmer-Hughes on Tue 13 Oct is ready for review.", "/rostering/completions" },
        { NotificationEventType.ShiftCompletionReturned, new ShiftCompletionReturnedPayload("a@x.au", "Grace Palmer-Hughes", Oct13, "Missing the handover"),
            "Your shift with Grace Palmer-Hughes on Tue 13 Oct was returned. See why.", "/portal" },
        { NotificationEventType.WitnessRequested, new WitnessRequestedPayload("a@x.au", "Sam Lee", "Grace Palmer-Hughes"),
            "Sam Lee needs you to witness a medication for Grace Palmer-Hughes.", "/portal/witness-approvals" },
        { NotificationEventType.CaregiverSubmissionReceived, new CaregiverSubmissionReceivedPayload("a@x.au", "Ann Hughes", "Grace Palmer-Hughes"),
            "Ann Hughes sent a profile update for Grace Palmer-Hughes.", $"/caregiver-submissions/{Id}" },
        { NotificationEventType.IncidentReported, new IncidentReportedPayload("a@x.au", "Sam Lee", "BehaviourOfConcern", "High"),
            "Sam Lee reported an incident: behaviour of concern, high severity.", $"/incidents/{Id}" },
        { NotificationEventType.IntakeBooked, IntakeVisit(IntakeWording.Booked),
            "Intake visit booked: Noah Fitzgerald, Fri 16 Oct at 10:00 am.", "/portal" },
        { NotificationEventType.IntakeBooked, IntakeVisit(IntakeWording.Changed),
            "Intake visit changed: Noah Fitzgerald, Fri 16 Oct at 10:00 am.", "/portal" },
        { NotificationEventType.IntakeBooked, IntakeVisit(IntakeWording.Cancelled),
            "Intake visit cancelled: Noah Fitzgerald, Fri 16 Oct at 10:00 am.", "/portal" },
    };

    // Fri 16 Oct 2026 10:00 in Sydney (AEDT, +11).
    private static IntakeVisitStaffPayload IntakeVisit(string kind) => new(kind, "sam.lee@provider.example", "Sam Lee", "Noah Fitzgerald",
        new DateTime(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc), 90, "Australia/Sydney", "12 Smith St", "0412 555 010", "priya@example.com", "Notes",
        "Dana Smith", "dana@provider.example", "Sample Support Co", null, null, "abc@odip", 0, DateTime.UtcNow);

    [Theory]
    [MemberData(nameof(EveryWiredEvent))]
    public void Build_GivesOnePlainSentenceAndARoute_ForEveryWiredEvent(NotificationEventType type, object payload, string title, string link)
    {
        var built = InAppNotificationText.Build(type, Id, payload);
        Assert.Equal(title, built.Title);
        Assert.Equal(link, built.LinkTo);
        Assert.DoesNotContain("@", built.Title); // the payload's RecipientEmail never reaches the bell
    }

    public static IEnumerable<object[]> EveryTypeAndOneFromTheFuture() =>
        Enum.GetValues<NotificationEventType>().Append((NotificationEventType)999).Select(t => new object[] { t });

    /// <summary>Review Focus 1: a payload it does not know (a test's anonymous object, a reserved type, a type appended later) never throws.</summary>
    [Theory]
    [MemberData(nameof(EveryTypeAndOneFromTheFuture))]
    public void Build_NeverThrows_AndGivesTheGenericTitle_ForAnyTypeWithAPayloadItDoesNotKnow(NotificationEventType type)
    {
        foreach (var payload in new object?[] { new { }, null, "text" })
            Assert.Equal((InAppNotificationText.GenericTitle, (string?)null), InAppNotificationText.Build(type, Id, payload));
    }

    /// <summary>Plan check S5: a null string inside a known payload (a future caller's slip) must not throw inside the caller's save.</summary>
    [Fact]
    public void Build_NeverThrows_OnANullStringInAKnownPayload()
    {
        var built = InAppNotificationText.Build(NotificationEventType.IncidentReported, Id, new IncidentReportedPayload("a@x.au", null!, null!, null!));
        Assert.Equal($"/incidents/{Id}", built.LinkTo);
        Assert.False(string.IsNullOrEmpty(built.Title));
    }

    /// <summary>Fix round 1 (CR-B N2): a missing name reads as a neutral word, never as a gap at the start of the sentence.</summary>
    [Fact]
    public void Build_AMissingName_ReadsAsANeutralWord()
    {
        Assert.Equal("Someone asked for annual leave, 13 Oct.", InAppNotificationText.Build(NotificationEventType.LeaveRequestSubmitted, Id,
            new LeaveRequestSubmittedPayload("a@x.au", null!, "Annual", Oct13, Oct13)).Title);
        Assert.Equal("You're rostered with a participant on Tue 13 Oct at 9:00 am.", InAppNotificationText.Build(NotificationEventType.ShiftAssigned, Id,
            new ShiftAssignedPayload("a@x.au", " ", Oct13, new(9, 0), new(17, 0))).Title);
        Assert.Equal("Someone's shift with a participant on Tue 13 Oct is ready for review.", InAppNotificationText.Build(NotificationEventType.ShiftCompletionPendingReview, Id,
            new ShiftCompletionPendingReviewPayload("a@x.au", "", null!, Oct13)).Title);
    }

    [Fact]
    public void Build_NeedsTheMatchingPayload_NotJustAnyKnownOne()
    {
        var leave = new LeaveRequestSubmittedPayload("a@x.au", "Sam Lee", "Annual", Oct13, Oct13);
        Assert.Equal(InAppNotificationText.GenericTitle, InAppNotificationText.Build(NotificationEventType.ShiftAssigned, Id, leave).Title);
    }

    /// <summary>Names stay as typed. Also plan check N2: LeaveType.Other reads as plain "leave", not "other leave".</summary>
    [Fact]
    public void Build_KeepsNamesAsTyped_PlainTextNeverHtmlEncoded()
    {
        var title = InAppNotificationText.Build(NotificationEventType.LeaveRequestSubmitted, Id,
            new LeaveRequestSubmittedPayload("a@x.au", "James O'Brien <b>&</b>", "Other", Oct13, Oct13)).Title;
        Assert.Equal("James O'Brien <b>&</b> asked for leave, 13 Oct.", title);
    }

    [Theory]
    [InlineData(2026, 10, 20, 2026, 10, 20, "20 Oct")]
    [InlineData(2026, 10, 20, 2026, 10, 24, "20 to 24 Oct")]
    [InlineData(2026, 10, 30, 2026, 11, 2, "30 Oct to 2 Nov")]
    [InlineData(2026, 12, 30, 2027, 1, 2, "30 Dec 2026 to 2 Jan 2027")]
    public void LeaveDates_ReadAsARange(int y1, int m1, int d1, int y2, int m2, int d2, string range)
    {
        var title = InAppNotificationText.Build(NotificationEventType.LeaveRequestDecided, Id,
            new LeaveRequestDecidedPayload("a@x.au", "Personal", new(y1, m1, d1), new(y2, m2, d2), true, null)).Title;
        Assert.Equal($"Your personal leave for {range} was approved.", title);
    }

    [Theory]
    [InlineData(0, 5, "12:05 am")]
    [InlineData(12, 30, "12:30 pm")]
    [InlineData(18, 0, "6:00 pm")]
    public void ShiftTimes_ReadAsAClock(int hour, int minute, string clock)
    {
        var title = InAppNotificationText.Build(NotificationEventType.ShiftAssigned, Id,
            new ShiftAssignedPayload("a@x.au", "Grace Palmer-Hughes", Oct13, new(hour, minute), new(23, 0))).Title;
        Assert.EndsWith($"on Tue 13 Oct at {clock}.", title);
    }
}
