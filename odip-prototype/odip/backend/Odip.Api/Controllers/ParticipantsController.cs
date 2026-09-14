using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// CRUD operations for NDIS participants.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/participants")]
public class ParticipantsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly ParticipantDocumentService _documentService;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    public ParticipantsController(OdipDbContext db, StaffCompatibilityLinkService compatLink, ParticipantDocumentService documentService, SafetyNoteSyncService safetyNoteSync)
    {
        _db = db;
        _compatLink = compatLink;
        _documentService = documentService;
        _safetyNoteSync = safetyNoteSync;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the preferred-staff (now preferred-user) picker. Thin
    /// wrapper: moved to <see cref="ParticipantPatchApplier.IsValidPreferredUserRefAsync"/> so the
    /// extracted Patch applier can call the exact same logic in-process — Odip.Infrastructure has
    /// no project reference back to Odip.Api, so the shared copy had to move there.
    /// </summary>
    private Task<bool> IsValidPreferredUserRefAsync(Guid? userId, CancellationToken ct) =>
        ParticipantPatchApplier.IsValidPreferredUserRefAsync(_db, userId, ct);

    /// <summary>
    /// PF-10.2, CommunityAccessDailyLiving stream — upserts every Community Access Risk Assessment
    /// row submitted with a create/update payload, keyed by
    /// <see cref="Domain.Enums.CommunityAccessRiskItemType"/>. Copies UpsertChecklistItemsAsync's
    /// documented pattern exactly, including the load-bearing empty/null guard below (same
    /// reasoning: an Update caller that never mentions CommunityAccessRiskItems round-trips an
    /// empty list, which must mean "leave existing rows alone", not "clear every rating"). Called
    /// before SaveChangesAsync so every row lands in the same transaction as the participant
    /// insert/update. Sparse on creation (see the guard inside the loop below): the wizard always
    /// submits the full fixed twenty-two-row array with every hidden/unrated row already null (see
    /// <see cref="CreateParticipantCommunityAccessRiskItemDto"/>'s doc), so a blank incoming row
    /// must not become a permanent database row just because it was present in the payload.
    /// </summary>
    private async Task UpsertCommunityAccessRiskItemsAsync(Guid participantId, List<CreateParticipantCommunityAccessRiskItemDto> items, CancellationToken ct)
    {
        if (items is null || items.Count == 0) return;
        var existing = await _db.ParticipantCommunityAccessRiskItems.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        var byType = existing.ToDictionary(a => a.ItemType);
        foreach (var dto in items)
        {
            if (!byType.TryGetValue(dto.ItemType, out var row))
            {
                // Load-bearing skip — same reasoning as UpsertChecklistItemsAsync's: only skip
                // when there is both no existing row for this type AND the incoming dto carries no
                // answer whatsoever; a dto that clears an EXISTING row to null still falls through
                // to ApplyAnswer below and keeps the row.
                if (dto.Rating is null && string.IsNullOrWhiteSpace(dto.StrategyNotes)) continue;
                row = new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = dto.ItemType };
                _db.ParticipantCommunityAccessRiskItems.Add(row);
                byType[dto.ItemType] = row;
            }
            ParticipantCommunityAccessRiskItemsController.ApplyAnswer(row, dto.Rating, dto.StrategyNotes);
        }
    }

    // ValidateNames/ValidateGender/ValidateFundingSource/ValidateLivingArrangement/
    // ValidateAddressPostcode/ValidatePhone/ValidateEmail/ValidateWeight/ValidateHeight/
    // ValidateDiagnoses moved to Odip.Infrastructure.Services.ParticipantPatchApplier (see that
    // class's type doc for why) so the extracted Patch applier and this controller's Create/Update
    // share one copy. Call sites below now read ParticipantPatchApplier.ValidateXyz(...).

    /// <summary>
    /// INTAKE-08 fix round 2 (Finding 1): true iff <paramref name="role"/> identifies a person
    /// either way CONTACT-03 allows (an existing Person via <see cref="CreateParticipantContactRoleDto.PersonId"/>,
    /// or a new one via a non-blank NewPersonFirstName/NewPersonLastName) — shared by
    /// <see cref="ValidateContactRoles"/> and <see cref="Create"/>'s persistence loop below so the
    /// two never disagree about which rows are "real".
    /// </summary>
    private static bool ContactRoleHasPerson(CreateParticipantContactRoleDto role) =>
        role.PersonId != null || !string.IsNullOrWhiteSpace(role.NewPersonFirstName) || !string.IsNullOrWhiteSpace(role.NewPersonLastName);

    /// <summary>
    /// CONTACT-02: server-side gate + CONTACT-03 uniqueness for every contact role row submitted
    /// transactionally with a new participant (mirrors RiskEntries' validate-before-save shape).
    /// Checked against <paramref name="dto"/>'s own PlanType/DateOfBirth (the participant entity
    /// doesn't exist yet at validation time) and against the other rows already in the same
    /// submission (a brand-new participant has no pre-existing rows to check against).
    ///
    /// INTAKE-08 fix round 2 (Finding 1): unlike every other validator in this controller, this
    /// one IS gated on <paramref name="dto"/>.IsDraft — mirrored on <see cref="ValidateNames"/>'s
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
    private static string? ValidateContactRoles(CreateParticipantDto dto)
    {
        var seen = new List<(ContactRoleType RoleType, bool IsPrimary, ContactRoleStatus Status)>();
        foreach (var role in dto.ContactRoles)
        {
            if (!ContactRoleHasPerson(role))
            {
                if (dto.IsDraft) continue;
                return "Each contact needs either an existing person or a new person's name.";
            }

            var gateError = ContactRoleRules.Validate(role.RoleType, dto.PlanType, dto.DateOfBirth, role.RegisteredProviderFlag);
            if (gateError != null) return gateError;

            var uniquenessError = ContactRoleRules.ValidateUniqueness(role.RoleType, role.IsPrimary, role.Status, seen);
            if (uniquenessError != null) return uniquenessError;

            seen.Add((role.RoleType, role.IsPrimary, role.Status));
        }
        return null;
    }

    /// <summary>
    /// PF-2 (SPEC-02): loads this participant's persisted, active contact roles and computes the
    /// advisory <see cref="ContactRoleRules.PlanTypeComplianceWarning"/> from them — never the
    /// submitted DTO, so a role row that failed some other validation and never persisted can't
    /// produce a false "satisfied" reading. Shared by GetById/Create/Update/Patch so all four
    /// response bodies compute the identical value from the identical source.
    /// </summary>
    private async Task<string?> ComputePlanTypeComplianceWarningAsync(Guid participantId, PlanType planType, CancellationToken ct)
    {
        var activeRoles = await _db.ParticipantContactRoles
            .Where(r => r.ParticipantId == participantId && r.Status == ContactRoleStatus.Active)
            .Select(r => new { r.RoleType, r.RegisteredProviderFlag, r.Status })
            .ToListAsync(ct);

        return ContactRoleRules.PlanTypeComplianceWarning(
            planType,
            activeRoles.Select(r => (r.RoleType, r.RegisteredProviderFlag, r.Status)));
    }

    // ApplyLivingArrangementFields moved to
    // Odip.Infrastructure.Services.ParticipantPatchApplier (see that class's type doc) — call
    // sites below now read ParticipantPatchApplier.ApplyLivingArrangementFields(...).

    /// <summary>List participants with optional filters.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ParticipantListDto>>>> GetAll(
        [FromQuery] string? search, [FromQuery] string? region, [FromQuery] bool? isActive,
        [FromQuery] bool? wheelchairRequired, [FromQuery] bool? isHighSupport, [FromQuery] bool? isDraft,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.Participants.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(p => (p.FirstName + " " + p.LastName).Contains(search) || (p.PreferredName != null && p.PreferredName.Contains(search)));
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(p => p.Region == region);
        if (isActive.HasValue) query = query.Where(p => p.IsActive == isActive.Value);
        if (wheelchairRequired.HasValue) query = query.Where(p => p.MobilityAidWheelchair == wheelchairRequired.Value);
        if (isHighSupport.HasValue) query = query.Where(p => p.IsHighSupport == isHighSupport.Value);
        // INTAKE-08: unfiltered by default (the plain participants list shows drafts, badged) —
        // every picker/aggregate surface that must exclude drafts passes isDraft=false explicitly
        // (see the report's enumerated surface list for every frontend call site that does).
        if (isDraft.HasValue) query = query.Where(p => p.IsDraft == isDraft.Value);

        var projectedQuery = query.OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            .Select(p => new ParticipantListDto
            {
                Id = p.Id, FirstName = p.FirstName, LastName = p.LastName,
                PreferredName = p.PreferredName,
                FullName = string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName,
                MaskedNdisNumber = p.NdisNumber != null ? p.NdisNumber.Length > 0 ? "••••••••" + p.NdisNumber.Substring(p.NdisNumber.Length - 1) : "•••" : null,
                PlanType = p.PlanType, Region = p.Region, IsRepeatClient = p.IsRepeatClient,
                IsActive = p.IsActive, MobilityAidWheelchair = p.MobilityAidWheelchair, MobilityAidWalker = p.MobilityAidWalker,
                IsHighSupport = p.IsHighSupport, IsIntensiveSupport = p.IsIntensiveSupport, SupportRatio = p.SupportRatio,
                OvernightSupport = p.OvernightSupport,
                // Derived: true iff the participant has any active restrictive-practice register row.
                HasRestrictivePracticeFlag = p.RestrictivePractices.Any(rp => rp.IsActive),
                ServiceStreams = p.ServiceStreams,
                HasActiveMedications = _db.ParticipantMedications.Any(m => m.ParticipantId == p.Id && m.Status != MedicationStatus.Ceased),
                IsDraft = p.IsDraft,
                IntakeCompletedAt = p.IntakeCompletedAt,
            });

        var result = await PagedResult<ParticipantListDto>.CreateAsync(projectedQuery, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<ParticipantListDto>>.Ok(result));
    }

    /// <summary>Get a single participant by ID.</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var p = await _db.Participants
            .Include(x => x.PreferredUser)
            .Include(x => x.RestrictivePractices)
            .Include(x => x.Consents)
            .Include(x => x.HealthConditions)
            .Include(x => x.AdlAssessments)
            .Include(x => x.ChecklistItems)
            .Include(x => x.CommunityAccessRiskItems)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // Field mapping extracted to ParticipantDetailMapper (cg02 Task 11) so the caregiver form
        // controllers can build the identical ParticipantDetailDto for their own projections
        // without duplicating this ~150-line construction. Behaviour-preserving: output is
        // byte-for-byte identical to the pre-extraction inline construction this replaced.
        var dto = await ParticipantDetailMapper.ToDetailDtoAsync(_db, p, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(dto));
    }

    /// <summary>Create a new participant.</summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Create([FromBody] CreateParticipantDto dto, CancellationToken ct)
    {
        var namesError = ParticipantPatchApplier.ValidateNames(dto);
        if (namesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(namesError));

        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        if (invalidOptions.Count > 0)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));

        var genderError = ParticipantPatchApplier.ValidateGender(dto);
        if (genderError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));

        var fundingError = ParticipantPatchApplier.ValidateFundingSource(dto);
        if (fundingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));

        var livingError = ParticipantPatchApplier.ValidateLivingArrangement(dto);
        if (livingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));

        var postcodeError = ParticipantPatchApplier.ValidateAddressPostcode(dto);
        if (postcodeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));

        var phoneError = ParticipantPatchApplier.ValidatePhone(dto);
        if (phoneError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(phoneError));

        var emailError = ParticipantPatchApplier.ValidateEmail(dto);
        if (emailError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(emailError));

        var weightError = ParticipantPatchApplier.ValidateWeight(dto);
        if (weightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(weightError));

        var heightError = ParticipantPatchApplier.ValidateHeight(dto);
        if (heightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(heightError));

        var diagnosesError = ParticipantPatchApplier.ValidateDiagnoses(dto);
        if (diagnosesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(diagnosesError));

        var contactRolesError = ValidateContactRoles(dto);
        if (contactRolesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(contactRolesError));

        if (!await IsValidPreferredUserRefAsync(dto.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

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
            // stored as null rather than trusting the client's INTAKE-07 payload exclusion alone.
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
            // SPEC-05 (PF-10.3) — stamped server-side, never client-supplied, only when the
            // Intake wizard's own final-step create call sets CompleteIntake; a mid-intake
            // "save as draft" POST (IsDraft=true, CompleteIntake omitted/false) must not stamp it.
            IntakeCompletedAt = dto.CompleteIntake ? DateTime.UtcNow : null,
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

            Person person;
            if (roleDto.PersonId.HasValue)
            {
                var existingPerson = await _db.People.FirstOrDefaultAsync(p => p.Id == roleDto.PersonId.Value, ct);
                if (existingPerson == null)
                    return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Selected person not found"));
                person = existingPerson;
            }
            else
            {
                person = new Person
                {
                    Id = Guid.NewGuid(),
                    FirstName = (roleDto.NewPersonFirstName ?? "").Trim(), LastName = (roleDto.NewPersonLastName ?? "").Trim(),
                    Phone = roleDto.NewPersonPhone, Mobile = roleDto.NewPersonMobile, Email = roleDto.NewPersonEmail,
                    Organisation = roleDto.NewPersonOrganisation,
                };
                _db.People.Add(person);
            }

            var role = new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id };
            ParticipantContactRolesController.ApplyRoleFields(role, roleDto);
            _db.ParticipantContactRoles.Add(role);
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
        await UpsertCommunityAccessRiskItemsAsync(participant.Id, dto.CommunityAccessRiskItems, ct);
        // PD-5: syncs the safety-critical auto-notes (allergies/behaviours-of-concern/falls-risk/
        // risks-hazards) in the same SaveChangesAsync as the participant insert. Reads
        // participant.RiskEntries via the change tracker (see SafetyNoteSyncService), which sees
        // the RiskEntries loop's just-added, not-yet-persisted rows above — closes the
        // "ParticipantRiskEntry rows" hole in SPEC-03's Trigger coverage table for the create path.
        await _safetyNoteSync.SyncFromParticipantAsync(participant, ct);
        await _db.SaveChangesAsync(ct);
        // PF-2: computed from what actually landed in the ParticipantContactRoles table (just
        // inserted above, in the same SaveChangesAsync), not from dto.ContactRoles — a role row
        // that failed some other validation and never persisted can't produce a false "satisfied"
        // reading.
        var createPlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(participant.Id, participant.PlanType, ct);
        return CreatedAtAction(nameof(GetById), new { id = participant.Id },
            ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = participant.Id, FirstName = participant.FirstName, LastName = participant.LastName, FullName = participant.FullName, IsActive = true, IsDraft = participant.IsDraft, IntakeCompletedAt = participant.IntakeCompletedAt, CreatedAt = participant.CreatedAt, UpdatedAt = participant.UpdatedAt, PlanTypeComplianceWarning = createPlanTypeComplianceWarning }));
    }

    /// <summary>Update an existing participant.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Update(Guid id, [FromBody] UpdateParticipantDto dto, CancellationToken ct)
    {
        var namesError = ParticipantPatchApplier.ValidateNames(dto);
        if (namesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(namesError));

        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        if (invalidOptions.Count > 0)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));

        var genderError = ParticipantPatchApplier.ValidateGender(dto);
        if (genderError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));

        var fundingError = ParticipantPatchApplier.ValidateFundingSource(dto);
        if (fundingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));

        var livingError = ParticipantPatchApplier.ValidateLivingArrangement(dto);
        if (livingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));

        var postcodeError = ParticipantPatchApplier.ValidateAddressPostcode(dto);
        if (postcodeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));

        var phoneError = ParticipantPatchApplier.ValidatePhone(dto);
        if (phoneError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(phoneError));

        var emailError = ParticipantPatchApplier.ValidateEmail(dto);
        if (emailError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(emailError));

        var weightError = ParticipantPatchApplier.ValidateWeight(dto);
        if (weightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(weightError));

        var heightError = ParticipantPatchApplier.ValidateHeight(dto);
        if (heightError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(heightError));

        var diagnosesError = ParticipantPatchApplier.ValidateDiagnoses(dto);
        if (diagnosesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(diagnosesError));

        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // INTAKE-08 fix round 1 (Finding 1b, controller ruling): un-finalising is not a product
        // capability. A participant that has already been finalised (p.IsDraft == false) can
        // never be sent back into draft state via this endpoint — only a genuinely new-or-still-
        // drafting record (p.IsDraft == true already) may keep saving with IsDraft=true. If this
        // ever becomes a real capability it ships as a deliberate, separate feature rather than a
        // side effect of the wizard's universal "Save as draft" button being clickable everywhere
        // (the frontend also removes that button for a finalised participant — see
        // ParticipantCreatePage.tsx — this is the server-side half of that same ruling).
        if (dto.IsDraft && !p.IsDraft)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("A finalised participant cannot be reverted to draft."));

        if (!await IsValidPreferredUserRefAsync(dto.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

        var previousPreferredStaffId = p.PreferredUserId;

        p.FirstName = dto.FirstName; p.LastName = dto.LastName; p.PreferredName = dto.PreferredName;
        p.MiddleName = dto.MiddleName;
        p.DateOfBirth = dto.DateOfBirth; p.Gender = dto.Gender; p.GenderSelfDescription = dto.GenderSelfDescription;
        p.PlaceOfBirth = dto.PlaceOfBirth; p.Country = dto.Country; p.Phone = dto.Phone; p.Email = dto.Email;
        p.NdisNumber = dto.NdisNumber; p.PlanStartDate = dto.PlanStartDate; p.PlanEndDate = dto.PlanEndDate;
        p.PlanType = dto.PlanType;
        p.Region = dto.Region;
        p.IsDsoa = dto.IsDsoa;
        // Key Identifiers (INTAKE sub-wave A).
        p.PensionCardNumber = dto.PensionCardNumber; p.PensionCardExpiry = dto.PensionCardExpiry;
        p.MedicareNumber = dto.MedicareNumber; p.MedicareExpiry = dto.MedicareExpiry;
        p.CompanionCardNumber = dto.CompanionCardNumber; p.CompanionCardExpiry = dto.CompanionCardExpiry;
        p.PrivateHealthFund = dto.PrivateHealthFund; p.PrivateHealthMembershipNumber = dto.PrivateHealthMembershipNumber;
        p.TaxiCardNumber = dto.TaxiCardNumber; p.HairColour = dto.HairColour; p.EyeColour = dto.EyeColour;
        p.WeightKg = dto.WeightKg; p.HeightCm = dto.HeightCm;
        p.FundingSource = dto.FundingSource;
        // Ndis ignores whatever the client sent for the reused "Other — specify" field — same
        // server-side clearing as Create, so flipping Other -> Ndis actually clears stale text
        // rather than leaving it dormant on the row.
        p.FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null;
        ParticipantPatchApplier.ApplyLivingArrangementFields(p, dto);
        p.AddressStreet = dto.AddressStreet; p.AddressSuburb = dto.AddressSuburb;
        p.AddressState = dto.AddressState; p.AddressPostcode = dto.AddressPostcode;
        p.IsRepeatClient = dto.IsRepeatClient;
        p.IsActive = dto.IsActive; p.MobilityAidWheelchair = dto.MobilityAidWheelchair; p.MobilityAidWalker = dto.MobilityAidWalker;
        p.MobilitySupportOptions = dto.MobilitySupportOptions;
        p.PrimaryDiagnosis = dto.PrimaryDiagnosis?.Trim(); p.OtherDiagnoses = dto.OtherDiagnoses.Select(d => d.Trim()).ToList(); p.HidpaSupportCategories = dto.HidpaSupportCategories;
        p.IsHighSupport = dto.IsHighSupport; p.IsIntensiveSupport = dto.IsIntensiveSupport;
        p.OvernightSupport = dto.OvernightSupport; p.OvernightRatio = dto.OvernightRatio;
        p.RequiresHiLoBed = dto.RequiresHiLoBed; p.RequiresHoist = dto.RequiresHoist; p.RequiresShowerChair = dto.RequiresShowerChair;
        p.RequiresCommode = dto.RequiresCommode; p.RequiresStandingMachine = dto.RequiresStandingMachine;
        // p.HasRestrictivePracticeFlag is intentionally left untouched — derived on read only.
        p.SupportRatio = dto.SupportRatio; p.MobilityNotes = dto.MobilityNotes;
        p.EquipmentRequirements = dto.EquipmentRequirements; p.TransportRequirements = dto.TransportRequirements;
        p.MedicalSummary = dto.MedicalSummary; p.BehaviourRiskSummary = dto.BehaviourRiskSummary;
        p.Notes = dto.Notes; p.PreferredUserId = dto.PreferredStaffId; p.ServiceStreams = dto.ServiceStreams;
        // INTAKE sub-wave B — Cultural & Consent step.
        p.IsCald = dto.IsCald; p.IsLgbtqi = dto.IsLgbtqi; p.IsFamilyCommunity = dto.IsFamilyCommunity;
        p.IsAboriginalOrTorresStraitIslander = dto.IsAboriginalOrTorresStraitIslander;
        p.ReceivedRightsAndResponsibilitiesInfo = dto.ReceivedRightsAndResponsibilitiesInfo;
        p.ReceivedPrivacyAndConfidentialityInfo = dto.ReceivedPrivacyAndConfidentialityInfo;
        p.ReceivedFeedbackInfo = dto.ReceivedFeedbackInfo; p.ReceivedBeingSafeInfo = dto.ReceivedBeingSafeInfo;
        p.ReceivedAdvocacyInfo = dto.ReceivedAdvocacyInfo;
        p.PersonalInterests = dto.PersonalInterests; p.ChoiceControlNotes = dto.ChoiceControlNotes;
        // INTAKE sub-wave C1 — Allergies/Anaphylaxis.
        p.AllergiesDetail = dto.AllergiesDetail; p.IsAnaphylaxisRisk = dto.IsAnaphylaxisRisk;
        p.AllergyManagementNotes = dto.AllergyManagementNotes;
        // INTAKE sub-wave C1 — Mobility & Functional.
        p.AmbulantStatus = dto.AmbulantStatus; p.FallsRiskRating = dto.FallsRiskRating;
        p.UnevenGroundFlag = dto.UnevenGroundFlag; p.LevelOfPersonalCare = dto.LevelOfPersonalCare;
        p.Orthotics = dto.Orthotics; p.ContinenceSupportDetail = dto.ContinenceSupportDetail;
        p.BowelCareDetail = dto.BowelCareDetail; p.MenstruationSupport = dto.MenstruationSupport;
        p.SkinIntegrity = dto.SkinIntegrity;
        // INTAKE sub-wave C1 — Behaviour & Communication.
        p.Memory = dto.Memory; p.MemoryAids = dto.MemoryAids;
        p.ImpairedUnderstanding = dto.ImpairedUnderstanding; p.ImpairedJudgementReasoning = dto.ImpairedJudgementReasoning;
        p.BehavioursOfConcernCurrent = dto.BehavioursOfConcernCurrent;
        p.BehavioursOfConcernFiveYearHistory = dto.BehavioursOfConcernFiveYearHistory;
        p.BehaviourRiskRating = dto.BehaviourRiskRating;
        p.RidsLogged = dto.RidsLogged; p.BspPlanProvided = dto.BspPlanProvided; p.BocChartProvided = dto.BocChartProvided;
        p.ExpressiveSkills = dto.ExpressiveSkills; p.ReceptiveSkills = dto.ReceptiveSkills;
        p.ReadingAbility = dto.ReadingAbility; p.CommunicationAids = dto.CommunicationAids;
        // INTAKE sub-wave C2 — Meals & Diet.
        p.MealAssistanceDetail = dto.MealAssistanceDetail; p.ChokingRiskMealDetail = dto.ChokingRiskMealDetail;
        p.ModifiedDietDetail = dto.ModifiedDietDetail; p.PegRegimeMealDetail = dto.PegRegimeMealDetail;
        p.SpecialUtensilsDetail = dto.SpecialUtensilsDetail; p.SpecialDietaryNeedsDetail = dto.SpecialDietaryNeedsDetail;
        p.FavouriteBreakfast = dto.FavouriteBreakfast; p.FavouriteLunch = dto.FavouriteLunch; p.FavouriteDinner = dto.FavouriteDinner;
        p.MedicationTricks = dto.MedicationTricks; p.FoodsAlwaysEaten = dto.FoodsAlwaysEaten;
        // INTAKE sub-wave C2 — About Me.
        p.Goals = dto.Goals; p.SupportAreas = dto.SupportAreas; p.StrengthsFears = dto.StrengthsFears;
        p.ThingsToKnow = dto.ThingsToKnow; p.WhoIsImportant = dto.WhoIsImportant; p.LikesDislikes = dto.LikesDislikes;
        // DIAG-02/INTAKE-03 reconciliation.
        p.HidpaNotes = dto.HidpaNotes;
        // INTAKE-03 — Community Access Behaviour & Support Detail.
        p.SignsHappyAndSettled = dto.SignsHappyAndSettled; p.WhatHelpsMeCalmDown = dto.WhatHelpsMeCalmDown;
        p.BocTriggers = dto.BocTriggers; p.BocEarlyWarningSigns = dto.BocEarlyWarningSigns;
        p.BocDeEscalationStrategies = dto.BocDeEscalationStrategies; p.BocWhatNotToDo = dto.BocWhatNotToDo;
        p.SupportsLookLikeMorning = dto.SupportsLookLikeMorning; p.SupportsLookLikeDay = dto.SupportsLookLikeDay;
        p.SupportsLookLikeAfternoonEvening = dto.SupportsLookLikeAfternoonEvening; p.SupportsLookLikeOvernight = dto.SupportsLookLikeOvernight;
        p.OverallCommunityAccessRiskRating = dto.OverallCommunityAccessRiskRating;
        // INTAKE-08: the caller declares intent per-call — true keeps/re-marks the participant a
        // draft (another "Save as draft" click, from any wizard step), false is a full save,
        // including the final Review-step submission that's meant to clear a draft off for good.
        // SPEC-05 PF-10.5: this is also "profile complete"'s single server-side flip point — every
        // one of the field validators above (ValidateNames et al.) already ran, so an incomplete
        // payload never reaches here with IsDraft=false; the client requests the transition, the
        // server only ever honours it after its own validation passes, in this one place.
        p.IsDraft = dto.IsDraft;
        // SPEC-05 PF-10.5: resuming an existing Intake draft (IntakeCompletedAt still null) routes
        // back through this same Update endpoint rather than a second Create — the resumed Intake
        // wizard's own final-step call sets CompleteIntake=true to stamp IntakeCompletedAt here,
        // exactly like Create's own CompleteIntake handling. Revises CompleteIntake's original
        // "ignored by Update" doc note (PF-10.3): that was written before this resume path existed.
        // Never overwrites an already-set value (set once, never cleared — see
        // Participant.IntakeCompletedAt's doc) and never touches IsDraft — resuming Intake alone
        // does not finalise the participant; only a subsequent Profile completion does that.
        if (dto.CompleteIntake && p.IntakeCompletedAt == null)
            p.IntakeCompletedAt = DateTime.UtcNow;
        p.UpdatedAt = DateTime.UtcNow;

        // Task 6d: a changed/cleared preferred-staff selection upserts/downgrades the matching
        // compatibility row, in the same transaction as the participant update.
        // INTAKE-08 fix round 1 (Finding 3): isDraft suppresses that upsert entirely for a draft.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(p.Id, previousPreferredStaffId, dto.PreferredStaffId, ct, isDraft: dto.IsDraft);
        // INTAKE sub-wave B — see CreateParticipantDto.Consents' doc for why, unlike RiskEntries/
        // ContactRoles, this is read on Update too (not create-mode-only).
        await ParticipantPatchApplier.UpsertConsentsAsync(_db, p.Id, dto.Consents, ct);
        // INTAKE sub-wave C1 — same read-on-both-paths convention as Consents above.
        await ParticipantPatchApplier.UpsertHealthConditionsAsync(_db, p.Id, dto.HealthConditions, ct);
        // INTAKE sub-wave C2 — same read-on-both-paths convention as Consents/HealthConditions above.
        await ParticipantPatchApplier.UpsertAdlAssessmentsAsync(_db, p.Id, dto.AdlAssessments, ct);
        // INTAKE-03/04 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments above.
        await ParticipantPatchApplier.UpsertChecklistItemsAsync(_db, p.Id, dto.ChecklistItems, ct);
        // PF-10.2 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments/ChecklistItems above.
        await UpsertCommunityAccessRiskItemsAsync(p.Id, dto.CommunityAccessRiskItems, ct);
        // PD-5: syncs the safety-critical auto-notes in the same SaveChangesAsync as this update.
        await _safetyNoteSync.SyncFromParticipantAsync(p, ct);
        await _db.SaveChangesAsync(ct);
        // PF-2: Update's payload carries no contactRoles (unchanged, per Design's note) — the
        // warning is computed from the participant's live ContactRoles exactly as GetById does.
        var updatePlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, IsDraft = p.IsDraft, IntakeCompletedAt = p.IntakeCompletedAt, UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = updatePlanTypeComplianceWarning }));
    }

    /// <summary>
    /// CORE-02: partial save. Patches only the semantic field groups present in <paramref name="dto"/>
    /// (16 scalar + 4 collection groups — see PatchParticipantDto's doc for the full partition);
    /// every absent group's columns are left completely untouched. Presence is all-or-nothing at
    /// the GROUP level, not the field level: a present group's own null member DOES clear that
    /// field (mirrors a mini full-submit for just that group), matching every existing
    /// validator/assignment's self-contained-within-one-group behaviour. Concurrency is
    /// last-write-wins per group — no RowVersion/ETag, same policy as today's whole-payload PUT,
    /// just scoped to a smaller blast radius. This DTO structurally cannot express IsDraft or
    /// IsActive — those stay PUT's job exclusively; a partial save can neither finalise nor
    /// un-finalise a draft.
    /// </summary>
    [HttpPatch("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Patch(Guid id, [FromBody] PatchParticipantDto dto, CancellationToken ct)
    {
        // Tenant scoping comes for free from OdipDbContext's ambient ITenantEntity query filter on
        // Participants (see GetById/Update above) — a wrong-tenant id simply isn't found.
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // Extracted, behaviour-preserving, into ParticipantPatchApplier.ApplyAsync so the
        // caregiver accept flow (CaregiverSubmissionsController) can apply a sanitised
        // PatchParticipantDto in-process without going through HTTP. See that class's doc.
        var error = await ParticipantPatchApplier.ApplyAsync(_db, _safetyNoteSync, _compatLink, p, dto, ct);
        if (error != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(error));

        // PF-2: Patch's DTO never carries contactRoles either — computed from live ContactRoles,
        // using p.PlanType as it stands after any ndisPlan group patch applied above.
        var patchPlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, IsDraft = p.IsDraft, UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = patchPlanTypeComplianceWarning }));
    }

    /// <summary>Get bookings for a participant.</summary>
    [HttpGet("{id:guid}/bookings")]
    public async Task<ActionResult<ApiResponse<List<BookingListDto>>>> GetBookings(Guid id, CancellationToken ct)
    {
        var bookings = await _db.ParticipantBookings.Include(b => b.TripInstance)
            .Where(b => b.ParticipantId == id)
            .Select(b => new BookingListDto
            {
                Id = b.Id, TripInstanceId = b.TripInstanceId, TripName = b.TripInstance.TripName,
                ParticipantId = b.ParticipantId, BookingStatus = b.BookingStatus, BookingDate = b.BookingDate,
                WheelchairRequired = b.WheelchairRequired, HighSupportRequired = b.HighSupportRequired,
                NightSupportRequired = b.NightSupportRequired, HasRestrictivePracticeFlag = b.HasRestrictivePracticeFlag,
                SupportRatioOverride = b.SupportRatioOverride, ActionRequired = b.ActionRequired
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<BookingListDto>>.Ok(bookings));
    }

    /// <summary>Get support profile for a participant (restricted).</summary>
    [HttpGet("{id:guid}/support-profile")]
    public async Task<ActionResult<ApiResponse<SupportProfileDto>>> GetSupportProfile(Guid id, CancellationToken ct)
    {
        var sp = await _db.SupportProfiles.FirstOrDefaultAsync(s => s.ParticipantId == id, ct);
        if (sp == null) return NotFound(ApiResponse<SupportProfileDto>.Fail("Support profile not found"));

        return Ok(ApiResponse<SupportProfileDto>.Ok(new SupportProfileDto
        {
            Id = sp.Id, ParticipantId = sp.ParticipantId, CommunicationNotes = sp.CommunicationNotes,
            BehaviourSupportNotes = sp.BehaviourSupportNotes, RestrictivePracticeDetails = sp.RestrictivePracticeDetails,
            ManualHandlingNotes = sp.ManualHandlingNotes, MedicationHealthSummary = sp.MedicationHealthSummary,
            EmergencyConsiderations = sp.EmergencyConsiderations, TravelSpecificNotes = sp.TravelSpecificNotes,
            ReviewDate = sp.ReviewDate
        }));
    }

    /// <summary>Create or update support profile for a participant.</summary>
    [HttpPut("{id:guid}/support-profile")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SupportProfileDto>>> UpdateSupportProfile(Guid id, [FromBody] UpdateSupportProfileDto dto, CancellationToken ct)
    {
        var sp = await _db.SupportProfiles.FirstOrDefaultAsync(s => s.ParticipantId == id, ct);
        if (sp == null)
        {
            sp = new SupportProfile { Id = Guid.NewGuid(), ParticipantId = id };
            _db.SupportProfiles.Add(sp);
        }
        sp.CommunicationNotes = dto.CommunicationNotes; sp.BehaviourSupportNotes = dto.BehaviourSupportNotes;
        // sp.RestrictivePracticeDetails is intentionally left untouched — the register replaces
        // it as the write path; existing legacy text stays readable via SupportProfileDto.
        sp.ManualHandlingNotes = dto.ManualHandlingNotes;
        sp.MedicationHealthSummary = dto.MedicationHealthSummary; sp.EmergencyConsiderations = dto.EmergencyConsiderations;
        sp.TravelSpecificNotes = dto.TravelSpecificNotes; sp.ReviewDate = dto.ReviewDate;
        sp.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<SupportProfileDto>.Ok(new SupportProfileDto { Id = sp.Id, ParticipantId = sp.ParticipantId }));
    }

    /// <summary>DOC-01: download the Intake Form PDF for a participant.</summary>
    [HttpGet("{id:guid}/documents/intake")]
    public async Task<IActionResult> DownloadIntakeFormPdf(Guid id, CancellationToken ct)
    {
        var result = await _documentService.GenerateIntakeFormAsync(id, ct);
        if (result == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    /// <summary>DOC-01: download the Participant Profile PDF for a participant.</summary>
    [HttpGet("{id:guid}/documents/profile")]
    public async Task<IActionResult> DownloadParticipantProfilePdf(Guid id, CancellationToken ct)
    {
        var result = await _documentService.GenerateParticipantProfileAsync(id, ct);
        if (result == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    /// <summary>
    /// PF-10.6: download the Client Overview ("Client Support Needs Summary") PDF for a
    /// participant — a condensed per-trip staff cheat-sheet. <paramref name="tripId"/> is optional:
    /// when supplied (primary Trip-detail surface), the header's TRIP/DATE/GROUP fields are
    /// populated from that trip; when omitted (secondary Participant-detail surface), the same
    /// document renders with a blank header, same 404 contract as the other two document endpoints.
    /// </summary>
    [HttpGet("{id:guid}/documents/client-overview")]
    public async Task<IActionResult> DownloadClientOverviewPdf(Guid id, [FromQuery] Guid? tripId, CancellationToken ct)
    {
        var result = await _documentService.GenerateClientOverviewAsync(id, tripId, ct);
        if (result == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    /// <summary>Archive (soft-delete) a participant.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        p.IsActive = false; p.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Participant archived"));
    }
}
