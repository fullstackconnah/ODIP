using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

public static partial class DbSeeder
{
    /// <summary>
    /// INTAKE-03/04. Seeds the CommunityAccessDailyLiving service-stream variant for a
    /// representative subset of demo participants: adds the ServiceStreams flag, a representative
    /// subset of <see cref="ParticipantChecklistItem"/> rows (both new checklists), HowToHelpNotes
    /// on a few of their existing <see cref="ParticipantAdlAssessment"/> rows, all four
    /// SupportsLookLike* shift blocks, and the six BOC/happy-settled flat fields (research spec
    /// §3). Chosen participants: Sophie Brown (ABI + Epilepsy — already has CommunityAccess ADL
    /// supervision notes for seizure risk, a natural CA fit), Charlotte White (autism L3, flight
    /// risk — already has 1:1 line-of-sight community-access supervision notes, the clearest
    /// existing CA fit in the demo data), and Olivia Wilson (CP quadriplegia, power wheelchair,
    /// non-verbal/AAC — a strong fit for the Community Mobility &amp; Transport Risk checklist
    /// specifically). All three are finalised (non-draft) participants already receiving other
    /// in-home-support-style attention (Sophie/Charlotte both already appear throughout the
    /// clinical-enrichment/ADL seeders above). Idempotent via fixed GUIDs (formulaic, same pattern
    /// as SeedParticipantAdlAssessmentsAsync) + an existence check on ParticipantChecklistItems.
    /// </summary>
    public static async Task SeedCommunityAccessDailyLivingAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantChecklistItems.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var targetIds = new[] { sophieId, charlotteId, oliviaId };

