using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Notifications.Templates;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The Admin notifications tab (plan D8, T10): terminal rows for the events PR 2's domain raises, never Pending, each Sent one with its delivery log,
/// one Failed with its Retry, the oldest incident's Skipped, and nothing raised for anything after the first days.
/// </summary>
public class DemoNotificationsTests
{
    private static readonly DateTimeOffset FirstRun = new(2026, 10, 2, 0, 35, 0, TimeSpan.Zero);          // Fri 10:35 AEST

    private static async Task<(List<NotificationOutbox> Rows, List<NotificationLog> Logs, Dictionary<Guid, User> Users)> RowsAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        return (await db.NotificationOutbox.ToListAsync(), await db.NotificationLogs.ToListAsync(), await db.Users.ToDictionaryAsync(u => u.Id));
    }

    [Fact]
    public async Task TheRows_AreThePlansMix_AndNoneIsEverPending()
    {
        var env = await TickAsync(FirstRun);
        var (rows, logs, _) = await RowsAsync(env);

        Assert.Equal(12, rows.Count);                                                        // 4 incidents x 2 coordinators, 2 witness requests, 2 shifts ready for review
        Assert.DoesNotContain(rows, r => r.Status == NotificationOutboxStatus.Pending);      // T10
        Assert.Equal(9, rows.Count(r => r.Status == NotificationOutboxStatus.Sent));
        Assert.Single(rows, r => r.Status == NotificationOutboxStatus.Failed);
        Assert.Equal(2, rows.Count(r => r.Status == NotificationOutboxStatus.Skipped));
        Assert.Equal(8, rows.Count(r => r.EventType == NotificationEventType.IncidentReported));
        Assert.Equal(2, rows.Count(r => r.EventType == NotificationEventType.WitnessRequested));
        Assert.Equal(2, rows.Count(r => r.EventType == NotificationEventType.ShiftCompletionPendingReview));
        Assert.Equal(rows.Count(r => r.Status == NotificationOutboxStatus.Sent), logs.Count);
    }

    [Fact]
    public async Task EachSentRow_HasExactlyOneDeliveryLog_ToTheRecipientsAddress_AndFailedAndSkippedRowsHaveNone()
    {
        var env = await TickAsync(FirstRun);
        var (rows, logs, users) = await RowsAsync(env);

        foreach (var row in rows)
        {
            var mine = logs.Where(l => l.OutboxId == row.Id).ToList();
            if (row.Status == NotificationOutboxStatus.Sent)
            {
                var log = Assert.Single(mine);
                Assert.Equal(users[row.RecipientUserId].Email, log.RecipientAddress);
                Assert.Equal(row.SentAt, log.SentAt);
                Assert.Equal(NotificationChannelKind.Email, log.Channel);
                Assert.Null(row.LastError);
                Assert.InRange((row.SentAt!.Value - row.CreatedAt).TotalSeconds, 20, 90);
            }
            else
            {
                Assert.Empty(mine);
                Assert.Null(row.SentAt);
            }
        }

        var failed = rows.Single(r => r.Status == NotificationOutboxStatus.Failed);
        Assert.Equal(5, failed.Attempts);                                                    // the Admin tab shows Retry
        Assert.Equal("SMTP connection timed out", failed.LastError);
        Assert.Equal(failed.CreatedAt.AddMinutes(1 + 5 + 15 + 60), failed.NextAttemptAt);    // the dispatcher's own backoff, still scheduled from the last attempt
        Assert.All(rows.Where(r => r.Status == NotificationOutboxStatus.Skipped), r =>
        {
            Assert.Equal("SMTP is not configured", r.LastError);
            Assert.Equal(0, r.Attempts);
        });
    }

    [Fact]
    public async Task EveryPayload_IsWhatTheTemplateWouldBeRenderedFrom_ForTheRowsOwnRecipientAndEvent()
    {
        var env = await TickAsync(FirstRun);
        var (rows, _, users) = await RowsAsync(env);

        foreach (var row in rows)
        {
            var recipient = users[row.RecipientUserId];
            Assert.Equal(DemoTestEnv.DemoTenantId, row.TenantId);
            switch (row.EventType)
            {
                case NotificationEventType.IncidentReported:
                    var incident = JsonSerializer.Deserialize<IncidentReportedPayload>(row.PayloadJson)!;
                    Assert.Equal(recipient.Email, incident.RecipientEmail);
                    Assert.Equal("IncidentReport", row.EntityType);
                    Assert.Contains(incident.ReportedByName, new[] { "Daniel Williams", "Sarah Mitchell", "Rachel Thompson", "Marcus Papadopoulos" });
                    Assert.Contains(incident.IncidentType, new[] { "RestrictivePracticeUse", "Abuse", "Neglect", "Injury" });
                    Assert.Contains(incident.Severity, new[] { "High", "Critical" });
                    break;
                case NotificationEventType.WitnessRequested:
                    var witness = JsonSerializer.Deserialize<WitnessRequestedPayload>(row.PayloadJson)!;
                    Assert.Equal(recipient.Email, witness.RecipientEmail);
                    Assert.Equal("MedicationAdministration", row.EntityType);
                    Assert.Equal("Marcus Papadopoulos", witness.AdministeringStaffName);
                    Assert.Equal("Harrison Lee", witness.ParticipantName);
                    break;
                case NotificationEventType.ShiftCompletionPendingReview:
                    var review = JsonSerializer.Deserialize<ShiftCompletionPendingReviewPayload>(row.PayloadJson)!;
                    Assert.Equal(recipient.Email, review.RecipientEmail);
                    Assert.Equal("ShiftCompletion", row.EntityType);
                    Assert.Equal("Sophie Brown", review.ParticipantName);
                    Assert.Equal(Friday.AddDays(-1), review.ServiceDate);
                    break;
                default:
                    Assert.Fail($"unexpected event {row.EventType}");
                    break;
            }
        }
    }

    [Fact]
    public async Task TheRecipients_AreTheActiveAdminsAndCoordinators_OrTheWitness_NeverTheReadOnlyUser()
    {
        var env = await TickAsync(FirstRun);
        var (rows, _, users) = await RowsAsync(env);

        foreach (var row in rows.Where(r => r.EventType != NotificationEventType.WitnessRequested))
            Assert.True(users[row.RecipientUserId].Role is UserRole.Admin or UserRole.Coordinator && users[row.RecipientUserId].IsActive);
        Assert.All(rows.Where(r => r.EventType == NotificationEventType.WitnessRequested), r => Assert.Equal(DemoFixture.StaffId("james"), r.RecipientUserId));
        Assert.DoesNotContain(rows, r => users[r.RecipientUserId].Role == UserRole.ReadOnly);
    }

    // The offsets (a second or two to raise, twenty to ninety seconds to send) are a function of the row's own id, so each first day's request has its own:
    // across a week of first days some are sent more than two minutes after the dose is written and some less, which is what makes the rule observable.
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    public async Task ARowIsWritten_OneMinuteAfterItsLastTime_AndNotBefore_NorBeforeTheEventItself(int days)
    {
        // The insulin witness request of the first day: the dose is written down at 08:17 (and appears in the demo two minutes later), the request goes
        // out some seconds after that and is sent a little later still. Read the times from a full run, then find the moment the row appears in a demo
        // ticked from early morning: one minute after the send, or when the dose itself appears, whichever is later.
        var reference = await TickAsync(FirstRun.AddDays(days));
        var (refRows, _, _) = await RowsAsync(reference);
        var day = DateOnly.FromDateTime(Local(FirstRun.AddDays(days).UtcDateTime));
        var row = refRows.Single(r => r.EventType == NotificationEventType.WitnessRequested && DateOnly.FromDateTime(Local(r.CreatedAt)) == day);
        await using var refDb = reference.AdminDb();
        var dose = await refDb.MedicationAdministrations.SingleAsync(a => a.Id == row.EntityId);
        var appears = new[] { row.SentAt!.Value.AddMinutes(1), dose.CreatedAt.AddMinutes(2) }.Max();

        var env = await TickAsync(new DateTimeOffset(2026, 10, 1, 20, 30, 0, TimeSpan.Zero).AddDays(days));         // about 06:30 on the day: the shift is cast, nobody has started
        await RunAsync(env, new DateTimeOffset(appears, TimeSpan.Zero).AddSeconds(-1));
        Assert.DoesNotContain((await RowsAsync(env)).Rows, r => r.Id == row.Id);

        await RunAsync(env, new DateTimeOffset(appears, TimeSpan.Zero));
        Assert.Contains((await RowsAsync(env)).Rows, r => r.Id == row.Id);
    }

    [Fact]
    public async Task NothingIsRaisedForLaterDays_SoTheTabDoesNotGrowAsTheDemoAges_AndASecondTickChangesNothing()
    {
        var env = await TickAsync(FirstRun);
        var before = (await RowsAsync(env)).Rows.Select(r => r.Id).ToHashSet();

        for (var day = 1; day <= 30; day += 2) await RunAsync(env, FirstRun.AddDays(day));
        var after = await RowsAsync(env);

        Assert.Equal(before, after.Rows.Select(r => r.Id).ToHashSet());
        Assert.DoesNotContain(after.Rows, r => r.Status == NotificationOutboxStatus.Pending);
        var again = await RunAsync(env, FirstRun.AddDays(30));
        Assert.DoesNotContain(again.RowsAdded.Keys, k => k.StartsWith("notifications/", StringComparison.Ordinal));
    }

    [Fact]
    public async Task OnTheRealSeed_TheRowsAreTheSame_NoneIsPending_AndTheStrictRecipientsAreTheDemoTenantsCoordinatorsAndAdmins()
    {
        var env = new DemoTestEnv(FirstRun);
        await using (var db = env.AdminDb()) await DemoOldSeedTests.RunOldSeedAsync(db);
        Assert.Empty((await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None)).Failures);

        var (rows, logs, users) = await RowsAsync(env);

        Assert.NotEmpty(rows);
        Assert.DoesNotContain(rows, r => r.Status == NotificationOutboxStatus.Pending);
        Assert.Equal(rows.Count(r => r.Status == NotificationOutboxStatus.Sent), logs.Count);
        Assert.All(rows, r => Assert.Equal(DemoTestEnv.DemoTenantId, users[r.RecipientUserId].TenantId));
    }
}
