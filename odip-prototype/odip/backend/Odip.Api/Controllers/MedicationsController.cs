using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Medication management: participant medication charts, PRN dosing rules, chemical-restraint
/// tracking, and the Medication Administration Record (MAR). No DELETE endpoint anywhere here —
/// NDIS record retention is ~7 years, so a medication is retired via <see cref="MedicationStatus.Ceased"/>
/// rather than removed.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class MedicationsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _currentTenant;
    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;
    private readonly Odip.Application.Interfaces.IObligationTaskService _obligationTasks;

    private readonly MedicationSlotService _slots;
    private readonly MedicationAdministrationRecorder _recorder;

    public MedicationsController(
        OdipDbContext db, ICurrentTenant currentTenant,
        Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null,
        Odip.Application.Interfaces.IObligationTaskService? obligationTasks = null,
        MedicationSlotService? slots = null,
        MedicationAdministrationRecorder? recorder = null)
    {
        _db = db;
        _currentTenant = currentTenant;
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
        _obligationTasks = obligationTasks ?? new Odip.Infrastructure.Tasks.ObligationTaskService(db);
        _slots = slots ?? new MedicationSlotService(db);
        _recorder = recorder ?? new MedicationAdministrationRecorder(db, _notificationRaiser, _obligationTasks);
    }

    // ── Participant medication list / create ─────────────────────────

    [HttpGet("participants/{participantId:guid}/medications")]
    public async Task<ActionResult<ApiResponse<List<MedicationListDto>>>> GetForParticipant(
        Guid participantId, [FromQuery] bool includeInactive, CancellationToken ct)
    {
        var query = _db.ParticipantMedications
            .Include(m => m.Participant)
            .Where(m => m.ParticipantId == participantId);
        if (!includeInactive)
            query = query.Where(m => m.Status != MedicationStatus.Ceased);

        var items = await query.OrderBy(m => m.Name).ToListAsync(ct);
        var result = items.Select(m => ToListDto(m, FullName(m.Participant))).ToList();
        return Ok(ApiResponse<List<MedicationListDto>>.Ok(result));
    }

    [HttpPost("participants/{participantId:guid}/medications")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<MedicationDetailDto>>> Create(
        Guid participantId, [FromBody] CreateMedicationDto dto, CancellationToken ct)
    {
        // INTAKE-08: a draft participant can't have a medication record created against them —
        // reads the same as "not found" from the caller's side (mirrors the Rostering pattern).
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId && !p.IsDraft, ct);
        if (participant == null) return NotFound(ApiResponse<MedicationDetailDto>.Fail("Participant not found"));

        var validationError = ValidateMedicationDto(
            dto.Type, dto.TimesOfDay, dto.PrnIndication, dto.PrnMaxDosesPer24h, dto.IsChemicalRestraint, dto.Purpose,
            dto.Frequency, dto.DaysOfWeek, dto.IntervalDays, dto.AnchorDate);
        if (validationError != null) return BadRequest(ApiResponse<MedicationDetailDto>.Fail(validationError));

        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(),
            ParticipantId = participantId,
            Name = dto.Name,
            Strength = dto.Strength,
            Form = dto.Form,
            Route = dto.Route,
            DoseDescription = dto.DoseDescription,
            Directions = dto.Directions,
            Type = dto.Type,
            TimesOfDay = dto.TimesOfDay,
            Frequency = dto.Frequency,
            DaysOfWeek = ParseDaysOfWeek(dto.DaysOfWeek),
            IntervalDays = dto.IntervalDays,
            AnchorDate = dto.AnchorDate,
            PrnIndication = dto.PrnIndication,
            PrnMaxDosesPer24h = dto.PrnMaxDosesPer24h,
            PrnMinIntervalMinutes = dto.PrnMinIntervalMinutes,
            Purpose = dto.Purpose,
            IsPsychotropic = dto.IsPsychotropic,
            IsChemicalRestraint = dto.IsChemicalRestraint,
            BspInPlace = dto.BspInPlace,
            RestrictivePracticeAuthorisationRef = dto.RestrictivePracticeAuthorisationRef,
            IsHighRisk = dto.IsHighRisk,
            IsHighIntensitySupport = dto.IsHighIntensitySupport,
            DrugSchedule = dto.DrugSchedule,
            SupportLevel = dto.SupportLevel,
            PrescriberName = dto.PrescriberName,
            PharmacyName = dto.PharmacyName,
            PharmacyPhone = dto.PharmacyPhone,
            Packaging = dto.Packaging,
            StartDate = dto.StartDate,
            EndDate = dto.EndDate,
            NextReviewDue = dto.NextReviewDue,
            ConsentObtained = dto.ConsentObtained,
            ConsentGivenBy = dto.ConsentGivenBy,
            ConsentDate = dto.ConsentDate,
            StorageRequirements = dto.StorageRequirements,
            Status = MedicationStatus.Active,
            Notes = dto.Notes,
        };
        _db.ParticipantMedications.Add(med);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<MedicationDetailDto>.Ok(ToDetailDto(med, FullName(participant), 0)));
    }

    // ── Single medication ──────────────────────────────────────────

    [HttpGet("medications/{id:guid}")]
    public async Task<ActionResult<ApiResponse<MedicationDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var med = await _db.ParticipantMedications.Include(m => m.Participant).FirstOrDefaultAsync(m => m.Id == id, ct);
        if (med == null) return NotFound(ApiResponse<MedicationDetailDto>.Fail("Medication not found"));

        var prnCount = await GetPrnDosesInLast24hAsync(med.Id, ct);
        return Ok(ApiResponse<MedicationDetailDto>.Ok(ToDetailDto(med, FullName(med.Participant), prnCount)));
    }

    [HttpPut("medications/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<MedicationDetailDto>>> Update(Guid id, [FromBody] UpdateMedicationDto dto, CancellationToken ct)
    {
        var med = await _db.ParticipantMedications.Include(m => m.Participant).FirstOrDefaultAsync(m => m.Id == id, ct);
        if (med == null) return NotFound(ApiResponse<MedicationDetailDto>.Fail("Medication not found"));

        var validationError = ValidateMedicationDto(
            dto.Type, dto.TimesOfDay, dto.PrnIndication, dto.PrnMaxDosesPer24h, dto.IsChemicalRestraint, dto.Purpose,
            dto.Frequency, dto.DaysOfWeek, dto.IntervalDays, dto.AnchorDate);
        if (validationError != null) return BadRequest(ApiResponse<MedicationDetailDto>.Fail(validationError));

        med.Name = dto.Name;
        med.Strength = dto.Strength;
        med.Form = dto.Form;
        med.Route = dto.Route;
        med.DoseDescription = dto.DoseDescription;
        med.Directions = dto.Directions;
        med.Type = dto.Type;
        med.TimesOfDay = dto.TimesOfDay;
        med.Frequency = dto.Frequency;
        med.DaysOfWeek = ParseDaysOfWeek(dto.DaysOfWeek);
        med.IntervalDays = dto.IntervalDays;
        med.AnchorDate = dto.AnchorDate;
        med.PrnIndication = dto.PrnIndication;
        med.PrnMaxDosesPer24h = dto.PrnMaxDosesPer24h;
        med.PrnMinIntervalMinutes = dto.PrnMinIntervalMinutes;
        med.Purpose = dto.Purpose;
        med.IsPsychotropic = dto.IsPsychotropic;
        med.IsChemicalRestraint = dto.IsChemicalRestraint;
        med.BspInPlace = dto.BspInPlace;
        med.RestrictivePracticeAuthorisationRef = dto.RestrictivePracticeAuthorisationRef;
        med.IsHighRisk = dto.IsHighRisk;
        med.IsHighIntensitySupport = dto.IsHighIntensitySupport;
        med.DrugSchedule = dto.DrugSchedule;
        med.SupportLevel = dto.SupportLevel;
        med.PrescriberName = dto.PrescriberName;
        med.PharmacyName = dto.PharmacyName;
        med.PharmacyPhone = dto.PharmacyPhone;
        med.Packaging = dto.Packaging;
        med.StartDate = dto.StartDate;
        med.EndDate = dto.EndDate;
        med.NextReviewDue = dto.NextReviewDue;
        med.ConsentObtained = dto.ConsentObtained;
        med.ConsentGivenBy = dto.ConsentGivenBy;
        med.ConsentDate = dto.ConsentDate;
        med.StorageRequirements = dto.StorageRequirements;
        med.Status = dto.Status;
        med.Notes = dto.Notes;
        med.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        var prnCount = await GetPrnDosesInLast24hAsync(med.Id, ct);
        return Ok(ApiResponse<MedicationDetailDto>.Ok(ToDetailDto(med, FullName(med.Participant), prnCount)));
    }

    // ── Register (across participants) ─────────────────────────────

    [HttpGet("medications/register")]
    public async Task<ActionResult<ApiResponse<PagedResult<MedicationListDto>>>> GetRegister(
        [FromQuery] string? search, [FromQuery] MedicationStatus? status,
        [FromQuery] int page = 1, [FromQuery] int pageSize = PagingParams.DefaultPageSize, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.ParticipantMedications.Include(m => m.Participant).AsQueryable();
        if (status.HasValue) query = query.Where(m => m.Status == status.Value);
        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(m => m.Name.Contains(search)
                || (m.Participant!.FirstName + " " + m.Participant.LastName).Contains(search)
                || (m.Participant!.PreferredName != null && m.Participant.PreferredName.Contains(search)));
        }

        // Correctness fix: (Participant.LastName, Name) ties trivially — two different
        // participants can share a surname, or one participant can have two medications with the
        // same name. With no unique tiebreaker, SQL makes no ordering guarantee among rows that
        // tie on the ORDER BY key, so two independent Skip/Take executions can resolve a tied
        // group differently — a row can land on both pages (duplicate) or neither (vanishes).
        // .Id is a unique Guid primary key, so ThenBy(m => m.Id) makes the total order
        // deterministic and safe to paginate. Mirrors IncidentsController.GetAll's identical fix.
        // ToListDto/FullName below are plain C# methods (not translatable to SQL), so — same as
        // this controller's sibling GetAdministrationReport — the page is materialised first and
        // mapped to DTOs client-side, rather than using PagedResult<T>.CreateAsync's
        // IQueryable<T>-of-DTO idiom.
        var ordered = query.OrderBy(m => m.Participant!.LastName).ThenBy(m => m.Name).ThenBy(m => m.Id);

        var totalCount = await ordered.CountAsync(ct);
        var pageItems = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);

        var result = new PagedResult<MedicationListDto>
        {
            Items = pageItems.Select(m => ToListDto(m, FullName(m.Participant))).ToList(),
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
        };
        return Ok(ApiResponse<PagedResult<MedicationListDto>>.Ok(result));
    }

    // ── MAR (Medication Administration Record) ──────────────────────

    [HttpGet("medications/mar")]
    public async Task<ActionResult<ApiResponse<MarDayDto>>> GetMar(
        [FromQuery] DateOnly? date, [FromQuery] Guid? participantId, CancellationToken ct)
    {
        // The MAR's "one calendar day" is the provider-local window [00:00, next 00:00). "Today" (when no
        // date is supplied) and "overdue" are both the PROVIDER's local notion, never UTC: a slot is an
        // unrecorded dose more than 60 minutes past its provider-local time.
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var targetDate = date ?? DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(_slots.UtcNow, provider.Zone));
        var dateStart = targetDate.ToDateTime(TimeOnly.MinValue);
        var dateEndExclusive = targetDate.AddDays(1).ToDateTime(TimeOnly.MinValue);

        var window = await _slots.GetWindowAsync(dateStart, dateEndExclusive, participantId, provider.Zone, includePrn: true, ct);

        // Deliverable 2 reverse link: ONE query for every administration that could show up in
        // today's MAR entries below, rather than one per entry.
        var dayIncidentIds = await GetIncidentIdsByAdministrationIdsAsync(
            window.Slots.Where(s => s.Administration != null).Select(s => s.Administration!.Id).ToList(), ct);

        var entries = new List<MarEntryDto>();
        foreach (var slot in window.Slots)
        {
            var m = slot.Medication;
            var participantName = FullName(m.Participant);
            var admin = slot.Administration;
            var incidentId = admin == null ? null : LookupIncidentId(dayIncidentIds, admin.Id);

            entries.Add(new MarEntryDto
            {
                MedicationId = m.Id,
                ParticipantId = m.ParticipantId,
                ParticipantName = participantName,
                MedicationName = m.Name,
                Strength = m.Strength,
                DoseDescription = m.DoseDescription,
                Form = m.Form,
                Route = m.Route,
                Packaging = m.Packaging,
                PharmacyName = m.PharmacyName,
                PharmacyPhone = m.PharmacyPhone,
                ScheduledTime = slot.TimeOfDay.ToString(@"hh\:mm"),
                ScheduledAt = slot.ScheduledAt,
                IsHighRisk = m.IsHighRisk,
                SupportLevel = m.SupportLevel,
                IsOverdue = slot.IsOverdue,
                Administration = admin == null ? null : ToAdministrationDto(admin, participantName, m.Name, m.DoseDescription, incidentId),
                IncidentId = incidentId,
            });
        }

        // Connection-map item 8 (tiny seam fix): the only administration id a MarPrnDto carries
        // is OutcomePendingAdministrationId — batch-resolve incident ids for every pending-outcome
        // administration in ONE call, same as dayIncidentIds above.
        var prnIncidentIds = await GetIncidentIdsByAdministrationIdsAsync(
            window.Prn.Where(p => p.OutcomePendingAdministration != null).Select(p => p.OutcomePendingAdministration!.Id).Distinct().ToList(), ct);

        var prnDtos = new List<MarPrnDto>();
        foreach (var status in window.Prn)
        {
            var m = status.Medication;
            var pending = status.OutcomePendingAdministration;

            prnDtos.Add(new MarPrnDto
            {
                MedicationId = m.Id,
                ParticipantId = m.ParticipantId,
                ParticipantName = FullName(m.Participant),
                Name = m.Name,
                Strength = m.Strength,
                DoseDescription = m.DoseDescription,
                PrnIndication = m.PrnIndication,
                PrnMaxDosesPer24h = m.PrnMaxDosesPer24h,
                PrnMinIntervalMinutes = m.PrnMinIntervalMinutes,
                Packaging = m.Packaging,
                PharmacyName = m.PharmacyName,
                PharmacyPhone = m.PharmacyPhone,
                DosesInLast24h = status.DosesInLast24h,
                LastDoseAt = status.LastDoseAt,
                OutcomePendingAdministrationId = pending?.Id,
                IncidentId = pending == null ? null : LookupIncidentId(prnIncidentIds, pending.Id),
            });
        }

        return Ok(ApiResponse<MarDayDto>.Ok(new MarDayDto { Date = targetDate, Entries = entries, PrnMedications = prnDtos }));
    }

    // ── Administrations ──────────────────────────────────────────────

    /// <summary>
    /// Records a dose (any outcome). Per the provider's Medication Competency mode: ENFORCE - the recording user needs a current
    /// credential, 403 with code MEDICATION_COMPETENCY_MISSING / _EXPIRED / _UNVERIFIABLE otherwise, for every role; WARN (the
    /// default) - the dose is recorded and flagged <c>recordedWithoutCompetency</c>. An
    /// optional <c>idempotencyKey</c> makes a retry safe (200 with the first record); a scheduled dose slot
    /// that already has a record returns 409 ADMINISTRATION_ALREADY_RECORDED with that record as <c>data</c>.
    /// The logic lives in <see cref="MedicationAdministrationRecorder"/>, shared with the shift package.
    /// </summary>
    [HttpPost("medications/{id:guid}/administrations")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AdministrationDto>>> RecordAdministration(
        Guid id, [FromBody] CreateAdministrationDto dto, CancellationToken ct)
    {
        // Resolved once and reused for the competency gate, the self-witness check and RecordedByName/
        // RecordedByUserId on the saved record — the administering identity, honouring the SuperAdmin
        // "view as" mechanism exactly like PortalController does (§4.3).
        var administeringUserId = await ResolveCurrentStaffIdAsync(ct);
        var result = await _recorder.RecordAsync(
            new RecordAdministrationRequest(id, dto, administeringUserId, GetRecordedByName()), ct);
        return result.ToActionResult(this);
    }

    [HttpPut("medications/administrations/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AdministrationDto>>> UpdateAdministration(
        Guid id, [FromBody] UpdateAdministrationDto dto, CancellationToken ct)
    {
        var admin = await _db.MedicationAdministrations
            .Include(a => a.ParticipantMedication).ThenInclude(m => m!.Participant)
            .FirstOrDefaultAsync(a => a.Id == id, ct);
        if (admin == null) return NotFound(ApiResponse<AdministrationDto>.Fail("Administration record not found"));

        if (dto.Status != MedicationAdministrationStatus.Administered && string.IsNullOrWhiteSpace(dto.Reason))
            return BadRequest(ApiResponse<AdministrationDto>.Fail("A reason is required when a dose is refused, withheld, missed or the wrong medication was given."));

        if (dto.Status == MedicationAdministrationStatus.WrongMedication && string.IsNullOrWhiteSpace(dto.Notes))
            return BadRequest(ApiResponse<AdministrationDto>.Fail("A note describing what was given instead is required when recording a wrong medication administration."));

        admin.Status = dto.Status;
        admin.AdministeredAt = dto.AdministeredAt;
        // Preserve the originally-recorded zone unless the caller supplies a new one — an amend
        // that doesn't touch AdministeredAt (the common case; see RecordAdministrationModal's
        // buildAmendFields) shouldn't wipe out how that original instant should be displayed.
        admin.AdministeredAtTimeZone = dto.AdministeredAtTimeZone ?? admin.AdministeredAtTimeZone;
        admin.DoseGiven = dto.DoseGiven;
        admin.WitnessName = dto.WitnessName;
        admin.Reason = dto.Reason;
        admin.PrnReason = dto.PrnReason;
        admin.PrnOutcome = dto.PrnOutcome;
        admin.PrnOutcomeAt = dto.PrnOutcomeAt;
        admin.Notes = dto.Notes;
        admin.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        var med = admin.ParticipantMedication!;
        var incidentMap = await GetIncidentIdsByAdministrationIdsAsync(new[] { admin.Id }, ct);
        return Ok(ApiResponse<AdministrationDto>.Ok(ToAdministrationDto(
            admin, FullName(med.Participant), med.Name, med.DoseDescription, LookupIncidentId(incidentMap, admin.Id))));
    }

    [HttpPost("medications/administrations/{id:guid}/outcome")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AdministrationDto>>> RecordOutcome(
        Guid id, [FromBody] RecordPrnOutcomeDto dto, CancellationToken ct)
    {
        var admin = await _db.MedicationAdministrations
            .Include(a => a.ParticipantMedication).ThenInclude(m => m!.Participant)
            .FirstOrDefaultAsync(a => a.Id == id, ct);
        if (admin == null) return NotFound(ApiResponse<AdministrationDto>.Fail("Administration record not found"));

        admin.PrnOutcome = dto.PrnOutcome;
        admin.PrnOutcomeAt = DateTime.UtcNow;
        admin.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var med = admin.ParticipantMedication!;
        var incidentMap = await GetIncidentIdsByAdministrationIdsAsync(new[] { admin.Id }, ct);
        return Ok(ApiResponse<AdministrationDto>.Ok(ToAdministrationDto(
            admin, FullName(med.Participant), med.Name, med.DoseDescription, LookupIncidentId(incidentMap, admin.Id))));
    }

    [HttpGet("participants/{participantId:guid}/administrations")]
    public async Task<ActionResult<ApiResponse<List<AdministrationDto>>>> GetParticipantAdministrations(
        Guid participantId, [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
    {
        var query = _db.MedicationAdministrations
            .Include(a => a.ParticipantMedication)
            .Include(a => a.Participant)
            .Where(a => a.ParticipantId == participantId);

        if (from.HasValue) query = query.Where(a => (a.AdministeredAt ?? a.ScheduledAt ?? a.CreatedAt) >= from.Value);
        if (to.HasValue) query = query.Where(a => (a.AdministeredAt ?? a.ScheduledAt ?? a.CreatedAt) <= to.Value);

        var items = await query.OrderByDescending(a => a.CreatedAt).ToListAsync(ct);
        var incidentMap = await GetIncidentIdsByAdministrationIdsAsync(items.Select(a => a.Id).ToList(), ct);
        var result = items.Select(a => ToAdministrationDto(
            a, FullName(a.Participant), a.ParticipantMedication?.Name ?? string.Empty, a.ParticipantMedication?.DoseDescription ?? string.Empty,
            LookupIncidentId(incidentMap, a.Id))).ToList();
        return Ok(ApiResponse<List<AdministrationDto>>.Ok(result));
    }

    /// <summary>
    /// Cross-participant medication administration report: every administration record,
    /// optionally filtered to one participant and/or a date range, ordered by when the dose was
    /// actually given (falling back to when it was scheduled, then when the record was created,
    /// for records with neither) — descending, most recent first. Tenant-scoped via the global
    /// query filter on <see cref="MedicationAdministration"/> (ITenantEntity). Narrower role gate
    /// than the plain per-participant history read (<see cref="GetParticipantAdministrations"/>),
    /// matching the create/update/register-adjacent endpoints on this controller.
    /// </summary>
    [HttpGet("medications/administrations/report")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PagedResult<AdministrationDto>>>> GetAdministrationReport(
        [FromQuery] Guid? participantId, [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.MedicationAdministrations
            .Include(a => a.ParticipantMedication)
            .Include(a => a.Participant)
            .AsQueryable();

        if (participantId.HasValue) query = query.Where(a => a.ParticipantId == participantId.Value);
        if (from.HasValue) query = query.Where(a => (a.AdministeredAt ?? a.ScheduledAt ?? a.CreatedAt) >= from.Value);
        if (to.HasValue) query = query.Where(a => (a.AdministeredAt ?? a.ScheduledAt ?? a.CreatedAt) <= to.Value);

        var ordered = query.OrderByDescending(a => a.AdministeredAt ?? a.ScheduledAt ?? a.CreatedAt);

        var totalCount = await ordered.CountAsync(ct);
        var pageItems = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        var incidentMap = await GetIncidentIdsByAdministrationIdsAsync(pageItems.Select(a => a.Id).ToList(), ct);

        var result = new PagedResult<AdministrationDto>
        {
            Items = pageItems.Select(a => ToAdministrationDto(
                a, FullName(a.Participant), a.ParticipantMedication?.Name ?? string.Empty, a.ParticipantMedication?.DoseDescription ?? string.Empty,
                LookupIncidentId(incidentMap, a.Id))).ToList(),
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
        };
        return Ok(ApiResponse<PagedResult<AdministrationDto>>.Ok(result));
    }

    // ── Helpers ────────────────────────────────────────────────────

    private string GetRecordedByName() =>
        User?.FindFirst("fullName")?.Value
        ?? User?.FindFirst(ClaimTypes.Name)?.Value
        ?? "Unknown";

    /// <summary>
    /// Resolves the caller's own user id, the same way PortalController does — ViewAsUserId
    /// takes priority (SuperAdmin tenant/user switching), falling back to the JWT's own subject
    /// claim. Returns null (never throws) when there's no current HTTP context/claim (e.g. a test
    /// constructing this controller directly with no ControllerContext) or the user isn't
    /// found — either of which just means "skip the self-witness check".
    /// </summary>
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        var claim = User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        Guid? ownUserId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        var userId = _currentTenant.ViewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var exists = await _db.Users.AnyAsync(u => u.Id == userId.Value, ct);
        return exists ? userId : null;
    }

    private static Weekdays? ParseDaysOfWeek(List<string>? days)
    {
        if (days == null || days.Count == 0) return null;
        var result = Weekdays.None;
        foreach (var d in days)
        {
            if (Enum.TryParse<Weekdays>(d, ignoreCase: true, out var flag)) result |= flag;
        }
        return result == Weekdays.None ? null : result;
    }

    private static List<string> FormatDaysOfWeek(Weekdays? mask)
    {
        if (mask is null || mask == Weekdays.None) return new List<string>();
        return MedicationScheduleCalculator.WeekdayOrder
            .Where(d => (mask.Value & d) != 0)
            .Select(d => d.ToString())
            .ToList();
    }

    private async Task<int> GetPrnDosesInLast24hAsync(Guid medicationId, CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddHours(-24);
        return await _db.MedicationAdministrations.CountAsync(a =>
            a.ParticipantMedicationId == medicationId &&
            a.Status == MedicationAdministrationStatus.Administered &&
            a.AdministeredAt != null && a.AdministeredAt >= cutoff, ct);
    }

    private static string? ValidateMedicationDto(
        MedicationType type, string? timesOfDay, string? prnIndication, int? prnMaxDosesPer24h,
        bool isChemicalRestraint, string? purpose,
        MedicationFrequency frequency, List<string>? daysOfWeek, int? intervalDays, DateOnly? anchorDate)
    {
        if (type == MedicationType.Prn)
        {
            if (string.IsNullOrWhiteSpace(prnIndication) || prnMaxDosesPer24h is null)
                return "PRN medications require a PRN indication and a maximum doses per 24 hours.";
        }
        else
        {
            if (!TryValidateTimesOfDayCsv(timesOfDay, out _))
                return "Regular medications require times of day as a comma-separated list of HH:mm values (e.g. \"08:00,20:00\").";

            if (frequency == MedicationFrequency.SpecificDays && ParseDaysOfWeek(daysOfWeek) is null)
                return "Select at least one day of the week for a specific-days schedule.";

            if (frequency == MedicationFrequency.EveryNDays && (intervalDays is null || intervalDays <= 0 || anchorDate is null))
                return "An every-N-days schedule requires a positive interval and an anchor date.";
        }

        if (isChemicalRestraint && string.IsNullOrWhiteSpace(purpose))
            return "A purpose is required when a medication is flagged as a chemical restraint.";

        return null;
    }

    private static bool TryValidateTimesOfDayCsv(string? csv, out List<TimeSpan> times) =>
        MedicationSlotCalculator.TryParseTimesOfDay(csv, out times);

    private static string FullName(Participant? p) => MedicationMapping.ParticipantName(p);

    private static MedicationListDto ToListDto(ParticipantMedication m, string participantName)
    {
        var today = DateTime.UtcNow.Date;
        var flags = new List<string>();
        if (m.IsChemicalRestraint && (!m.BspInPlace || string.IsNullOrEmpty(m.RestrictivePracticeAuthorisationRef)))
            flags.Add("ChemicalRestraintUnauthorised");
        if (m.NextReviewDue.HasValue && m.NextReviewDue.Value < today && m.Status == MedicationStatus.Active)
            flags.Add("ReviewOverdue");
        if (!m.ConsentObtained && m.Status == MedicationStatus.Active)
            flags.Add("ConsentMissing");

        return new MedicationListDto
        {
            Id = m.Id,
            ParticipantId = m.ParticipantId,
            ParticipantName = participantName,
            Name = m.Name,
            Strength = m.Strength,
            Form = m.Form,
            Route = m.Route,
            DoseDescription = m.DoseDescription,
            Type = m.Type,
            TimesOfDay = m.TimesOfDay,
            Frequency = m.Frequency,
            DaysOfWeek = FormatDaysOfWeek(m.DaysOfWeek),
            IntervalDays = m.IntervalDays,
            AnchorDate = m.AnchorDate,
            Status = m.Status,
            IsHighRisk = m.IsHighRisk,
            IsPsychotropic = m.IsPsychotropic,
            IsChemicalRestraint = m.IsChemicalRestraint,
            DrugSchedule = m.DrugSchedule,
            SupportLevel = m.SupportLevel,
            Packaging = m.Packaging,
            StartDate = m.StartDate,
            EndDate = m.EndDate,
            NextReviewDue = m.NextReviewDue,
            ComplianceFlags = flags,
        };
    }

    private static MedicationDetailDto ToDetailDto(ParticipantMedication m, string participantName, int prnDosesInLast24h)
    {
        var list = ToListDto(m, participantName);
        return new MedicationDetailDto
        {
            Id = list.Id,
            ParticipantId = list.ParticipantId,
            ParticipantName = list.ParticipantName,
            Name = list.Name,
            Strength = list.Strength,
            Form = list.Form,
            Route = list.Route,
            DoseDescription = list.DoseDescription,
            Type = list.Type,
            TimesOfDay = list.TimesOfDay,
            Frequency = list.Frequency,
            DaysOfWeek = list.DaysOfWeek,
            IntervalDays = list.IntervalDays,
            AnchorDate = list.AnchorDate,
            Status = list.Status,
            IsHighRisk = list.IsHighRisk,
            IsPsychotropic = list.IsPsychotropic,
            IsChemicalRestraint = list.IsChemicalRestraint,
            DrugSchedule = list.DrugSchedule,
            SupportLevel = list.SupportLevel,
            Packaging = list.Packaging,
            StartDate = list.StartDate,
            EndDate = list.EndDate,
            NextReviewDue = list.NextReviewDue,
            ComplianceFlags = list.ComplianceFlags,
            Directions = m.Directions,
            PrnIndication = m.PrnIndication,
            PrnMaxDosesPer24h = m.PrnMaxDosesPer24h,
            PrnMinIntervalMinutes = m.PrnMinIntervalMinutes,
            Purpose = m.Purpose,
            BspInPlace = m.BspInPlace,
            RestrictivePracticeAuthorisationRef = m.RestrictivePracticeAuthorisationRef,
            IsHighIntensitySupport = m.IsHighIntensitySupport,
            PrescriberName = m.PrescriberName,
            PharmacyName = m.PharmacyName,
            PharmacyPhone = m.PharmacyPhone,
            ConsentObtained = m.ConsentObtained,
            ConsentGivenBy = m.ConsentGivenBy,
            ConsentDate = m.ConsentDate,
            StorageRequirements = m.StorageRequirements,
            Notes = m.Notes,
            PrnDosesInLast24h = prnDosesInLast24h,
            CreatedAt = m.CreatedAt,
            UpdatedAt = m.UpdatedAt,
        };
    }

    /// <summary>
    /// Connection-map reverse link (Deliverable 2): for the given medication-administration ids,
    /// the newest active IncidentReport whose MedicationAdministrationId points back at each one
    /// — ONE query for the whole batch (never per-row).
    /// </summary>
    private async Task<Dictionary<Guid, Guid>> GetIncidentIdsByAdministrationIdsAsync(IReadOnlyCollection<Guid> administrationIds, CancellationToken ct)
    {
        if (administrationIds.Count == 0) return new Dictionary<Guid, Guid>();
        var rows = await _db.IncidentReports
            .Where(i => i.IsActive && i.MedicationAdministrationId != null && administrationIds.Contains(i.MedicationAdministrationId.Value))
            .Select(i => new { AdminId = i.MedicationAdministrationId!.Value, i.Id, i.CreatedAt })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.AdminId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First().Id);
    }

    /// <summary>Dictionary&lt;Guid, Guid&gt;.GetValueOrDefault returns Guid.Empty (not null) for a
    /// missing key, which would wrongly stand in for "no incident" — this is the null-correct
    /// lookup every incident-id-map read in this class uses instead.</summary>
    private static Guid? LookupIncidentId(Dictionary<Guid, Guid> map, Guid key) =>
        map.TryGetValue(key, out var incidentId) ? incidentId : null;

    private static AdministrationDto ToAdministrationDto(
        MedicationAdministration a, string participantName, string medicationName, string doseDescription, Guid? incidentId = null) =>
        MedicationMapping.ToAdministrationDto(a, participantName, medicationName, doseDescription, incidentId);
}
