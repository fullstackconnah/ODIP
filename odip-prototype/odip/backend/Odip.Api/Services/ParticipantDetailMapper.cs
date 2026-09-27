using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>
/// Builds a <see cref="ParticipantDetailDto"/> from a <see cref="Participant"/>, extracted
/// verbatim from <see cref="ParticipantsController.GetById"/> (cg02 Task 11) so the caregiver
/// form (<see cref="ParticipantsController"/>'s sibling controllers CaregiverController and
/// CaregiverSubmissionsController) can build the identical projection input without duplicating
/// ~150 lines of field mapping. Behaviour-preserving: GetById's own regression tests
/// (Odip.Tests/Controllers/ParticipantsControllerTests.cs) are the net — output must be
/// byte-for-byte identical to the pre-extraction inline construction.
///
/// Lives in Odip.Api (NOT Odip.Infrastructure, despite the plan's suggested location) because it
/// calls the per-collection MaterializeAll helpers (e.g. ParticipantConsentsController.MaterializeAll),
/// which are `internal static` members of Odip.Api controllers. Odip.Infrastructure has no project
/// reference to Odip.Api — the dependency runs the other way (Api depends on Infrastructure) — so
/// hosting this type in Infrastructure would require making those five MaterializeAll methods
/// public and giving Infrastructure a reference to Api (or duplicating them), a much larger and
/// riskier change for no behavioural benefit. `internal` visibility here matches those helpers'
/// own accessibility; every caller (ParticipantsController, CaregiverController,
/// CaregiverSubmissionsController) lives in this same assembly.
/// </summary>
internal static class ParticipantDetailMapper
{
    /// <summary>
    /// Caller must have loaded PreferredUser, RestrictivePractices, Consents, HealthConditions,
    /// AdlAssessments, ChecklistItems and CommunityAccessRiskItems on <paramref name="p"/> (via
    /// Include) — exactly what ParticipantsController.GetById includes.
    /// </summary>
    internal static async Task<ParticipantDetailDto> ToDetailDtoAsync(OdipDbContext db, Participant p, CancellationToken ct)
    {
        var hasActiveMedications = await db.ParticipantMedications
            .AnyAsync(m => m.ParticipantId == p.Id && m.Status != MedicationStatus.Ceased, ct);
        var planTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(db, p.Id, p.PlanType, ct);
        // A participant can retain historical inquiries, so the intake explicitly edits the most
        // recently updated linked inquiry rather than guessing from a copied participant field.
        var inquiry = await db.ParticipantInquiries
            .Where(x => x.ParticipantId == p.Id && x.TenantId == p.TenantId)
            .OrderByDescending(x => x.UpdatedAt).FirstOrDefaultAsync(ct);

        return new ParticipantDetailDto
        {
            Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName,
            InquiryId = inquiry?.Id, InquirySource = inquiry?.Source, InquiryProvenance = inquiry?.Provenance,
            MiddleName = p.MiddleName,
            FullName = string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName,
            MaskedNdisNumber = p.NdisNumber != null ? p.NdisNumber.Length > 0 ? "••••••••" + p.NdisNumber[^1] : "•••" : null,
            NdisNumber = p.NdisNumber, DateOfBirth = p.DateOfBirth, Gender = p.Gender, GenderSelfDescription = p.GenderSelfDescription,
            PlaceOfBirth = p.PlaceOfBirth, Country = p.Country, Phone = p.Phone, Email = p.Email,
            PlanStartDate = p.PlanStartDate, PlanEndDate = p.PlanEndDate, PlanType = p.PlanType, Region = p.Region, IsDsoa = p.IsDsoa,
            // Key Identifiers (INTAKE sub-wave A).
            PensionCardNumber = p.PensionCardNumber, PensionCardExpiry = p.PensionCardExpiry,
            MedicareNumber = p.MedicareNumber, MedicareExpiry = p.MedicareExpiry,
            CompanionCardNumber = p.CompanionCardNumber, CompanionCardExpiry = p.CompanionCardExpiry,
            PrivateHealthFund = p.PrivateHealthFund, PrivateHealthMembershipNumber = p.PrivateHealthMembershipNumber,
            TaxiCardNumber = p.TaxiCardNumber, HairColour = p.HairColour, EyeColour = p.EyeColour,
            WeightKg = p.WeightKg, HeightCm = p.HeightCm,
            FundingSource = p.FundingSource, FundingOrganisation = p.FundingOrganisation, IsRepeatClient = p.IsRepeatClient, IsActive = p.IsActive,
            LivingArrangement = p.LivingArrangement,
            MainSupportPersonName = p.MainSupportPersonName, MainSupportPersonRelationship = p.MainSupportPersonRelationship,
            OthersLivingInAccommodation = p.OthersLivingInAccommodation, ResidentialInfo = p.ResidentialInfo,
            LivesWithOthers = p.LivesWithOthers, WhoLivesWith = p.WhoLivesWith,
            SilProviderName = p.SilProviderName, SilProviderContactPhone = p.SilProviderContactPhone,
            AccommodationType = p.AccommodationType, OnSiteSupportHours = p.OnSiteSupportHours,
            LivingArrangementNotes = p.LivingArrangementNotes,
            AddressStreet = p.AddressStreet, AddressSuburb = p.AddressSuburb,
            AddressState = p.AddressState, AddressPostcode = p.AddressPostcode,
            MobilityAidWheelchair = p.MobilityAidWheelchair, MobilityAidWalker = p.MobilityAidWalker,
            IsHighSupport = p.IsHighSupport, IsIntensiveSupport = p.IsIntensiveSupport, SupportRatio = p.SupportRatio,
            MobilitySupportOptions = p.MobilitySupportOptions,
            PrimaryDiagnosis = p.PrimaryDiagnosis, OtherDiagnoses = p.OtherDiagnoses, HidpaSupportCategories = p.HidpaSupportCategories,
            HidpaNotes = p.HidpaNotes,
            OvernightSupport = p.OvernightSupport, OvernightRatio = p.OvernightRatio,
            RequiresHiLoBed = p.RequiresHiLoBed, RequiresHoist = p.RequiresHoist, RequiresShowerChair = p.RequiresShowerChair,
            RequiresCommode = p.RequiresCommode, RequiresStandingMachine = p.RequiresStandingMachine,
            // Derived: true iff the participant has any active restrictive-practice register row.
            HasRestrictivePracticeFlag = p.RestrictivePractices.Any(rp => rp.IsActive),
            ServiceStreams = p.ServiceStreams,
            HasActiveMedications = hasActiveMedications,
            MobilityNotes = p.MobilityNotes, EquipmentRequirements = p.EquipmentRequirements,
            TransportRequirements = p.TransportRequirements, MedicalSummary = p.MedicalSummary,
            BehaviourRiskSummary = p.BehaviourRiskSummary, Notes = p.Notes,
            CreatedAt = p.CreatedAt, UpdatedAt = p.UpdatedAt,
            PreferredStaffId = p.PreferredUserId,
            PreferredStaffName = p.PreferredUser != null
                ? p.PreferredUser.FirstName + " " + p.PreferredUser.LastName
                : null,
            IsDraft = p.IsDraft,
            IntakeCompletedAt = p.IntakeCompletedAt,
            // INTAKE sub-wave B — Cultural & Consent step.
            IsCald = p.IsCald, IsLgbtqi = p.IsLgbtqi, IsFamilyCommunity = p.IsFamilyCommunity,
            IsAboriginalOrTorresStraitIslander = p.IsAboriginalOrTorresStraitIslander,
            ReceivedRightsAndResponsibilitiesInfo = p.ReceivedRightsAndResponsibilitiesInfo,
            ReceivedPrivacyAndConfidentialityInfo = p.ReceivedPrivacyAndConfidentialityInfo,
            ReceivedFeedbackInfo = p.ReceivedFeedbackInfo, ReceivedBeingSafeInfo = p.ReceivedBeingSafeInfo,
            ReceivedAdvocacyInfo = p.ReceivedAdvocacyInfo,
            PersonalInterests = p.PersonalInterests, ChoiceControlNotes = p.ChoiceControlNotes,
            Consents = ParticipantConsentsController.MaterializeAll(p.Id, p.Consents.ToList()),
            // INTAKE sub-wave C1 — Allergies/Anaphylaxis.
            AllergiesDetail = p.AllergiesDetail, IsAnaphylaxisRisk = p.IsAnaphylaxisRisk,
            AllergyManagementNotes = p.AllergyManagementNotes,
            HealthConditions = ParticipantHealthConditionsController.MaterializeAll(p.Id, p.HealthConditions.ToList()),
            // INTAKE sub-wave C1 — Mobility & Functional.
            AmbulantStatus = p.AmbulantStatus, FallsRiskRating = p.FallsRiskRating,
            UnevenGroundFlag = p.UnevenGroundFlag, LevelOfPersonalCare = p.LevelOfPersonalCare,
            Orthotics = p.Orthotics, ContinenceSupportDetail = p.ContinenceSupportDetail,
            BowelCareDetail = p.BowelCareDetail, MenstruationSupport = p.MenstruationSupport,
            SkinIntegrity = p.SkinIntegrity,
            // INTAKE sub-wave C1 — Behaviour & Communication.
            Memory = p.Memory, MemoryAids = p.MemoryAids,
            ImpairedUnderstanding = p.ImpairedUnderstanding, ImpairedJudgementReasoning = p.ImpairedJudgementReasoning,
            BehavioursOfConcernCurrent = p.BehavioursOfConcernCurrent,
            BehavioursOfConcernFiveYearHistory = p.BehavioursOfConcernFiveYearHistory,
            BehaviourRiskRating = p.BehaviourRiskRating,
            RidsLogged = p.RidsLogged, BspPlanProvided = p.BspPlanProvided, BocChartProvided = p.BocChartProvided,
            ExpressiveSkills = p.ExpressiveSkills, ReceptiveSkills = p.ReceptiveSkills,
            ReadingAbility = p.ReadingAbility, CommunicationAids = p.CommunicationAids,
            // INTAKE sub-wave C2 — the structured ADL rating grid (Daily Living step).
            AdlAssessments = ParticipantAdlAssessmentsController.MaterializeAll(p.Id, p.AdlAssessments.ToList()),
            // INTAKE sub-wave C2 — Meals & Diet.
            MealAssistanceDetail = p.MealAssistanceDetail, ChokingRiskMealDetail = p.ChokingRiskMealDetail,
            ModifiedDietDetail = p.ModifiedDietDetail, PegRegimeMealDetail = p.PegRegimeMealDetail,
            SpecialUtensilsDetail = p.SpecialUtensilsDetail, SpecialDietaryNeedsDetail = p.SpecialDietaryNeedsDetail,
            FavouriteBreakfast = p.FavouriteBreakfast, FavouriteLunch = p.FavouriteLunch, FavouriteDinner = p.FavouriteDinner,
            MedicationTricks = p.MedicationTricks, FoodsAlwaysEaten = p.FoodsAlwaysEaten,
            // INTAKE sub-wave C2 — About Me.
            Goals = p.Goals, SupportAreas = p.SupportAreas, StrengthsFears = p.StrengthsFears,
            ThingsToKnow = p.ThingsToKnow, WhoIsImportant = p.WhoIsImportant, LikesDislikes = p.LikesDislikes,
            // INTAKE-03/04, CommunityAccessDailyLiving stream — the structured checklist grid.
            ChecklistItems = ParticipantChecklistItemsController.MaterializeAll(p.Id, p.ChecklistItems.ToList()),
            // INTAKE-03 — Community Access Behaviour & Support Detail.
            SignsHappyAndSettled = p.SignsHappyAndSettled, WhatHelpsMeCalmDown = p.WhatHelpsMeCalmDown,
            BocTriggers = p.BocTriggers, BocEarlyWarningSigns = p.BocEarlyWarningSigns,
            BocDeEscalationStrategies = p.BocDeEscalationStrategies, BocWhatNotToDo = p.BocWhatNotToDo,
            SupportsLookLikeMorning = p.SupportsLookLikeMorning, SupportsLookLikeDay = p.SupportsLookLikeDay,
            SupportsLookLikeAfternoonEvening = p.SupportsLookLikeAfternoonEvening, SupportsLookLikeOvernight = p.SupportsLookLikeOvernight,
            // PF-10.2, CommunityAccessDailyLiving stream — the structured risk-assessment matrix grid.
            CommunityAccessRiskItems = ParticipantCommunityAccessRiskItemsController.MaterializeAll(p.Id, p.CommunityAccessRiskItems.ToList()),
            OverallCommunityAccessRiskRating = p.OverallCommunityAccessRiskRating,
            PlanTypeComplianceWarning = planTypeComplianceWarning,
        };
    }

    /// <summary>
    /// Same computation as ParticipantsController's private ComputePlanTypeComplianceWarningAsync,
    /// duplicated (not shared) so that controller's three other call sites (Create/Update/Patch,
    /// which build their own partial response DTOs, not full ones) are untouched by this
    /// extraction — GetById is the only caller re-pointed at this mapper.
    /// </summary>
    private static async Task<string?> ComputePlanTypeComplianceWarningAsync(OdipDbContext db, Guid participantId, PlanType planType, CancellationToken ct)
    {
        var activeRoles = await db.ParticipantContactRoles
            .Where(r => r.ParticipantId == participantId && r.Status == ContactRoleStatus.Active)
            .Select(r => new { r.RoleType, r.RegisteredProviderFlag, r.Status })
            .ToListAsync(ct);

        return ContactRoleRules.PlanTypeComplianceWarning(
            planType,
            activeRoles.Select(r => (r.RoleType, r.RegisteredProviderFlag, r.Status)));
    }
}
