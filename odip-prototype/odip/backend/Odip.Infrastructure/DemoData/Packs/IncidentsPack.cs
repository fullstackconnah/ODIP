using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The incidents (plan 2.5, 1b row 27, 3a): twelve the demo starts with, the shift notes two of them hang from, and a few minor ones a week after
/// that, each moved along its script by the clock.
///
///  - The twelve (<see cref="IncidentCatalog.Static"/> and the slip below) are filed once, dated back from the day of the first run (two by the hour
///    from the first tick), as the incident form files them: Submitted (the draft stays a draft), its reporting Required where the form's rule says
///    so, with the injuries, the witnesses (three waiting, two approved, one declined, two who need no approval) and the obligation task a report to
///    the Commission needs. Everything after filing is a change on the incident's script (<see cref="IncidentTimeline"/>), each its own save and so
///    its own audit entry, by the coordinator, at its own time: the review (which records who had been told), the escalation, the report to the
///    Commission (which completes the task), the resolution and the closing. By the first run eight are open; all six statuses, all five reporting
///    states, ten of the eleven types and all four severities are there. One has waited more than a day for its report (Ryan's restraint, which stays
///    overdue for the demo); one is still inside its day (William's, whose report is made at 20 hours and its task completed then).
///  - The slip (I-09): the first day's note on Sophie's live shift at 09:41, which the scanner flags as Falls and Injury, raises the follow-up task;
///    at 10:30 the incident is filed from it with the shift and the note, and the task is closed as filing closes it. And one flagged note nobody has
///    filed anything from, on yesterday's evening shift, whose task stays open in the queue.
///  - Rolling: on about three days in ten a minor incident (a graze, a raised voice, a broken cup, a stomach upset, a late dose, a lost hearing
///    aid) is filed at a scripted time, never one that needs the Commission, so the tiles stay credible, and goes along its script: reviewed the
///    next morning (9:30), resolved on the fifth day (15:00), closed on the tenth (11:00).
///  - Whose change it is: a step is made only while the incident stands exactly as the script left it before that step (compare-and-set, plan 4.3), so
///    an incident somebody reviews, resolves or reopens by hand is left as they left it. An unrelated edit does not stop the script.
///
/// An incident has no tenant column, so it is the Demo tenant's by its reporter, and the guard checks that; its injuries and witnesses hang off it.
/// Nothing is sent: the notification the form would raise is not written (plan D8). Time (plan 2.0): when it happened, when the Commission was
/// reported to and when family were told are provider-local wall-clock values typed into the form (the wire inventory lists them as such); every
/// other instant is the one conversion of a local time.
/// </summary>
public sealed class IncidentsPack : IDemoPack
{
    public string Name => "incidents";

    private const int GraceMinutes = 2;
    private const int RollingLookbackDays = 14;
    private const int RollingPercent = 30;
    private const int AgingLookbackDays = 70;

    private static readonly TimeOnly SlipNoteAt = new(9, 41);
    private static readonly TimeOnly SlipIncidentAt = new(10, 30);
    private static readonly TimeOnly OpenNoteAt = new(18, 30);
    private static readonly string[] RollingReporters = { "james", "brendan", "rachel", "marcus", "priya", "emily", "daniel", "sarah" };

