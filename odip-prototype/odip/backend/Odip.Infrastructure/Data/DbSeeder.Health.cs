using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public static partial class DbSeeder
{
    /// <summary>
    /// INTAKE sub-wave C1. Seeds realistic <see cref="ParticipantHealthCondition"/> rows for a
    /// majority of the 20 demo participants — condition rows chosen to be coherent with each
    /// participant's existing <see cref="Participant.PrimaryDiagnosis"/>/<see cref="Participant.OtherDiagnoses"/>/
    /// <see cref="Participant.MedicalSummary"/> (e.g. Sophie Brown's Epilepsy row mirrors her
    /// existing OtherDiagnoses "Epilepsy" + HidpaSupportCategories.EpilepsyManagement — see this
    /// PR's report for the epilepsy grid/diagnosis reconciliation this demonstrates), with varied
    /// Has/PlanProvided/TrainingRequired combinations so the detail page's grid has real plan/
    /// training variety to show. Idempotent via fixed GUIDs (formulaic, same pattern as
    /// <see cref="SeedParticipantConsentsAsync"/>) + an existence check.
    /// </summary>
    public static async Task SeedParticipantHealthConditionsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantHealthConditions.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var plans = new (Guid ParticipantId, (HealthConditionType Type, bool? Has, string? Severity, bool? PlanProvided, bool? TrainingRequired, string? Notes)[] Rows)[]
        {
            // Liam Johnson — SCI, independent transfers, no other flagged conditions.
            (Guid.Parse("d1000000-0000-0000-0000-000000000001"), new[]
            {
                (HealthConditionType.MentalHealth, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // Sophie Brown — ABI + Epilepsy (OtherDiagnoses already has "Epilepsy",
            // HidpaSupportCategories already has EpilepsyManagement) — the grid row mirrors both,
            // seeded coherently rather than derived server-side (see this PR's report).
            (Guid.Parse("d1000000-0000-0000-0000-000000000002"), new[]
            {
                (HealthConditionType.Epilepsy, (bool?)true, (string?)"GrandMal, breakthrough seizures", (bool?)true, (bool?)true, "Seizure management plan on file; PRN midazolam per plan."),
                (HealthConditionType.MentalHealth, (bool?)true, "ABI-related mood changes", (bool?)true, (bool?)false, (string?)null),
            }),
            // Olivia Wilson — CP quadriplegia, PEG feeding.
            (Guid.Parse("d1000000-0000-0000-0000-000000000004"), new[]
            {
                (HealthConditionType.Dysphagia, (bool?)true, "Severe — PEG fed, no oral intake", (bool?)true, (bool?)true, "PEG site care per plan."),
                (HealthConditionType.WoundCare, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // Charlotte White — Autism L3 + Psychosocial Disability, anxiety, restrictive practice flag.
            (Guid.Parse("d1000000-0000-0000-0000-000000000008"), new[]
            {
                (HealthConditionType.MentalHealth, (bool?)true, "Anxiety disorder", (bool?)true, (bool?)true, "See BSP for de-escalation strategies."),
                (HealthConditionType.IntellectualDisability, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // William Martin — DSOA, no flagged conditions but answered.
            (Guid.Parse("d1000000-0000-0000-0000-000000000009"), new[]
            {
                (HealthConditionType.HighBloodPressure, (bool?)true, (string?)"Controlled with medication", (bool?)false, (bool?)false, (string?)null),
            }),
            // Chloe Robinson — Down syndrome, congenital heart condition (cleared for travel).
            (Guid.Parse("d2000000-0000-0000-0000-000000000003"), new[]
            {
                (HealthConditionType.IntellectualDisability, (bool?)true, (string?)"Mild", (bool?)true, (bool?)false, (string?)null),
            }),
            // Harrison Lee — Multiple Sclerosis, fatigue management important.
            (Guid.Parse("d2000000-0000-0000-0000-000000000006"), new[]
            {
                (HealthConditionType.WoundCare, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)"Monitored due to reduced mobility; no current wounds."),
            }),
            // Ryan Murphy — ABI (stroke), aphasia, right-side weakness, restrictive practice flag.
            (Guid.Parse("d2000000-0000-0000-0000-000000000008"), new[]
            {
                (HealthConditionType.MentalHealth, (bool?)true, (string?)"Post-stroke frustration/low mood", (bool?)true, (bool?)true, (string?)null),
                (HealthConditionType.HighBloodPressure, (bool?)true, "Controlled", (bool?)false, (bool?)false, (string?)null),
            }),
            // Natalie Walsh — no medical flags recorded, one deliberately-unanswered row (the
            // "not recorded" grid state, same doctrine as SeedParticipantConsentsAsync's Mia gap).
            (Guid.Parse("d2000000-0000-0000-0000-000000000009"), new[]
            {
                (HealthConditionType.Asthma, (bool?)null, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // Dylan Foster — manual wheelchair, otherwise no flagged conditions.
            (Guid.Parse("d2000000-0000-0000-0000-000000000010"), new[]
            {
                (HealthConditionType.WoundCare, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
        };

        var participantIds = plans.Select(p => p.ParticipantId).ToArray();
        var participantExists = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => participantIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (participantExists.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var rows = new List<ParticipantHealthCondition>();
        var counter = 1;
        foreach (var (participantId, conditionRows) in plans)
        {
            if (!participantExists.Contains(participantId))
                continue;

            foreach (var (type, has, severity, planProvided, trainingRequired, notes) in conditionRows)
            {
                rows.Add(new ParticipantHealthCondition
                {
                    // Deterministic across runs — same formula as SeedParticipantConsentsAsync's
                    // counter-derived ids.
                    Id = Guid.Parse($"7a000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    ConditionType = type,
                    Has = has,
                    Severity = severity,
                    PlanProvided = planProvided,
                    TrainingRequired = trainingRequired,
                    Notes = notes,
                    CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
                });
                counter++;
            }
        }

        if (rows.Count == 0)
            return;

        context.ParticipantHealthConditions.AddRange(rows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave C1. Updates a majority of the 20 demo participants IN PLACE with the new
    /// flat Allergies/Mobility &amp; Functional/Behaviour &amp; Communication columns (Master Data
    /// Dictionary MED-012, MOB-002/003/005..010/012, COG-001..004/006/008/009/010/011,
    /// COM-001..004) — chosen to be coherent with each participant's existing diagnoses/mobility
    /// notes/behaviour-risk summary (e.g. Olivia Wilson's non-verbal/AAC-device note already on
    /// her record now also sets ExpressiveSkills/CommunicationAids consistently). Idempotent via an
    /// existence check on whether any of the target participants already has AmbulantStatus set
    /// (a column no earlier sub-wave could have populated) rather than fixed GUIDs, since this
    /// seeder UPDATES existing rows rather than inserting new ones.
    /// </summary>
    public static async Task SeedParticipantClinicalEnrichmentAsync(OdipDbContext context, CancellationToken ct = default)
    {
        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;

        var targetIds = new[]
        {
            Guid.Parse("d1000000-0000-0000-0000-000000000001"), // Liam — SCI, wheelchair
            Guid.Parse("d1000000-0000-0000-0000-000000000002"), // Sophie — ABI + Epilepsy
            Guid.Parse("d1000000-0000-0000-0000-000000000003"), // Noah — fully ambulant
            Guid.Parse("d1000000-0000-0000-0000-000000000004"), // Olivia — CP quadriplegia, AAC
            Guid.Parse("d1000000-0000-0000-0000-000000000005"), // Ethan — no mobility flags, allergy only
            Guid.Parse("d1000000-0000-0000-0000-000000000006"), // Mia — allergy only (anaphylaxis)
            Guid.Parse("d1000000-0000-0000-0000-000000000007"), // Jack — manual wheelchair, independent
            Guid.Parse("d1000000-0000-0000-0000-000000000008"), // Charlotte — autism, flight risk, BOC
            Guid.Parse("d2000000-0000-0000-0000-000000000001"), // Isabella — allergy only
            Guid.Parse("d2000000-0000-0000-0000-000000000002"), // Mason — power wheelchair
            Guid.Parse("d2000000-0000-0000-0000-000000000003"), // Chloe — Down syndrome, sudden-change distress
            Guid.Parse("d2000000-0000-0000-0000-000000000006"), // Harrison — MS, fatigue
            Guid.Parse("d2000000-0000-0000-0000-000000000008"), // Ryan — ABI stroke, aphasia
            Guid.Parse("d2000000-0000-0000-0000-000000000010"), // Dylan — manual wheelchair, flat terrain only
        };

        var participants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).ToListAsync(ct);
        if (participants.Count == 0)
            return;

        // Idempotency guard: if any target participant already has AmbulantStatus populated, this
        // seeder has already run (no earlier sub-wave could have set that column).
        if (participants.Any(p => p.AmbulantStatus != null))
            return;

        void Set(Guid id, Action<Participant> apply)
        {
            var p = participants.FirstOrDefault(x => x.Id == id);
            if (p != null) apply(p);
        }

        Set(Guid.Parse("d1000000-0000-0000-0000-000000000001"), p => // Liam — SCI, wheelchair, independent transfers
        {
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
            p.SkinIntegrity = "Pressure area checks twice daily per SCI care plan — no current areas of concern.";
            p.Memory = MemoryLevel.Excellent;
            p.ImpairedUnderstanding = false; p.ImpairedJudgementReasoning = false;
            p.BehavioursOfConcernCurrent = false;
            p.ExpressiveSkills = "High — fully verbal."; p.ReceptiveSkills = "High.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000002"), p => // Sophie — ABI + Epilepsy
        {
            p.AmbulantStatus = AmbulantStatus.Unsteady;
            p.FallsRiskRating = RiskRatingLevel.Medium;
            p.UnevenGroundFlag = true;
            p.LevelOfPersonalCare = PersonalCareLevel.Supervision;
            p.Memory = MemoryLevel.Fair;
            p.MemoryAids = true;
            p.BehavioursOfConcernCurrent = true;
            p.BehavioursOfConcernFiveYearHistory = true;
            p.BehaviourRiskRating = RiskRatingLevel.Medium;
            p.RidsLogged = true; p.BspPlanProvided = true; p.BocChartProvided = true;
            p.ExpressiveSkills = "High — verbal."; p.ReceptiveSkills = "High.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000003"), p => // Noah — fully ambulant
        {
            p.AmbulantStatus = AmbulantStatus.NoAssist;
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
            p.Memory = MemoryLevel.Excellent;
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000004"), p => // Olivia — CP quadriplegia, AAC device
        {
            p.FallsRiskRating = RiskRatingLevel.Critical;
            p.LevelOfPersonalCare = PersonalCareLevel.TwoPerson;
            p.ContinenceSupportDetail = "Full assistance required; pads, checked and changed on a schedule.";
            p.BowelCareDetail = "Bowel care per plan alongside PEG feeding regime — staff trained.";
            p.SkinIntegrity = "High risk — pressure mattress in use, repositioning schedule followed strictly.";
            p.Memory = MemoryLevel.Excellent;
            p.ImpairedUnderstanding = false; p.ImpairedJudgementReasoning = false;
            p.ExpressiveSkills = "Low verbal — communicates via AAC (eye-gaze) device, confirm before proceeding.";
            p.ReceptiveSkills = "High.";
            p.CommunicationAids = "AAC eye-gaze device.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000005"), p => // Ethan — allergy only
        {
            p.AllergiesDetail = "Bee stings — mild local reaction (swelling), not anaphylactic.";
            p.IsAnaphylaxisRisk = false;
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000006"), p => // Mia — anaphylaxis
        {
            p.AllergiesDetail = "Peanuts and tree nuts.";
            p.IsAnaphylaxisRisk = true;
            p.AllergyManagementNotes = "EpiPen carried at all times; all support staff briefed on the anaphylaxis action plan.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000007"), p => // Jack — manual wheelchair, independent
        {
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000008"), p => // Charlotte — autism, flight risk, BOC
        {
            p.Memory = MemoryLevel.Excellent;
            p.ImpairedUnderstanding = false; p.ImpairedJudgementReasoning = false;
            p.BehavioursOfConcernCurrent = true;
            p.BehavioursOfConcernFiveYearHistory = true;
            p.BehaviourRiskRating = RiskRatingLevel.High;
            p.RidsLogged = true; p.BspPlanProvided = true; p.BocChartProvided = true;
            p.ExpressiveSkills = "High — verbal, but may script under stress."; p.ReceptiveSkills = "High.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000001"), p => // Isabella — allergy only
        {
            p.AllergiesDetail = "Penicillin — rash, not anaphylactic.";
            p.IsAnaphylaxisRisk = false;
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000002"), p => // Mason — power wheelchair, independent transfers
        {
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000003"), p => // Chloe — Down syndrome, sudden-change distress
        {
            p.Memory = MemoryLevel.Fair;
            p.ImpairedUnderstanding = true; p.ImpairedJudgementReasoning = true;
            p.BehavioursOfConcernCurrent = true;
            p.BehaviourRiskRating = RiskRatingLevel.Medium;
            p.RidsLogged = false; p.BspPlanProvided = true; p.BocChartProvided = false;
            p.ExpressiveSkills = "Medium — verbal, benefits from visual schedule."; p.ReceptiveSkills = "Medium.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000006"), p => // Harrison — MS, fatigue management
        {
            p.AmbulantStatus = AmbulantStatus.ShortDistance;
            p.FallsRiskRating = RiskRatingLevel.Medium;
            p.LevelOfPersonalCare = PersonalCareLevel.OnePerson;
            p.SkinIntegrity = "Monitor for pressure areas — reduced mobility, no current concerns.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000008"), p => // Ryan — ABI stroke, aphasia, right-side weakness
        {
            p.AmbulantStatus = AmbulantStatus.Frame;
            p.FallsRiskRating = RiskRatingLevel.Medium;
            p.Memory = MemoryLevel.Fair;
            p.BehavioursOfConcernCurrent = true;
            p.BehaviourRiskRating = RiskRatingLevel.Low;
            p.ExpressiveSkills = "Low — aphasia post-stroke, allow extra time for word-finding.";
            p.ReceptiveSkills = "High — understanding intact.";
            p.CommunicationAids = "Communication board for word-finding difficulty.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000010"), p => // Dylan — manual wheelchair, flat terrain only
        {
            p.UnevenGroundFlag = true;
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
        });

        foreach (var p in participants) p.UpdatedAt = DateTime.UtcNow;
        await context.SaveChangesAsync(ct);
    }

}
