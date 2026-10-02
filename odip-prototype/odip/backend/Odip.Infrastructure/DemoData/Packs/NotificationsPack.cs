using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The Admin notifications tab (plan 1b row 47, D8) for the events PR 2's domain raises, written as the terminal rows they end up as and never
/// Pending (a Pending row would be dispatched if <c>Notifications:Enabled</c> were ever switched on): the incident form's "incident reported" to
/// every active Admin or Coordinator for the four serious open incidents, the dose recorder's "witness requested" for the doses of the first two
/// days, and the portal's "shift ready for review" for the morning shift of the day before the first run. Most are Sent (each with its delivery log
/// row); one, to a coordinator, Failed after five attempts so the tab shows its Retry; the oldest incident's were Skipped, from before an email
/// server was set up. The notifier itself is never called (T10; the source scan keeps it so): the rows are built here, with the payload the template
/// would be rendered from.
///
/// They belong to the first days only, like the rows of any static story: a dose or a shift of a later day raises nothing here, so the tab does not
/// grow as the demo ages. Time (plan 2.0): every instant is the triggering event's own plus seconds, so a row is written only once the last of them
/// has passed (a Sent row's send, a Failed row's last attempt).
/// </summary>
public sealed class NotificationsPack : IDemoPack
{
    public string Name => "notifications";

    private const int MaxAttempts = 5;
    private static readonly int[] BackoffMinutes = { 1, 5, 15, 60 };       // the dispatcher's own schedule between attempts one to five

    private static readonly string[] IncidentEvents = { "I-03", "I-04", "I-10", "I-12" };

    private sealed record Planned(NotificationOutbox Row, NotificationLog? Log);

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var recipients = run.Directory.AllUsers.Where(u => u.IsActive && (u.Role == UserRole.Admin || u.Role == UserRole.Coordinator))
            .OrderBy(u => u.Email, StringComparer.OrdinalIgnoreCase).ToList();
        if (recipients.Count == 0) return;

        var staff = await run.FreshStaffAsync(ct);
        var chart = await DemoQueries.MedicationsByIds(run.Db, MedicationCatalog.New.Select(s => MedicationCatalog.IdOf(s.Key)).ToList()).ToListAsync(ct);
        var firstDay = MedicationCatalog.FirstRunDay(chart) ?? anchors.D0;
        var planned = new List<Planned>();

        // 1. Incident reported, to every recipient, for the serious open ones.
        var incidents = await DemoQueries.IncidentsByIds(run.Db, IncidentEvents.Select(IncidentCatalog.IdOf).ToList()).ToListAsync(ct);
        foreach (var incident in incidents.OrderBy(i => i.CreatedAt))
        {
            var reporter = staff.Values.FirstOrDefault(u => u.Id == incident.ReportedByUserId);
            if (reporter is null) continue;
            var key = IncidentEvents.Single(k => IncidentCatalog.IdOf(k) == incident.Id);
            for (var i = 0; i < recipients.Count; i++)
            {
                var recipient = recipients[i];
                var state = key == "I-10" ? NotificationOutboxStatus.Skipped
                    : key == "I-04" && recipients.Count > 1 && i == recipients.Count - 1 ? NotificationOutboxStatus.Failed : NotificationOutboxStatus.Sent;
                var payload = new IncidentReportedPayload(recipient.Email, reporter.FullName, incident.IncidentType.ToString(), incident.Severity.ToString());
                Plan(run, planned, NotificationEventType.IncidentReported, nameof(IncidentReport), incident.Id, recipient, payload, incident.CreatedAt, state);
            }
        }

        // 2. Witness requested, to the staff witness of each dose recorded on the first two days.
        var from = anchors.LocalToUtc(firstDay.AddDays(-1), TimeOnly.MinValue);
        var to = anchors.LocalToUtc(firstDay.AddDays(1), TimeOnly.MinValue);
        foreach (var dose in await DemoQueries.WitnessedDosesBetween(run.Db, from, to).ToListAsync(ct))
        {
            var witness = staff.Values.FirstOrDefault(u => u.Id == dose.WitnessUserId);
            if (witness is null) continue;
            var participant = run.Directory.AllParticipants.FirstOrDefault(p => p.Id == dose.ParticipantId)?.FullName ?? "a participant";
            Plan(run, planned, NotificationEventType.WitnessRequested, nameof(MedicationAdministration), dose.Id, witness,
                new WitnessRequestedPayload(witness.Email, dose.RecordedByName, participant), dose.CreatedAt, NotificationOutboxStatus.Sent);
        }

