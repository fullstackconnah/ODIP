using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
    public ParticipantsController(OdipDbContext db, StaffCompatibilityLinkService compatLink)
    {
        _db = db;
        _compatLink = compatLink;
    }

    /// <summary>
    /// §4.4 same-tenant validation for the preferred-staff (now preferred-user) picker: null is
    /// always fine, otherwise the id must resolve to an active User — same-tenant scoping comes
    /// for free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidPreferredUserRefAsync(Guid? userId, CancellationToken ct) =>
        userId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == userId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    /// <summary>INTAKE-05: Gender "Other" requires the self-description free-text field, both ends.</summary>
    private static string? ValidateGender(CreateParticipantDto dto) =>
        dto.Gender == Gender.Other && string.IsNullOrWhiteSpace(dto.GenderSelfDescription)
            ? "Please provide a gender self-description."
            : null;

    /// <summary>
    /// FUND-02: FundingSource "Other" requires the (reused) FundingOrganisation free-text field,
    /// both ends — mirrors ValidateGender's shape exactly. Ndis ignores whatever
    /// FundingOrganisation carries (the frontend's INTAKE-07 engine excludes it from the payload
    /// entirely in that case; this validator does not error on a stray/legacy value either way).
    /// </summary>
    private static string? ValidateFundingSource(CreateParticipantDto dto) =>
        dto.FundingSource == ParticipantFundingSource.Other && string.IsNullOrWhiteSpace(dto.FundingOrganisation)
            ? "Please specify the funding organisation."
            : null;

    /// <summary>
    /// LIVING-01/02/03/04: each arrangement type requires its one key identifying field, both
    /// ends — same shape as ValidateGender/ValidateFundingSource. Independent's WhoLivesWith is
    /// only required when LivesWithOthers is true (a second level of conditionality nested inside
    /// the arrangement-type gate).
    /// </summary>
    private static string? ValidateLivingArrangement(CreateParticipantDto dto)
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
    private static string? ValidateAddressPostcode(CreateParticipantDto dto) =>
        !string.IsNullOrWhiteSpace(dto.AddressPostcode) && !System.Text.RegularExpressions.Regex.IsMatch(dto.AddressPostcode, @"^\d{4}$")
            ? "Postcode must be exactly 4 digits."
            : null;

    /// <summary>
    /// DIAG-01: unlike ValidateGender/ValidateFundingSource/ValidateLivingArrangement (which
    /// enforce a required companion field), diagnoses are open text with a curated picklist as UI
    /// guidance only (see Diagnoses.cs's type doc) — so the only server-side rule is "not blank,
    /// not absurdly long" per entry, applied to both PrimaryDiagnosis and every OtherDiagnoses row.
    /// </summary>
    private static string? ValidateDiagnoses(CreateParticipantDto dto)
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
    /// LIVING-02/03/04 server-side clearing: defence in depth, mirroring FundingOrganisation's
    /// pattern in Create/Update above — a field belonging to a non-selected arrangement type (or,
    /// for WhoLivesWith, belonging to a LivesWithOthers=false Independent participant) is stored
    /// as null regardless of what a stale client payload sent, rather than trusting the
    /// frontend's INTAKE-07 payload exclusion alone.
    /// </summary>
    private static void ApplyLivingArrangementFields(Participant p, CreateParticipantDto dto)
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

    /// <summary>List participants with optional filters.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ParticipantListDto>>>> GetAll(
        [FromQuery] string? search, [FromQuery] string? region, [FromQuery] bool? isActive,
        [FromQuery] bool? wheelchairRequired, [FromQuery] bool? isHighSupport,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.Participants.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(p => (p.FirstName + " " + p.LastName).Contains(search) || (p.PreferredName != null && p.PreferredName.Contains(search)));
        if (!string.IsNullOrWhiteSpace(region)) query = query.Where(p => p.Region == region);
        if (isActive.HasValue) query = query.Where(p => p.IsActive == isActive.Value);
        if (wheelchairRequired.HasValue) query = query.Where(p => p.MobilityAidWheelchair == wheelchairRequired.Value);
        if (isHighSupport.HasValue) query = query.Where(p => p.IsHighSupport == isHighSupport.Value);

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
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        var hasActiveMedications = await _db.ParticipantMedications
            .AnyAsync(m => m.ParticipantId == id && m.Status != MedicationStatus.Ceased, ct);

        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto
        {
            Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName,
            FullName = string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName,
            MaskedNdisNumber = p.NdisNumber != null ? p.NdisNumber.Length > 0 ? "••••••••" + p.NdisNumber[^1] : "•••" : null,
            NdisNumber = p.NdisNumber, DateOfBirth = p.DateOfBirth, Gender = p.Gender, GenderSelfDescription = p.GenderSelfDescription,
            PlanStartDate = p.PlanStartDate, PlanEndDate = p.PlanEndDate, PlanType = p.PlanType, Region = p.Region,
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
        }));
    }

    /// <summary>Create a new participant.</summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Create([FromBody] CreateParticipantDto dto, CancellationToken ct)
    {
        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        if (invalidOptions.Count > 0)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));

        var genderError = ValidateGender(dto);
        if (genderError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));

        var fundingError = ValidateFundingSource(dto);
        if (fundingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));

        var livingError = ValidateLivingArrangement(dto);
        if (livingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));

        var postcodeError = ValidateAddressPostcode(dto);
        if (postcodeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));

        var diagnosesError = ValidateDiagnoses(dto);
        if (diagnosesError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(diagnosesError));

        if (!await IsValidPreferredUserRefAsync(dto.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName, PreferredName = dto.PreferredName,
            DateOfBirth = dto.DateOfBirth, Gender = dto.Gender, GenderSelfDescription = dto.GenderSelfDescription,
            NdisNumber = dto.NdisNumber, PlanStartDate = dto.PlanStartDate, PlanEndDate = dto.PlanEndDate,
            PlanType = dto.PlanType, Region = dto.Region,
            FundingSource = dto.FundingSource,
            // Ndis ignores whatever the client sent for the reused "Other — specify" field —
            // stored as null rather than trusting the client's INTAKE-07 payload exclusion alone.
            FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null,
            IsRepeatClient = dto.IsRepeatClient,
            MobilityAidWheelchair = dto.MobilityAidWheelchair, MobilityAidWalker = dto.MobilityAidWalker,
            MobilitySupportOptions = dto.MobilitySupportOptions,
            PrimaryDiagnosis = dto.PrimaryDiagnosis, OtherDiagnoses = dto.OtherDiagnoses, HidpaSupportCategories = dto.HidpaSupportCategories,
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
        };
        ApplyLivingArrangementFields(participant, dto);
        _db.Participants.Add(participant);
        // Task 6d: a preferred-staff selection on create also upserts a Preferred row in the
        // rostering compatibility matrix, in the same transaction as the participant insert.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(participant.Id, null, dto.PreferredStaffId, ct);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = participant.Id },
            ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = participant.Id, FirstName = participant.FirstName, LastName = participant.LastName, FullName = participant.FullName, IsActive = true, CreatedAt = participant.CreatedAt, UpdatedAt = participant.UpdatedAt }));
    }

    /// <summary>Update an existing participant.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantDetailDto>>> Update(Guid id, [FromBody] UpdateParticipantDto dto, CancellationToken ct)
    {
        var invalidOptions = dto.MobilitySupportOptions.Where(o => !MobilitySupportOptions.IsValid(o)).ToList();
        if (invalidOptions.Count > 0)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(
                $"Invalid mobility support option(s): {string.Join(", ", invalidOptions)}"));

        var genderError = ValidateGender(dto);
        if (genderError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(genderError));

        var fundingError = ValidateFundingSource(dto);
        if (fundingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(fundingError));

        var livingError = ValidateLivingArrangement(dto);
        if (livingError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(livingError));

        var postcodeError = ValidateAddressPostcode(dto);
        if (postcodeError != null)
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail(postcodeError));

        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        if (!await IsValidPreferredUserRefAsync(dto.PreferredStaffId, ct))
            return BadRequest(ApiResponse<ParticipantDetailDto>.Fail("Preferred staff member not found."));

        var previousPreferredStaffId = p.PreferredUserId;

        p.FirstName = dto.FirstName; p.LastName = dto.LastName; p.PreferredName = dto.PreferredName;
        p.DateOfBirth = dto.DateOfBirth; p.Gender = dto.Gender; p.GenderSelfDescription = dto.GenderSelfDescription;
        p.NdisNumber = dto.NdisNumber; p.PlanStartDate = dto.PlanStartDate; p.PlanEndDate = dto.PlanEndDate;
        p.PlanType = dto.PlanType;
        p.Region = dto.Region;
        p.FundingSource = dto.FundingSource;
        // Ndis ignores whatever the client sent for the reused "Other — specify" field — same
        // server-side clearing as Create, so flipping Other -> Ndis actually clears stale text
        // rather than leaving it dormant on the row.
        p.FundingOrganisation = dto.FundingSource == ParticipantFundingSource.Other ? dto.FundingOrganisation : null;
        ApplyLivingArrangementFields(p, dto);
        p.AddressStreet = dto.AddressStreet; p.AddressSuburb = dto.AddressSuburb;
        p.AddressState = dto.AddressState; p.AddressPostcode = dto.AddressPostcode;
        p.IsRepeatClient = dto.IsRepeatClient;
        p.IsActive = dto.IsActive; p.MobilityAidWheelchair = dto.MobilityAidWheelchair; p.MobilityAidWalker = dto.MobilityAidWalker;
        p.MobilitySupportOptions = dto.MobilitySupportOptions;
        p.PrimaryDiagnosis = dto.PrimaryDiagnosis; p.OtherDiagnoses = dto.OtherDiagnoses; p.HidpaSupportCategories = dto.HidpaSupportCategories;
        p.IsHighSupport = dto.IsHighSupport; p.IsIntensiveSupport = dto.IsIntensiveSupport;
        p.OvernightSupport = dto.OvernightSupport; p.OvernightRatio = dto.OvernightRatio;
        p.RequiresHiLoBed = dto.RequiresHiLoBed; p.RequiresHoist = dto.RequiresHoist; p.RequiresShowerChair = dto.RequiresShowerChair;
        p.RequiresCommode = dto.RequiresCommode; p.RequiresStandingMachine = dto.RequiresStandingMachine;
        // p.HasRestrictivePracticeFlag is intentionally left untouched — derived on read only.
        p.SupportRatio = dto.SupportRatio; p.MobilityNotes = dto.MobilityNotes;
        p.EquipmentRequirements = dto.EquipmentRequirements; p.TransportRequirements = dto.TransportRequirements;
        p.MedicalSummary = dto.MedicalSummary; p.BehaviourRiskSummary = dto.BehaviourRiskSummary;
        p.Notes = dto.Notes; p.PreferredUserId = dto.PreferredStaffId; p.ServiceStreams = dto.ServiceStreams;
        p.UpdatedAt = DateTime.UtcNow;

        // Task 6d: a changed/cleared preferred-staff selection upserts/downgrades the matching
        // compatibility row, in the same transaction as the participant update.
        await _compatLink.SyncFromParticipantPreferredStaffAsync(p.Id, previousPreferredStaffId, dto.PreferredStaffId, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantDetailDto>.Ok(new ParticipantDetailDto { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, FullName = p.FullName, IsActive = p.IsActive, UpdatedAt = p.UpdatedAt }));
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
