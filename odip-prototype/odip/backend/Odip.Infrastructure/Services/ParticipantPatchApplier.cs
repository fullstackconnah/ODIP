using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The PATCH apply logic, extracted verbatim from ParticipantsController.Patch so the caregiver
/// accept flow (CaregiverSubmissionsController) can apply a sanitised PatchParticipantDto
/// in-process without going through HTTP. Behaviour is identical to the pre-extraction action;
/// ParticipantsControllerPatchTests is the regression net.
///
/// This class also carries the Validate*/ApplyLivingArrangementFields/Upsert*Async/
/// IsValidPreferredUserRefAsync helpers that ParticipantsController.Create/Update also call.
/// Odip.Infrastructure has no project reference back to Odip.Api (Api -> Infrastructure is the
/// only allowed direction), so these small, dependency-light helpers had to move here rather than
/// stay `internal static` on ParticipantsController as the plan describes — `internal` isn't
/// visible cross-assembly and this codebase has no InternalsVisibleTo (confirmed: "public" is the
/// documented convention for cross-project members, see ParticipantDocumentService's doc comment).
/// ParticipantsController.Create/Update now call these as ParticipantPatchApplier.XyzAsync(...).
///
/// The four per-item ApplyAnswer assignment blocks (Consent/HealthCondition/Adl/ChecklistItem) are
/// inlined into the Upsert*Async methods below rather than moved, for the same cross-assembly
/// reason: their originals stay on ParticipantConsentsController etc. (still called from those
/// controllers' own single-item PUT endpoints), and moving would touch four more controllers and
/// their test suites for no behavioural benefit. Both copies are intentionally byte-identical.
/// </summary>
public static class ParticipantPatchApplier
{
    /// <returns>A validation error message to surface as 400, or null on success (changes saved).</returns>
    public static async Task<string?> ApplyAsync(
        OdipDbContext db,
        SafetyNoteSyncService safetyNoteSync,
        StaffCompatibilityLinkService compatLink,
        Participant p,
        PatchParticipantDto dto,
        CancellationToken ct)
    {
        // ── Validate — only for present groups, each checked purely from its own incoming values
        // (no merge with the existing entity needed: every validator below is already confirmed
        // self-contained within one group — see SPEC-00's field-by-field walk). Minimal transient
        // CreateParticipantDto instances let the existing validator methods be reused verbatim
        // without touching Create/Update's own call sites. Groups with no existing server-side
        // validator (ServiceProfile, CulturalBackground, BehaviourCommunication,
        // CommunityAccessBehaviour, MealsAndDiet, AboutMe, SupportsLookLike, RisksHazardsSummary)
        // have nothing to check here, matching today's full submit exactly.
        if (dto.PersonalDetails is { } pdValidate)
        {
            var transient = new CreateParticipantDto
            {
                FirstName = pdValidate.FirstName, LastName = pdValidate.LastName,
                Gender = pdValidate.Gender, GenderSelfDescription = pdValidate.GenderSelfDescription,
                Phone = pdValidate.Phone, Email = pdValidate.Email,
            };
            var namesError = ValidateNames(transient);
            if (namesError != null) return namesError;
            var genderError = ValidateGender(transient);
            if (genderError != null) return genderError;
            var phoneError = ValidatePhone(transient);
            if (phoneError != null) return phoneError;
            var emailError = ValidateEmail(transient);
            if (emailError != null) return emailError;
        }

        if (dto.PreferredStaff is { } psdValidate && !await IsValidPreferredUserRefAsync(db, psdValidate.PreferredStaffId, ct))
            return "Preferred staff member not found.";

        if (dto.Address is { } adValidate)
        {
            var postcodeError = ValidateAddressPostcode(new CreateParticipantDto { AddressPostcode = adValidate.AddressPostcode });
            if (postcodeError != null) return postcodeError;
        }

        if (dto.LivingArrangement is { } ladValidate)
        {
            var transient = new CreateParticipantDto
            {
                LivingArrangement = ladValidate.LivingArrangement, MainSupportPersonName = ladValidate.MainSupportPersonName,
                LivesWithOthers = ladValidate.LivesWithOthers, WhoLivesWith = ladValidate.WhoLivesWith,
                SilProviderName = ladValidate.SilProviderName,
            };
            var livingError = ValidateLivingArrangement(transient);
            if (livingError != null) return livingError;
        }

        if (dto.NdisPlan is { } npValidate)
        {
            var fundingError = ValidateFundingSource(new CreateParticipantDto { FundingSource = npValidate.FundingSource, FundingOrganisation = npValidate.FundingOrganisation });
            if (fundingError != null) return fundingError;
        }

        if (dto.KeyIdentifiers is { } kiValidate)
        {
            var weightError = ValidateWeight(new CreateParticipantDto { WeightKg = kiValidate.WeightKg });
            if (weightError != null) return weightError;
            var heightError = ValidateHeight(new CreateParticipantDto { HeightCm = kiValidate.HeightCm });
            if (heightError != null) return heightError;
        }

        if (dto.SupportNeedsMobility is { } snmValidate)
        {
            // Same inline check Create/Update run — the only server-side rule this group has
            // today. equipmentRefine (the frontend's "notes without a ticked item" cross-field
            // rule) has no backend twin anywhere in this codebase and Create/Update don't enforce
            // it either, so Patch doesn't invent one here — see this PR's report.
            var invalidOptions = snmValidate.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
            if (invalidOptions.Count > 0)
                return $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}";
        }