        // 3. Shift ready for review, to every recipient, for the morning shift of the day before the first run.
        var morning = LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, firstDay.AddDays(-1));
        var shift = (await DemoQueries.ShiftsByIds(run.Db, new List<Guid> { morning }).ToListAsync(ct)).FirstOrDefault();
        var completion = shift is null ? null : (await DemoQueries.SubmittedCompletionsOf(run.Db, new List<Guid> { morning }).ToListAsync(ct)).FirstOrDefault();
        var worker = shift is null ? null : staff.Values.FirstOrDefault(u => u.Id == shift.UserId);
        if (shift is not null && completion is not null && worker is not null && run.Directory.Participant(LiveSetCatalog.Morning.Participant) is { } sophie)
        {
            foreach (var recipient in recipients)
                Plan(run, planned, NotificationEventType.ShiftCompletionPendingReview, nameof(ShiftCompletion), completion.Id, recipient,
                    new ShiftCompletionPendingReviewPayload(recipient.Email, worker.FullName, sophie.FullName, shift.ServiceDate), completion.SubmittedAt!.Value, NotificationOutboxStatus.Sent);
        }

        if (planned.Count == 0) return;
        var existing = await run.ExistingIdsAsync<NotificationOutbox>(planned.Select(p => p.Row.Id), ct);
        var fresh = planned.Where(p => !existing.Contains(p.Row.Id)).ToList();
        if (fresh.Count == 0) return;

        foreach (var p in fresh)
        {
            run.Db.NotificationOutbox.Add(p.Row);
            if (p.Log is not null) run.Db.NotificationLogs.Add(p.Log);
        }
        await run.SaveAsync(ct);
        run.Added("notification rows", fresh.Count);
    }

    /// <summary>One outbox row (and its delivery log for a Sent one) for an event at an instant, unless its last time has not passed yet.</summary>
    private static void Plan(DemoRun run, List<Planned> planned, NotificationEventType type, string entityType, Guid entityId, User recipient, object payload,
        DateTime eventUtc, NotificationOutboxStatus state)
    {
        var id = DemoIds.For("outbox", type.ToString(), entityId, recipient.Id);
        var created = eventUtc.AddSeconds(DemoIds.Pick(id, "created", 1, 5));
        var row = new NotificationOutbox
        {
            Id = id, TenantId = run.TenantId, EventType = type, EntityType = entityType, EntityId = entityId, RecipientUserId = recipient.Id,
            PayloadJson = JsonSerializer.Serialize(payload), Status = state, NextAttemptAt = created, CreatedAt = created,
        };
        NotificationLog? log = null;
        DateTime done;
        switch (state)
        {
            case NotificationOutboxStatus.Sent:
                row.SentAt = created.AddSeconds(DemoIds.Pick(id, "sent", 20, 90));
                done = row.SentAt.Value;
                log = new NotificationLog
                {
                    Id = DemoIds.For("outbox-log", id), TenantId = run.TenantId, OutboxId = id, Channel = NotificationChannelKind.Email,
                    ProviderMessageId = $"demo-{id:N}", SentAt = row.SentAt.Value, RecipientAddress = recipient.Email,
                };
                break;
            case NotificationOutboxStatus.Failed:
                // Five transient failures, each retried after the dispatcher's backoff (1, 5, 15, 60 minutes): the next attempt is still scheduled from the last one.
                row.Attempts = MaxAttempts;
                row.LastError = "SMTP connection timed out";
                row.NextAttemptAt = created.AddMinutes(BackoffMinutes.Sum());
                done = row.NextAttemptAt;
                break;
            default:
                row.LastError = "SMTP is not configured";
                done = created;
                break;
        }
        if (done.AddMinutes(1) > run.Anchors.NowUtc) return;                                  // its last moment has not happened: written when it has
        planned.Add(new Planned(row, log));
    }
}
