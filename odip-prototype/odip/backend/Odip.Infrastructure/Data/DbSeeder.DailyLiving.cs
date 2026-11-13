using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public static partial class DbSeeder
{
    /// <summary>
    /// INTAKE sub-wave C2. Seeds realistic <see cref="ParticipantAdlAssessment"/> rows (both
    /// Personal and Community/Domestic ADLs) for a majority of the 20 demo participants — levels
    /// chosen to be coherent with each participant's existing mobility/personal-care/cognitive
    /// attributes seeded by <see cref="SeedParticipantClinicalEnrichmentAsync"/> (e.g. Olivia
    /// Wilson's TwoPerson LevelOfPersonalCare and non-verbal AAC note are mirrored here as
    /// FullSupport-level personal ADLs; Sophie Brown's Epilepsy/Supervision-level care mirrors into
    /// Supervision-level Medication Administration/Community Access rows). Includes deliberately
    /// unanswered (null Level) rows for a couple of participants — the "not assessed" grid state,
    /// same doctrine as SeedParticipantHealthConditionsAsync's Natalie Walsh gap. Idempotent via
    /// fixed GUIDs (formulaic, same pattern as SeedParticipantHealthConditionsAsync) + an existence
    /// check.
    /// </summary>
    public static async Task SeedParticipantAdlAssessmentsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantAdlAssessments.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var plans = new (Guid ParticipantId, (AdlType Type, AdlLevel? Level, string? Notes)[] Rows)[]
        {
            // Liam Johnson — SCI, independent transfers.
            (Guid.Parse("d1000000-0000-0000-0000-000000000001"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Bathing, (AdlLevel?)AdlLevel.Supervision, "Shower chair in use — standby supervision for safety."),
                (AdlType.Toileting, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Transportation, (AdlLevel?)AdlLevel.Assistance, "Manual wheelchair transfers into vehicle."),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
            // Sophie Brown — ABI + Epilepsy, Supervision-level personal care.
            (Guid.Parse("d1000000-0000-0000-0000-000000000002"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.MedicationAdministration, (AdlLevel?)AdlLevel.Supervision, "Anti-epileptic medication — supervise to confirm doses taken."),
                (AdlType.MoneyHandling, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Appointments, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.CommunityAccess, (AdlLevel?)AdlLevel.Supervision, "Seizure risk — line-of-sight supervision in the community."),
            }),
            // Noah Taylor — fully ambulant, independent.
            (Guid.Parse("d1000000-0000-0000-0000-000000000003"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Bathing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Banking, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
            // Olivia Wilson — CP quadriplegia, TwoPerson personal care, non-verbal/AAC.
            (Guid.Parse("d1000000-0000-0000-0000-000000000004"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.FullSupport, (string?)null),
                (AdlType.Bathing, (AdlLevel?)AdlLevel.FullSupport, "Two-person assist, ceiling hoist."),
                (AdlType.OralCare, (AdlLevel?)AdlLevel.FullSupport, (string?)null),
                (AdlType.Toileting, (AdlLevel?)AdlLevel.FullSupport, (string?)null),
                (AdlType.MedicationAdministration, (AdlLevel?)AdlLevel.FullSupport, "Administered via PEG per plan."),
                // Deliberately unanswered — financial matters are managed by the SIL provider/administrator, not yet assessed on this grid.
                (AdlType.Banking, (AdlLevel?)null, (string?)null),
            }),
            // Charlotte White — autism L3, flight risk, requires 1:1 line-of-sight supervision.
            (Guid.Parse("d1000000-0000-0000-0000-000000000008"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Grooming, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.CommunityAccess, (AdlLevel?)AdlLevel.Assistance, "Flight risk in unfamiliar environments — 1:1 line-of-sight supervision required."),
                (AdlType.Socialising, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.RoadAwareness, (AdlLevel?)AdlLevel.Assistance, (string?)null),
            }),
            // William Martin — DSOA, experienced traveller.
            (Guid.Parse("d1000000-0000-0000-0000-000000000009"), new[]
            {
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.PublicTransport, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Isabella Clarke — enthusiastic traveller, no other flags.
            (Guid.Parse("d2000000-0000-0000-0000-000000000001"), new[]
            {
                (AdlType.CommunityAccess, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Socialising, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
            // Mason Nguyen — power wheelchair, independent transfers on level surfaces.
            (Guid.Parse("d2000000-0000-0000-0000-000000000002"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Transportation, (AdlLevel?)AdlLevel.Assistance, "Power wheelchair — accessible vehicle loading assistance."),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Chloe Robinson — Down syndrome, impaired understanding, sudden-change distress.
            (Guid.Parse("d2000000-0000-0000-0000-000000000003"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.MoneyHandling, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Appointments, (AdlLevel?)AdlLevel.Assistance, "Prefers advance notice/visual schedule for appointments."),
                (AdlType.Cleaning, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.MedicationAdministration, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Harrison Lee — MS, fatigue management, OnePerson personal care.
            (Guid.Parse("d2000000-0000-0000-0000-000000000006"), new[]
            {
                (AdlType.Bathing, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.Toileting, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Laundry, (AdlLevel?)AdlLevel.Assistance, "Fatigue management — avoid over-exertion."),
                (AdlType.Gardening, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Ryan Murphy — ABI stroke, aphasia, right-side weakness.
            (Guid.Parse("d2000000-0000-0000-0000-000000000008"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Assistance, "Right-side weakness post-stroke."),
                (AdlType.Grooming, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.MoneyHandling, (AdlLevel?)AdlLevel.Assistance, "Aphasia — allow extra time, use visual aids where possible."),
                (AdlType.Appointments, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                // Deliberately unanswered — vocational goals under review, not yet assessed.
                (AdlType.WorkStudy, (AdlLevel?)null, "Not currently working — vocational goals under review."),
            }),
            // Dylan Foster — manual wheelchair, flat terrain only.
            (Guid.Parse("d2000000-0000-0000-0000-000000000010"), new[]
            {
                (AdlType.Transportation, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
        };

        var participantIds = plans.Select(p => p.ParticipantId).ToArray();
        var participantExists = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => participantIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (participantExists.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var rows = new List<ParticipantAdlAssessment>();
        var counter = 1;
        foreach (var (participantId, adlRows) in plans)
        {
            if (!participantExists.Contains(participantId))
                continue;

            foreach (var (type, level, notes) in adlRows)
            {
                rows.Add(new ParticipantAdlAssessment
                {
                    // Deterministic across runs — same formula as SeedParticipantHealthConditionsAsync's counter-derived ids.
                    Id = Guid.Parse($"7b000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    AdlType = type,
                    Level = level,
                    Notes = notes,
                    CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
                });
                counter++;
            }
        }

        if (rows.Count == 0)
            return;

        context.ParticipantAdlAssessments.AddRange(rows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave C2. Updates a majority of the 20 demo participants IN PLACE with the new
    /// flat Meals &amp; Diet/About Me columns (Master Data Dictionary MEAL-001..012 minus the
    /// allergies dedup, GOAL-001..008 minus the Hobbies dedup — see Participant.cs's field group
    /// doc) — chosen to be coherent with each participant's existing diagnoses/mobility/behaviour
    /// notes (e.g. Olivia Wilson's PEG feeding already on her medical record now also sets
    /// PegRegimeMealDetail/ModifiedDietDetail consistently; Sophie Brown's structured-routine note
    /// now also sets Goals/ThingsToKnow consistently with her BSP). Idempotent via an existence
    /// check on whether any of the target participants already has Goals set (a column no earlier
    /// sub-wave could have populated) rather than fixed GUIDs, since this seeder UPDATES existing
    /// rows rather than inserting new ones — same idempotency idiom as
    /// SeedParticipantClinicalEnrichmentAsync's AmbulantStatus check.
    /// </summary>
    public static async Task SeedParticipantDailyLivingAsync(OdipDbContext context, CancellationToken ct = default)
    {
        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;

        var targetIds = new[]
        {
            Guid.Parse("d1000000-0000-0000-0000-000000000001"), // Liam
            Guid.Parse("d1000000-0000-0000-0000-000000000002"), // Sophie
            Guid.Parse("d1000000-0000-0000-0000-000000000003"), // Noah
            Guid.Parse("d1000000-0000-0000-0000-000000000004"), // Olivia
            Guid.Parse("d1000000-0000-0000-0000-000000000007"), // Jack
            Guid.Parse("d1000000-0000-0000-0000-000000000008"), // Charlotte
            Guid.Parse("d1000000-0000-0000-0000-000000000009"), // William
            Guid.Parse("d2000000-0000-0000-0000-000000000001"), // Isabella
            Guid.Parse("d2000000-0000-0000-0000-000000000003"), // Chloe
            Guid.Parse("d2000000-0000-0000-0000-000000000005"), // Grace
            Guid.Parse("d2000000-0000-0000-0000-000000000006"), // Harrison
            Guid.Parse("d2000000-0000-0000-0000-000000000008"), // Ryan
            Guid.Parse("d2000000-0000-0000-0000-000000000009"), // Natalie
        };

        var participants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).ToListAsync(ct);
        if (participants.Count == 0)
            return;

        // Idempotency guard: if any target participant already has Goals populated, this seeder
        // has already run (no earlier sub-wave could have set that column).
        if (participants.Any(p => p.Goals != null))
            return;

        void Set(Guid id, Action<Participant> apply)
        {
            var p = participants.FirstOrDefault(x => x.Id == id);
            if (p != null) apply(p);
        }

        Set(Guid.Parse("d1000000-0000-0000-0000-000000000001"), p => // Liam — SCI, independent, surfing/beach volleyball
        {
            p.MealAssistanceDetail = "Independent with meals — able to prepare simple meals from a seated position.";
            p.FavouriteBreakfast = "Eggs on toast."; p.FavouriteLunch = "Chicken wrap."; p.FavouriteDinner = "BBQ and salad.";
            p.FoodsAlwaysEaten = "Fresh fruit with every meal.";
            p.Goals = "Build more independence with meal preparation; get back into regular surfing.";
            p.SupportAreas = "Meal prep, community access for sport.";
            p.StrengthsFears = "Strength: very social and motivated. Fear: being seen as \"unable\" in public.";
            p.ThingsToKnow = "Prefers to transfer himself where possible — offer help, don't assume.";
            p.WhoIsImportant = "Mother Karen and his younger sibling.";
            p.LikesDislikes = "Likes the beach and rugby league. Dislikes being rushed.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000002"), p => // Sophie — ABI + Epilepsy, structured routine
        {
            p.MealAssistanceDetail = "Independent with meals; supervise medication administration at mealtimes.";
            p.ChokingRiskMealDetail = "No known swallowing risk — general supervision only, consistent with no Dysphagia flag on the health-condition grid.";
            p.MedicationTricks = "Takes tablets more easily with a small amount of yoghurt.";
            p.Goals = "Maintain a structured daily routine; reduce seizure frequency.";
            p.SupportAreas = "Community access supervision, medication prompting.";
            p.StrengthsFears = "Strength: creative, expressive through art. Fear: loud/crowded environments.";
            p.ThingsToKnow = "Needs advance notice of any routine change.";
            p.WhoIsImportant = "Her partner.";
            p.LikesDislikes = "Likes painting and live music. Dislikes sudden loud noises.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000003"), p => // Noah — fully independent, bushwalking
        {
            p.FavouriteBreakfast = "Porridge with banana."; p.FavouriteLunch = "Salad sandwich."; p.FavouriteDinner = "Pasta.";
            p.Goals = "Try bushwalking trips; meet new people on his first trip.";
            p.SupportAreas = "None currently identified.";
            p.LikesDislikes = "Likes the outdoors. Dislikes being micromanaged.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000004"), p => // Olivia — CP quadriplegia, PEG feeding, non-verbal/AAC
        {
            p.MealAssistanceDetail = "Full assistance required for all meals.";
            p.ModifiedDietDetail = "No oral intake — nutrition delivered via PEG.";
            p.PegRegimeMealDetail = "PEG feeding regime per plan — see HIDPA Enteral Feeding category; staff trained.";
            p.SpecialUtensilsDetail = "N/A — PEG fed, no oral utensils used.";
            p.Goals = "Maintain skin integrity and PEG site health; continue art gallery/live jazz outings.";
            p.SupportAreas = "Full personal care, PEG feeding, communication via AAC device.";
            p.StrengthsFears = "Strength: expressive through her AAC device once given time. Fear: being spoken over rather than to.";
            p.ThingsToKnow = "Always confirm with her AAC device before proceeding with any task.";
            p.WhoIsImportant = "Her fellow residents at the group home.";
            p.LikesDislikes = "Likes art galleries and live jazz. Dislikes being rushed through communication.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000007"), p => // Jack — independent, photography
        {
            p.Goals = "Build a photography portfolio from trips.";
            p.LikesDislikes = "Likes photography and urban exploring. Dislikes being treated as less capable because of his wheelchair.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000008"), p => // Charlotte — autism L3, flight risk, structure-dependent
        {
            p.MealAssistanceDetail = "Independent with meals; prefers the same plate/cup each time.";
            p.SpecialDietaryNeedsDetail = "Prefers plain/unmixed foods — avoid sauces touching other foods.";
            p.FoodsAlwaysEaten = "Plain pasta, chicken nuggets.";
            p.Goals = "Build tolerance for small routine changes with advance warning.";
            p.SupportAreas = "1:1 line-of-sight supervision in the community; routine-change preparation.";
            p.StrengthsFears = "Strength: deep knowledge of animals and nature. Fear: unfamiliar environments without notice.";
            p.ThingsToKnow = "Give advance notice of any routine change — see BSP.";
            p.WhoIsImportant = "Her support worker Emily.";
            p.LikesDislikes = "Likes animals and nature walks. Dislikes crowded, noisy places.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000009"), p => // William — DSOA, experienced traveller
        {
            p.FavouriteBreakfast = "Bacon and eggs."; p.FavouriteLunch = "Meat pie."; p.FavouriteDinner = "Roast dinner.";
            p.Goals = "Keep active with sport and travel.";
            p.LikesDislikes = "Likes cricket and AFL. Dislikes early mornings.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000001"), p => // Isabella — enthusiastic traveller
        {
            p.Goals = "Try a new cafe or live-music venue on every trip.";
            p.LikesDislikes = "Likes live music and cafes. Dislikes long waits.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000003"), p => // Chloe — Down syndrome, sudden-change distress
        {
            p.MealAssistanceDetail = "Independent with meals; benefits from a visual meal schedule.";
            p.Goals = "Cope better with unexpected changes using a visual schedule.";
            p.SupportAreas = "Advance warning of changes, visual supports.";
            p.StrengthsFears = "Strength: loves dancing and craft. Fear: sudden unannounced changes.";
            p.ThingsToKnow = "Use a visual schedule and give warning before any change.";
            p.WhoIsImportant = "Her family.";
            p.LikesDislikes = "Likes dancing and craft activities. Dislikes sudden change.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000005"), p => // Grace — good communicator, cooking/gardening
        {
            p.FavouriteBreakfast = "Muesli and yoghurt."; p.FavouriteLunch = "Garden salad."; p.FavouriteDinner = "Stir fry.";
            p.Goals = "Grow her own vegetables; try new recipes.";
            p.LikesDislikes = "Likes cooking and gardening. Dislikes being interrupted mid-task.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000006"), p => // Harrison — MS, fatigue management
        {
            p.MealAssistanceDetail = "Independent with meals when not fatigued; offer breaks during preparation.";
            p.Goals = "Manage fatigue while staying active — prefers morning activities.";
            p.SupportAreas = "Fatigue management, pacing of daily tasks.";
            p.ThingsToKnow = "Prefers morning activities — fatigues more easily later in the day.";
            p.LikesDislikes = "Likes rugby league and fishing. Dislikes over-scheduled days.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000008"), p => // Ryan — ABI stroke, aphasia
        {
            p.MealAssistanceDetail = "Independent with meals; right-side weakness — offer adaptive utensils if needed.";
            p.SpecialUtensilsDetail = "Weighted/non-slip utensils available if fatigued.";
            p.Goals = "Continue building communication confidence since ABI rehab.";
            p.SupportAreas = "Communication support, extra time for word-finding.";
            p.StrengthsFears = "Strength: comfortable traveller, loves AFL. Fear: being rushed mid-sentence.";
            p.ThingsToKnow = "Allow extra time to communicate — aphasia post-ABI.";
            p.WhoIsImportant = "Family gatherings, especially AFL match days.";
            p.LikesDislikes = "Likes AFL and family gatherings. Dislikes being finished off mid-sentence.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000009"), p => // Natalie — social butterfly
        {
            p.Goals = "Keep up an active social calendar.";
            p.LikesDislikes = "Likes socialising and board games. Dislikes sitting out of group activities.";
        });

        foreach (var p in participants) p.UpdatedAt = DateTime.UtcNow;
        await context.SaveChangesAsync(ct);
    }

}