        if (dto.Medical is { } medValidate)
        {
            var diagnosesError = ValidateDiagnoses(new CreateParticipantDto { PrimaryDiagnosis = medValidate.PrimaryDiagnosis, OtherDiagnoses = medValidate.OtherDiagnoses });
            if (diagnosesError != null) return diagnosesError;
        }

        // ── Apply — plain property assignment, scoped to present group(s) only. Literally the
        // same statements Update already has above, just gated on group presence.
        if (dto.PersonalDetails is { } pd)
        {
            p.FirstName = pd.FirstName; p.LastName = pd.LastName; p.PreferredName = pd.PreferredName;
            p.MiddleName = pd.MiddleName; p.DateOfBirth = pd.DateOfBirth; p.Gender = pd.Gender;
            p.GenderSelfDescription = pd.GenderSelfDescription; p.PlaceOfBirth = pd.PlaceOfBirth;
            p.Country = pd.Country; p.Phone = pd.Phone; p.Email = pd.Email;
        }

        // Task 6d, gated on group presence instead of always running (§5 of PreferredStaff's
        // controller-behaviour doc): only diff/sync when this call actually touches PreferredStaff.
        Guid? previousPreferredStaffId = null;
        var preferredStaffChanged = false;
        if (dto.PreferredStaff is { } psd)
        {
            previousPreferredStaffId = p.PreferredUserId;
            preferredStaffChanged = previousPreferredStaffId != psd.PreferredStaffId;
            p.PreferredUserId = psd.PreferredStaffId;
        }

        if (dto.Address is { } ad)
        {
            p.AddressStreet = ad.AddressStreet; p.AddressSuburb = ad.AddressSuburb;
            p.AddressState = ad.AddressState; p.AddressPostcode = ad.AddressPostcode;
        }

        if (dto.LivingArrangement is { } lad)
        {
            // Reuses ApplyLivingArrangementFields verbatim — same arrangement-type clearing rules
            // Create/Update already apply.
            var transient = new CreateParticipantDto
            {
                LivingArrangement = lad.LivingArrangement, MainSupportPersonName = lad.MainSupportPersonName,
                MainSupportPersonRelationship = lad.MainSupportPersonRelationship, OthersLivingInAccommodation = lad.OthersLivingInAccommodation,
                ResidentialInfo = lad.ResidentialInfo, LivesWithOthers = lad.LivesWithOthers, WhoLivesWith = lad.WhoLivesWith,
                SilProviderName = lad.SilProviderName, SilProviderContactPhone = lad.SilProviderContactPhone,
                AccommodationType = lad.AccommodationType, OnSiteSupportHours = lad.OnSiteSupportHours,
                LivingArrangementNotes = lad.LivingArrangementNotes,
            };
            ApplyLivingArrangementFields(p, transient);
        }