    private sealed record Ctx(DemoRun Run, IReadOnlyDictionary<string, User> Staff, DateOnly FirstDay)
    {
        public DemoAnchors A => Run.Anchors;
        public DateTime Utc(DateTime local) => A.LocalToUtc(local);
        public bool Due(DateTime utc) => utc.AddMinutes(GraceMinutes) <= A.NowUtc;
        public DateTime Local(DateTime utc) => ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(utc), A.Zone);
        public User? Reviewer => Staff.GetValueOrDefault("sarah");
    }

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var staff = await run.FreshStaffAsync(ct);
        var chart = await DemoQueries.MedicationsByIds(run.Db, MedicationCatalog.New.Select(s => MedicationCatalog.IdOf(s.Key)).ToList()).ToListAsync(ct);
        var c = new Ctx(run, staff, MedicationCatalog.FirstRunDay(chart) ?? run.Anchors.D0);

        await StaticAsync(c, ct);
        await SlipAsync(c, ct);
        await OpenNoteAsync(c, ct);
        await RollingAsync(c, ct);
        await AgeAsync(c, ct);
    }

    // ── the twelve (without the slip) ──

    private static async Task StaticAsync(Ctx c, CancellationToken ct)
    {
        var run = c.Run;
        var existing = await run.ExistingIdsAsync<IncidentReport>(IncidentCatalog.Static.Select(s => IncidentCatalog.IdOf(s.Key)), ct);
        var slot = PackageRows.Local(c.FirstDay.AddDays(-1), new TimeOnly(8, 0));
        var doseId = PackageRows.DoseId(MedicationCatalog.MiaSertraline, slot);
        var doseThere = (await run.ExistingIdsAsync<MedicationAdministration>(new[] { doseId }, ct)).Contains(doseId);

        var added = 0;
        foreach (var story in IncidentCatalog.Static.Where(s => !existing.Contains(IncidentCatalog.IdOf(s.Key))))
        {
            if (!c.Staff.TryGetValue(story.Reporter, out var reporter)) { run.Skipped($"incident {story.Key}", $"{story.Reporter} is missing"); continue; }
            DemoParticipant? participant = null;
            if (story.Participant is not null && (participant = run.Directory.Participant(story.Participant)) is null)
            {
                run.Skipped($"incident {story.Key}", $"{story.Participant} is missing");
                continue;
            }

            var createdUtc = story.HoursBefore is { } hours ? WholeMinute(c.A.NowUtc.AddHours(-hours)) : c.Utc(PackageRows.Local(c.FirstDay.AddDays(-story.DaysBefore), story.ReportedAt));
            if (!c.Due(createdUtc)) continue;                                              // reported later today: wait for it

            Insert(c, Build(c, story, reporter, participant, createdUtc, story.Key == "I-02" && doseThere ? doseId : null));
            added++;
        }
        if (added > 0)
        {
            await run.SaveAsync(ct);
            run.Added("incidents", added);
        }
    }

    private static DateTime WholeMinute(DateTime utc) => new(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMinute, DateTimeKind.Utc);

    /// <summary>An incident with the rows that go with it.</summary>
    private sealed record Plan(IncidentReport Incident, User Reporter, List<IncidentInjury> Injuries, List<IncidentWitness> Witnesses, BookingTask? QscTask);

    /// <summary>
    /// An incident as it is filed: Submitted (or the Draft it stays), its reporting Required when the story has a report to the Commission to come
    /// (the form's rule, which these types meet) or the state the story gives it, and none of what happens later. Its review, escalation, report,
    /// resolution and closing are on its script (<see cref="IncidentTimeline"/>), so the row says only what was true when it was filed.
    /// </summary>
    private static Plan Build(Ctx c, IncidentStory story, User reporter, DemoParticipant? participant, DateTime createdUtc, Guid? administration)
    {
        var id = IncidentCatalog.IdOf(story.Key);
        var createdLocal = c.Local(createdUtc);
        var incident = new IncidentReport
        {
            Id = id,
            ServiceType = story.Service,
            InvolvedParticipantId = participant?.Id,
            ReportedByUserId = reporter.Id,
            IncidentType = story.Type,
            OtherTypeSpecify = story.Type == IncidentType.Other ? "Equipment failure" : null,
            Severity = story.Severity,
            Status = story.Status == IncidentStatus.Draft ? IncidentStatus.Draft : IncidentStatus.Submitted,
            Title = story.Title,
            Description = story.Description,
            IncidentDateTime = createdLocal.AddMinutes(-(8 + DemoIds.Pick(id, "since", 0, 25))),
            Location = story.Location,
            ImmediateActionsTaken = ImmediateActions(story.Type),
            QscReportingStatus = IncidentCatalog.QscReports.ContainsKey(story.Key) ? QscReportingStatus.Required : story.Qsc,
            MedicationAdministrationId = administration,
            IsActive = true,
            CreatedAt = createdUtc,
            UpdatedAt = createdUtc,
        };

        var injuries = new List<IncidentInjury>();
        var witnesses = new List<IncidentWitness>();
        void Injury(BodyRegion region, InjuryType type, string text) => injuries.Add(new IncidentInjury
        {
            Id = DemoIds.For("incident-injury", story.Key, region.ToString()), IncidentReportId = id, Region = region, InjuryType = type, Description = text, CreatedAt = createdUtc,
        });
        void Witness(string key, WitnessStatus status, string? statement = null)
        {
            User? staff = null;
            var isStaff = DemoPeople.StaffEmails.ContainsKey(key);                       // a story key, not an outside person's description
            if (isStaff && !c.Staff.TryGetValue(key, out staff)) return;                 // the person is missing: no witness, never a made-up outsider
            var name = isStaff ? staff!.FullName : key;
            var responded = status is WitnessStatus.Approved or WitnessStatus.Declined ? createdUtc.AddMinutes(90 + DemoIds.Pick(id, "responded-" + key, 0, 500)) : (DateTime?)null;
            witnesses.Add(new IncidentWitness
            {
                Id = DemoIds.For("incident-witness", story.Key, key), IncidentReportId = id, WitnessUserId = isStaff ? staff!.Id : null, WitnessName = name,
                WitnessStatus = status, WitnessRequestedAt = status == WitnessStatus.NotRequired ? null : createdUtc, WitnessRespondedAt = responded,
                StatementText = statement, CreatedAt = createdUtc,
            });
        }

        switch (story.Key)
        {
            case "I-01":
                Injury(BodyRegion.RightKnee, InjuryType.Abrasion, "Grazed knee, cleaned and covered with a dressing.");
                Injury(BodyRegion.LeftWrist, InjuryType.SprainOrStrain, "Sore left wrist with normal movement. Ice applied for ten minutes.");
                Witness("jade", WitnessStatus.Pending);
                Witness("Lifeguard on duty (beach patrol)", WitnessStatus.NotRequired);
                incident.ImmediateActionsTaken = "The graze was cleaned and covered, ice applied to the wrist and movement checked. Ethan rested in the shade before walking on.";
                break;
            case "I-03":
                incident.RestrictivePracticeType = RestrictivePracticeType.PhysicalRestraint;
                incident.IsRestrictivePracticeAuthorised = false;
                incident.UnapprovedRestrictivePracticeDetails = "A brief physical hold of both arms by one worker for about two minutes, released as soon as Ryan was calm.";
                incident.ImmediateActionsTaken = "The hold was released as soon as Ryan stopped striking out. A quiet space and a drink were offered and the on-call coordinator was phoned.";
                Witness("emily", WitnessStatus.Approved, "I was in the next room and saw the end of it. Ryan was calm as soon as he was let go and nobody was hurt.");
                Witness("priya", WitnessStatus.Pending);
                break;
            case "I-04":
                Witness("rachel", WitnessStatus.Pending);
                break;
            case "I-05":
                Witness("daniel", WitnessStatus.Approved, "I met Chloe and the worker at the bus stop after security found her. She was safe and in good spirits.");
                Witness("Centre security officer", WitnessStatus.NotRequired);
                break;
            case "I-12":
                Injury(BodyRegion.RightHip, InjuryType.Bruise, "A bruise forming over the right hip. Painful to press, walking and standing normal. No ambulance called.");
                Witness("brendan", WitnessStatus.Declined, "I was not in the bathroom when it happened and cannot say more than what the note says.");
                break;
        }

        // A report to the Commission that has not been made yet is a task (SourceKey incident-qsc:{id}, due a day after the incident was filed, as the form raises it).
        BookingTask? task = null;
        if (incident.QscReportingStatus == QscReportingStatus.Required && incident.QscReportedAt is null)
        {
            task = new BookingTask
            {
                Id = DemoIds.For("task", "incident-qsc", id), TenantId = c.Run.TenantId, SourceKey = $"incident-qsc:{id}", TaskType = TaskType.IncidentQscReport,
                Title = $"Report incident to the NDIS Commission: {incident.Title}", DueDate = DateOnly.FromDateTime(createdUtc.AddHours(QscReporting.OverdueHours)),
                LinkTo = $"/incidents/{id}", IncidentReportId = id, Priority = TaskPriority.High, Status = TaskItemStatus.NotStarted, CreatedAt = createdUtc, UpdatedAt = createdUtc,
            };
        }
        return new Plan(incident, reporter, injuries, witnesses, task);
    }

    private static void Insert(Ctx c, Plan plan)
    {
        var db = c.Run.Db;
        db.IncidentReports.Add(plan.Incident);
        db.IncidentInjuries.AddRange(plan.Injuries);
        db.IncidentWitnesses.AddRange(plan.Witnesses);
        if (plan.QscTask is not null) db.BookingTasks.Add(plan.QscTask);
        c.Run.StampAudit(plan.Incident.Id, plan.Incident.CreatedAt, plan.Reporter);
        if (plan.QscTask is not null) c.Run.StampAudit(plan.QscTask.Id, plan.QscTask.CreatedAt, plan.Reporter);
    }

    private static string ImmediateActions(IncidentType type) => type switch
    {
        IncidentType.Injury => "First aid was given, the participant was checked over and the coordinator was told.",
        IncidentType.MedicationError => "The prescriber was phoned and the participant was watched for any effect.",
        IncidentType.Illness => "Fluids and rest, and the family was told.",
        IncidentType.BehaviourOfConcern => "Space and the usual calming steps from the behaviour support plan.",
        _ => "The coordinator was told and the details were written down at the time.",
    };

    // ── the slip (I-09) and the note that is still open ──

    private static async Task SlipAsync(Ctx c, CancellationToken ct)
    {
        var run = c.Run;
        var incidentId = IncidentCatalog.IdOf("I-09");
        if ((await run.ExistingIdsAsync<IncidentReport>(new[] { incidentId }, ct)).Count > 0) return;

        var shiftId = LiveSetCatalog.ShiftId(LiveSetCatalog.Morning, c.FirstDay);
        var shift = (await DemoQueries.ShiftsByIds(run.Db, new List<Guid> { shiftId }).ToListAsync(ct)).FirstOrDefault();
        if (shift is null || run.Directory.Participant(LiveSetCatalog.Morning.Participant) is not { } sophie) return;
        var worker = c.Staff.Values.FirstOrDefault(u => u.Id == shift.UserId);
        if (worker is null) return;

        var noteLocal = PackageRows.Local(c.FirstDay, SlipNoteAt);
        if (!c.Due(c.Utc(noteLocal))) return;
        if (!await OldSeedChecks.ShiftNotesThereAsync(run, "incident I-09's flagged note", ct)) return;

        var note = PackageRows.Note(run, shift, worker, noteLocal, IncidentCatalog.SlipNote);
        if ((await run.ExistingIdsAsync<ShiftNote>(new[] { note.Id }, ct)).Count == 0)
        {
            run.Db.ShiftNotes.Add(note);
            var task = PackageRows.FlaggedNoteTask(run, note, c.FirstDay);
            run.Db.BookingTasks.Add(task);
            run.StampAudit(note.Id, note.CreatedAt, worker);
            run.StampAudit(task.Id, task.CreatedAt, worker);
            await run.SaveAsync(ct);
            run.Added("incident notes");
        }

        var createdUtc = c.Utc(PackageRows.Local(c.FirstDay, SlipIncidentAt));
        if (!c.Due(createdUtc)) return;                                                     // filed at 10:30: the note and its open task wait for it

        var story = new IncidentStory("I-09", "sophie", worker.FirstName.ToLowerInvariant(), IncidentType.Injury, IncidentSeverity.Medium, IncidentStatus.Submitted, QscReportingStatus.Pending,
            "Sophie slipped in the bathroom",
            "Sophie slipped on the wet bathroom tiles while getting ready this morning and put her left hand out to stop herself. A small graze on the left elbow, cleaned and covered. "
            + "She was a little shaken and settled with a cup of tea. No other concerns. Filed from the shift note written at 09:41.",
            "Sophie's bathroom", 0, SlipIncidentAt, Service: ServiceStreams.InHomeSupport);
        var plan = Build(c, story, worker, sophie, createdUtc, null);
        plan.Incident.ShiftId = shift.Id;
        plan.Incident.ShiftNoteId = note.Id;
        plan.Injuries.Add(new IncidentInjury
        {
            Id = DemoIds.For("incident-injury", "I-09", BodyRegion.LeftElbow.ToString()), IncidentReportId = incidentId, Region = BodyRegion.LeftElbow, InjuryType = InjuryType.Abrasion,
            Description = "Small graze on the left elbow, cleaned and covered.", CreatedAt = createdUtc,
        });
        Insert(c, plan);

        // Filing the incident answers the follow-up: its task is completed by the form's own call, at the same moment.
        var open = (await DemoQueries.OpenTasksByKeys(run.Db, new List<string> { $"flagged-note:{note.Id}" }).ToListAsync(ct)).FirstOrDefault();
        if (open is not null)
        {
            PackageRows.CloseTask(run, open, createdUtc);
            run.StampAudit(open.Id, createdUtc, worker);
        }
        await run.SaveAsync(ct);
        run.Added("incidents");
    }

    private static async Task OpenNoteAsync(Ctx c, CancellationToken ct)
    {
        var run = c.Run;
        var day = c.FirstDay.AddDays(-1);
        var shift = (await DemoQueries.ShiftsByIds(run.Db, new List<Guid> { LiveSetCatalog.ShiftId(LiveSetCatalog.Evening, day) }).ToListAsync(ct)).FirstOrDefault();
        if (shift is null) return;
        var worker = c.Staff.Values.FirstOrDefault(u => u.Id == shift.UserId);
        if (worker is null) return;

        var noteLocal = PackageRows.Local(day, OpenNoteAt);
        if (!c.Due(c.Utc(noteLocal))) return;
        var note = PackageRows.Note(run, shift, worker, noteLocal, IncidentCatalog.OpenNote);
        if ((await run.ExistingIdsAsync<ShiftNote>(new[] { note.Id }, ct)).Count > 0) return;
        if (!await OldSeedChecks.ShiftNotesThereAsync(run, "the open flagged note", ct)) return;

        run.Db.ShiftNotes.Add(note);
        var task = PackageRows.FlaggedNoteTask(run, note, day);
        run.Db.BookingTasks.Add(task);
        run.StampAudit(note.Id, note.CreatedAt, worker);
        run.StampAudit(task.Id, task.CreatedAt, worker);
        await run.SaveAsync(ct);
        run.Added("incident notes");
    }

    // ── the minor ones that follow ──

    private static async Task RollingAsync(Ctx c, CancellationToken ct)
    {
        var run = c.Run;
        var people = run.Directory.AllParticipants.Where(p => p.Key.Length > 0 && p.CanBeRostered).OrderBy(p => p.Key, StringComparer.Ordinal).ToList();
        var reporters = RollingReporters.Where(k => c.Staff.ContainsKey(k)).ToList();
        if (people.Count == 0 || reporters.Count == 0) return;

        var candidates = new List<(DateOnly Date, Guid Id, DateTime CreatedUtc, IncidentCatalog.RollingStory Story, DemoParticipant Participant, User Reporter)>();
        for (var i = 0; i <= RollingLookbackDays; i++)
        {
            var date = c.A.D0.AddDays(-i);
            var key = DemoIds.For("incident-day", date);
            if (DemoIds.Pick(key, "has", 0, 99) >= RollingPercent) continue;

            var createdUtc = c.Utc(PackageRows.Local(date, new TimeOnly(9, 0)).AddMinutes(DemoIds.Pick(key, "time", 0, 480)));
            if (!c.Due(createdUtc)) continue;
            candidates.Add((date, DemoIds.For("incident", "rolling", date), createdUtc, IncidentCatalog.Rolling[DemoIds.Pick(key, "story", 0, IncidentCatalog.Rolling.Count - 1)],
                people[DemoIds.Pick(key, "who", 0, people.Count - 1)], c.Staff[reporters[DemoIds.Pick(key, "reporter", 0, reporters.Count - 1)]]));
        }
        if (candidates.Count == 0) return;

        var existing = await run.ExistingIdsAsync<IncidentReport>(candidates.Select(x => x.Id), ct);
        var added = 0;
        foreach (var (date, id, createdUtc, story, participant, reporter) in candidates.Where(x => !existing.Contains(x.Id)))
        {
            var first = participant.FullName.Split(' ')[0];
            var created = c.Local(createdUtc);
            var incident = new IncidentReport
            {
                Id = id, ServiceType = ServiceStreams.CommunityAccessDailyLiving, InvolvedParticipantId = participant.Id, ReportedByUserId = reporter.Id,
                IncidentType = story.Type, OtherTypeSpecify = story.OtherType, Severity = story.Severity, Status = IncidentStatus.Submitted,
                Title = story.Title, Description = story.Description.Replace("{n}", first, StringComparison.Ordinal), Location = story.Location.Replace("{n}", first, StringComparison.Ordinal),
                IncidentDateTime = created.AddMinutes(-(10 + DemoIds.Pick(id, "since", 0, 50))), ImmediateActionsTaken = ImmediateActions(story.Type),
                QscReportingStatus = QscReportingStatus.NotRequired, IsActive = true, CreatedAt = createdUtc, UpdatedAt = createdUtc,
            };
            run.Db.IncidentReports.Add(incident);
            if (story.Injury)
            {
                var region = new[] { BodyRegion.RightKnee, BodyRegion.LeftKnee, BodyRegion.RightElbow, BodyRegion.LeftHand }[DemoIds.Pick(id, "region", 0, 3)];
                run.Db.IncidentInjuries.Add(new IncidentInjury
                {
                    Id = DemoIds.For("incident-injury", "rolling", date), IncidentReportId = id, Region = region, InjuryType = InjuryType.Abrasion,
                    Description = "A graze, cleaned and covered with a dressing.", CreatedAt = createdUtc,
                });
            }
            run.StampAudit(id, createdUtc, reporter);
            added++;
        }
        if (added > 0)
        {
            await run.SaveAsync(ct);
            run.Added("incidents", added);
        }
    }

    // ── the script ──

    private static async Task AgeAsync(Ctx c, CancellationToken ct)
    {
        var run = c.Run;
        if (c.Reviewer is not { } reviewer)
        {
            run.Skipped("incident script", "the coordinator (sarah) is missing, so no incident is reviewed, escalated, reported, resolved or closed");
            return;
        }

        // The twelve and the rolling ones move along their scripts; nothing else in the tenant (an incident somebody files by hand) is ever touched.
        var rolling = Enumerable.Range(0, AgingLookbackDays + 1).Select(i => DemoIds.For("incident", "rolling", c.A.D0.AddDays(-i))).ToHashSet();
        var moving = (await DemoQueries.AgingIncidents(run.Db, c.Staff.Values.Select(u => u.Id).ToList(), c.A.NowUtc.AddDays(-AgingLookbackDays)).ToListAsync(ct))
            .Select(i => (Incident: i, Story: IncidentCatalog.StoryOf(i.Id)))
            .Where(x => x.Story is not null || rolling.Contains(x.Incident.Id))
            .OrderBy(x => x.Incident.CreatedAt).ToList();

        foreach (var (incident, story) in moving)
        {
            var script = IncidentTimeline.For(story, incident.CreatedAt, c.A.Zone);
            foreach (var step in script)
            {
                if (!IncidentTimeline.IsPending(incident, step, script)) continue;       // made already, or somebody else has taken the incident on
                if (!c.Due(step.WhenUtc)) break;                                         // still to come, and so is everything after it
                await ApplyAsync(c, incident, story, step, reviewer, ct);                // one step, one save: its own audit entry, at its own time
            }
        }
    }

    /// <summary>
    /// One change on the script, made as the coordinator would make it (the incident's own fields, and the obligation task when the report is made),
    /// saved by itself so the audit entry the interceptor writes is this change alone, stamped with the step's time and the coordinator.
    /// </summary>
    private static async Task ApplyAsync(Ctx c, IncidentReport incident, IncidentStory? story, IncidentStep step, User coordinator, CancellationToken ct)
    {
        var run = c.Run;
        var when = step.WhenUtc;
        switch (step.Kind)
        {
            case IncidentStepKind.Review:
                incident.Status = IncidentStatus.UnderReview;
                incident.ReviewedByUserId = coordinator.Id;
                incident.ReviewedAt = when;
                RecordTold(c, incident, story);
                break;
            case IncidentStepKind.Escalate:
                incident.Status = IncidentStatus.Escalated;
                break;
            case IncidentStepKind.Report:
                // Within 24 hours of filing the report is on time, after it late (the labels the app's own rule reads), and its time is typed as the wall clock of the moment.
                incident.QscReportingStatus = when - incident.CreatedAt <= TimeSpan.FromHours(QscReporting.OverdueHours) ? QscReportingStatus.ReportedWithin24h : QscReportingStatus.ReportedLate;
                incident.QscReportedAt = c.Local(when);
                incident.QscReferenceNumber = story is not null && IncidentCatalog.QscReports.TryGetValue(story.Key, out var report) ? report.Reference : null;
                foreach (var task in await DemoQueries.OpenTasksByKeys(run.Db, new List<string> { $"incident-qsc:{incident.Id}" }).ToListAsync(ct))
                {
                    PackageRows.CloseTask(run, task, when);
                    run.StampAudit(task.Id, when, coordinator);
                }
                break;
            case IncidentStepKind.Resolve:
                incident.Status = IncidentStatus.Resolved;
                incident.ReviewNotes = IncidentCatalog.ReviewNotes[DemoIds.Pick(incident.Id, "review-notes", 0, IncidentCatalog.ReviewNotes.Length - 1)];
                incident.CorrectiveActions = IncidentCatalog.CorrectiveActions[DemoIds.Pick(incident.Id, "corrective", 0, IncidentCatalog.CorrectiveActions.Length - 1)];
                incident.ResolvedAt = when;
                break;
            case IncidentStepKind.Close:
                incident.Status = IncidentStatus.Closed;
                break;
        }
        if (incident.UpdatedAt < when) incident.UpdatedAt = when;                          // forward only: a later edit by somebody else keeps its own stamp
        run.StampAudit(incident.Id, when, coordinator);
        await run.SaveAsync(ct);
        run.Changed(step.Kind == IncidentStepKind.Report ? "incidents reported" : "incidents aged");
    }

    /// <summary>Who had been told by the time of the review, as the coordinator records it: wall-clock times, typed into the compliance step.</summary>
    private static void RecordTold(Ctx c, IncidentReport incident, IncidentStory? story)
    {
        if (story is null || !IncidentCatalog.ToldAfter.TryGetValue(story.Key, out var told)) return;
        var created = c.Local(incident.CreatedAt);
        if (told.FamilyMinutes is { } familyMinutes)
        {
            incident.FamilyNotified = true;
            incident.FamilyNotifiedAt = created.AddMinutes(familyMinutes);
        }
        if (told.CoordinatorMinutes is { } coordinatorMinutes)
        {
            incident.SupportCoordinatorNotified = true;
            incident.SupportCoordinatorNotifiedAt = created.AddMinutes(coordinatorMinutes);
        }
    }
}