        var participants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).ToListAsync(ct);
        if (participants.Count == 0)
            return;

        var adlRows = await context.ParticipantAdlAssessments.IgnoreQueryFilters([TenantFilter.Name])
            .Where(a => targetIds.Contains(a.ParticipantId)).ToListAsync(ct);

        void SetAdlHowToHelp(Guid participantId, AdlType type, string howToHelp)
        {
            var row = adlRows.FirstOrDefault(a => a.ParticipantId == participantId && a.AdlType == type);
            if (row != null) row.HowToHelpNotes = howToHelp;
        }

        var checklistPlans = new (Guid ParticipantId, (ChecklistItemType Type, ChecklistItemValue? Value, string? Notes)[] Rows)[]
        {
            // Sophie Brown — ABI + Epilepsy, seizure risk in community, supervision-level community access.
            (sophieId, new[]
            {
                (ChecklistItemType.UsesWheelchair, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.FallsRisk, (ChecklistItemValue?)ChecklistItemValue.Yes, "Seizure-related falls risk — supervise on stairs/uneven ground."),
                (ChecklistItemType.SensorySensitivities, (ChecklistItemValue?)ChecklistItemValue.Yes, "Avoid loud/crowded venues where possible."),
                (ChecklistItemType.SeatbeltMustBeChecked, (ChecklistItemValue?)ChecklistItemValue.Yes, (string?)null),
                (ChecklistItemType.HarmToSelf, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.AbscondingRunningAway, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.VerbalAggressionYelling, (ChecklistItemValue?)ChecklistItemValue.NotApplicable, (string?)null),
            }),
            // Charlotte White — autism L3, flight risk, 1:1 line-of-sight supervision in the community.
            (charlotteId, new[]
            {
                (ChecklistItemType.UsesWheelchair, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.SensorySensitivities, (ChecklistItemValue?)ChecklistItemValue.Yes, "Noise/crowds — carry noise-cancelling headphones."),
                (ChecklistItemType.CommunicationAidOrDeviceUsed, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.AbscondingRunningAway, (ChecklistItemValue?)ChecklistItemValue.Yes, "Flight risk in unfamiliar environments — 1:1 line-of-sight supervision required."),
                (ChecklistItemType.HarmToSelf, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.HarmToOthers, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.RefusalToMoveTransition, (ChecklistItemValue?)ChecklistItemValue.Yes, "May refuse to leave a preferred activity — give a 5-minute warning before transitions."),
                (ChecklistItemType.InappropriatePublicBehaviour, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
            }),
            // Olivia Wilson — CP quadriplegia, power wheelchair, non-verbal/AAC.
            (oliviaId, new[]
            {
                (ChecklistItemType.UsesWheelchair, (ChecklistItemValue?)ChecklistItemValue.Yes, (string?)null),
                (ChecklistItemType.WheelchairAccessibleVehicleRequired, (ChecklistItemValue?)ChecklistItemValue.Yes, (string?)null),
                (ChecklistItemType.WalkingFrameOrAids, (ChecklistItemValue?)ChecklistItemValue.NotApplicable, (string?)null),
                (ChecklistItemType.IssuesWithUnevenGround, (ChecklistItemValue?)ChecklistItemValue.Yes, "Power wheelchair — avoid gravel/unsealed paths where possible."),
                (ChecklistItemType.SeatbeltMustBeChecked, (ChecklistItemValue?)ChecklistItemValue.Yes, "Check wheelchair restraint and lap belt on every vehicle transfer."),
                (ChecklistItemType.CommunicationAidOrDeviceUsed, (ChecklistItemValue?)ChecklistItemValue.Yes, "AAC device — always confirm with it before proceeding with any task."),
                (ChecklistItemType.HarmToSelf, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.HarmToOthers, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
            }),
        };

        var now = DateTime.UtcNow;
        var checklistRows = new List<ParticipantChecklistItem>();
        var counter = 1;
        foreach (var (participantId, items) in checklistPlans)
        {
            if (!participants.Any(p => p.Id == participantId))
                continue;

            foreach (var (type, value, notes) in items)
            {
                checklistRows.Add(new ParticipantChecklistItem
                {
                    // Deterministic across runs — same formula as SeedParticipantAdlAssessmentsAsync's counter-derived ids.
                    Id = Guid.Parse($"7c000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    ItemType = type,
                    Value = value,
                    Notes = notes,
                    CreatedAt = now, UpdatedAt = now,
                });
                counter++;
            }
        }

        void Set(Guid id, Action<Participant> apply)
        {
            var p = participants.FirstOrDefault(x => x.Id == id);
            if (p != null) apply(p);
        }

        Set(sophieId, p => // Sophie — ABI + Epilepsy, structured routine
        {
            p.ServiceStreams |= ServiceStreams.CommunityAccessDailyLiving;
            p.SignsHappyAndSettled = "Relaxed posture, engaged in conversation, humming to herself while painting.";
            p.WhatHelpsMeCalmDown = "A quiet space and her sketchbook; step away from noise/crowds.";
            p.BocTriggers = "Sudden loud noises, unplanned changes to the day's schedule.";
            p.BocEarlyWarningSigns = "Goes quiet, stops making eye contact, fidgets with her hands.";
            p.BocDeEscalationStrategies = "Offer a quiet space, reduce stimulation, give her sketchbook.";
            p.BocWhatNotToDo = "Don't crowd her or raise your voice — give space and time.";
            p.SupportsLookLikeMorning = "Support with medication prompting and breakfast; check seizure diary.";
            p.SupportsLookLikeDay = "Community access with line-of-sight supervision; encourage art/creative activities.";
            p.SupportsLookLikeAfternoonEvening = "Wind-down time with low-stimulation activities; medication reminder.";
            p.SupportsLookLikeOvernight = "Not currently receiving overnight Oassist support.";
        });

        Set(charlotteId, p => // Charlotte — autism L3, flight risk, structure-dependent
        {
            p.ServiceStreams |= ServiceStreams.CommunityAccessDailyLiving;
            p.SignsHappyAndSettled = "Talking about animals, relaxed shoulders, following the planned schedule without prompting.";
            p.WhatHelpsMeCalmDown = "Noise-cancelling headphones and a familiar routine.";
            p.BocTriggers = "Unfamiliar environments without advance notice; crowded/noisy venues.";
            p.BocEarlyWarningSigns = "Increased pacing, repeating questions about the schedule.";
            p.BocDeEscalationStrategies = "Move to a quieter area, revisit the visual schedule, give a 5-minute transition warning.";
            p.BocWhatNotToDo = "Don't force a transition without warning or introduce a new environment unannounced.";
            p.SupportsLookLikeMorning = "Review the visual schedule for the day together before leaving.";
            p.SupportsLookLikeDay = "1:1 line-of-sight community access supervision; carry noise-cancelling headphones.";
            p.SupportsLookLikeAfternoonEvening = "Wind-down with a preferred nature/animal activity.";
            p.SupportsLookLikeOvernight = "Not currently receiving overnight Oassist support.";
        });

        Set(oliviaId, p => // Olivia — CP quadriplegia, power wheelchair, non-verbal/AAC
        {
            p.ServiceStreams |= ServiceStreams.CommunityAccessDailyLiving;
            p.SignsHappyAndSettled = "Active AAC device use, relaxed posture, smiling and engaging with surroundings.";
            p.WhatHelpsMeCalmDown = "Familiar music and being given time to communicate via her AAC device.";
            p.BocTriggers = "Being spoken over rather than to; being rushed mid-communication.";
            p.BocEarlyWarningSigns = "Disengages from her AAC device, avoids eye contact.";
            p.BocDeEscalationStrategies = "Pause, give full attention, wait for her to use the AAC device.";
            p.BocWhatNotToDo = "Don't finish sentences for her or move on before she's finished communicating.";
            p.SupportsLookLikeMorning = "Full assistance with personal care; two-person transfer with ceiling hoist.";
            p.SupportsLookLikeDay = "Community access via wheelchair-accessible vehicle; confirm plans via AAC device before proceeding.";
            p.SupportsLookLikeAfternoonEvening = "PEG feeding regime per plan; skin-integrity check.";
            p.SupportsLookLikeOvernight = "Two-person assist for repositioning per pressure-care schedule.";
        });

        // HowToHelpNotes on a couple of each participant's existing ADL rows.
        SetAdlHowToHelp(sophieId, AdlType.CommunityAccess, "Stay within sight at all times; watch for early-warning seizure signs and keep a clear path to sit down.");
        SetAdlHowToHelp(sophieId, AdlType.MedicationAdministration, "Prompt gently and confirm the tablet was swallowed — offer a small amount of yoghurt if needed.");
        SetAdlHowToHelp(charlotteId, AdlType.CommunityAccess, "Keep line-of-sight at all times; use the visual schedule and give 5-minute warnings before any transition.");
        SetAdlHowToHelp(oliviaId, AdlType.Bathing, "Confirm each step with her via the AAC device before proceeding — never rush.");
        SetAdlHowToHelp(oliviaId, AdlType.MedicationAdministration, "Administer via PEG per plan; confirm site looks normal before and after.");

        foreach (var p in participants) p.UpdatedAt = DateTime.UtcNow;

        if (checklistRows.Count > 0)
            context.ParticipantChecklistItems.AddRange(checklistRows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Seeds a couple of demo <see cref="Shift"/> rows plus <see cref="ShiftNote"/> entries on
    /// them (NOTES-01). No other seeder in this file creates <see cref="Shift"/> rows at all —
    /// rostering data normally only exists once a coordinator uses the roster board — so this
    /// method creates the handful of shifts it needs itself, gated on the same
    /// idempotency check as everywhere else in this file (fixed GUIDs + an existence check on
    /// the table this method actually owns seeding of, ShiftNotes).
    /// </summary>
    public static async Task SeedShiftNotesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ShiftNotes.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var jamesUserId = Guid.Parse("b1000000-0000-0000-0000-000000000003");
        var emilyUserId = Guid.Parse("b2000000-0000-0000-0000-000000000002");

        var targetParticipantIds = new[] { sophieId, charlotteId };
        var existingParticipants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetParticipantIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        var targetUserIds = new[] { jamesUserId, emilyUserId };
        var existingUsers = await context.Users.IgnoreQueryFilters([TenantFilter.Name])
            .Where(u => targetUserIds.Contains(u.Id)).Select(u => u.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0 || existingUsers.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var shifts = new List<Shift>();
        var notes = new List<ShiftNote>();

        if (existingParticipants.Contains(sophieId) && existingUsers.Contains(jamesUserId))
        {
            var sophieShift = new Shift
            {
                Id = Guid.Parse("77000000-0000-0000-0000-000000000001"), TenantId = demoTenantId,
                ParticipantId = sophieId, UserId = jamesUserId, ServiceDate = today.AddDays(-2),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
                Ratio = SupportRatio.TwoToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published,
                CreatedAt = now.AddDays(-2), UpdatedAt = now.AddDays(-2),
            };
            shifts.Add(sophieShift);

            // Three notes — enough to exercise the roster slide-over's collapsed-disclosure
            // threshold (>2 notes).
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000001"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Quiet shift — Sophie spent most of the afternoon on her art project. No seizure activity observed.",
                CreatedAt = now.AddDays(-2).AddHours(8), UpdatedAt = now.AddDays(-2).AddHours(8),
            });
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000002"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Reminded Sophie about her hair appointment next week with Marie — she's looking forward to it.",
                CreatedAt = now.AddDays(-2).AddHours(8).AddMinutes(30), UpdatedAt = now.AddDays(-2).AddHours(8).AddMinutes(30),
            });
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000003"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Handover: left her medication chart on the kitchen counter for the evening shift to sign off.",
                CreatedAt = now.AddDays(-2).AddHours(8).AddMinutes(45), UpdatedAt = now.AddDays(-2).AddHours(8).AddMinutes(45),
            });
            // NOTES-02 demo: trips the Falls category so the live demo shows the keyword-flagging
            // banner + incident-report prompt on a real seeded note.
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000005"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Sophie stumbled near the back step on the way in from the garden — caught herself on the rail, no injury seen but keeping an eye on her today.",
                CreatedAt = now.AddDays(-2).AddHours(9), UpdatedAt = now.AddDays(-2).AddHours(9),
            });
        }

        if (existingParticipants.Contains(charlotteId) && existingUsers.Contains(emilyUserId))
        {
            var charlotteShift = new Shift
            {
                Id = Guid.Parse("77000000-0000-0000-0000-000000000002"), TenantId = demoTenantId,
                ParticipantId = charlotteId, UserId = emilyUserId, ServiceDate = today.AddDays(-1),
                StartTime = new TimeOnly(14, 0), EndTime = new TimeOnly(22, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published,
                CreatedAt = now.AddDays(-1), UpdatedAt = now.AddDays(-1),
            };
            shifts.Add(charlotteShift);

            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000004"), TenantId = demoTenantId,
                ShiftId = charlotteShift.Id, AuthorUserId = emilyUserId, AuthorName = "Emily Nguyen",
                Body = "Charlotte was a little agitated after a change to the evening routine — settled quickly once we moved to a quiet space with her headphones.",
                CreatedAt = now.AddDays(-1).AddHours(7), UpdatedAt = now.AddDays(-1).AddHours(7),
            });
            // NOTES-02 demo: trips the Medication category alongside the existing agitation note
            // above (which already trips BehaviourOfConcern on its own), so the demo tenant shows
            // both seeded categories the brief asks for (falls + medication) without either note
            // being contrived-looking.
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000006"), TenantId = demoTenantId,
                ShiftId = charlotteShift.Id, AuthorUserId = emilyUserId, AuthorName = "Emily Nguyen",
                Body = "Charlotte's 6pm medication was given a little later than usual — checked the chart and confirmed the tablet was the right dose.",
                CreatedAt = now.AddDays(-1).AddHours(7).AddMinutes(30), UpdatedAt = now.AddDays(-1).AddHours(7).AddMinutes(30),
            });
        }

        if (shifts.Count == 0)
            return;

        // NOTES-02: compute flagged categories the same way PortalController does at save time —
        // via the shared scanner, not hardcoded — so the seeded demo data always reflects the
        // vocabulary's current behaviour rather than a value that could silently drift from it.
        foreach (var note in notes)
            note.FlaggedCategories = ShiftNoteKeywordScanner.Scan(note.Body);

        context.Shifts.AddRange(shifts);
        context.ShiftNotes.AddRange(notes);
        await context.SaveChangesAsync(ct);
    }

}