        if (dto.NdisPlan is { } np)
        {
            p.NdisNumber = np.NdisNumber; p.PlanStartDate = np.PlanStartDate; p.PlanEndDate = np.PlanEndDate;
            p.PlanType = np.PlanType; p.FundingSource = np.FundingSource;
            // Ndis ignores whatever the client sent for the reused "Other — specify" field — same
            // server-side clearing as Create/Update.
            p.FundingOrganisation = np.FundingSource == ParticipantFundingSource.Other ? np.FundingOrganisation : null;
            p.IsDsoa = np.IsDsoa; p.IsRepeatClient = np.IsRepeatClient;
        }

        if (dto.ServiceProfile is { } sp)
        {
            p.Region = sp.Region; p.ServiceStreams = sp.ServiceStreams;
        }

        if (dto.KeyIdentifiers is { } ki)
        {
            p.PensionCardNumber = ki.PensionCardNumber; p.PensionCardExpiry = ki.PensionCardExpiry;
            p.MedicareNumber = ki.MedicareNumber; p.MedicareExpiry = ki.MedicareExpiry;
            p.CompanionCardNumber = ki.CompanionCardNumber; p.CompanionCardExpiry = ki.CompanionCardExpiry;
            p.PrivateHealthFund = ki.PrivateHealthFund; p.PrivateHealthMembershipNumber = ki.PrivateHealthMembershipNumber;
            p.TaxiCardNumber = ki.TaxiCardNumber; p.HairColour = ki.HairColour; p.EyeColour = ki.EyeColour;
            p.WeightKg = ki.WeightKg; p.HeightCm = ki.HeightCm;
        }

        if (dto.CulturalBackground is { } cb)
        {
            p.IsCald = cb.IsCald; p.IsLgbtqi = cb.IsLgbtqi; p.IsFamilyCommunity = cb.IsFamilyCommunity;
            p.IsAboriginalOrTorresStraitIslander = cb.IsAboriginalOrTorresStraitIslander;
            p.ReceivedRightsAndResponsibilitiesInfo = cb.ReceivedRightsAndResponsibilitiesInfo;
            p.ReceivedPrivacyAndConfidentialityInfo = cb.ReceivedPrivacyAndConfidentialityInfo;
            p.ReceivedFeedbackInfo = cb.ReceivedFeedbackInfo; p.ReceivedBeingSafeInfo = cb.ReceivedBeingSafeInfo;
            p.ReceivedAdvocacyInfo = cb.ReceivedAdvocacyInfo;
            p.PersonalInterests = cb.PersonalInterests; p.ChoiceControlNotes = cb.ChoiceControlNotes;
        }

        if (dto.SupportNeedsMobility is { } snm)
        {
            p.IsHighSupport = snm.IsHighSupport; p.IsIntensiveSupport = snm.IsIntensiveSupport;
            p.SupportRatio = snm.SupportRatio; p.MobilityAidWheelchair = snm.MobilityAidWheelchair;
            p.MobilityAidWalker = snm.MobilityAidWalker; p.MobilitySupportOptions = snm.MobilitySupportOptions;
            p.OvernightSupport = snm.OvernightSupport; p.OvernightRatio = snm.OvernightRatio;
            p.RequiresHiLoBed = snm.RequiresHiLoBed; p.RequiresHoist = snm.RequiresHoist;
            p.RequiresShowerChair = snm.RequiresShowerChair; p.RequiresCommode = snm.RequiresCommode;
            p.RequiresStandingMachine = snm.RequiresStandingMachine; p.MobilityNotes = snm.MobilityNotes;
            p.EquipmentRequirements = snm.EquipmentRequirements; p.TransportRequirements = snm.TransportRequirements;
            p.AmbulantStatus = snm.AmbulantStatus; p.FallsRiskRating = snm.FallsRiskRating;
            p.UnevenGroundFlag = snm.UnevenGroundFlag; p.LevelOfPersonalCare = snm.LevelOfPersonalCare;
            p.Orthotics = snm.Orthotics; p.ContinenceSupportDetail = snm.ContinenceSupportDetail;
            p.BowelCareDetail = snm.BowelCareDetail; p.MenstruationSupport = snm.MenstruationSupport;
            p.SkinIntegrity = snm.SkinIntegrity;
        }

