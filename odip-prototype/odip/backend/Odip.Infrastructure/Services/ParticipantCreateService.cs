using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// POST /participants as a service, so the onboarding import creates participants by exactly the manual-entry rules. It validates, then TRACKS the
/// participant and every row that goes with it; the caller saves (the controller once per request, the importer once per row inside its own
/// transaction) and may adjust the tracked participant first. Moved verbatim from ParticipantsController.Create.
/// </summary>
public sealed class ParticipantCreateService
{
    private readonly OdipDbContext _db;
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    private readonly ParticipantIntakeSnapshotService _intakeSnapshots;
    private readonly TimeProvider _clock;

    public ParticipantCreateService(OdipDbContext db, StaffCompatibilityLinkService compatLink, SafetyNoteSyncService safetyNoteSync,
        ParticipantIntakeSnapshotService intakeSnapshots, TimeProvider clock)
    {
        _db = db;
        _compatLink = compatLink;
        _safetyNoteSync = safetyNoteSync;
        _intakeSnapshots = intakeSnapshots;
        _clock = clock;
    }

    /// <summary>
    /// The participant a retried "Complete Intake" already created (same completion request id), or null. The snapshot is keyed per participant
    /// and a create always mints a new one, so without this a retry made a second participant, PDF and onboarding row. Tenant-scoped by the
    /// snapshot's own query filter.
    /// </summary>
    public async Task<Participant?> FindCompletedReplayAsync(CreateParticipantDto dto, CancellationToken ct)
    {
        if (!dto.CompleteIntake || string.IsNullOrWhiteSpace(dto.CompletionRequestId)) return null;
        var priorParticipantId = await _db.ParticipantIntakeSnapshots
            .Where(s => s.RequestId == dto.CompletionRequestId)
            .Select(s => s.ParticipantId)
            .FirstOrDefaultAsync(ct);
        return priorParticipantId == Guid.Empty ? null : await _db.Participants.FirstOrDefaultAsync(x => x.Id == priorParticipantId, ct);
    }

    /// <returns>The tracked, unsaved participant; or the 400 message, in the order the controller checked them.</returns>
    public async Task<(Participant? Participant, string? Error)> StageAsync(CreateParticipantDto dto, string actor, CancellationToken ct)
    {
        var error = ParticipantPatchApplier.ValidateNames(dto)
            ?? InvalidMobilityOptions(dto)
            ?? ParticipantPatchApplier.ValidateGender(dto)
            ?? ParticipantPatchApplier.ValidateFundingSource(dto)
            ?? ParticipantPatchApplier.ValidateLivingArrangement(dto)
            ?? ParticipantPatchApplier.ValidateAddressPostcode(dto)
            ?? ParticipantPatchApplier.ValidatePhone(dto)
            ?? ParticipantPatchApplier.ValidateEmail(dto)
            ?? ParticipantPatchApplier.ValidateWeight(dto)
            ?? ParticipantPatchApplier.ValidateHeight(dto)
            ?? ParticipantPatchApplier.ValidateDiagnoses(dto)
            ?? ValidateContactRoles(dto, await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct));
        if (error != null) return (null, error);

        if (!await ParticipantPatchApplier.IsValidPreferredUserRefAsync(_db, dto.PreferredStaffId, ct))
            return (null, "Preferred staff member not found.");

