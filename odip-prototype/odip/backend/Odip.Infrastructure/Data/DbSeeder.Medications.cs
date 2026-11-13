using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public static partial class DbSeeder
{
    /// <summary>
    /// Seeds sample medication charts + a day of administration history for a handful of
    /// existing demo participants — deliberately covers PRN dosing limits, a chemical-restraint
    /// medication (BSP + authorisation in place), a high-risk/high-intensity injectable, and one
    /// overdue review to exercise the ReviewOverdue compliance flag. Idempotent: bails out if
    /// any ParticipantMedication already exists, and again per-participant if the demo
    /// participants this seed targets haven't been created yet (e.g. a fresh DB where
    /// SeedAsync hasn't run first).
    /// </summary>
    public static async Task SeedMedicationsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantMedications.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");
        // Seed-expansion task: additional demo participants that now carry their own medication charts.
        var liamId = Guid.Parse("d1000000-0000-0000-0000-000000000001");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var miaId = Guid.Parse("d1000000-0000-0000-0000-000000000006");
        var williamId = Guid.Parse("d1000000-0000-0000-0000-000000000009");
        var isabellaId = Guid.Parse("d2000000-0000-0000-0000-000000000001");
        var chloeId = Guid.Parse("d2000000-0000-0000-0000-000000000003");
        var graceId = Guid.Parse("d2000000-0000-0000-0000-000000000005");
        var zoeId = Guid.Parse("d2000000-0000-0000-0000-000000000007");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");
        var natalieId = Guid.Parse("d2000000-0000-0000-0000-000000000009");

        var targetIds = new[]
        {
            sophieId, charlotteId, harrisonId,
            liamId, oliviaId, miaId, williamId, isabellaId, chloeId, graceId, zoeId, ryanId, natalieId,
        };
        var existingParticipants = await context.Participants.IgnoreQueryFilters([TenantFilter.Name])
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var today = DateTime.UtcNow.Date;

        var levetiracetamId = Guid.Parse("70000000-0000-0000-0000-000000000001");
        var paracetamolId = Guid.Parse("70000000-0000-0000-0000-000000000002");
        var risperidoneId = Guid.Parse("70000000-0000-0000-0000-000000000003");
        var sertralineId = Guid.Parse("70000000-0000-0000-0000-000000000004");
        var insulinId = Guid.Parse("70000000-0000-0000-0000-000000000005");
        // Seed-expansion task — new medication charts covering the remaining schedule/packaging
        // variety the brief calls out (SpecificDays, EveryNDays, extra PRN/high-risk/forms).
        var prednisoloneId = Guid.Parse("70000000-0000-0000-0000-000000000006");
        var ferrousSulfateId = Guid.Parse("70000000-0000-0000-0000-000000000007");
        var warfarinId = Guid.Parse("70000000-0000-0000-0000-000000000008");
        var omeprazoleId = Guid.Parse("70000000-0000-0000-0000-000000000009");
        var movicolId = Guid.Parse("70000000-0000-0000-0000-00000000000a");
        var digoxinId = Guid.Parse("70000000-0000-0000-0000-00000000000b");
        var salbutamolId = Guid.Parse("70000000-0000-0000-0000-00000000000c");
        var betamethasoneId = Guid.Parse("70000000-0000-0000-0000-00000000000d");
        var latanoprostId = Guid.Parse("70000000-0000-0000-0000-00000000000e");
        var miaSertralineId = Guid.Parse("70000000-0000-0000-0000-00000000000f");

        var medications = new List<ParticipantMedication>();

        if (existingParticipants.Contains(sophieId))
        {
            // Sophie Brown already carries "Epilepsy medication — Keppra 500mg BD" in her
            // SupportProfile free text (Keppra is the brand name for levetiracetam) — this is
            // the structured record backing that note.
            medications.Add(new ParticipantMedication
            {
                Id = levetiracetamId, TenantId = demoTenantId, ParticipantId = sophieId,
                Name = "Levetiracetam", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (500mg)", Directions = "Take with food, morning and evening.",
                Type = MedicationType.Regular, TimesOfDay = "08:00,20:00",
                Purpose = "Seizure prophylaxis — acquired brain injury with breakthrough seizures.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Amina Yusuf", PharmacyName = "Coorparoo Chemist Warehouse", Packaging = PackagingType.WebsterPack,
                StartDate = today.AddMonths(-8), NextReviewDue = today.AddMonths(4),
                ConsentObtained = true, ConsentGivenBy = "Margaret Johnson (mother)", ConsentDate = today.AddMonths(-8),
                StorageRequirements = "Store below 25°C, away from light.", Status = MedicationStatus.Active,
            });

            medications.Add(new ParticipantMedication
            {
                Id = paracetamolId, TenantId = demoTenantId, ParticipantId = sophieId,
                Name = "Paracetamol", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "2 tablets (1000mg)", Directions = "May repeat every 4-6 hours as required.",
                Type = MedicationType.Prn, PrnIndication = "Mild-moderate pain or fever",
                PrnMaxDosesPer24h = 4, PrnMinIntervalMinutes = 240,
                Purpose = "Analgesia / antipyretic.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.Assist,
                PrescriberName = "Dr. Amina Yusuf", PharmacyName = "Coorparoo Chemist Warehouse",
                Packaging = PackagingType.Sachet,
                StartDate = today.AddMonths(-8),
                // Deliberately in the past — demonstrates the ReviewOverdue compliance flag.
                NextReviewDue = today.AddDays(-14),
                ConsentObtained = true, ConsentGivenBy = "Margaret Johnson (mother)", ConsentDate = today.AddMonths(-8),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            medications.Add(new ParticipantMedication
            {
                Id = risperidoneId, TenantId = demoTenantId, ParticipantId = charlotteId,
                Name = "Risperidone", Strength = "0.5mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (0.5mg)", Directions = "Dissolve under tongue if severely distressed.",
                Type = MedicationType.Prn, PrnIndication = "Acute behavioural escalation posing risk to self or others",
                PrnMaxDosesPer24h = 2, PrnMinIntervalMinutes = 360,
                Purpose = "Used primarily to manage episodes of severe behavioural escalation.",
                IsPsychotropic = true, IsChemicalRestraint = true, BspInPlace = true,
                RestrictivePracticeAuthorisationRef = "QLD-RP-2026-00417",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Farid Haidari", PharmacyName = "Toowong Community Pharmacy",
                StartDate = today.AddMonths(-5), NextReviewDue = today.AddMonths(1),
                ConsentObtained = true, ConsentGivenBy = "David Brown (father/guardian)", ConsentDate = today.AddMonths(-5),
                StorageRequirements = "Store in locked medication cabinet.", Status = MedicationStatus.Active,
            });

            medications.Add(new ParticipantMedication
            {
                Id = sertralineId, TenantId = demoTenantId, ParticipantId = charlotteId,
                Name = "Sertraline", Strength = "50mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (50mg)", Directions = "Take each morning with breakfast.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Ongoing management of generalised anxiety disorder.",
                IsPsychotropic = true, DrugSchedule = DrugSchedule.Schedule4,
                SupportLevel = MedicationSupportLevel.PromptOnly, PrescriberName = "Dr. Farid Haidari",
                PharmacyName = "Toowong Community Pharmacy", StartDate = today.AddMonths(-10),
                NextReviewDue = today.AddMonths(2), ConsentObtained = true,
                ConsentGivenBy = "David Brown (father/guardian)", ConsentDate = today.AddMonths(-10),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            medications.Add(new ParticipantMedication
            {
                Id = insulinId, TenantId = demoTenantId, ParticipantId = harrisonId,
                Name = "Insulin Glargine", Strength = "100units/mL", Form = MedicationForm.Injection, Route = MedicationRoute.Subcutaneous,
                DoseDescription = "18 units subcutaneously", Directions = "Rotate injection site — abdomen or thigh.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Type 1 diabetes mellitus — basal insulin.",
                IsHighRisk = true, IsHighIntensitySupport = true,
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Priya Chandran", PharmacyName = "Chermside Pharmacy",
                StartDate = today.AddYears(-2), NextReviewDue = today.AddMonths(3),
                ConsentObtained = true, ConsentGivenBy = "Harrison Lee (self)", ConsentDate = today.AddYears(-2),
                StorageRequirements = "Refrigerate 2-8°C; in-use pen may be kept below 25°C for up to 28 days.",
                Status = MedicationStatus.Active,
            });
        }

        // ── Seed-expansion task: additional medication charts ──
        if (existingParticipants.Contains(williamId))
        {
            // EveryNDays — alternate-day dosing to minimise side effects, anchored 40 days back.
            medications.Add(new ParticipantMedication
            {
                Id = prednisoloneId, TenantId = demoTenantId, ParticipantId = williamId,
                Name = "Prednisolone", Strength = "5mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (5mg)", Directions = "Take with breakfast on dosing days only.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Frequency = MedicationFrequency.EveryNDays, IntervalDays = 2, AnchorDate = DateOnly.FromDateTime(today.AddDays(-40)),
                Purpose = "Chronic inflammatory condition maintenance — alternate-day regimen to minimise long-term corticosteroid side effects.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr. Sanjay Mehta", PharmacyName = "Woodridge Family Pharmacy", Packaging = PackagingType.WebsterPack,
                StartDate = today.AddMonths(-3), NextReviewDue = today.AddMonths(3),
                ConsentObtained = true, ConsentGivenBy = "William Martin (self)", ConsentDate = today.AddMonths(-3),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            // SpecificDays — Mon/Wed/Fri alternate-day iron dosing (reduces GI side effects vs daily).
            medications.Add(new ParticipantMedication
            {
                Id = ferrousSulfateId, TenantId = demoTenantId, ParticipantId = graceId,
                Name = "Ferrous Sulfate", Strength = "325mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (325mg)", Directions = "Take on an empty stomach where tolerated.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Frequency = MedicationFrequency.SpecificDays, DaysOfWeek = Weekdays.Monday | Weekdays.Wednesday | Weekdays.Friday,
                Purpose = "Iron-deficiency anaemia — alternate-day dosing per current GP guidance.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr. Wendy Cho", PharmacyName = "Underwood Pharmacy", Packaging = PackagingType.DosetteBox,
                StartDate = today.AddMonths(-2), NextReviewDue = today.AddMonths(4),
                ConsentObtained = true, ConsentGivenBy = "Grace O'Sullivan (self)", ConsentDate = today.AddMonths(-2),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            // High-risk (witness required) — post-stroke anticoagulation.
            medications.Add(new ParticipantMedication
            {
                Id = warfarinId, TenantId = demoTenantId, ParticipantId = ryanId,
                Name = "Warfarin", Strength = "3mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (3mg)", Directions = "Take at the same time each evening. Do not double up if a dose is missed.",
                Type = MedicationType.Regular, TimesOfDay = "18:00",
                Purpose = "Anticoagulation — atrial fibrillation following ischaemic stroke.",
                IsHighRisk = true,
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Farid Haidari", PharmacyName = "Box Hill Amcal Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-9), NextReviewDue = today.AddMonths(1),
                ConsentObtained = true, ConsentGivenBy = "Sandra Lee (spouse/carer)", ConsentDate = today.AddMonths(-9),
                StorageRequirements = "Store below 25°C, away from light. Bleeding risk — report any unusual bruising immediately.",
                Status = MedicationStatus.Active,
            });

            medications.Add(new ParticipantMedication
            {
                Id = omeprazoleId, TenantId = demoTenantId, ParticipantId = ryanId,
                Name = "Omeprazole", Strength = "20mg", Form = MedicationForm.Capsule, Route = MedicationRoute.Oral,
                DoseDescription = "1 capsule (20mg)", Directions = "Take before breakfast.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Gastroprotection alongside anticoagulant therapy.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr. Farid Haidari", PharmacyName = "Box Hill Amcal Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-9), NextReviewDue = today.AddMonths(3),
                ConsentObtained = true, ConsentGivenBy = "Sandra Lee (spouse/carer)", ConsentDate = today.AddMonths(-9),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            // Enteral route/Powder form — matches Olivia's existing "PEG feeding schedule" support-profile note.
            medications.Add(new ParticipantMedication
            {
                Id = movicolId, TenantId = demoTenantId, ParticipantId = oliviaId,
                Name = "Movicol (Macrogol)", Strength = "13.7g/sachet", Form = MedicationForm.Powder, Route = MedicationRoute.Enteral,
                DoseDescription = "1 sachet dissolved in 125mL water, via PEG", Directions = "Flush PEG line before and after administration.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Bowel management — chronic constipation prophylaxis.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Amina Yusuf", PharmacyName = "Box Hill Amcal Pharmacy", Packaging = PackagingType.Sachet,
                StartDate = today.AddMonths(-11), NextReviewDue = today.AddMonths(2),
                ConsentObtained = true, ConsentGivenBy = "Robert White (father)", ConsentDate = today.AddMonths(-11),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(chloeId))
        {
            medications.Add(new ParticipantMedication
            {
                Id = digoxinId, TenantId = demoTenantId, ParticipantId = chloeId,
                Name = "Digoxin", Strength = "0.25mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (0.25mg)", Directions = "Take with breakfast. No missed doses — contact GP if a dose is missed.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Congenital heart condition — rate control.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr Jason Park", PharmacyName = "Bondi Junction Chemist", Packaging = PackagingType.Other,
                StartDate = today.AddYears(-3), NextReviewDue = today.AddMonths(6),
                ConsentObtained = true, ConsentGivenBy = "Peter Robinson (father/guardian)", ConsentDate = today.AddYears(-3),
                StorageRequirements = "Narrow therapeutic index — double-check dose against the MAR before every administration.",
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(zoeId))
        {
            // PRN with max/24h + min-interval, Inhaler form.
            medications.Add(new ParticipantMedication
            {
                Id = salbutamolId, TenantId = demoTenantId, ParticipantId = zoeId,
                Name = "Salbutamol", Strength = "100mcg/actuation", Form = MedicationForm.Inhaler, Route = MedicationRoute.Inhaled,
                DoseDescription = "2 puffs via spacer", Directions = "Use spacer device. Rinse mouth after use if more than occasional.",
                Type = MedicationType.Prn, PrnIndication = "Wheeze or shortness of breath (asthma)",
                PrnMaxDosesPer24h = 8, PrnMinIntervalMinutes = 240,
                Purpose = "Reliever for mild intermittent asthma.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.SelfAdministered,
                PrescriberName = "Dr. Wendy Cho", PharmacyName = "Newtown Community Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddYears(-1), NextReviewDue = today.AddMonths(6),
                ConsentObtained = true, ConsentGivenBy = "Zoe Campbell (self)", ConsentDate = today.AddYears(-1),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(natalieId))
        {
            // Daily multi-time, Cream/Topical form.
            medications.Add(new ParticipantMedication
            {
                Id = betamethasoneId, TenantId = demoTenantId, ParticipantId = natalieId,
                Name = "Betamethasone", Strength = "0.05%", Form = MedicationForm.Cream, Route = MedicationRoute.Topical,
                DoseDescription = "Thin layer to affected areas", Directions = "Apply sparingly, avoid face and skin folds.",
                Type = MedicationType.Regular, TimesOfDay = "08:00,20:00",
                Purpose = "Eczema flare management.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Assist,
                PrescriberName = "Dr. Wendy Cho", PharmacyName = "Underwood Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-1), NextReviewDue = today.AddMonths(2),
                ConsentObtained = true, ConsentGivenBy = "Natalie Walsh (self)", ConsentDate = today.AddMonths(-1),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(isabellaId))
        {
            // Drops/Ocular form.
            medications.Add(new ParticipantMedication
            {
                Id = latanoprostId, TenantId = demoTenantId, ParticipantId = isabellaId,
                Name = "Latanoprost", Strength = "0.005%", Form = MedicationForm.Drops, Route = MedicationRoute.Ocular,
                DoseDescription = "1 drop each eye", Directions = "Instil at night. Wait 5 minutes if using other eye drops.",
                Type = MedicationType.Regular, TimesOfDay = "21:00",
                Purpose = "Open-angle glaucoma — intraocular pressure control.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr Jason Park", PharmacyName = "Kangaroo Point Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-4), NextReviewDue = today.AddMonths(5),
                ConsentObtained = true, ConsentGivenBy = "Isabella Clarke (self)", ConsentDate = today.AddMonths(-4),
                StorageRequirements = "Refrigerate unopened bottle; discard 4 weeks after opening.",
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(miaId))
        {
            // Structured record backing Mia's existing SupportProfile free text ("Sertraline 50mg morning").
            medications.Add(new ParticipantMedication
            {
                Id = miaSertralineId, TenantId = demoTenantId, ParticipantId = miaId,
                Name = "Sertraline", Strength = "50mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (50mg)", Directions = "Take each morning with breakfast.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Ongoing management of mild anxiety.",
                IsPsychotropic = true, DrugSchedule = DrugSchedule.Schedule4,
                SupportLevel = MedicationSupportLevel.PromptOnly, PrescriberName = "Dr. Wendy Cho",
                PharmacyName = "Sunnybank Community Pharmacy", Packaging = PackagingType.WebsterPack,
                StartDate = today.AddMonths(-7), NextReviewDue = today.AddMonths(5),
                ConsentObtained = true, ConsentGivenBy = "Mia Anderson (self)", ConsentDate = today.AddMonths(-7),
                Status = MedicationStatus.Active,
            });
        }

        if (medications.Count == 0)
            return;

        context.ParticipantMedications.AddRange(medications);
        await context.SaveChangesAsync(ct);

        // ── Sample administration history — a two-week scatter across Administered/Refused/
        // Withheld/Missed/WrongMedication, witness states across NotRequired/Pending/Approved/
        // Declined, RecordedByUserId set from the seeded demo users, and a couple of records with
        // AdministeredAtTimeZone set (seed-expansion task). The original "yesterday" records above
        // this comment (IDs ...0001-...0004) are left exactly as they were.
        var yesterday = today.AddDays(-1);
        var administrations = new List<MedicationAdministration>();

        // Fixed demo-user ids (see SeedAsync) — used directly rather than re-querying, since this
        // method only runs after SeedAsync has already created them.
        var jamesUserId = Guid.Parse("b1000000-0000-0000-0000-000000000003");
        var emilyUserId = Guid.Parse("b2000000-0000-0000-0000-000000000002");
        var danielUserId = Guid.Parse("b2000000-0000-0000-0000-000000000003");
        var rachelUserId = Guid.Parse("b2000000-0000-0000-0000-000000000001");
        var sarahUserId = Guid.Parse("b1000000-0000-0000-0000-000000000002");
        var marcusUserId = Guid.Parse("a2000000-0000-0000-0000-000000000001");
        var priyaUserId = Guid.Parse("a2000000-0000-0000-0000-000000000002");
        var lachlanUserId = Guid.Parse("a2000000-0000-0000-0000-000000000003");
        var jadeUserId = Guid.Parse("a2000000-0000-0000-0000-000000000004");
        var brendanUserId = Guid.Parse("a2000000-0000-0000-0000-000000000005");

        // Most recent Monday/Wednesday/Friday on or before today — used for Grace's SpecificDays
        // (Mon/Wed/Fri) Ferrous Sulfate history so the dates line up with her actual schedule
        // regardless of what day the seeder happens to run on.
        DateTime MostRecentWeekday(DateTime from, DayOfWeek day)
        {
            var diff = ((int)from.DayOfWeek - (int)day + 7) % 7;
            return from.AddDays(-diff);
        }
        var recentMonday = MostRecentWeekday(today, DayOfWeek.Monday);
        var recentWednesday = MostRecentWeekday(today, DayOfWeek.Wednesday);
        var recentFriday = MostRecentWeekday(today, DayOfWeek.Friday);

        if (existingParticipants.Contains(sophieId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000001"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = yesterday.AddHours(8), AdministeredAt = yesterday.AddHours(8).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)",
                RecordedByName = "James O'Brien",
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000002"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = yesterday.AddHours(20), Status = MedicationAdministrationStatus.Refused,
                RecordedByName = "James O'Brien",
                Reason = "Participant declined the evening dose; settled after 20 minutes. GP notified next business day.",
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000003"), TenantId = demoTenantId,
                ParticipantMedicationId = sertralineId, ParticipantId = charlotteId,
                ScheduledAt = yesterday.AddHours(8), AdministeredAt = yesterday.AddHours(8).AddMinutes(10),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (50mg)",
                RecordedByName = "Emily Nguyen",
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000004"), TenantId = demoTenantId,
                ParticipantMedicationId = insulinId, ParticipantId = harrisonId,
                ScheduledAt = yesterday.AddHours(8), AdministeredAt = yesterday.AddHours(8).AddMinutes(2),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
                RecordedByName = "Daniel Williams", WitnessName = "Rachel Thompson",
            });

            // Two more, further back — one Approved witness, one Declined (the compliance queue
            // demo: a witness that raised a discrepancy rather than rubber-stamping it).
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000000d"), TenantId = demoTenantId,
                ParticipantMedicationId = insulinId, ParticipantId = harrisonId,
                ScheduledAt = today.AddDays(-6).AddHours(8), AdministeredAt = today.AddDays(-6).AddHours(8).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
                RecordedByName = "Daniel Williams", RecordedByUserId = danielUserId,
                WitnessName = "Rachel Thompson", WitnessUserId = rachelUserId,
                WitnessStatus = WitnessStatus.Approved,
                WitnessRequestedAt = today.AddDays(-6).AddHours(8).AddMinutes(3), WitnessRespondedAt = today.AddDays(-6).AddHours(8).AddMinutes(6),
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000000e"), TenantId = demoTenantId,
                ParticipantMedicationId = insulinId, ParticipantId = harrisonId,
                ScheduledAt = today.AddDays(-13).AddHours(8), AdministeredAt = today.AddDays(-13).AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
                RecordedByName = "Marcus Papadopoulos", RecordedByUserId = marcusUserId,
                WitnessName = "Priya Sharma", WitnessUserId = priyaUserId,
                WitnessStatus = WitnessStatus.Declined,
                WitnessRequestedAt = today.AddDays(-13).AddHours(8).AddMinutes(4), WitnessRespondedAt = today.AddDays(-13).AddHours(8).AddMinutes(11),
                Notes = "Witness queried the pen dial reading against the MAR before declining to confirm; recount matched the prescribed dose and was resolved with the coordinator same day.",
            });
        }

        if (existingParticipants.Contains(sophieId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000000f"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = today.AddDays(-3).AddHours(8), AdministeredAt = today.AddDays(-3).AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000010"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = today.AddDays(-3).AddHours(20), AdministeredAt = today.AddDays(-3).AddHours(20).AddMinutes(6),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000011"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = today.AddDays(-7).AddHours(8), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "Emily Nguyen", RecordedByUserId = emilyUserId,
                Reason = "Staff shift changeover — dose not given within the window; escalated to the on-call coordinator and given late once identified.",
            });

            // PRN Paracetamol — no fixed schedule, so ScheduledAt is null.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000012"), TenantId = demoTenantId,
                ParticipantMedicationId = paracetamolId, ParticipantId = sophieId,
                AdministeredAt = today.AddDays(-2).AddHours(11), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "2 tablets (1000mg)", PrnReason = "Mild headache reported after a busy morning.", PrnOutcome = "Resolved within an hour.",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000013"), TenantId = demoTenantId,
                ParticipantMedicationId = paracetamolId, ParticipantId = sophieId,
                AdministeredAt = today.AddDays(-9).AddHours(15), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "2 tablets (1000mg)", PrnReason = "Reported mild fever.", PrnOutcome = "Settled by evening; no further doses needed that day.",
                RecordedByName = "Emily Nguyen", RecordedByUserId = emilyUserId,
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000014"), TenantId = demoTenantId,
                ParticipantMedicationId = sertralineId, ParticipantId = charlotteId,
                ScheduledAt = today.AddDays(-8).AddHours(8), AdministeredAt = today.AddDays(-8).AddHours(8).AddMinutes(8),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (50mg)",
                RecordedByName = "Emily Nguyen", RecordedByUserId = emilyUserId,
                AdministeredAtTimeZone = "Australia/Melbourne",
            });

            // PRN Risperidone (chemical restraint) — one Administered, one Withheld.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000015"), TenantId = demoTenantId,
                ParticipantMedicationId = risperidoneId, ParticipantId = charlotteId,
                AdministeredAt = today.AddDays(-4).AddHours(16), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "1 tablet (0.5mg)",
                PrnReason = "Became distressed and attempted to leave the property unsupervised.",
                PrnOutcome = "Settled within 20 minutes with quiet space and noise-cancelling headphones.",
                RecordedByName = "Daniel Williams", RecordedByUserId = danielUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000016"), TenantId = demoTenantId,
                ParticipantMedicationId = risperidoneId, ParticipantId = charlotteId,
                Status = MedicationAdministrationStatus.Withheld,
                Reason = "Participant was asleep when the escalation resolved on its own before symptoms met the PRN threshold — dose withheld on RN phone advice.",
                RecordedByName = "Daniel Williams", RecordedByUserId = danielUserId,
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            // High-risk med, recent Administered dose with an outstanding (Pending) witness —
            // deliberately triggers ParticipantAlertsService's high-risk-medication-witness-gap
            // Critical alert for Ryan.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000017"), TenantId = demoTenantId,
                ParticipantMedicationId = warfarinId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-2).AddHours(18), AdministeredAt = today.AddDays(-2).AddHours(18).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (3mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
                WitnessName = "Sarah Mitchell", WitnessUserId = sarahUserId, WitnessStatus = WitnessStatus.Pending,
                WitnessRequestedAt = today.AddDays(-2).AddHours(18).AddMinutes(5),
                AdministeredAtTimeZone = "Australia/Melbourne",
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000018"), TenantId = demoTenantId,
                ParticipantMedicationId = warfarinId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-9).AddHours(18), AdministeredAt = today.AddDays(-9).AddHours(18).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (3mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
                WitnessName = "Sarah Mitchell", WitnessUserId = sarahUserId, WitnessStatus = WitnessStatus.Approved,
                WitnessRequestedAt = today.AddDays(-9).AddHours(18).AddMinutes(4), WitnessRespondedAt = today.AddDays(-9).AddHours(18).AddMinutes(9),
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000019"), TenantId = demoTenantId,
                ParticipantMedicationId = warfarinId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-14).AddHours(18), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
                Reason = "Participant unwell overnight — GP consulted next morning, dose resumed as normal from the following day.",
            });

            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001a"), TenantId = demoTenantId,
                ParticipantMedicationId = omeprazoleId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-2).AddHours(8), AdministeredAt = today.AddDays(-2).AddHours(8).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 capsule (20mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001b"), TenantId = demoTenantId,
                ParticipantMedicationId = omeprazoleId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-9).AddHours(8), AdministeredAt = today.AddDays(-9).AddHours(8).AddMinutes(2),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 capsule (20mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001c"), TenantId = demoTenantId,
                ParticipantMedicationId = movicolId, ParticipantId = oliviaId,
                ScheduledAt = today.AddDays(-4).AddHours(8), AdministeredAt = today.AddDays(-4).AddHours(8).AddMinutes(12),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 sachet via PEG",
                RecordedByName = "Lachlan Robertson", RecordedByUserId = lachlanUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001d"), TenantId = demoTenantId,
                ParticipantMedicationId = movicolId, ParticipantId = oliviaId,
                ScheduledAt = today.AddDays(-11).AddHours(8), Status = MedicationAdministrationStatus.Withheld,
                RecordedByName = "Lachlan Robertson", RecordedByUserId = lachlanUserId,
                Reason = "Participant reported nausea overnight; RN phone advice was to withhold and reassess before the next dose. GP updated same day.",
            });
        }

        if (existingParticipants.Contains(chloeId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001e"), TenantId = demoTenantId,
                ParticipantMedicationId = digoxinId, ParticipantId = chloeId,
                ScheduledAt = today.AddDays(-3).AddHours(8), AdministeredAt = today.AddDays(-3).AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (0.25mg)",
                RecordedByName = "Priya Sharma", RecordedByUserId = priyaUserId,
            });

            // MED-03 wrong-medication demo — Reason (required for non-Administered) and Notes
            // (required for WrongMedication) both populated.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001f"), TenantId = demoTenantId,
                ParticipantMedicationId = digoxinId, ParticipantId = chloeId,
                ScheduledAt = today.AddDays(-10).AddHours(8), AdministeredAt = today.AddDays(-10).AddHours(8).AddMinutes(6),
                Status = MedicationAdministrationStatus.WrongMedication,
                DoseGiven = "1 Paracetamol tablet (500mg) — given in error",
                Reason = "Incorrect blister-pack row administered — participant received a Paracetamol tablet instead of the scheduled Digoxin dose.",
                Notes = "Error identified within 10 minutes when checking the MAR against the blister pack. GP phoned for advice — monitor only, no intervention required. Digoxin given once confirmed safe, 45 minutes later. Incident report completed.",
                RecordedByName = "Priya Sharma", RecordedByUserId = priyaUserId,
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000020"), TenantId = demoTenantId,
                ParticipantMedicationId = ferrousSulfateId, ParticipantId = graceId,
                ScheduledAt = recentMonday.AddHours(8), AdministeredAt = recentMonday.AddHours(8).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (325mg)",
                RecordedByName = "Sarah Mitchell", RecordedByUserId = sarahUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000021"), TenantId = demoTenantId,
                ParticipantMedicationId = ferrousSulfateId, ParticipantId = graceId,
                ScheduledAt = recentWednesday.AddHours(8), AdministeredAt = recentWednesday.AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (325mg)",
                RecordedByName = "Sarah Mitchell", RecordedByUserId = sarahUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000022"), TenantId = demoTenantId,
                ParticipantMedicationId = ferrousSulfateId, ParticipantId = graceId,
                ScheduledAt = recentFriday.AddHours(8), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "Sarah Mitchell", RecordedByUserId = sarahUserId,
                Reason = "Missed during a full-day community outing — dose box wasn't packed; resumed on the next scheduled day.",
            });
        }

        if (existingParticipants.Contains(williamId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000023"), TenantId = demoTenantId,
                ParticipantMedicationId = prednisoloneId, ParticipantId = williamId,
                ScheduledAt = today.AddDays(-2).AddHours(8), AdministeredAt = today.AddDays(-2).AddHours(8).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (5mg)",
                RecordedByName = "Brendan Nguyen", RecordedByUserId = brendanUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000024"), TenantId = demoTenantId,
                ParticipantMedicationId = prednisoloneId, ParticipantId = williamId,
                ScheduledAt = today.AddDays(-12).AddHours(8), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
                Reason = "Dosing day missed while William was away with family — resumed on schedule from the next dosing day.",
            });
        }

        if (existingParticipants.Contains(natalieId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000025"), TenantId = demoTenantId,
                ParticipantMedicationId = betamethasoneId, ParticipantId = natalieId,
                ScheduledAt = today.AddDays(-3).AddHours(8), AdministeredAt = today.AddDays(-3).AddHours(8).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "Thin layer to affected areas",
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000026"), TenantId = demoTenantId,
                ParticipantMedicationId = betamethasoneId, ParticipantId = natalieId,
                ScheduledAt = today.AddDays(-3).AddHours(20), AdministeredAt = today.AddDays(-3).AddHours(20).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "Thin layer to affected areas",
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
            });
        }

        if (existingParticipants.Contains(isabellaId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000027"), TenantId = demoTenantId,
                ParticipantMedicationId = latanoprostId, ParticipantId = isabellaId,
                ScheduledAt = today.AddDays(-5).AddHours(21), AdministeredAt = today.AddDays(-5).AddHours(21).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 drop each eye",
                RecordedByName = "Marcus Papadopoulos", RecordedByUserId = marcusUserId,
            });
        }

        if (existingParticipants.Contains(zoeId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000028"), TenantId = demoTenantId,
                ParticipantMedicationId = salbutamolId, ParticipantId = zoeId,
                AdministeredAt = today.AddDays(-6).AddHours(10), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "2 puffs via spacer", PrnReason = "Wheeze noted after morning walk.", PrnOutcome = "Resolved within 5 minutes.",
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
            });
        }

        if (administrations.Count > 0)
        {
            context.MedicationAdministrations.AddRange(administrations);
            await context.SaveChangesAsync(ct);
        }
    }

}