        if (dto.Medical is { } med)
        {
            p.PrimaryDiagnosis = med.PrimaryDiagnosis?.Trim();
            p.OtherDiagnoses = med.OtherDiagnoses.Select(d => d.Trim()).ToList();
            p.HidpaSupportCategories = med.HidpaSupportCategories; p.HidpaNotes = med.HidpaNotes;
            p.MedicalSummary = med.MedicalSummary; p.AllergiesDetail = med.AllergiesDetail;
            p.IsAnaphylaxisRisk = med.IsAnaphylaxisRisk; p.AllergyManagementNotes = med.AllergyManagementNotes;
        }

        if (dto.BehaviourCommunication is { } bc)
        {
            p.Memory = bc.Memory; p.MemoryAids = bc.MemoryAids; p.ImpairedUnderstanding = bc.ImpairedUnderstanding;
            p.ImpairedJudgementReasoning = bc.ImpairedJudgementReasoning; p.BehavioursOfConcernCurrent = bc.BehavioursOfConcernCurrent;
            p.BehavioursOfConcernFiveYearHistory = bc.BehavioursOfConcernFiveYearHistory; p.BehaviourRiskRating = bc.BehaviourRiskRating;
            p.RidsLogged = bc.RidsLogged; p.BspPlanProvided = bc.BspPlanProvided; p.BocChartProvided = bc.BocChartProvided;
            p.ExpressiveSkills = bc.ExpressiveSkills; p.ReceptiveSkills = bc.ReceptiveSkills;
            p.ReadingAbility = bc.ReadingAbility; p.CommunicationAids = bc.CommunicationAids;
        }

        if (dto.CommunityAccessBehaviour is { } cab)
        {
            p.SignsHappyAndSettled = cab.SignsHappyAndSettled; p.WhatHelpsMeCalmDown = cab.WhatHelpsMeCalmDown;
            p.BocTriggers = cab.BocTriggers; p.BocEarlyWarningSigns = cab.BocEarlyWarningSigns;
            p.BocDeEscalationStrategies = cab.BocDeEscalationStrategies; p.BocWhatNotToDo = cab.BocWhatNotToDo;
            // PF-10.4 (SPEC-05): see PatchCommunityAccessBehaviourDto's doc for why this scalar
            // rides alongside the CA narrative fields rather than opening a new group.
            p.OverallCommunityAccessRiskRating = cab.OverallCommunityAccessRiskRating;
        }

        if (dto.MealsAndDiet is { } mad)
        {
            p.MealAssistanceDetail = mad.MealAssistanceDetail; p.ChokingRiskMealDetail = mad.ChokingRiskMealDetail;
            p.ModifiedDietDetail = mad.ModifiedDietDetail; p.PegRegimeMealDetail = mad.PegRegimeMealDetail;
            p.SpecialUtensilsDetail = mad.SpecialUtensilsDetail; p.SpecialDietaryNeedsDetail = mad.SpecialDietaryNeedsDetail;
            p.FavouriteBreakfast = mad.FavouriteBreakfast; p.FavouriteLunch = mad.FavouriteLunch; p.FavouriteDinner = mad.FavouriteDinner;
            p.MedicationTricks = mad.MedicationTricks; p.FoodsAlwaysEaten = mad.FoodsAlwaysEaten;
        }

