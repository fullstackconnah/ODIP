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
            NdisNumber = p.NdisNumber, DateOfBirth = p.DateOfBirth, PlanType = p.PlanType, Region = p.Region,
            FundingOrganisation = p.FundingOrganisation, IsRepeatClient = p.IsRepeatClient, IsActive = p.IsActive,
            MobilityAidWheelchair = p.MobilityAidWheelchair, MobilityAidWalker = p.MobilityAidWalker,
            IsHighSupport = p.IsHighSupport, IsIntensiveSupport = p.IsIntensiveSupport, SupportRatio = p.SupportRatio,
            MobilitySupportOptions = p.MobilitySupportOptions,
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

        var participant = new Participant
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName, PreferredName = dto.PreferredName,
            DateOfBirth = dto.DateOfBirth, NdisNumber = dto.NdisNumber, PlanType = dto.PlanType, Region = dto.Region,
            FundingOrganisation = dto.FundingOrganisation, IsRepeatClient = dto.IsRepeatClient,
            MobilityAidWheelchair = dto.MobilityAidWheelchair, MobilityAidWalker = dto.MobilityAidWalker,
            MobilitySupportOptions = dto.MobilitySupportOptions,
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
        };
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

        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p == null) return NotFound(ApiResponse<ParticipantDetailDto>.Fail("Participant not found"));

        var previousPreferredStaffId = p.PreferredUserId;

        p.FirstName = dto.FirstName; p.LastName = dto.LastName; p.PreferredName = dto.PreferredName;
        p.DateOfBirth = dto.DateOfBirth; p.NdisNumber = dto.NdisNumber; p.PlanType = dto.PlanType;
        p.Region = dto.Region; p.FundingOrganisation = dto.FundingOrganisation; p.IsRepeatClient = dto.IsRepeatClient;
        p.IsActive = dto.IsActive; p.MobilityAidWheelchair = dto.MobilityAidWheelchair; p.MobilityAidWalker = dto.MobilityAidWalker;
        p.MobilitySupportOptions = dto.MobilitySupportOptions;
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
