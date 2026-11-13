using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public static partial class DbSeeder
{
    /// <summary>
    /// Seeds a few demo <see cref="RestrictivePractice"/> register rows for the demo participants
    /// whose OTHER seed data already implies a restrictive practice, mirroring exactly what the
    /// AddRestrictivePractices migration's SQL backfill would produce for this data if it were
    /// pre-existing production rows: an Unclassified entry from Sophie Brown's and Charlotte
    /// White's <see cref="SupportProfile.RestrictivePracticeDetails"/> free text, plus a
    /// ChemicalRestraint entry linked to Charlotte's Risperidone PRN (seeded with
    /// <see cref="ParticipantMedication.IsChemicalRestraint"/> = true in
    /// <see cref="SeedMedicationsAsync"/>). Deliberately does NOT invoke the migration's backfill
    /// service — this covers the fact that migrations run against an empty database before this
    /// seeder populates the legacy fields, so the real backfill never sees this seed data. Also
    /// sets each participant's derived <see cref="Participant.HasRestrictivePracticeFlag"/> to
    /// match, the same sync-write <see cref="Api.Controllers.RestrictivePracticesController"/>
    /// performs on every register mutation. Idempotent via fixed GUIDs + an existence check, same
    /// pattern as <see cref="SeedParticipantRoutinesAsync"/>.
    /// </summary>
    public static async Task SeedRestrictivePracticesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.RestrictivePractices.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        // Fixed ID from SeedMedicationsAsync — Charlotte's Risperidone PRN (IsChemicalRestraint = true).
        var risperidoneId = Guid.Parse("70000000-0000-0000-0000-000000000003");
        // Seed-expansion task — Chloe Robinson and Ryan Murphy's Participant rows already carry
        // HasRestrictivePracticeFlag = true from SeedAsync (their behaviour-risk narrative implies
        // an in-place restrictive practice) but had no backing register row until now — this
        // method is what makes that flag consistent (see the entity's remarks on the flag being
        // derived, never independently writable, going forward). Harrison Lee gets a new
        // MechanicalRestraint row and is newly flagged here for the same reason.
        var chloeId = Guid.Parse("d2000000-0000-0000-0000-000000000003");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");

        var targetIds = new[] { sophieId, charlotteId, chloeId, ryanId, harrisonId };
        var participants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        if (participants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var practices = new List<RestrictivePractice>();

        if (participants.TryGetValue(sophieId, out var sophie))
        {
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                Type = RestrictivePracticeType.Unclassified,
                Description = "Environmental restriction — locked doors during sleep. Authorised by NDIS Commission.",
                IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });
            sophie.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(charlotteId, out var charlotte))
        {
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Type = RestrictivePracticeType.Unclassified,
                Description = "Continuous supervision in community settings. GPS tracker watch. Authorised.",
                IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });

            // Only add the ChemicalRestraint link if the medication was actually seeded (guards
            // against SeedMedicationsAsync having been skipped for any reason).
            if (await context.ParticipantMedications.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(m => m.Id == risperidoneId, ct))
            {
                practices.Add(new RestrictivePractice
                {
                    Id = Guid.Parse("75000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                    Type = RestrictivePracticeType.ChemicalRestraint, RelatedMedicationId = risperidoneId,
                    Description = "Risperidone",
                    AuthorisedBy = "QLD Senior Practitioner", AuthorisationDate = DateOnly.FromDateTime(now.AddMonths(-2)),
                    IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
                });
            }

            // Seed-expansion task — Seclusion, and the "recently reviewed" demo: freshly
            // authorised/reviewed rather than overdue, so the register shows a healthy example
            // alongside the two deliberately-overdue ones below.
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Type = RestrictivePracticeType.Seclusion,
                Description = "Brief supervised time in a low-stimulus room (door unlocked, staff immediately outside) used only when Charlotte is at risk of harm to self during acute sensory overload. Least-restrictive option confirmed with BSP.",
                AuthorisedBy = "Dr. Farid Haidari (Behaviour Support Practitioner)", AuthorisationDate = today.AddDays(-10), ReviewDate = today.AddMonths(6),
                IsActive = true, CreatedAt = now.AddDays(-10), UpdatedAt = now.AddDays(-10),
            });

            charlotte.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(chloeId, out var chloe))
        {
            // Overdue review (#1 of 2) — exercises ParticipantAlertsService's
            // restrictive-practice-review-overdue rule.
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = chloeId,
                Type = RestrictivePracticeType.EnvironmentalRestraint,
                Description = "Bedroom door alarm fitted — alerts staff if Chloe leaves her room overnight, due to elopement risk when her routine is disrupted.",
                AuthorisedBy = "NDIS Quality and Safeguards Commission", AuthorisationDate = today.AddMonths(-8), ReviewDate = today.AddDays(-10),
                IsActive = true, CreatedAt = now.AddMonths(-8), UpdatedAt = now.AddMonths(-8),
            });
            chloe.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(ryanId, out var ryan))
        {
            // Overdue review (#2 of 2).
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = ryanId,
                Type = RestrictivePracticeType.PhysicalRestraint,
                Description = "Two-person supported physical guiding technique, used only during acute frustration episodes affecting safety when communication support alone hasn't de-escalated. Authorised per BSP.",
                AuthorisedBy = "Dr. Farid Haidari (Behaviour Support Practitioner)", AuthorisationDate = today.AddMonths(-9), ReviewDate = today.AddDays(-25),
                IsActive = true, CreatedAt = now.AddMonths(-9), UpdatedAt = now.AddMonths(-9),
            });
            ryan.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(harrisonId, out var harrison))
        {
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Type = RestrictivePracticeType.MechanicalRestraint,
                Description = "Postural support harness used during vehicle transport due to risk of releasing the seatbelt when fatigued/unwell. Reviewed with OT — least restrictive option identified for transport safety.",
                AuthorisedBy = "Dr. Priya Chandran", AuthorisationDate = today.AddMonths(-4), ReviewDate = today.AddMonths(4),
                IsActive = true, CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
            harrison.HasRestrictivePracticeFlag = true;
        }

        if (practices.Count == 0)
            return;

        context.RestrictivePractices.AddRange(practices);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE-09. Seeds a few demo <see cref="ParticipantRiskEntry"/> rows spanning all four
    /// <see cref="AtRiskParty"/> categories, for the same demo participants as
    /// <see cref="SeedParticipantRoutinesAsync"/>/<see cref="SeedRestrictivePracticesAsync"/>.
    /// Idempotent via fixed GUIDs + an existence check, same pattern as those two methods.
    /// </summary>
    public static async Task SeedParticipantRiskEntriesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantRiskEntries.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");

        var targetIds = new[] { sophieId, charlotteId, harrisonId };
        var existingParticipants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var entries = new List<ParticipantRiskEntry>();

        if (existingParticipants.Contains(sophieId))
        {
            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                AtRiskParty = AtRiskParty.Participant,
                Description = "Risk of seizure-related injury during a fall.",
                MitigationNotes = "Padded flooring in her room; staff trained in seizure first aid.",
                IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = charlotteId,
                AtRiskParty = AtRiskParty.Public,
                Description = "Risk to public safety if she leaves the property unsupervised in an unfamiliar area.",
                MitigationNotes = "Continuous supervision protocol per her routine; GPS tracker watch.",
                IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });

            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                AtRiskParty = AtRiskParty.OtherParticipants,
                Description = "Risk of overstimulation triggering distress that could escalate around other participants during group activities.",
                MitigationNotes = "Schedule her activities separately from large groups where possible; use noise-cancelling headphones.",
                IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = harrisonId,
                AtRiskParty = AtRiskParty.Staff,
                Description = "Risk of a hypoglycaemic episode requiring staff intervention during outings.",
                MitigationNotes = "Staff carry glucose tablets and are trained to recognise early signs.",
                IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (entries.Count == 0)
            return;

        context.ParticipantRiskEntries.AddRange(entries);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave B. Seeds realistic <see cref="ParticipantConsent"/> rows — a majority of
    /// the 20 demo participants, each getting all seven <see cref="ConsentType"/> rows with
    /// varied answers (some fully granted, some with one or two declines, some with an
    /// unanswered gap) so the detail page's "granted / declined / not recorded" three-way status
    /// list has real demo data for every state. Idempotent via fixed GUIDs + an existence check,
    /// same pattern as <see cref="SeedParticipantRiskEntriesAsync"/> — the "fixed" GUID here is
    /// generated deterministically from a running counter (rather than 91 individually
    /// hand-typed literals) since this seeder covers far more rows than that one; still stable
    /// and idempotent across runs, just built from a formula instead of copy-pasted values.
    /// </summary>
    public static async Task SeedParticipantConsentsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantConsents.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        // participantId -> answer per ConsentType. null = deliberately left unanswered (the
        // "not recorded" detail-page state), so at least one participant below has a gap.
        var plans = new (Guid ParticipantId, Dictionary<ConsentType, bool?> Answers)[]
        {
            (Guid.Parse("d1000000-0000-0000-0000-000000000001"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000002"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = null,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000004"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000006"), new()
            {
                [ConsentType.PhotoVideo] = null, [ConsentType.Alcohol] = null, [ConsentType.OtcMedication] = null,
                [ConsentType.EmergencyMedical] = null, [ConsentType.Privacy] = null, [ConsentType.TravelInsurance] = null,
                [ConsentType.TermsAndConditions] = null,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000007"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = false,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000008"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = false,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000009"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000001"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = null, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000004"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000005"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = false,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = null,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000006"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000008"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = false,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000009"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
        };

        var participantIds = plans.Select(p => p.ParticipantId).ToArray();
        var participants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => participantIds.Contains(p.Id))
            .Select(p => new { p.Id, p.FirstName, p.LastName })
            .ToDictionaryAsync(p => p.Id, ct);
        if (participants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var rows = new List<ParticipantConsent>();
        var counter = 1;
        foreach (var (participantId, answers) in plans)
        {
            if (!participants.TryGetValue(participantId, out var participant))
                continue;

            foreach (var (type, granted) in answers)
            {
                rows.Add(new ParticipantConsent
                {
                    // Deterministic across runs — same (counter) every time this method builds
                    // the same `plans` list — satisfying the idempotent-fixed-id pattern without
                    // 91 hand-typed literals.
                    Id = Guid.Parse($"79000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    ConsentType = type,
                    Granted = granted,
                    RecordedAt = granted.HasValue ? now.AddMonths(-3) : null,
                    SignedByName = granted == true ? $"{participant.FirstName} {participant.LastName}".Trim() : null,
                    SignedDate = granted == true ? DateOnly.FromDateTime(now.AddMonths(-3)) : null,
                    CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
                });
                counter++;
            }
        }

        if (rows.Count == 0)
            return;

        context.ParticipantConsents.AddRange(rows);
        await context.SaveChangesAsync(ct);
    }

}