        if (dto.AboutMe is { } am)
        {
            p.Goals = am.Goals; p.SupportAreas = am.SupportAreas; p.StrengthsFears = am.StrengthsFears;
            p.ThingsToKnow = am.ThingsToKnow; p.WhoIsImportant = am.WhoIsImportant; p.LikesDislikes = am.LikesDislikes;
        }

        if (dto.SupportsLookLike is { } sll)
        {
            p.SupportsLookLikeMorning = sll.SupportsLookLikeMorning; p.SupportsLookLikeDay = sll.SupportsLookLikeDay;
            p.SupportsLookLikeAfternoonEvening = sll.SupportsLookLikeAfternoonEvening; p.SupportsLookLikeOvernight = sll.SupportsLookLikeOvernight;
        }

        if (dto.RisksHazardsSummary is { } rhs)
        {
            p.BehaviourRiskSummary = rhs.BehaviourRiskSummary; p.Notes = rhs.Notes;
        }

        p.UpdatedAt = DateTime.UtcNow;

        // Task 6d: only sync the compatibility matrix when PreferredStaff was actually touched AND
        // actually changed — see PatchPreferredStaffDto's doc for why this group is isolated.
        if (preferredStaffChanged)
            await compatLink.SyncFromParticipantPreferredStaffAsync(p.Id, previousPreferredStaffId, dto.PreferredStaff!.PreferredStaffId, ct);

        // ── Collections — upserted via the existing helpers verbatim, only when present. See
        // PatchParticipantDto's per-member doc for the upsert-by-key/leave-alone-on-omission
        // contract these share with Create/Update.
        if (dto.Consents != null) await UpsertConsentsAsync(db, p.Id, dto.Consents, ct);
        if (dto.HealthConditions != null) await UpsertHealthConditionsAsync(db, p.Id, dto.HealthConditions, ct);
        if (dto.AdlAssessments != null) await UpsertAdlAssessmentsAsync(db, p.Id, dto.AdlAssessments, ct);
        if (dto.ChecklistItems != null) await UpsertChecklistItemsAsync(db, p.Id, dto.ChecklistItems, ct);

        // PD-5, item 5c: any of the 4 partial-save groups above (medical, behaviourCommunication,
        // risksHazardsSummary, supportNeedsMobility) can touch a safety-critical field — closes
        // the "core02 partial-save endpoint" holes in SPEC-03's Trigger coverage table. Gated on
        // group presence so an unrelated group's PATCH (e.g. just PersonalDetails) doesn't run a
        // needless sync pass.
        if (dto.Medical != null || dto.BehaviourCommunication != null || dto.RisksHazardsSummary != null || dto.SupportNeedsMobility != null)
            await safetyNoteSync.SyncFromParticipantAsync(p, ct);