        // Moved from ParticipantsController.Create unchanged, but for the three edits listed in Step 6.
        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName, PreferredName = dto.PreferredName,
            MiddleName = dto.MiddleName,
            DateOfBirth = dto.DateOfBirth, Gender = dto.Gender, GenderSelfDescription = dto.GenderSelfDescription,
            PlaceOfBirth = dto.PlaceOfBirth, Country = dto.Country, Phone = dto.Phone, Email = dto.Email,
            NdisNumber = dto.NdisNumber, PlanStartDate = dto.PlanStartDate, PlanEndDate = dto.PlanEndDate,
            PlanType = dto.PlanType, Region = dto.Region, IsDsoa = dto.IsDsoa,
            // Key Identifiers (INTAKE sub-wave A).
            PensionCardNumber = dto.PensionCardNumber, PensionCardExpiry = dto.PensionCardExpiry,
            MedicareNumber = dto.MedicareNumber, MedicareExpiry = dto.MedicareExpiry,
            CompanionCardNumber = dto.CompanionCardNumber, CompanionCardExpiry = dto.CompanionCardExpiry,
            PrivateHealthFund = dto.PrivateHealthFund, PrivateHealthMembershipNumber = dto.PrivateHealthMembershipNumber,
            TaxiCardNumber = dto.TaxiCardNumber, HairColour = dto.HairColour, EyeColour = dto.EyeColour,
            WeightKg = dto.WeightKg, HeightCm = dto.HeightCm,
            FundingSource = dto.FundingSource,
            // Ndis ignores whatever the client sent for the reused "Other — specify" field —
            // stored as null rather than trusting the client to leave it out.
            FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null,
            IsRepeatClient = dto.IsRepeatClient,
            MobilityAidWheelchair = dto.MobilityAidWheelchair, MobilityAidWalker = dto.MobilityAidWalker,
            MobilitySupportOptions = dto.MobilitySupportOptions,
            PrimaryDiagnosis = dto.PrimaryDiagnosis?.Trim(), OtherDiagnoses = dto.OtherDiagnoses.Select(d => d.Trim()).ToList(), HidpaSupportCategories = dto.HidpaSupportCategories,
            IsHighSupport = dto.IsHighSupport, IsIntensiveSupport = dto.IsIntensiveSupport,
            OvernightSupport = dto.OvernightSupport, OvernightRatio = dto.OvernightRatio,
            RequiresHiLoBed = dto.RequiresHiLoBed, RequiresHoist = dto.RequiresHoist, RequiresShowerChair = dto.RequiresShowerChair,
            RequiresCommode = dto.RequiresCommode, RequiresStandingMachine = dto.RequiresStandingMachine,
            // HasRestrictivePracticeFlag is intentionally not set from dto — derived on read only.
            SupportRatio = dto.SupportRatio, MobilityNotes = dto.MobilityNotes,
            EquipmentRequirements = dto.EquipmentRequirements, TransportRequirements = dto.TransportRequirements,
            MedicalSummary = dto.MedicalSummary, BehaviourRiskSummary = dto.BehaviourRiskSummary, Notes = dto.Notes,
            PreferredUserId = dto.PreferredStaffId,
            ServiceStreams = dto.ServiceStreams,
            // INTAKE-06 — plain participant-level fields, not arrangement-conditional.
            AddressStreet = dto.AddressStreet, AddressSuburb = dto.AddressSuburb,
            AddressState = dto.AddressState, AddressPostcode = dto.AddressPostcode,
            IsDraft = dto.IsDraft,
            // A newly created participant cannot possess pre-existing, participant-bound
            // approval evidence. Never inherit Participant.IsActive's legacy default and never
            // accept an activation boolean from the client.
            IsActive = false,
            // SPEC-05 (PF-10.3) — stamped server-side, never client-supplied, only when the
            // Intake wizard's own final-step create call sets CompleteIntake; a mid-intake
            // "save as draft" POST (IsDraft=true, CompleteIntake omitted/false) must not stamp it.
            IntakeCompletedAt = null,
            // INTAKE sub-wave B — Cultural & Consent step.
            IsCald = dto.IsCald, IsLgbtqi = dto.IsLgbtqi, IsFamilyCommunity = dto.IsFamilyCommunity,
            IsAboriginalOrTorresStraitIslander = dto.IsAboriginalOrTorresStraitIslander,
            ReceivedRightsAndResponsibilitiesInfo = dto.ReceivedRightsAndResponsibilitiesInfo,
            ReceivedPrivacyAndConfidentialityInfo = dto.ReceivedPrivacyAndConfidentialityInfo,
            ReceivedFeedbackInfo = dto.ReceivedFeedbackInfo, ReceivedBeingSafeInfo = dto.ReceivedBeingSafeInfo,
            ReceivedAdvocacyInfo = dto.ReceivedAdvocacyInfo,
            PersonalInterests = dto.PersonalInterests, ChoiceControlNotes = dto.ChoiceControlNotes,
            // INTAKE sub-wave C1 — Allergies/Anaphylaxis.
            AllergiesDetail = dto.AllergiesDetail, IsAnaphylaxisRisk = dto.IsAnaphylaxisRisk,
            AllergyManagementNotes = dto.AllergyManagementNotes,
            // INTAKE sub-wave C1 — Mobility & Functional.
            AmbulantStatus = dto.AmbulantStatus, FallsRiskRating = dto.FallsRiskRating,
            UnevenGroundFlag = dto.UnevenGroundFlag, LevelOfPersonalCare = dto.LevelOfPersonalCare,
            Orthotics = dto.Orthotics, ContinenceSupportDetail = dto.ContinenceSupportDetail,
            BowelCareDetail = dto.BowelCareDetail, MenstruationSupport = dto.MenstruationSupport,
            SkinIntegrity = dto.SkinIntegrity,
            // INTAKE sub-wave C1 — Behaviour & Communication.
            Memory = dto.Memory, MemoryAids = dto.MemoryAids,
            ImpairedUnderstanding = dto.ImpairedUnderstanding, ImpairedJudgementReasoning = dto.ImpairedJudgementReasoning,
            BehavioursOfConcernCurrent = dto.BehavioursOfConcernCurrent,
            BehavioursOfConcernFiveYearHistory = dto.BehavioursOfConcernFiveYearHistory,
            BehaviourRiskRating = dto.BehaviourRiskRating,
            RidsLogged = dto.RidsLogged, BspPlanProvided = dto.BspPlanProvided, BocChartProvided = dto.BocChartProvided,
            ExpressiveSkills = dto.ExpressiveSkills, ReceptiveSkills = dto.ReceptiveSkills,
            ReadingAbility = dto.ReadingAbility, CommunicationAids = dto.CommunicationAids,
            // INTAKE sub-wave C2 — Meals & Diet.
            MealAssistanceDetail = dto.MealAssistanceDetail, ChokingRiskMealDetail = dto.ChokingRiskMealDetail,
            ModifiedDietDetail = dto.ModifiedDietDetail, PegRegimeMealDetail = dto.PegRegimeMealDetail,
            SpecialUtensilsDetail = dto.SpecialUtensilsDetail, SpecialDietaryNeedsDetail = dto.SpecialDietaryNeedsDetail,
            FavouriteBreakfast = dto.FavouriteBreakfast, FavouriteLunch = dto.FavouriteLunch, FavouriteDinner = dto.FavouriteDinner,
            MedicationTricks = dto.MedicationTricks, FoodsAlwaysEaten = dto.FoodsAlwaysEaten,
            // INTAKE sub-wave C2 — About Me.
            Goals = dto.Goals, SupportAreas = dto.SupportAreas, StrengthsFears = dto.StrengthsFears,
            ThingsToKnow = dto.ThingsToKnow, WhoIsImportant = dto.WhoIsImportant, LikesDislikes = dto.LikesDislikes,
            // DIAG-02/INTAKE-03 reconciliation.
            HidpaNotes = dto.HidpaNotes,
            // INTAKE-03 — Community Access Behaviour & Support Detail.
            SignsHappyAndSettled = dto.SignsHappyAndSettled, WhatHelpsMeCalmDown = dto.WhatHelpsMeCalmDown,
            BocTriggers = dto.BocTriggers, BocEarlyWarningSigns = dto.BocEarlyWarningSigns,
            BocDeEscalationStrategies = dto.BocDeEscalationStrategies, BocWhatNotToDo = dto.BocWhatNotToDo,
            SupportsLookLikeMorning = dto.SupportsLookLikeMorning, SupportsLookLikeDay = dto.SupportsLookLikeDay,
            SupportsLookLikeAfternoonEvening = dto.SupportsLookLikeAfternoonEvening, SupportsLookLikeOvernight = dto.SupportsLookLikeOvernight,
            OverallCommunityAccessRiskRating = dto.OverallCommunityAccessRiskRating,
        };
        ParticipantPatchApplier.ApplyLivingArrangementFields(participant, dto);
        _db.Participants.Add(participant);
        // INTAKE-09: risk-entry rows submitted alongside a new participant are created in the
        // same SaveChangesAsync call as the participant insert below — transactional with it.
        // Edit-mode manages risk entries afterwards via the separate nested CRUD
        // (ParticipantRiskEntriesController), not via this DTO's collection.
        foreach (var entry in dto.RiskEntries)
        {
            _db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
            {
                Id = Guid.NewGuid(),
                ParticipantId = participant.Id,
                AtRiskParty = entry.AtRiskParty,
                Description = entry.Description.Trim(),
                MitigationNotes = string.IsNullOrWhiteSpace(entry.MitigationNotes) ? null : entry.MitigationNotes.Trim(),
                IsActive = entry.IsActive,
            });
        }
        // CONTACT-02: contact-role rows submitted alongside a new participant, in the same
        // SaveChangesAsync call as the participant insert below — transactional with it, same
        // pattern as the RiskEntries loop above. Validated (gating + uniqueness) up-front by
        // ValidateContactRoles; a "new person" row creates its Person here, an "existing person"
        // row looks it up by id (already tenant-scoped via _db.People's query filter).
        foreach (var roleDto in dto.ContactRoles)
        {
            // INTAKE-08 fix round 2 (Finding 1): mirrors ValidateContactRoles' skip above — a
            // draft's wholly-empty/abandoned-mid-fill row (no person identified) is silently
            // dropped from the save entirely, rather than trying to create a Person with a blank
            // name. A non-draft reaches here having already 400'd on this same row inside
            // ValidateContactRoles, so this branch is unreachable for it.
            if (!ContactRoleHasPerson(roleDto) && dto.IsDraft) continue;

            var roleError = await AddContactRoleAsync(participant.Id, participant.TenantId, roleDto, ct);
            if (roleError != null)
                return (null, roleError);
        }

        // Task 6d: a preferred-staff selection on create also upserts a Preferred row in the
        // rostering compatibility matrix, in the same transaction as the participant insert.
        // INTAKE-08 fix round 1 (Finding 3): isDraft suppresses that upsert entirely for a draft.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(participant.Id, null, dto.PreferredStaffId, ct, isDraft: dto.IsDraft);
        // INTAKE sub-wave B — consent rows submitted alongside a new/drafted participant, in the
        // same SaveChangesAsync call as the participant insert below.
        await ParticipantPatchApplier.UpsertConsentsAsync(_db, participant.Id, dto.Consents, ct);
        // INTAKE sub-wave C1 — health-condition grid rows submitted alongside a new/drafted
        // participant, in the same SaveChangesAsync call as the participant insert below.
        await ParticipantPatchApplier.UpsertHealthConditionsAsync(_db, participant.Id, dto.HealthConditions, ct);
        // INTAKE sub-wave C2 — ADL-assessment grid rows submitted alongside a new/drafted
        // participant, in the same SaveChangesAsync call as the participant insert below.
        await ParticipantPatchApplier.UpsertAdlAssessmentsAsync(_db, participant.Id, dto.AdlAssessments, ct);
        // INTAKE-03/04 — Community Access checklist-item grid rows submitted alongside a
        // new/drafted participant, in the same SaveChangesAsync call as the participant insert below.
        await ParticipantPatchApplier.UpsertChecklistItemsAsync(_db, participant.Id, dto.ChecklistItems, ct);
        // PF-10.2 — Community Access Risk Assessment matrix rows submitted alongside a
        // new/drafted participant, in the same SaveChangesAsync call as the participant insert below.
        await ParticipantPatchApplier.UpsertCommunityAccessRiskItemsAsync(_db, participant.Id, dto.CommunityAccessRiskItems, ct);
        // PD-5: syncs the safety-critical auto-notes (allergies/behaviours-of-concern/falls-risk/
        // risks-hazards) in the same SaveChangesAsync as the participant insert. Reads
        // participant.RiskEntries via the change tracker (see SafetyNoteSyncService), which sees
        // the RiskEntries loop's just-added, not-yet-persisted rows above — closes the
        // "ParticipantRiskEntry rows" hole in SPEC-03's Trigger coverage table for the create path.
        await _safetyNoteSync.SyncFromParticipantAsync(participant, ct);
        if (dto.CompleteIntake)
        {
            var snapshot = await _intakeSnapshots.PrepareCaptureAsync(participant, actor, dto.CompletionRequestId, ct);
            // Completion metadata and its immutable evidence share one server-issued UTC instant.
            participant.IntakeCompletedAt = snapshot.CompletedAtUtc;
            // Completing intake is what puts a participant on the onboarding worklist. A brand-new
            // participant cannot have an onboarding row yet, so no existence check is needed; the
            // row lands in the same SaveChangesAsync as the participant (and its tenant is stamped
            // with the participant's, by OdipDbContext.SaveChangesAsync).
            _db.ParticipantOnboardings.Add(NewOnboarding(participant));
        }

        return (participant, null);
    }

    private static string? InvalidMobilityOptions(CreateParticipantDto dto)
    {
        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        return invalidOptions.Count > 0 ? $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}" : null;
    }

    /// <summary>True when the row names a person either way CONTACT-03 allows: an existing Person, or a new one's first or last name.</summary>
    public static bool ContactRoleHasPerson(CreateParticipantContactRoleDto role) =>
        role.PersonId != null || !string.IsNullOrWhiteSpace(role.NewPersonFirstName) || !string.IsNullOrWhiteSpace(role.NewPersonLastName);

    /// <summary>
    /// CONTACT-02: server-side gate + CONTACT-03 uniqueness for every contact role row submitted
    /// transactionally with a new participant (mirrors RiskEntries' validate-before-save shape).
    /// Checked against <paramref name="dto"/>'s own PlanType/DateOfBirth (the participant entity
    /// doesn't exist yet at validation time) and against the other rows already in the same
    /// submission (a brand-new participant has no pre-existing rows to check against).
    ///
    /// INTAKE-08 fix round 2 (Finding 1): unlike every other validator in this controller, this
    /// one IS gated on <paramref name="dto"/>.IsDraft — mirrored on <see cref="ParticipantPatchApplier.ValidateNames"/>'s
    /// shape, not the "always runs identically" doctrine documented on
    /// <see cref="CreateParticipantDto.IsDraft"/>. Reason: the wizard's Contacts step lets a
    /// caller add a contact row and then abandon it mid-fill (or never touch it at all) before
    /// clicking "Save as draft" — <see cref="ContactRoleHasPerson"/>-false rows are silently
    /// skipped (not validated, not persisted — see Create's loop below) rather than hard-failing
    /// the entire draft save on the existing-or-new-person requirement. A row that DOES identify
    /// a person is still gated + uniqueness-checked exactly as a full submission, since a person
    /// being provided at all means it's actually going to be persisted. Format-level checks on
    /// whatever a caller DID provide (e.g. NewPersonFirstName's [StringLength(100)]) still run
    /// regardless of IsDraft — those are enforced automatically by [ApiController]'s model
    /// validation filter before this method is ever reached, same as every other DTO field. A
    /// non-draft (IsDraft false) submission hard-fails a personless row exactly as before.
    /// </summary>
    private static string? ValidateContactRoles(CreateParticipantDto dto, DateOnly asOf)
    {
        var seen = new List<(ContactRoleType RoleType, bool IsPrimary, ContactRoleStatus Status)>();
        foreach (var role in dto.ContactRoles)
        {
            if (!ContactRoleHasPerson(role))
            {
                if (dto.IsDraft) continue;
                return "Each contact needs either an existing person or a new person's name.";
            }

            var gateError = ContactRoleRules.Validate(role.RoleType, dto.PlanType, dto.DateOfBirth, role.RegisteredProviderFlag, asOf);
            if (gateError != null) return gateError;

            var uniquenessError = ContactRoleRules.ValidateUniqueness(role.RoleType, role.IsPrimary, role.Status, seen);
            if (uniquenessError != null) return uniquenessError;

            seen.Add((role.RoleType, role.IsPrimary, role.Status));
        }
        return null;
    }

    /// <summary>A blank onboarding record in the participant's own tenant (stamped with the participant's by OdipDbContext.SaveChangesAsync when still default).</summary>
    public static ParticipantOnboarding NewOnboarding(Participant participant) =>
        new() { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id };

    /// <summary>Tracks a Person (new, or an existing one looked up by id) and a role linking it to the participant. Saved by the caller.</summary>
    public async Task<string?> AddContactRoleAsync(Guid participantId, Guid tenantId, CreateParticipantContactRoleDto roleDto, CancellationToken ct)
    {
        Person person;
        if (roleDto.PersonId.HasValue)
        {
            var existingPerson = await _db.People.FirstOrDefaultAsync(p => p.Id == roleDto.PersonId.Value, ct);
            if (existingPerson == null) return "Selected person not found";
            person = existingPerson;
        }
        else
        {
            person = new Person
            {
                Id = Guid.NewGuid(), TenantId = tenantId,
                FirstName = (roleDto.NewPersonFirstName ?? "").Trim(), LastName = (roleDto.NewPersonLastName ?? "").Trim(),
                Phone = roleDto.NewPersonPhone, Mobile = roleDto.NewPersonMobile, Email = roleDto.NewPersonEmail,
                Organisation = roleDto.NewPersonOrganisation,
            };
            _db.People.Add(person);
        }

        // The participant's tenant, set explicitly: SaveChanges only stamps a tenant that is still default, and the intake evidence
        // (prepared before that save) matches tracked rows to the participant by tenant.
        var role = new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, PersonId = person.Id };
        ContactRoleFields.Apply(role, roleDto);
        _db.ParticipantContactRoles.Add(role);
        return null;
    }
}
