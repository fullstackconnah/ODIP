using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
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
    private readonly ParticipantIntakeSnapshotService _intakeSnapshots;
    private readonly TimeProvider _clock;
    private readonly ParticipantCreateService _creator;
    public ParticipantsController(OdipDbContext db, StaffCompatibilityLinkService compatLink, ParticipantDocumentService documentService, SafetyNoteSyncService safetyNoteSync, ParticipantIntakeSnapshotService? intakeSnapshots = null, TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
        _db = db;
        _compatLink = compatLink;
        _documentService = documentService;
        _safetyNoteSync = safetyNoteSync;
        _intakeSnapshots = intakeSnapshots ?? new ParticipantIntakeSnapshotService(db);
        _creator = new ParticipantCreateService(db, compatLink, safetyNoteSync, _intakeSnapshots, _clock);
    }

    /// <summary>
    /// §4.4 same-tenant validation for the preferred-staff (now preferred-user) picker. Thin
    /// wrapper: moved to <see cref="ParticipantPatchApplier.IsValidPreferredUserRefAsync"/> so the
    /// extracted Patch applier can call the exact same logic in-process — Odip.Infrastructure has
    /// no project reference back to Odip.Api, so the shared copy had to move there.
    /// </summary>
    private Task<bool> IsValidPreferredUserRefAsync(Guid? userId, CancellationToken ct) =>
        ParticipantPatchApplier.IsValidPreferredUserRefAsync(_db, userId, ct);

    // Direct controller tests do not construct an HttpContext, while authenticated requests do.
    // Keep audit attribution deterministic in both cases rather than dereferencing a null User.
    private string CompletionActor() =>
        User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? User?.FindFirstValue("sub") ?? "unknown";

    // ValidateNames/ValidateGender/ValidateFundingSource/ValidateLivingArrangement/
    // ValidateAddressPostcode/ValidatePhone/ValidateEmail/ValidateWeight/ValidateHeight/
    // ValidateDiagnoses moved to Odip.Infrastructure.Services.ParticipantPatchApplier (see that
    // class's type doc for why) so the extracted Patch applier and this controller's Create/Update
    // share one copy. Call sites below now read ParticipantPatchApplier.ValidateXyz(...).

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

    /// <summary>
    /// Idempotent "ensure the onboarding row exists" for an existing participant, the same
    /// AnyAsync-then-Add pattern ParticipantInquiriesController.Convert uses, scoped to the
    /// participant's tenant. Tracked only — the caller's single SaveChangesAsync persists it, so
    /// completion, its immutable snapshot and the worklist row commit together or not at all.
    /// </summary>
    private async Task EnsureOnboardingAsync(Participant participant, CancellationToken ct)
    {
        if (await _db.ParticipantOnboardings.AnyAsync(x => x.ParticipantId == participant.Id && x.TenantId == participant.TenantId, ct)) return;
        _db.ParticipantOnboardings.Add(ParticipantCreateService.NewOnboarding(participant));
    }

    /// <summary>List participants with optional filters.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ParticipantListDto>>>> GetAll(
        [FromQuery] string? search, [FromQuery] string? region, [FromQuery] bool? isActive,
        [FromQuery] bool? wheelchairRequired, [FromQuery] bool? isHighSupport, [FromQuery] bool? isDraft,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default,
        [FromQuery] bool operationalOnly = false, [FromQuery] bool canReceiveServices = false, [FromQuery] bool servicesBegun = false)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.Participants.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = ParticipantQueries.SearchByName(query, search);
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(p => p.Region == region);
        if (isActive.HasValue) query = query.Where(p => p.IsActive == isActive.Value);
        if (wheelchairRequired.HasValue) query = query.Where(p => p.MobilityAidWheelchair == wheelchairRequired.Value);
        if (isHighSupport.HasValue) query = query.Where(p => p.IsHighSupport == isHighSupport.Value);
        // A caller can still explicitly select drafts for back-office work.
        if (isDraft.HasValue) query = query.Where(p => p.IsDraft == isDraft.Value);
        // The pickers of operational screens: who can receive services (active, finalised or services started), never an archived participant.
        if (canReceiveServices) query = query.Where(Participant.CanReceiveServicesRule);
        // Pickers of records about the past as well (incidents, the medication report): past the start of services, archived participants kept.
        if (servicesBegun) query = query.Where(Participant.ServicesBegunRule);
        if (operationalOnly)
        {
            // The register is a stage boundary, not a presentation-only draft filter. A record
            // introduced through the new onboarding workflow has an onboarding row and must not
            // enter operational read surfaces until it has been activated. For an organisation
            // that ENFORCES readiness, activated means the fail-closed readiness gate accepts it
            // (unchanged). In Warn mode (the default) activation proceeds without signed-agreement
            // evidence, so an activated participant is on the register like any other.
            // Older non-draft records have no onboarding row, so retain their historic visibility.
            query = ParticipantReadiness.OperationalRegister(_db, query);
        }

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
                ServicesStartedAt = p.ServicesStartedAt,
            });

        var result = await PagedResult<ParticipantListDto>.CreateAsync(projectedQuery, page, pageSize, ct);

        // What is missing for each participant on this page (intake, onboarding, signed agreement),
        // for the quiet "Not ready" note in pickers and the register. Three queries for the page.
        var readinessIssues = await ParticipantReadiness.IssuesAsync(_db, result.Items.Select(i => i.Id).ToList(), ct);
        result.Items = result.Items
            .Select(i => i with { ReadinessIssues = ParticipantReadiness.IssuesOrNull(readinessIssues, i.Id) })
            .ToList();

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
        // The coordinator-facing read carries what is missing before this participant is fully
        // ready. The mapper is shared with the caregiver forms, which must not show it, so it is
        // set here and nowhere else.
        var readinessIssues = await ParticipantReadiness.IssuesAsync(_db, new[] { p.Id }, ct);
        dto = dto with { ReadinessIssues = ParticipantReadiness.IssuesOrNull(readinessIssues, p.Id) };
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(dto));
    }

    /// <summary>Create a new participant.</summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Create([FromBody] CreateParticipantDto dto, CancellationToken ct)
    {
        // A retried "Complete Intake" (the response was lost to a 502 or a dropped connection) answers with the participant the first attempt made.
        var prior = await _creator.FindCompletedReplayAsync(dto, ct);
        if (prior != null)
            return Ok(ApiResponse<ParticipantDetailDto>.Ok(CreatedBody(prior, await ComputePlanTypeComplianceWarningAsync(prior.Id, prior.PlanType, ct))));

        var (participant, error) = await _creator.StageAsync(dto, CompletionActor(), ct);
        if (error != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(error));

        await _db.SaveChangesAsync(ct);
        // PF-2: computed from what actually landed in the ParticipantContactRoles table, not from dto.ContactRoles.
        var createPlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(participant!.Id, participant.PlanType, ct);
        return CreatedAtAction(nameof(GetById), new { id = participant.Id },
            ApiResponse<ParticipantDetailDto>.Ok(CreatedBody(participant, createPlanTypeComplianceWarning)));
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
        var previousSupportRatio = p.SupportRatio;

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
        // Lifecycle flags are deliberately not copied from the full-profile DTO. They are derived
        // below from the server-owned intake completion evidence and the permitted draft state.
        p.MobilityAidWheelchair = dto.MobilityAidWheelchair; p.MobilityAidWalker = dto.MobilityAidWalker;
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
        // SPEC-05 PF-10.5: resuming an existing Intake draft (IntakeCompletedAt still null) routes
        // back through this same Update endpoint rather than a second Create — the resumed Intake
        // wizard's own final-step call sets CompleteIntake=true to stamp IntakeCompletedAt here,
        // exactly like Create's own CompleteIntake handling. Revises CompleteIntake's original
        // "ignored by Update" doc note (PF-10.3): that was written before this resume path existed.
        // Never overwrites an already-set value (set once, never cleared — see
        // Participant.IntakeCompletedAt's doc) and never touches IsDraft — resuming Intake alone
        // does not finalise the participant; only "Make active" on the onboarding checklist does that.
        p.UpdatedAt = DateTime.UtcNow;

        if (dto.CompleteIntake)
        {
            var intakeSnapshot = await _intakeSnapshots.PrepareCaptureAsync(p, CompletionActor(), dto.CompletionRequestId, ct);
            // Preserve the first completion stamp but create a separate immutable revision for an
            // intentional later completion with a new idempotency key.
            p.IntakeCompletedAt ??= intakeSnapshot.CompletedAtUtc;
            // Same worklist rule as Create: completing intake (first time or a deliberate later
            // revision) guarantees exactly one onboarding row, created in this same save. Repeats
            // find the existing row and add nothing.
            await EnsureOnboardingAsync(p, ct);
        }

        // A full-profile PUT may edit profile data, but it cannot promote an intake-incomplete
        // participant, and neither CompleteIntake nor raw IsActive/IsDraft values activate anyone.
        // Already-active legacy rows stay active (IsActive is never written here).
        // A finalised participant is never sent back to draft by an update (the rule above rejects an explicit isDraft: true), and a
        // legacy participant whose IntakeCompletedAt was never stamped is NOT a draft because of that: they stay finalised.
        // Nor is a draft finalised by one: IsDraft is never written here. Only "Make active" finishes onboarding (it applies the readiness rule this would skip).
        // Saving never activates anyone (owner decision 2026-10-13): "Make active" on the onboarding checklist does, and the status
        // endpoint restores an archived participant. This used to activate here, which re-activated an archived participant on every save.

        // Task 6d: a changed/cleared preferred-staff selection upserts/downgrades the matching
        // compatibility row, in the same transaction as the participant update. Draft state is
        // the derived state above, not the client-supplied flag.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(p.Id, previousPreferredStaffId, dto.PreferredStaffId, ct, isDraft: p.IsDraft);
        // INTAKE sub-wave B — see CreateParticipantDto.Consents' doc for why, unlike RiskEntries/
        // ContactRoles, this is read on Update too (not create-mode-only).
        await ParticipantPatchApplier.UpsertConsentsAsync(_db, p.Id, dto.Consents, ct);
        // INTAKE sub-wave C1 — same read-on-both-paths convention as Consents above.
        await ParticipantPatchApplier.UpsertHealthConditionsAsync(_db, p.Id, dto.HealthConditions, ct);
        // INTAKE sub-wave C2 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments above.
        await ParticipantPatchApplier.UpsertAdlAssessmentsAsync(_db, p.Id, dto.AdlAssessments, ct);
        // INTAKE-03/04 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments/ChecklistItems above.
        await ParticipantPatchApplier.UpsertChecklistItemsAsync(_db, p.Id, dto.ChecklistItems, ct);
        // PF-10.2 — same read-on-both-paths convention as Consents/HealthConditions/AdlAssessments/ChecklistItems above.
        await ParticipantPatchApplier.UpsertCommunityAccessRiskItemsAsync(_db, p.Id, dto.CommunityAccessRiskItems, ct);
        // PD-5: syncs the safety-critical auto-notes in the same SaveChangesAsync as this update.
        await _safetyNoteSync.SyncFromParticipantAsync(p, ct);
        if (p.SupportRatio != previousSupportRatio) await TripStaffing.RecalculateForParticipantAsync(_db, p.Id, ct);
        await _db.SaveChangesAsync(ct);
        // PF-2: Update's payload carries no contactRoles (unchanged, per Design's note) — the
        // warning is computed from the participant's live ContactRoles exactly as GetById does.
        var updatePlanTypeComplianceWarning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, IsDraft = p.IsDraft, IntakeCompletedAt = p.IntakeCompletedAt, UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = updatePlanTypeComplianceWarning }));
    }

    // ── Scoped lifecycle writes ───────────────────────────────────────────────────────────
    // PUT /participants/{id} is a FULL replace: it assigns every field from the DTO. Every screen that only owns part of a
    // participant therefore calls one of the endpoints below, which write that part and nothing else, so no screen can wipe
    // what it does not show (code review round 2, section A). Full PUT stays for API clients; no screen calls it.

    /// <summary>
    /// Saves, or completes, an intake the Intake wizard is RESUMING. The body is the wizard's own payload (the same shape POST
    /// takes), but only the intake scope is ever read from it (<see cref="ParticipantIntakeSnapshotService.IntakeScopeFieldNames"/>,
    /// the list the immutable intake evidence is built from): gender, middle name, diagnoses, allergies, key identifiers and
    /// every other profile-owned field are left exactly as they are, and it never reads or changes whether the participant is a
    /// draft or active. Contacts and risk entries in the payload are CREATED (the ones already recorded are skipped, so a
    /// retry never duplicates them); existing ones are managed by their own endpoints. Everything is validated before anything
    /// is written, so a rejection changes nothing. Idempotent on <c>completionRequestId</c>: a retried completion finds its
    /// evidence and adds nothing (a new key is a deliberate new revision).
    /// </summary>
    [HttpPut("{id:guid}/intake")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> SaveIntake(Guid id, [FromBody] CreateParticipantDto dto, CancellationToken ct)
    {
        // Only the validators for fields in the intake scope: a stale or foreign value in a field this endpoint ignores must not
        // reject the save.
        var scopeError = ParticipantPatchApplier.ValidateNames(dto)
            ?? ParticipantPatchApplier.ValidateFundingSource(dto)
            ?? ParticipantPatchApplier.ValidateLivingArrangement(dto)
            ?? ParticipantPatchApplier.ValidateAddressPostcode(dto)
            ?? ParticipantPatchApplier.ValidatePhone(dto)
            ?? ParticipantPatchApplier.ValidateEmail(dto);
        if (scopeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(scopeError));

        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // ── Validate what will be created, before touching the participant ──
        var providerToday = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var existingRoles = await _db.ParticipantContactRoles.Include(r => r.Person).Where(r => r.ParticipantId == p.Id).ToListAsync(ct);
        var newRoles = new List<CreateParticipantContactRoleDto>();
        var rolesSoFar = existingRoles.Select(r => (r.RoleType, r.IsPrimary, r.Status)).ToList();
        foreach (var roleDto in dto.ContactRoles)
        {
            if (!ParticipantCreateService.ContactRoleHasPerson(roleDto))
            {
                // An abandoned, half-filled row: dropped from a draft save exactly as Create drops it.
                if (dto.IsDraft) continue;
                return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Each contact needs either an existing person or a new person's name."));
            }
            if (existingRoles.Any(r => IsSameContact(r, roleDto)) || newRoles.Any(r => IsSameContact(r, roleDto))) continue;

            var gateError = ContactRoleRules.Validate(roleDto.RoleType, dto.PlanType, dto.DateOfBirth, roleDto.RegisteredProviderFlag, providerToday);
            if (gateError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(gateError));
            var uniquenessError = ContactRoleRules.ValidateUniqueness(roleDto.RoleType, roleDto.IsPrimary, roleDto.Status, rolesSoFar);
            if (uniquenessError != null) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(uniquenessError));
            if (roleDto.PersonId.HasValue && !await _db.People.AnyAsync(x => x.Id == roleDto.PersonId.Value, ct))
                return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Selected person not found"));

            rolesSoFar.Add((roleDto.RoleType, roleDto.IsPrimary, roleDto.Status));
            newRoles.Add(roleDto);
        }

        // A risk is "already recorded" only by a match in the same state (active or inactive): an inactive entry says nothing about a
        // current one (review F-2).
        var existingRisks = await _db.ParticipantRiskEntries.Where(r => r.ParticipantId == p.Id).Select(r => new { r.AtRiskParty, r.Description, r.IsActive }).ToListAsync(ct);
        var riskKeys = existingRisks.Select(r => (r.AtRiskParty, r.Description.Trim().ToLowerInvariant(), r.IsActive)).ToHashSet();
        var newRisks = new List<CreateParticipantRiskEntryDto>();
        foreach (var entry in dto.RiskEntries)
        {
            var description = entry.Description?.Trim() ?? "";
            if (description.Length == 0) continue; // an abandoned row
            if (riskKeys.Add((entry.AtRiskParty, description.ToLowerInvariant(), entry.IsActive))) newRisks.Add(entry);
        }

        // ── Write ──
        var previousSupportRatio = p.SupportRatio;
        ApplyIntakeScope(p, dto);
        p.UpdatedAt = DateTime.UtcNow;

        foreach (var roleDto in newRoles)
            await _creator.AddContactRoleAsync(p.Id, p.TenantId, roleDto, ct);
        foreach (var entry in newRisks)
        {
            _db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
            {
                Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id, AtRiskParty = entry.AtRiskParty, Description = entry.Description.Trim(),
                MitigationNotes = string.IsNullOrWhiteSpace(entry.MitigationNotes) ? null : entry.MitigationNotes.Trim(),
                IsActive = entry.IsActive,
            });
        }

        // The enquiry this participant came from keeps its own copy of the name and contact details (the Enquiries tab reads it):
        // keep it in step. Where the enquiry came from (source, provenance) is its own record and is not touched.
        foreach (var inquiry in await _db.ParticipantInquiries.Where(i => i.ParticipantId == p.Id).ToListAsync(ct))
        {
            inquiry.FirstName = p.FirstName; inquiry.LastName = p.LastName; inquiry.Phone = p.Phone; inquiry.Email = p.Email;
            inquiry.UpdatedAt = p.UpdatedAt;
        }

        // PD-5: the safety-critical auto-notes read behavioursOfConcern, the risks summary and the risk entries, all in this scope.
        await _safetyNoteSync.SyncFromParticipantAsync(p, ct);
        if (p.SupportRatio != previousSupportRatio) await TripStaffing.RecalculateForParticipantAsync(_db, p.Id, ct);

        if (dto.CompleteIntake)
        {
            var snapshot = await _intakeSnapshots.PrepareCaptureAsync(p, CompletionActor(), dto.CompletionRequestId, ct);
            // Set once, never moved: a later deliberate completion is a new revision with the first completion's time kept.
            p.IntakeCompletedAt ??= snapshot.CompletedAtUtc;
            await EnsureOnboardingAsync(p, ct);
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException ex) when (ex.Entries.All(e => e.Entity is ParticipantInquiry))
        {
            // A booking wrote the linked enquiry meanwhile (its IntakeIcsSequence/IntakeUid are concurrency tokens). This save only copies the
            // name and contact onto it, never the booking, so take the enquiry's current tokens and save once more rather than lose the intake.
            foreach (var entry in ex.Entries)
            {
                var stored = await entry.GetDatabaseValuesAsync(ct);
                if (stored is null) { entry.State = EntityState.Detached; continue; } // the enquiry is gone: nothing of it to keep in step
                foreach (var property in entry.Properties)
                {
                    var mine = property.IsModified;
                    property.OriginalValue = stored[property.Metadata];
                    if (!mine) property.CurrentValue = stored[property.Metadata]; // keep what the booking wrote
                    property.IsModified = mine;
                }
            }
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException again) when (again.Entries.All(e => e.Entity is ParticipantInquiry))
            {
                // One retry only: a booking that wins twice in a row is the house conflict. Nothing was saved, and the wizard keeps what was typed, so saving again is the way on.
                return Conflict(ApiResponse<ParticipantDetailDto>.Fail("Someone else just changed this participant's enquiry. Save again."));
            }
        }
        var warning = await ComputePlanTypeComplianceWarningAsync(p.Id, p.PlanType, ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto
        {
            Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName,
            IsActive = p.IsActive, IsDraft = p.IsDraft, IntakeCompletedAt = p.IntakeCompletedAt,
            UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = warning,
        }));
    }

    /// <summary>
    /// Writes the intake scope, and only the intake scope, from a wizard payload. Keep in step with
    /// <see cref="ParticipantIntakeSnapshotService.IntakeScopeFieldNames"/> (a test holds the two together).
    /// </summary>
    private static void ApplyIntakeScope(Participant p, CreateParticipantDto dto)
    {
        p.FirstName = dto.FirstName.Trim(); p.LastName = dto.LastName.Trim(); p.PreferredName = dto.PreferredName;
        p.DateOfBirth = dto.DateOfBirth; p.Phone = dto.Phone; p.Email = dto.Email;
        p.AddressStreet = dto.AddressStreet; p.AddressSuburb = dto.AddressSuburb;
        p.AddressState = dto.AddressState; p.AddressPostcode = dto.AddressPostcode;
        ParticipantPatchApplier.ApplyLivingArrangementFields(p, dto);
        p.NdisNumber = dto.NdisNumber?.Trim(); p.PlanStartDate = dto.PlanStartDate; p.PlanEndDate = dto.PlanEndDate;
        p.PlanType = dto.PlanType; p.FundingSource = dto.FundingSource;
        p.FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null;
        p.Region = dto.Region; p.IsRepeatClient = dto.IsRepeatClient; p.ServiceStreams = dto.ServiceStreams;
        p.MobilityAidWheelchair = dto.MobilityAidWheelchair; p.MobilityAidWalker = dto.MobilityAidWalker;
        p.IsHighSupport = dto.IsHighSupport; p.IsIntensiveSupport = dto.IsIntensiveSupport;
        p.OvernightSupport = dto.OvernightSupport; p.OvernightRatio = dto.OvernightRatio;
        p.RequiresHiLoBed = dto.RequiresHiLoBed; p.RequiresHoist = dto.RequiresHoist; p.RequiresShowerChair = dto.RequiresShowerChair;
        p.RequiresCommode = dto.RequiresCommode; p.RequiresStandingMachine = dto.RequiresStandingMachine; p.SupportRatio = dto.SupportRatio;
        p.MedicalSummary = dto.MedicalSummary;
        p.IsCald = dto.IsCald; p.IsLgbtqi = dto.IsLgbtqi; p.IsFamilyCommunity = dto.IsFamilyCommunity;
        p.IsAboriginalOrTorresStraitIslander = dto.IsAboriginalOrTorresStraitIslander;
        p.ReceivedRightsAndResponsibilitiesInfo = dto.ReceivedRightsAndResponsibilitiesInfo;
        p.ReceivedPrivacyAndConfidentialityInfo = dto.ReceivedPrivacyAndConfidentialityInfo;
        p.ReceivedFeedbackInfo = dto.ReceivedFeedbackInfo; p.ReceivedBeingSafeInfo = dto.ReceivedBeingSafeInfo;
        p.ReceivedAdvocacyInfo = dto.ReceivedAdvocacyInfo;
        p.BehavioursOfConcernCurrent = dto.BehavioursOfConcernCurrent; p.BehavioursOfConcernFiveYearHistory = dto.BehavioursOfConcernFiveYearHistory;
        p.ExpressiveSkills = dto.ExpressiveSkills; p.HidpaNotes = dto.HidpaNotes;
        p.BehaviourRiskSummary = dto.BehaviourRiskSummary; p.Notes = dto.Notes;
    }

    /// <summary>
    /// True when <paramref name="existing"/> already records this contact: the same role, in the same status, for the same person
    /// (by id, or by name for a person typed in). A resumed save that repeats a contact the participant already has creates nothing.
    /// The status matters: an Expired or Superseded row says nothing about a CURRENT contact, so adding Pat Parent as a current next of
    /// kin beside an expired Pat Parent must create the new row, not be answered 200 and silently dropped (review F-2).
    /// </summary>
    private static bool IsSameContact(ParticipantContactRole existing, CreateParticipantContactRoleDto incoming)
    {
        if (existing.RoleType != incoming.RoleType || existing.Status != incoming.Status) return false;
        if (incoming.PersonId.HasValue) return existing.PersonId == incoming.PersonId.Value;
        return existing.Person != null && SameName(existing.Person.FirstName, incoming.NewPersonFirstName) && SameName(existing.Person.LastName, incoming.NewPersonLastName);
    }

    private static bool IsSameContact(CreateParticipantContactRoleDto first, CreateParticipantContactRoleDto second)
    {
        if (first.RoleType != second.RoleType || first.Status != second.Status) return false;
        if (first.PersonId.HasValue || second.PersonId.HasValue) return first.PersonId == second.PersonId;
        return SameName(first.NewPersonFirstName, second.NewPersonFirstName) && SameName(first.NewPersonLastName, second.NewPersonLastName);
    }

    private static bool SameName(string? a, string? b) => string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>The body POST /participants answers with (and a replayed completion answers with again).</summary>
    private static ParticipantDetailDto CreatedBody(Participant p, string? planTypeComplianceWarning) => new()
    {
        Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, IsDraft = p.IsDraft,
        IntakeCompletedAt = p.IntakeCompletedAt, CreatedAt = p.CreatedAt, UpdatedAt = p.UpdatedAt, PlanTypeComplianceWarning = planTypeComplianceWarning,
    };

    private const string DraftCannotBeActivated = "A draft participant cannot be activated. Complete their intake and profile first.";
    private const string ActivationEvidenceRequired = "This participant cannot be activated until their signed service agreement evidence is recorded.";
    private const string ActivationFundingRequired = "This participant cannot be activated until their plan budget is recorded on the Funding tab.";
    private const string FromUndoneImport = "This person came from an import that was undone. Import them again.";
    private const string BeginServicesEnforced = "Your organisation enforces readiness, so services begin when the participant is made active.";

    /// <summary>The 400 message for an activation the organisation's readiness rule refuses.</summary>
    private static string ActivationRefusal(ActivationBlock block) =>
        block == ActivationBlock.FundingNotRecorded ? ActivationFundingRequired : ActivationEvidenceRequired;

    /// <summary>
    /// The one way a screen changes whether a participant is active: the flag and an optional reason, nothing else (a partial
    /// participant sent to the full-record PUT was answered 400 "First name is required." and the screen swallowed it). Role-checked
    /// like every lifecycle write, audited as ONE row (the reason rides on it), and activation goes through the same readiness
    /// rule as everywhere else: a draft cannot be activated, and an organisation that enforces readiness needs the evidence. An
    /// archived participant's upcoming shifts, patterns and bookings are not cancelled, and the response names them.
    /// </summary>
    [HttpPost("{id:guid}/status")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public Task<ActionResult<ApiResponse<ParticipantStatusResultDto>>> ChangeStatus(Guid id, [FromBody] ChangeParticipantStatusDto dto, CancellationToken ct)
    {
        if (dto.IsActive is null)
            return Task.FromResult<ActionResult<ApiResponse<ParticipantStatusResultDto>>>(
                BadRequest(ApiResponse<ParticipantStatusResultDto>.Fail("isActive is required.")));
        return ApplyStatusAsync(id, dto.IsActive.Value, dto.Reason, ct);
    }

    /// <summary>Brings an archived participant back: reactivates them (subject to the readiness rule) and touches no other field.</summary>
    [HttpPost("{id:guid}/restore")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public Task<ActionResult<ApiResponse<ParticipantStatusResultDto>>> Restore(Guid id, CancellationToken ct) =>
        ApplyStatusAsync(id, activate: true, reason: null, ct);

    private async Task<ActionResult<ApiResponse<ParticipantStatusResultDto>>> ApplyStatusAsync(Guid id, bool activate, string? reason, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantStatusResultDto>.Fail("Participant not found"));

        // Already there: nothing is written and no audit row is made.
        if (p.IsActive == activate)
            return Ok(ApiResponse<ParticipantStatusResultDto>.Ok(StatusResult(p, changed: false, [])));

        var warnings = new List<string>();
        if (activate)
        {
            if (p.IsDraft) return BadRequest(ApiResponse<ParticipantStatusResultDto>.Fail(DraftCannotBeActivated));
            // Undo archives an onboarding import's drafts as finalised, so restoring one would make them Active without onboarding.
            if (await _db.ImportBatchItems.AnyAsync(i => i.EntityId == p.Id && i.Batch!.UndoneAt != null, ct))
                return BadRequest(ApiResponse<ParticipantStatusResultDto>.Fail(FromUndoneImport));
            var block = await ParticipantReadiness.ActivationBlockAsync(_db, p, _clock, ct);
            if (block != ActivationBlock.None)
                return BadRequest(ApiResponse<ParticipantStatusResultDto>.Fail(ActivationRefusal(block)));
            // Warn mode activates, and what is still missing comes back as notes for the screen: never blocking. This is the ACTIVATION checklist, so it also lists
            // that the plan budget is not recorded (an NDIS-funded participant with no current plan); the roster and the pickers never list that.
            var issues = await ParticipantReadiness.ActivationIssuesAsync(_db, new[] { p.Id }, _clock, ct);
            if (issues.TryGetValue(p.Id, out var missing))
                warnings.AddRange(missing.Select(issue => $"Not yet fully ready: {issue}."));
        }
        else
        {
            warnings.AddRange(await DeactivationWarningsAsync(p.Id, ct));
        }

        p.IsActive = activate;
        p.UpdatedAt = DateTime.UtcNow;
        // The audit interceptor writes the one row for this change; the reason rides on it instead of making a second one.
        if (!string.IsNullOrWhiteSpace(reason) && HttpContext != null)
            HttpContext.Items[AuditInterceptor.ReasonItemKey(p.Id)] = reason.Trim();
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantStatusResultDto>.Ok(StatusResult(p, changed: true, warnings)));
    }

    private static ParticipantStatusResultDto StatusResult(Participant p, bool changed, List<string> warnings) =>
        new() { Id = p.Id, IsActive = p.IsActive, IsDraft = p.IsDraft, Changed = changed, Warnings = warnings };

    /// <summary>
    /// What still refers to a participant being archived. Nothing is cancelled (there is no domain rule that says it should be, and
    /// a coordinator may be archiving a record they will restore), so the response says what was left in place.
    /// </summary>
    private async Task<List<string>> DeactivationWarningsAsync(Guid participantId, CancellationToken ct)
    {
        // A date, not a moment: shifts are rostered by calendar day, and "today" is the PROVIDER's date (DESIGN.md "Time on the wire"),
        // never the UTC date, which is still yesterday until 10:00 or 11:00 in Sydney.
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var shifts = await ParticipantQueries.UpcomingShifts(_db, participantId, today).CountAsync(ct);
        var patterns = await ParticipantQueries.LivePatterns(_db, participantId, today).CountAsync(ct);
        var bookings = await ParticipantQueries.UpcomingBookings(_db, participantId, today).CountAsync(ct);

        var warnings = new List<string>();
        if (shifts > 0)
            warnings.Add(shifts == 1
                ? "1 upcoming shift still references this participant. It was not cancelled."
                : $"{shifts} upcoming shifts still reference this participant. They were not cancelled.");
        if (patterns > 0)
            warnings.Add(patterns == 1
                ? "1 recurring shift pattern still references this participant. It was not changed."
                : $"{patterns} recurring shift patterns still reference this participant. They were not changed.");
        if (bookings > 0)
            warnings.Add(bookings == 1
                ? "1 upcoming trip booking still references this participant. It was not cancelled."
                : $"{bookings} upcoming trip bookings still reference this participant. They were not cancelled.");
        return warnings;
    }

    /// <summary>
    /// "Make active" on the onboarding checklist: finalises a participant whose intake is complete and moves them to the Active tab. It carries no
    /// profile field, so it cannot wipe one. Open checklist items do not stop it (the screen lists them in its confirm step; owner decision 2026-10-13).
    /// Idempotent; it only ever finalises a DRAFT, so an archived participant is not brought back (the status endpoint restores them).
    /// The organisation's readiness rule applies (the status endpoint refuses a draft). Where it does not let them be activated (Enforce, no verified
    /// signed-agreement evidence) the step is refused with the same message the status endpoint gives and they stay a draft on the Onboarding tab:
    /// finalised but not activated would leave them in no stage. A legacy draft already marked active has nothing to activate and is finalised as before.
    /// </summary>
    [HttpPost("{id:guid}/make-active")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> MakeActive(Guid id, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        if (p.IsDraft)
        {
            if (!p.IntakeCompletedAt.HasValue)
                return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Complete the participant's intake before making them active."));
            // Warn (the default) activates, Enforce needs evidence. A draft whose services started is active already but has never been
            // through this rule, so it is asked too.
            if ((!p.IsActive || p.ServicesStartedAt != null) && await ParticipantReadiness.ActivationBlockAsync(_db, p, _clock, ct) is var block && block != ActivationBlock.None)
                return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(ActivationRefusal(block)));
            p.IsDraft = false;
            p.UpdatedAt = DateTime.UtcNow;
            p.IsActive = true;
            await _db.SaveChangesAsync(ct);
        }

        return Ok(ApiResponse<ParticipantDetailDto>.Ok(LifecycleBody(p)));
    }

    /// <summary>
    /// "Begin services" on the onboarding checklist (owner decision 2026-10-13): a participant in onboarding (a draft, intake complete) can receive
    /// services (the roster board, shifts and patterns, the support-worker portal, medications, budgets and alerts: see
    /// <see cref="Participant.CanReceiveServicesRule"/>) while staying on the Onboarding tab until "Make active". Sets <see cref="Participant.ServicesStartedAt"/>
    /// and <see cref="Participant.IsActive"/> and keeps the draft. Idempotent: a second call changes nothing, except that a services-started draft which was
    /// archived is switched back on (the first date kept). An organisation that enforces readiness keeps its placement rule
    /// (<see cref="ParticipantReadiness.CheckAsync"/>, which <c>MayPlaceAsync</c> uses), which refuses a draft: there, services begin when the participant is made active.
    /// </summary>
    [HttpPost("{id:guid}/begin-services")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> BeginServices(Guid id, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        // Nothing to do once services run (or the participant was made active). A services-started draft that was archived is switched back on,
        // keeping the first date.
        if (p.ServicesStartedAt == null || (p.IsDraft && !p.IsActive))
        {
            if (!p.IsDraft) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Services can only begin for a participant in onboarding."));
            if (!p.IntakeCompletedAt.HasValue) return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Complete the participant's intake before services begin."));
            // Enforce keeps its strict placement rule (owner decision): it refuses until verified signed-agreement evidence exists.
            if (await ParticipantReadiness.IsEnforcedAsync(_db, p.TenantId, ct) && !(await ParticipantReadiness.CheckAsync(_db, p.Id, ct)).Allowed)
                return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(BeginServicesEnforced));
            p.ServicesStartedAt ??= DateTime.UtcNow;
            p.IsActive = true;
            p.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        return Ok(ApiResponse<ParticipantDetailDto>.Ok(LifecycleBody(p)));
    }

    /// <summary>What make-active and begin-services answer: the participant's lifecycle state.</summary>
    private static ParticipantDetailDto LifecycleBody(Participant p) => new()
    {
        Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName,
        IsActive = p.IsActive, IsDraft = p.IsDraft, IntakeCompletedAt = p.IntakeCompletedAt, ServicesStartedAt = p.ServicesStartedAt, UpdatedAt = p.UpdatedAt,
    };

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
        if (!await _db.Participants.AnyAsync(p => p.Id == id, ct)) return NotFound(ApiResponse<List<BookingListDto>>.Fail("Participant not found"));

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
        // SupportProfile has no organisation column or query filter: it is the caller's only if its participant is.
        if (!await _db.Participants.AnyAsync(p => p.Id == id, ct)) return NotFound(ApiResponse<SupportProfileDto>.Fail("Participant not found"));

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
        if (!await _db.Participants.AnyAsync(p => p.Id == id, ct)) return NotFound(ApiResponse<SupportProfileDto>.Fail("Participant not found"));

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

    /// <summary>Lists immutable intake-completion revisions for the authenticated participant tenant.</summary>
    [HttpGet("{id:guid}/intake-snapshots")]
    public async Task<ActionResult<ApiResponse<List<ParticipantIntakeSnapshotDto>>>> ListIntakeSnapshots(Guid id, CancellationToken ct)
    {
        if (!await _db.Participants.AnyAsync(p => p.Id == id, ct)) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        var snapshots = await _db.ParticipantIntakeSnapshots
            .Where(x => x.ParticipantId == id)
            .OrderByDescending(x => x.Revision)
            .Select(x => new ParticipantIntakeSnapshotDto { Revision = x.Revision, CompletedAtUtc = x.CompletedAtUtc })
            .ToListAsync(ct);
        return Ok(ApiResponse<List<ParticipantIntakeSnapshotDto>>.Ok(snapshots));
    }

    /// <summary>Downloads the immutable dated PDF produced by an explicit intake completion.</summary>
    [HttpGet("{id:guid}/intake-snapshots/{revision:int}/download")]
    public async Task<IActionResult> DownloadIntakeSnapshotPdf(Guid id, int revision, CancellationToken ct)
    {
        if (!await _db.Participants.AnyAsync(p => p.Id == id, ct)) return NotFound(ApiResponse<bool>.Fail("Participant not found"));
        var snapshot = await _intakeSnapshots.FindAsync(id, revision, ct);
        if (snapshot == null) return NotFound(ApiResponse<bool>.Fail("Intake snapshot not found"));
        return File(snapshot.PdfContent, "application/pdf", $"Intake-Completion-r{snapshot.Revision}-{snapshot.CompletedAtUtc:yyyyMMdd}.pdf");
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
