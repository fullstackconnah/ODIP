using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public static partial class DbSeeder
{
    /// <summary>
    /// Seeds a handful of sample participant notes — a mix of pinned, plain, and archived —
    /// for the same demo participants <see cref="SeedMedicationsAsync"/> targets. Idempotent:
    /// bails out if any ParticipantNote already exists, and again per-participant if the demo
    /// participants haven't been created yet.
    /// </summary>
    public static async Task SeedParticipantNotesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantNotes.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");
        // Seed-expansion task — additional demo participants that now carry their own notes.
        var liamId = Guid.Parse("d1000000-0000-0000-0000-000000000001");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var jackId = Guid.Parse("d1000000-0000-0000-0000-000000000007");
        var williamId = Guid.Parse("d1000000-0000-0000-0000-000000000009");
        var graceId = Guid.Parse("d2000000-0000-0000-0000-000000000005");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");

        var targetIds = new[] { sophieId, charlotteId, harrisonId, liamId, oliviaId, jackId, williamId, graceId, ryanId };
        var existingParticipants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var notes = new List<ParticipantNote>();

        if (existingParticipants.Contains(sophieId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Haircut preference", Description = "Sophie prefers a short bob, above the shoulders, cut by Marie at Coorparoo Hair Studio — she becomes distressed with unfamiliar hairdressers. Book a quiet mid-morning slot where possible.",
                IsPinned = true, IsArchived = false, CreatedByName = "James O'Brien",
                CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });

            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Old transport note — superseded", Description = "Previously required the accessible van for all outings; this has since been reassessed and no longer applies. Kept for historical reference only.",
                IsPinned = false, IsArchived = true, CreatedByName = "Emily Nguyen",
                CreatedAt = now.AddMonths(-9), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Title = "Preferred de-escalation approach", Description = "When Charlotte becomes agitated, offer a quiet space and her noise-cancelling headphones before any verbal redirection — verbal prompts too early tend to escalate rather than help.",
                IsPinned = false, IsArchived = false, CreatedByName = "Daniel Williams",
                CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Title = "Dietary note", Description = "Harrison manages his own insulin dosing around meals — support staff should confirm carb counts with him before he eats but not dose on his behalf unless asked.",
                IsPinned = false, IsArchived = false, CreatedByName = "Rachel Thompson",
                CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        // ── Seed-expansion task: additional notes ──
        if (existingParticipants.Contains(liamId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = liamId,
                Title = "Beach access preference", Description = "Liam prefers the beach wheelchair kept at Surfers Paradise SLSC over the Broadwater Parklands one — the tyres are better maintained. Ring ahead to reserve it on busy weekends.",
                IsPinned = false, IsArchived = false, CreatedByName = "James O'Brien",
                CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = oliviaId,
                Title = "Gallery visit preparation", Description = "Confirm venue accessibility (hoist/accessible bathroom) at least a week ahead for any gallery or live-music outing, and build in extra time either side for her PEG feeding schedule.",
                IsPinned = true, IsArchived = false, CreatedByName = "Rachel Thompson",
                CreatedAt = now.AddMonths(-5), UpdatedAt = now.AddMonths(-5),
            });
        }

        if (existingParticipants.Contains(jackId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = jackId,
                Title = "Photography equipment", Description = "Jack carries his own camera bag on the back of his wheelchair — no need to offer to carry it for him. He's fully independent with his wheelchair; let him lead rather than push.",
                IsPinned = false, IsArchived = false, CreatedByName = "Sarah Mitchell",
                CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (existingParticipants.Contains(williamId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, ParticipantId = williamId,
                Title = "Sports viewing preference", Description = "William follows the NRL closely — where the trip schedule allows, try to keep weekend afternoons free for him to catch live games on TV or at a local pub screening.",
                IsPinned = false, IsArchived = false, CreatedByName = "Marcus Papadopoulos",
                CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, ParticipantId = graceId,
                Title = "Cooking involvement", Description = "Grace loves being included in group meal prep — give her a real task (chopping, stirring, plating) rather than having meals done for her. She's proud of her cooking and likes to be asked for tips.",
                IsPinned = false, IsArchived = false, CreatedByName = "Sarah Mitchell",
                CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-00000000000a"), TenantId = demoTenantId, ParticipantId = ryanId,
                Title = "Communication support — allow response time", Description = "Ryan has expressive aphasia and uses a word board alongside speech. Allow at least 20 seconds for him to respond before repeating or rephrasing a question, and never finish his sentences for him.",
                IsPinned = true, IsArchived = false, CreatedByName = "James O'Brien",
                CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (notes.Count == 0)
            return;

        context.ParticipantNotes.AddRange(notes);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Seeds a few demo <see cref="ParticipantRoutine"/> rows — per-day routines and
    /// shift-critical specifics support workers must know — for the same demo participants
    /// as <see cref="SeedParticipantNotesAsync"/>. Idempotent via fixed GUIDs + an existence
    /// check, same pattern as that method.
    /// </summary>
    public static async Task SeedParticipantRoutinesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantRoutines.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");
        // Seed-expansion task — additional demo participants that now carry their own routines.
        // Chloe Robinson (d2-3) is deliberately NOT given a routine here despite being
        // high-support/overnight — see SeedRestrictivePracticesAsync's note on her flag — so
        // ParticipantAlertsService's routine-coverage-gap rule has one real instance to surface
        // rather than the register being suspiciously complete everywhere.
        var liamId = Guid.Parse("d1000000-0000-0000-0000-000000000001");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var jackId = Guid.Parse("d1000000-0000-0000-0000-000000000007");
        var williamId = Guid.Parse("d1000000-0000-0000-0000-000000000009");
        var graceId = Guid.Parse("d2000000-0000-0000-0000-000000000005");
        var natalieId = Guid.Parse("d2000000-0000-0000-0000-000000000009");
        var isabellaId = Guid.Parse("d2000000-0000-0000-0000-000000000001");
        var zoeId = Guid.Parse("d2000000-0000-0000-0000-000000000007");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");

        var targetIds = new[]
        {
            sophieId, charlotteId, harrisonId,
            liamId, oliviaId, jackId, williamId, graceId, natalieId, isabellaId, zoeId, ryanId,
        };
        var existingParticipants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var routines = new List<ParticipantRoutine>();

        if (existingParticipants.Contains(sophieId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Epilepsy medication window", Description = "Keppra 500mg BD — must be given within 30 minutes of the scheduled time. If a dose is missed, follow the seizure medication protocol in her file, not the standard PRN process.",
                Category = RoutineCategory.Medication, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });

            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Morning routine", Description = "Wake gently — avoid sudden noise or lights. Offer a warm drink before getting up. Takes about 45 minutes; do not rush transitions.",
                Category = RoutineCategory.PersonalCare, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(8, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Title = "Line-of-sight supervision", Description = "Flight risk in unfamiliar environments — maintain continuous line-of-sight supervision whenever off the property. Do not rely on verbal check-ins alone.",
                Category = RoutineCategory.Behaviour, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });

            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Title = "Saturday swimming session", Description = "Local pool 10am — bring noise-cancelling headphones for the change rooms, which can get loud and crowded.",
                Category = RoutineCategory.Activity, Days = ParticipantRoutineDays.Saturday, StartTime = new TimeOnly(9, 30), EndTime = new TimeOnly(11, 30),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Title = "Insulin — confirm, don't dose", Description = "Harrison manages his own insulin dosing around meals. Confirm carb counts with him before he eats, but do not administer on his behalf unless he asks.",
                Category = RoutineCategory.Medication, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });

            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Title = "Evening meal prep", Description = "Prefers to help prep dinner rather than have it made for him — offer him a task (chopping, stirring) rather than taking over.",
                Category = RoutineCategory.Meals, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(17, 30), EndTime = new TimeOnly(18, 30),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        // ── Seed-expansion task: additional routines ──
        if (existingParticipants.Contains(liamId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = liamId,
                Title = "Bedtime wind-down", Description = "Prefers a quiet 30 minutes before lights-out — no screens, TV off. A short chat about the day's activities helps him settle.",
                Category = RoutineCategory.Sleep, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(21, 0), EndTime = new TimeOnly(22, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, ParticipantId = oliviaId,
                Title = "Hoist transfer routine", Description = "Requires a ceiling hoist or mobile hoist for every transfer — never attempt a manual transfer. Two staff must be present. Check sling fit before each use.",
                Category = RoutineCategory.PersonalCare, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-5), UpdatedAt = now.AddMonths(-5),
            });
        }

        if (existingParticipants.Contains(jackId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, ParticipantId = jackId,
                Title = "Weekly photography outing", Description = "Sunday morning outing to a local spot of Jack's choosing to take photos — he plans the location himself; staff just provide transport and are on hand if needed.",
                Category = RoutineCategory.Activity, Days = ParticipantRoutineDays.Sunday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(12, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (existingParticipants.Contains(williamId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000a"), TenantId = demoTenantId, ParticipantId = williamId,
                Title = "Breakfast preference", Description = "Prefers a cooked breakfast (eggs on toast) over cereal where the venue allows it — happy with cereal on travel days, just checks first.",
                Category = RoutineCategory.Meals, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(8, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000b"), TenantId = demoTenantId, ParticipantId = graceId,
                Title = "Meal prep involvement", Description = "Always offer Grace a role in group meal prep — she especially enjoys planning the menu the day before.",
                Category = RoutineCategory.Meals, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (existingParticipants.Contains(natalieId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000c"), TenantId = demoTenantId, ParticipantId = natalieId,
                Title = "Skin cream application", Description = "Betamethasone cream applied morning and evening for eczema — apply sparingly to affected areas only, avoiding the face.",
                Category = RoutineCategory.PersonalCare, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(8, 15),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (existingParticipants.Contains(isabellaId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000d"), TenantId = demoTenantId, ParticipantId = isabellaId,
                Title = "Evening eye drops", Description = "Latanoprost eye drops each night for glaucoma — must not be skipped. If a dose is missed, do not double up the next night; note it in the medication chart instead.",
                Category = RoutineCategory.Medication, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(21, 0), EndTime = new TimeOnly(21, 15),
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
        }

        if (existingParticipants.Contains(zoeId))
        {
            // Deliberately inactive — demonstrates a retired routine (the register keeps history
            // via IsActive rather than deleting it).
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000e"), TenantId = demoTenantId, ParticipantId = zoeId,
                Title = "Weekly photography walk — discontinued", Description = "Previously a standing Thursday photography walk; discontinued when Zoe's engagement with the service changed. Kept for history only.",
                Category = RoutineCategory.Activity, Days = ParticipantRoutineDays.Thursday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(11, 30),
                IsCritical = false, IsActive = false, CreatedAt = now.AddMonths(-10), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000f"), TenantId = demoTenantId, ParticipantId = ryanId,
                Title = "Allow processing/response time", Description = "Ryan has expressive aphasia — allow at least 20 seconds for him to respond before repeating or rephrasing. Frustration is more likely when staff finish sentences for him or rush the conversation.",
                Category = RoutineCategory.Behaviour, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (routines.Count == 0)
            return;

        context.ParticipantRoutines.AddRange(routines);
        await context.SaveChangesAsync(ct);
    }

}