        await db.SaveChangesAsync(ct);
        return null;
    }

    // ── Shared helpers (also called by ParticipantsController.Create/Update) ──────────────

    /// <summary>
    /// §4.4 same-tenant validation for the preferred-staff (now preferred-user) picker: null is
    /// always fine, otherwise the id must resolve to an active User — same-tenant scoping comes
    /// for free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    public static Task<bool> IsValidPreferredUserRefAsync(OdipDbContext db, Guid? userId, CancellationToken ct) =>
        userId.HasValue
            ? db.Users.AnyAsync(u => u.Id == userId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    /// <summary>
    /// INTAKE sub-wave B — upserts every consent row submitted with a create/update payload, keyed
    /// by <see cref="Domain.Enums.ConsentType"/>. Moved verbatim from ParticipantsController; see
    /// that type's history for the full upsert-by-key rationale. The per-row assignment below is
    /// intentionally identical to ParticipantConsentsController.ApplyAnswer (kept there too, for
    /// that controller's own single-item PUT — see this class's type doc for why it's duplicated
    /// rather than shared across the Api/Infrastructure assembly boundary).
    /// </summary>
    public static async Task UpsertConsentsAsync(OdipDbContext db, Guid participantId, List<CreateParticipantConsentDto> consents, CancellationToken ct)
    {
        if (consents is null || consents.Count == 0) return;
        var existing = await db.ParticipantConsents.Where(c => c.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(c => c.ConsentType);
        foreach (var dto in consents)
        {
            if (!byType.TryGetValue(dto.ConsentType, out var row))
            {
                row = new ParticipantConsent { Id = Guid.NewGuid(), ParticipantId = participantId, ConsentType = dto.ConsentType };
                db.ParticipantConsents.Add(row);
                byType[dto.ConsentType] = row;
            }
            if (row.Granted != dto.Granted)
                row.RecordedAt = dto.Granted.HasValue ? DateTime.UtcNow : null;
            row.Granted = dto.Granted;
            row.SignedByName = string.IsNullOrWhiteSpace(dto.SignedByName) ? null : dto.SignedByName.Trim();
            row.SignedDate = dto.SignedDate;
            row.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>
    /// INTAKE sub-wave C1 — upserts every health-condition row, keyed by
    /// <see cref="Domain.Enums.HealthConditionType"/>. Moved verbatim from ParticipantsController;
    /// see this class's type doc for why the per-row assignment (identical to
    /// ParticipantHealthConditionsController.ApplyAnswer) is duplicated rather than shared.
    /// </summary>
    public static async Task UpsertHealthConditionsAsync(OdipDbContext db, Guid participantId, List<CreateParticipantHealthConditionDto> conditions, CancellationToken ct)
    {
        if (conditions is null || conditions.Count == 0) return;
        var existing = await db.ParticipantHealthConditions.Where(c => c.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(c => c.ConditionType);
        foreach (var dto in conditions)
        {
            if (!byType.TryGetValue(dto.ConditionType, out var row))
            {
                row = new ParticipantHealthCondition { Id = Guid.NewGuid(), ParticipantId = participantId, ConditionType = dto.ConditionType };
                db.ParticipantHealthConditions.Add(row);
                byType[dto.ConditionType] = row;
            }
            row.Has = dto.Has;
            row.Severity = string.IsNullOrWhiteSpace(dto.Severity) ? null : dto.Severity.Trim();
            row.PlanProvided = dto.PlanProvided;
            row.TrainingRequired = dto.TrainingRequired;
            row.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
            row.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>
    /// INTAKE sub-wave C2 — upserts every ADL-assessment row, keyed by
    /// <see cref="Domain.Enums.AdlType"/>. Moved verbatim from ParticipantsController; sparse on
    /// creation exactly as the original (see the guard inside the loop). Per-row assignment is
    /// identical to ParticipantAdlAssessmentsController.ApplyAnswer (duplicated — see type doc).
    /// </summary>
    public static async Task UpsertAdlAssessmentsAsync(OdipDbContext db, Guid participantId, List<CreateParticipantAdlAssessmentDto> assessments, CancellationToken ct)
    {
        if (assessments is null || assessments.Count == 0) return;
        var existing = await db.ParticipantAdlAssessments.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(a => a.AdlType);
        foreach (var dto in assessments)
        {
            if (!byType.TryGetValue(dto.AdlType, out var row))
            {
                if (dto.Level is null && string.IsNullOrWhiteSpace(dto.Notes) && string.IsNullOrWhiteSpace(dto.HowToHelpNotes)) continue;
                row = new ParticipantAdlAssessment { Id = Guid.NewGuid(), ParticipantId = participantId, AdlType = dto.AdlType };
                db.ParticipantAdlAssessments.Add(row);
                byType[dto.AdlType] = row;
            }
            row.Level = dto.Level;
            row.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
            row.HowToHelpNotes = string.IsNullOrWhiteSpace(dto.HowToHelpNotes) ? null : dto.HowToHelpNotes.Trim();
            row.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>
    /// INTAKE-03/04, CommunityAccessDailyLiving stream — upserts every checklist-item row, keyed by
    /// <see cref="Domain.Enums.ChecklistItemType"/>. Moved verbatim from ParticipantsController;
    /// sparse on creation exactly as the original. Per-row assignment is identical to
    /// ParticipantChecklistItemsController.ApplyAnswer (duplicated — see type doc).
    /// </summary>
    public static async Task UpsertChecklistItemsAsync(OdipDbContext db, Guid participantId, List<CreateParticipantChecklistItemDto> items, CancellationToken ct)
    {
        if (items is null || items.Count == 0) return;
        var existing = await db.ParticipantChecklistItems.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(a => a.ItemType);
        foreach (var dto in items)
        {
            if (!byType.TryGetValue(dto.ItemType, out var row))
            {
                if (dto.Value is null && string.IsNullOrWhiteSpace(dto.Notes)) continue;
                row = new ParticipantChecklistItem { Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = dto.ItemType };
                db.ParticipantChecklistItems.Add(row);
                byType[dto.ItemType] = row;
            }
            row.Value = dto.Value;
            row.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
            row.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>
    /// INTAKE-08: FirstName/LastName requiredness, gated on <see cref="CreateParticipantDto.IsDraft"/>.
    /// Moved verbatim from ParticipantsController.
    /// </summary>
    public static string? ValidateNames(CreateParticipantDto dto)
    {
        var firstBlank = string.IsNullOrWhiteSpace(dto.FirstName);
        var lastBlank = string.IsNullOrWhiteSpace(dto.LastName);
        if (dto.IsDraft)
            return firstBlank && lastBlank ? "Provide at least a first or last name to save a draft." : null;
        if (firstBlank) return "First name is required.";
        if (lastBlank) return "Last name is required.";
        return null;
    }

    /// <summary>INTAKE-05: Gender "Other" requires the self-description free-text field, both ends.</summary>
    public static string? ValidateGender(CreateParticipantDto dto) =>
        dto.Gender == Gender.Other && string.IsNullOrWhiteSpace(dto.GenderSelfDescription)
            ? "Please provide a gender self-description."
            : null;

    /// <summary>
    /// FUND-02: FundingSource "Other" requires the (reused) FundingOrganisation free-text field.
    /// Moved verbatim from ParticipantsController.
    /// </summary>
    public static string? ValidateFundingSource(CreateParticipantDto dto) =>
        dto.FundingSource == ParticipantFundingSource.Other && string.IsNullOrWhiteSpace(dto.FundingOrganisation)
            ? "Please specify the funding organisation."
            : null;

    /// <summary>
    /// LIVING-01/02/03/04: each arrangement type requires its one key identifying field. Moved
    /// verbatim from ParticipantsController.
    /// </summary>
    public static string? ValidateLivingArrangement(CreateParticipantDto dto)
    {
        if (dto.LivingArrangement == Domain.Enums.LivingArrangement.Family && string.IsNullOrWhiteSpace(dto.MainSupportPersonName))
            return "Please provide the main support person's name.";
        if (dto.LivingArrangement == Domain.Enums.LivingArrangement.Independent && dto.LivesWithOthers == true && string.IsNullOrWhiteSpace(dto.WhoLivesWith))
            return "Please specify who the participant lives with.";
        if (dto.LivingArrangement == Domain.Enums.LivingArrangement.SupportedAccommodation && string.IsNullOrWhiteSpace(dto.SilProviderName))
            return "Please provide the SIL provider name.";
        return null;
    }

    /// <summary>INTAKE-06: AU postcode is exactly 4 digits when supplied (optional field, so blank is fine).</summary>
    public static string? ValidateAddressPostcode(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.AddressPostcode) && !System.Text.RegularExpressions.Regex.IsMatch(dto.AddressPostcode, @"^\d{4}$")
            ? "Postcode must be exactly 4 digits."
            : null;

    /// <summary>INTAKE sub-wave A: the participant's OWN phone number, AU-tolerant format check. Moved verbatim.</summary>
    public static string? ValidatePhone(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.Phone) && !System.Text.RegularExpressions.Regex.IsMatch(dto.Phone, @"^\+?[\d\s\-()]{6,20}$")
            ? "Please provide a valid phone number."
            : null;

    /// <summary>INTAKE sub-wave A: the participant's OWN email, simple non-strict shape check. Moved verbatim.</summary>
    public static string? ValidateEmail(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.Email) && !System.Text.RegularExpressions.Regex.IsMatch(dto.Email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")
            ? "Please provide a valid email address."
            : null;

    /// <summary>WeightKg is numeric(5,2); reject out-of-range before it hits an Npgsql overflow. Moved verbatim.</summary>
    public static string? ValidateWeight(CreateParticipantDto dto) =>
        dto.WeightKg.HasValue && (dto.WeightKg.Value <= 0 || dto.WeightKg.Value > 999.99m)
            ? "Weight must be greater than 0 and no more than 999.99 kg."
            : null;

    /// <summary>Same shape/reasoning as <see cref="ValidateWeight"/>, for HeightCm. Moved verbatim.</summary>
    public static string? ValidateHeight(CreateParticipantDto dto) =>
        dto.HeightCm.HasValue && (dto.HeightCm.Value <= 0 || dto.HeightCm.Value > 999.99m)
            ? "Height must be greater than 0 and no more than 999.99 cm."
            : null;

    /// <summary>
    /// DIAG-01: diagnoses are open text with a curated picklist as UI guidance only — the only
    /// server-side rule is "not blank, not absurdly long" per entry. Moved verbatim.
    /// </summary>
    public static string? ValidateDiagnoses(CreateParticipantDto dto)
    {
        if (dto.PrimaryDiagnosis != null && dto.PrimaryDiagnosis.Trim().Length == 0)
            return "Primary diagnosis cannot be blank.";
        if (dto.OtherDiagnoses.Any(d => string.IsNullOrWhiteSpace(d)))
            return "Other diagnoses cannot contain a blank entry.";
        if (dto.OtherDiagnoses.Any(d => d.Length > 200))
            return "Each diagnosis must be 200 characters or fewer.";
        return null;
    }

    /// <summary>
    /// LIVING-02/03/04 server-side clearing: a field belonging to a non-selected arrangement type
    /// is stored as null regardless of what a stale client payload sent. Moved verbatim from
    /// ParticipantsController.
    /// </summary>
    public static void ApplyLivingArrangementFields(Participant p, CreateParticipantDto dto)
    {
        var arrangement = dto.LivingArrangement;
        p.LivingArrangement = arrangement;

        var isFamily = arrangement == Domain.Enums.LivingArrangement.Family;
        p.MainSupportPersonName = isFamily ? dto.MainSupportPersonName : null;
        p.MainSupportPersonRelationship = isFamily ? dto.MainSupportPersonRelationship : null;
        p.OthersLivingInAccommodation = isFamily ? dto.OthersLivingInAccommodation : null;
        p.ResidentialInfo = isFamily ? dto.ResidentialInfo : null;

        var isIndependent = arrangement == Domain.Enums.LivingArrangement.Independent;
        p.LivesWithOthers = isIndependent ? dto.LivesWithOthers : null;
        p.WhoLivesWith = isIndependent && dto.LivesWithOthers == true ? dto.WhoLivesWith : null;

        var isSupported = arrangement == Domain.Enums.LivingArrangement.SupportedAccommodation;
        p.SilProviderName = isSupported ? dto.SilProviderName : null;
        p.SilProviderContactPhone = isSupported ? dto.SilProviderContactPhone : null;
        p.AccommodationType = isSupported ? dto.AccommodationType : null;
        p.OnSiteSupportHours = isSupported ? dto.OnSiteSupportHours : null;

        // Shared across all three arrangement types (LIVING-01) — cleared only when no
        // arrangement is selected at all.
        p.LivingArrangementNotes = arrangement != null ? dto.LivingArrangementNotes : null;
    }
}
