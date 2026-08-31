using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/incidents")]
public class IncidentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public IncidentsController(OdipDbContext db) => _db = db;

    private static readonly IncidentType[] QscRequiredTypes = new[]
    {
        IncidentType.Abuse, IncidentType.Neglect, IncidentType.Death,
        IncidentType.RestrictivePracticeUse, IncidentType.MissingPerson
    };

    /// <summary>
    /// §4.4 same-tenant validation for the three user pickers below: null is always fine,
    /// otherwise the id must resolve to an active User — same-tenant scoping comes for free from
    /// _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidUserRefAsync(Guid? userId, CancellationToken ct) =>
        userId.HasValue
            ? _db.Users.AnyAsync(u => u.Id == userId.Value && u.IsActive, ct)
            : Task.FromResult(true);

    /// <summary>
    /// INC-01 validation: null is always fine, otherwise the id must resolve to a TripInstance —
    /// same-tenant scoping comes for free from _db.TripInstances' ambient OdipDbContext query
    /// filter, same pattern as <see cref="IsValidUserRefAsync"/>.
    /// </summary>
    private Task<bool> IsValidTripRefAsync(Guid? tripId, CancellationToken ct) =>
        tripId.HasValue
            ? _db.TripInstances.AnyAsync(t => t.Id == tripId.Value, ct)
            : Task.FromResult(true);

    /// <summary>
    /// INC-01/INC-02/INC-04 cross-field validation shared by Create and Update: a Trip-stream
    /// incident must carry a valid trip link, an "Other" incident type must carry its specify
    /// text, and a RestrictivePracticeUse incident must carry which of the register's 6
    /// categories was used. Returns an error message, or null when the dto passes.
    /// </summary>
    private static string? ValidateServiceTypeAndIncidentType(CreateIncidentDto dto)
    {
        if (dto.ServiceType == ServiceStreams.Trip && dto.TripInstanceId == null)
            return "A trip must be selected when the service type is Trip.";
        if (dto.IncidentType == IncidentType.Other && string.IsNullOrWhiteSpace(dto.OtherTypeSpecify))
            return "Please specify the incident type.";
        if (dto.IncidentType == IncidentType.RestrictivePracticeUse && dto.RestrictivePracticeType == null)
            return "Please select the restrictive practice type.";
        return null;
    }

    /// <summary>
    /// INC-05 FK validation: null is always fine. Otherwise the id must resolve to a
    /// RestrictivePractice register entry — same-tenant scoping comes for free from
    /// _db.RestrictivePractices' ambient OdipDbContext query filter, same pattern as
    /// <see cref="IsValidUserRefAsync"/>. When an involved participant and/or restrictive
    /// practice type is also present on the dto, the linked entry must belong to that
    /// participant and match that type — a link that points at the wrong participant's register,
    /// or a different category than what was reported, would silently mislabel the register
    /// entry's authorisation as covering an incident it doesn't.
    /// </summary>
    private async Task<string?> ValidateRestrictivePracticeLinkAsync(
        Guid? restrictivePracticeId, RestrictivePracticeType? rpType, Guid? involvedParticipantId, CancellationToken ct)
    {
        if (!restrictivePracticeId.HasValue) return null;

        var practice = await _db.RestrictivePractices.FirstOrDefaultAsync(rp => rp.Id == restrictivePracticeId.Value, ct);
        if (practice == null) return "Linked restrictive practice entry not found.";
        if (involvedParticipantId.HasValue && practice.ParticipantId != involvedParticipantId.Value)
            return "Linked restrictive practice entry does not belong to the involved participant.";
        if (rpType.HasValue && practice.Type != rpType.Value)
            return "Linked restrictive practice entry does not match the selected restrictive practice type.";
        return null;
    }

    /// <summary>
    /// INC-04: the authorised-vs-unauthorised determination, computed once at Create time only
    /// (see <see cref="IncidentReport.IsRestrictivePracticeAuthorised"/> for why Update
    /// never calls this). Authorised means the involved participant had at least one ACTIVE
    /// register entry of the reported type at this moment — the same tenant-scoped
    /// _db.RestrictivePractices set INC-05's picker and RestrictivePracticesController both read,
    /// so "no matching active entry" (including a participant with only inactive/retired rows of
    /// that type) is Unauthorised, not "unknown". Returns null — not determinable — when this
    /// isn't a RestrictivePracticeUse incident or no participant was selected.
    /// </summary>
    private async Task<bool?> DetermineRestrictivePracticeAuthorisationAsync(
        IncidentType incidentType, RestrictivePracticeType? rpType, Guid? involvedParticipantId, CancellationToken ct)
    {
        if (incidentType != IncidentType.RestrictivePracticeUse) return null;
        if (rpType == null || involvedParticipantId == null) return null;

        return await _db.RestrictivePractices.AnyAsync(
            rp => rp.ParticipantId == involvedParticipantId.Value && rp.Type == rpType.Value && rp.IsActive, ct);
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<IncidentListDto>>>> GetAll(
        [FromQuery] Guid? tripId, [FromQuery] IncidentStatus? status,
        [FromQuery] IncidentSeverity? severity, [FromQuery] QscReportingStatus? qscStatus,
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.IncidentReports
            .Include(i => i.TripInstance)
            .Include(i => i.ReportedByUser)
            .Include(i => i.InvolvedParticipant)
            .AsQueryable();

        // Default: only active records unless explicitly filtered
        if (isActive != false)
            query = query.Where(i => i.IsActive);
        else if (isActive == false)
            query = query.Where(i => !i.IsActive);

        if (tripId.HasValue) query = query.Where(i => i.TripInstanceId == tripId.Value);
        if (status.HasValue) query = query.Where(i => i.Status == status.Value);
        if (severity.HasValue) query = query.Where(i => i.Severity == severity.Value);
        if (qscStatus.HasValue) query = query.Where(i => i.QscReportingStatus == qscStatus.Value);

        var items = await query.OrderByDescending(i => i.IncidentDateTime)
            .Select(i => new IncidentListDto
            {
                Id = i.Id,
                ServiceType = i.ServiceType,
                TripInstanceId = i.TripInstanceId,
                TripName = i.TripInstance != null ? i.TripInstance.TripName : null,
                IncidentType = i.IncidentType,
                OtherTypeSpecify = i.OtherTypeSpecify,
                Severity = i.Severity,
                Status = i.Status,
                Title = i.Title,
                IncidentDateTime = i.IncidentDateTime,
                Location = i.Location,
                ReportedByName = i.ReportedByUser.FirstName + " " + i.ReportedByUser.LastName,
                InvolvedParticipantName = i.InvolvedParticipant != null
                    ? i.InvolvedParticipant.FirstName + " " + i.InvolvedParticipant.LastName : null,
                QscReportingStatus = i.QscReportingStatus,
                IsOverdue24h = i.QscReportingStatus == QscReportingStatus.Required
                    && i.QscReportedAt == null
                    && (DateTime.UtcNow - i.CreatedAt).TotalHours > 24,
                CreatedAt = i.CreatedAt
            }).ToListAsync(ct);

        return Ok(ApiResponse<List<IncidentListDto>>.Ok(items));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<IncidentDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var item = await _db.IncidentReports
            .Include(i => i.TripInstance)
            .Include(i => i.ReportedByUser)
            .Include(i => i.InvolvedParticipant)
            .Include(i => i.InvolvedUser)
            .Include(i => i.ReviewedByUser)
            .Include(i => i.RestrictivePractice)
            .Where(i => i.Id == id)
            .Select(i => new IncidentDetailDto
            {
                Id = i.Id,
                ServiceType = i.ServiceType,
                TripInstanceId = i.TripInstanceId,
                TripName = i.TripInstance != null ? i.TripInstance.TripName : null,
                IncidentType = i.IncidentType,
                OtherTypeSpecify = i.OtherTypeSpecify,
                Severity = i.Severity,
                Status = i.Status,
                Title = i.Title,
                IncidentDateTime = i.IncidentDateTime,
                Location = i.Location,
                ReportedByName = i.ReportedByUser.FirstName + " " + i.ReportedByUser.LastName,
                InvolvedParticipantName = i.InvolvedParticipant != null
                    ? i.InvolvedParticipant.FirstName + " " + i.InvolvedParticipant.LastName : null,
                QscReportingStatus = i.QscReportingStatus,
                IsOverdue24h = i.QscReportingStatus == QscReportingStatus.Required
                    && i.QscReportedAt == null
                    && (DateTime.UtcNow - i.CreatedAt).TotalHours > 24,
                CreatedAt = i.CreatedAt,
                // Detail fields
                ParticipantBookingId = i.ParticipantBookingId,
                InvolvedParticipantId = i.InvolvedParticipantId,
                InvolvedStaffId = i.InvolvedUserId,
                InvolvedStaffName = i.InvolvedUser != null
                    ? i.InvolvedUser.FirstName + " " + i.InvolvedUser.LastName : null,
                ReportedByStaffId = i.ReportedByUserId,
                RestrictivePracticeType = i.RestrictivePracticeType,
                RestrictivePracticeId = i.RestrictivePracticeId,
                RestrictivePracticeDescription = i.RestrictivePractice != null ? i.RestrictivePractice.Description : null,
                RestrictivePracticeReviewDate = i.RestrictivePractice != null ? i.RestrictivePractice.ReviewDate : null,
                IsRestrictivePracticeAuthorised = i.IsRestrictivePracticeAuthorised,
                Description = i.Description,
                ImmediateActionsTaken = i.ImmediateActionsTaken,
                WereEmergencyServicesCalled = i.WereEmergencyServicesCalled,
                EmergencyServicesDetails = i.EmergencyServicesDetails,
                WitnessNames = i.WitnessNames,
                WitnessStatements = i.WitnessStatements,
                QscReportedAt = i.QscReportedAt,
                QscReferenceNumber = i.QscReferenceNumber,
                ReviewedByStaffId = i.ReviewedByUserId,
                ReviewedByName = i.ReviewedByUser != null
                    ? i.ReviewedByUser.FirstName + " " + i.ReviewedByUser.LastName : null,
                ReviewedAt = i.ReviewedAt,
                ReviewNotes = i.ReviewNotes,
                CorrectiveActions = i.CorrectiveActions,
                ResolvedAt = i.ResolvedAt,
                FamilyNotified = i.FamilyNotified,
                FamilyNotifiedAt = i.FamilyNotifiedAt,
                SupportCoordinatorNotified = i.SupportCoordinatorNotified,
                SupportCoordinatorNotifiedAt = i.SupportCoordinatorNotifiedAt,
                UpdatedAt = i.UpdatedAt
            }).FirstOrDefaultAsync(ct);

        if (item == null) return NotFound(ApiResponse<IncidentDetailDto>.Fail("Incident not found"));
        return Ok(ApiResponse<IncidentDetailDto>.Ok(item));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<IncidentListDto>>> Create([FromBody] CreateIncidentDto dto, CancellationToken ct)
    {
        var crossFieldError = ValidateServiceTypeAndIncidentType(dto);
        if (crossFieldError != null)
            return BadRequest(ApiResponse<IncidentListDto>.Fail(crossFieldError));
        if (!await IsValidTripRefAsync(dto.TripInstanceId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Trip not found."));
        if (!await IsValidUserRefAsync(dto.InvolvedStaffId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Involved staff member not found."));
        if (!await IsValidUserRefAsync(dto.ReportedByStaffId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Reported-by staff member not found."));
        var rpLinkError = await ValidateRestrictivePracticeLinkAsync(dto.RestrictivePracticeId, dto.RestrictivePracticeType, dto.InvolvedParticipantId, ct);
        if (rpLinkError != null)
            return BadRequest(ApiResponse<IncidentListDto>.Fail(rpLinkError));

        // INC-04: determined once here, from the register as it stood right now — see
        // DetermineRestrictivePracticeAuthorisationAsync and the entity field's XML doc for why
        // this never runs again on Update.
        var isRpAuthorised = await DetermineRestrictivePracticeAuthorisationAsync(dto.IncidentType, dto.RestrictivePracticeType, dto.InvolvedParticipantId, ct);

        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(),
            ServiceType = dto.ServiceType,
            TripInstanceId = dto.TripInstanceId,
            ParticipantBookingId = dto.ParticipantBookingId,
            InvolvedParticipantId = dto.InvolvedParticipantId,
            InvolvedUserId = dto.InvolvedStaffId,
            ReportedByUserId = dto.ReportedByStaffId,
            IncidentType = dto.IncidentType,
            OtherTypeSpecify = dto.OtherTypeSpecify,
            RestrictivePracticeType = dto.RestrictivePracticeType,
            RestrictivePracticeId = dto.RestrictivePracticeId,
            IsRestrictivePracticeAuthorised = isRpAuthorised,
            Severity = dto.Severity,
            Title = dto.Title,
            Description = dto.Description,
            IncidentDateTime = dto.IncidentDateTime,
            Location = dto.Location,
            ImmediateActionsTaken = dto.ImmediateActionsTaken,
            WereEmergencyServicesCalled = dto.WereEmergencyServicesCalled,
            EmergencyServicesDetails = dto.EmergencyServicesDetails,
            WitnessNames = dto.WitnessNames,
            WitnessStatements = dto.WitnessStatements,
            Status = IncidentStatus.Draft
        };

        // Auto-set QSC reporting requirement for critical incidents. RestrictivePracticeUse is
        // already in QscRequiredTypes (any RP incident is reportable-territory regardless of the
        // determination), so `isRpAuthorised == false` is belt-and-braces here rather than a
        // behaviour change — it's the INC-04 nudge made explicit, and keeps this correct even if
        // QscRequiredTypes is ever narrowed to drop RestrictivePracticeUse. This only ever raises
        // QscReportingStatus to Required as a default; like every field here it's still editable
        // afterwards on the Update flow, so it's a nudge, not a lock.
        if (dto.Severity == IncidentSeverity.Critical || QscRequiredTypes.Contains(dto.IncidentType) || isRpAuthorised == false)
        {
            incident.QscReportingStatus = QscReportingStatus.Required;
        }

        _db.IncidentReports.Add(incident);
        await _db.SaveChangesAsync(ct);

        await _db.Entry(incident).Reference(i => i.TripInstance).LoadAsync(ct);
        await _db.Entry(incident).Reference(i => i.ReportedByUser).LoadAsync(ct);
        if (incident.InvolvedParticipantId.HasValue) await _db.Entry(incident).Reference(i => i.InvolvedParticipant).LoadAsync(ct);

        return Ok(ApiResponse<IncidentListDto>.Ok(new IncidentListDto
        {
            Id = incident.Id,
            ServiceType = incident.ServiceType,
            TripInstanceId = incident.TripInstanceId,
            TripName = incident.TripInstance?.TripName,
            IncidentType = incident.IncidentType,
            OtherTypeSpecify = incident.OtherTypeSpecify,
            Severity = incident.Severity,
            Status = incident.Status,
            Title = incident.Title,
            IncidentDateTime = incident.IncidentDateTime,
            Location = incident.Location,
            ReportedByName = incident.ReportedByUser != null ? incident.ReportedByUser.FirstName + " " + incident.ReportedByUser.LastName : null,
            InvolvedParticipantName = incident.InvolvedParticipant != null
                ? incident.InvolvedParticipant.FirstName + " " + incident.InvolvedParticipant.LastName : null,
            QscReportingStatus = incident.QscReportingStatus,
            IsOverdue24h = incident.QscReportingStatus == QscReportingStatus.Required
                && incident.QscReportedAt == null
                && (DateTime.UtcNow - incident.CreatedAt).TotalHours > 24,
            CreatedAt = incident.CreatedAt
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<IncidentListDto>>> Update(Guid id, [FromBody] UpdateIncidentDto dto, CancellationToken ct)
    {
        var i = await _db.IncidentReports.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (i == null) return NotFound(ApiResponse<IncidentListDto>.Fail("Incident not found"));

        var crossFieldError = ValidateServiceTypeAndIncidentType(dto);
        if (crossFieldError != null)
            return BadRequest(ApiResponse<IncidentListDto>.Fail(crossFieldError));
        if (!await IsValidTripRefAsync(dto.TripInstanceId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Trip not found."));
        if (!await IsValidUserRefAsync(dto.InvolvedStaffId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Involved staff member not found."));
        if (!await IsValidUserRefAsync(dto.ReportedByStaffId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Reported-by staff member not found."));
        if (!await IsValidUserRefAsync(dto.ReviewedByStaffId, ct))
            return BadRequest(ApiResponse<IncidentListDto>.Fail("Reviewed-by staff member not found."));
        var rpLinkError = await ValidateRestrictivePracticeLinkAsync(dto.RestrictivePracticeId, dto.RestrictivePracticeType, dto.InvolvedParticipantId, ct);
        if (rpLinkError != null)
            return BadRequest(ApiResponse<IncidentListDto>.Fail(rpLinkError));

        i.ServiceType = dto.ServiceType;
        i.TripInstanceId = dto.TripInstanceId;
        i.ParticipantBookingId = dto.ParticipantBookingId;
        i.InvolvedParticipantId = dto.InvolvedParticipantId;
        i.InvolvedUserId = dto.InvolvedStaffId;
        i.ReportedByUserId = dto.ReportedByStaffId;
        i.IncidentType = dto.IncidentType;
        i.OtherTypeSpecify = dto.OtherTypeSpecify;
        // INC-04: RestrictivePracticeType/Id may still be corrected here like any other field, but
        // IsRestrictivePracticeAuthorised is deliberately left untouched — it's frozen at whatever
        // Create computed (see the entity field's XML doc). Editing the participant or type here
        // does NOT silently re-run the authorised/unauthorised finding against today's register.
        i.RestrictivePracticeType = dto.RestrictivePracticeType;
        i.RestrictivePracticeId = dto.RestrictivePracticeId;
        i.Severity = dto.Severity;
        i.Status = dto.Status;
        i.Title = dto.Title;
        i.Description = dto.Description;
        i.IncidentDateTime = dto.IncidentDateTime;
        i.Location = dto.Location;
        i.ImmediateActionsTaken = dto.ImmediateActionsTaken;
        i.WereEmergencyServicesCalled = dto.WereEmergencyServicesCalled;
        i.EmergencyServicesDetails = dto.EmergencyServicesDetails;
        i.WitnessNames = dto.WitnessNames;
        i.WitnessStatements = dto.WitnessStatements;
        i.QscReportingStatus = dto.QscReportingStatus;
        i.QscReportedAt = dto.QscReportedAt;
        i.QscReferenceNumber = dto.QscReferenceNumber;
        i.ReviewedByUserId = dto.ReviewedByStaffId;
        i.ReviewNotes = dto.ReviewNotes;
        i.CorrectiveActions = dto.CorrectiveActions;
        i.FamilyNotified = dto.FamilyNotified;
        i.FamilyNotifiedAt = dto.FamilyNotifiedAt;
        i.SupportCoordinatorNotified = dto.SupportCoordinatorNotified;
        i.SupportCoordinatorNotifiedAt = dto.SupportCoordinatorNotifiedAt;
        i.UpdatedAt = DateTime.UtcNow;

        // Set resolved timestamp when status changes to Resolved
        if (dto.Status == IncidentStatus.Resolved && i.ResolvedAt == null)
            i.ResolvedAt = DateTime.UtcNow;

        // Set reviewed timestamp when reviewer is assigned
        if (dto.ReviewedByStaffId.HasValue && i.ReviewedAt == null)
            i.ReviewedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        await _db.Entry(i).Reference(x => x.TripInstance).LoadAsync(ct);
        await _db.Entry(i).Reference(x => x.ReportedByUser).LoadAsync(ct);
        if (i.InvolvedParticipantId.HasValue) await _db.Entry(i).Reference(x => x.InvolvedParticipant).LoadAsync(ct);

        return Ok(ApiResponse<IncidentListDto>.Ok(new IncidentListDto
        {
            Id = i.Id,
            ServiceType = i.ServiceType,
            TripInstanceId = i.TripInstanceId,
            TripName = i.TripInstance?.TripName,
            IncidentType = i.IncidentType,
            OtherTypeSpecify = i.OtherTypeSpecify,
            Severity = i.Severity,
            Status = i.Status,
            Title = i.Title,
            IncidentDateTime = i.IncidentDateTime,
            Location = i.Location,
            ReportedByName = i.ReportedByUser != null ? i.ReportedByUser.FirstName + " " + i.ReportedByUser.LastName : null,
            InvolvedParticipantName = i.InvolvedParticipant != null
                ? i.InvolvedParticipant.FirstName + " " + i.InvolvedParticipant.LastName : null,
            QscReportingStatus = i.QscReportingStatus,
            IsOverdue24h = i.QscReportingStatus == QscReportingStatus.Required
                && i.QscReportedAt == null
                && (DateTime.UtcNow - i.CreatedAt).TotalHours > 24,
            CreatedAt = i.CreatedAt
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var i = await _db.IncidentReports.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (i == null) return NotFound(ApiResponse<bool>.Fail("Incident not found"));
        i.IsActive = false;
        i.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("trip/{tripId:guid}")]
    public async Task<ActionResult<ApiResponse<List<IncidentListDto>>>> GetByTrip(Guid tripId, CancellationToken ct)
    {
        var items = await _db.IncidentReports
            .Include(i => i.TripInstance)
            .Include(i => i.ReportedByUser)
            .Include(i => i.InvolvedParticipant)
            .Where(i => i.TripInstanceId == tripId && i.IsActive)
            .OrderByDescending(i => i.IncidentDateTime)
            .Select(i => new IncidentListDto
            {
                Id = i.Id,
                ServiceType = i.ServiceType,
                TripInstanceId = i.TripInstanceId,
                TripName = i.TripInstance != null ? i.TripInstance.TripName : null,
                IncidentType = i.IncidentType,
                OtherTypeSpecify = i.OtherTypeSpecify,
                Severity = i.Severity,
                Status = i.Status,
                Title = i.Title,
                IncidentDateTime = i.IncidentDateTime,
                Location = i.Location,
                ReportedByName = i.ReportedByUser.FirstName + " " + i.ReportedByUser.LastName,
                InvolvedParticipantName = i.InvolvedParticipant != null
                    ? i.InvolvedParticipant.FirstName + " " + i.InvolvedParticipant.LastName : null,
                QscReportingStatus = i.QscReportingStatus,
                IsOverdue24h = i.QscReportingStatus == QscReportingStatus.Required
                    && i.QscReportedAt == null
                    && (DateTime.UtcNow - i.CreatedAt).TotalHours > 24,
                CreatedAt = i.CreatedAt
            }).ToListAsync(ct);

        return Ok(ApiResponse<List<IncidentListDto>>.Ok(items));
    }

    [HttpGet("overdue-qsc")]
    public async Task<ActionResult<ApiResponse<List<IncidentListDto>>>> GetOverdueQsc(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddHours(-24);
        var items = await _db.IncidentReports
            .Include(i => i.TripInstance)
            .Include(i => i.ReportedByUser)
            .Include(i => i.InvolvedParticipant)
            .Where(i => i.IsActive
                && i.QscReportingStatus == QscReportingStatus.Required
                && i.QscReportedAt == null
                && i.CreatedAt < cutoff)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => new IncidentListDto
            {
                Id = i.Id,
                ServiceType = i.ServiceType,
                TripInstanceId = i.TripInstanceId,
                TripName = i.TripInstance != null ? i.TripInstance.TripName : null,
                IncidentType = i.IncidentType,
                OtherTypeSpecify = i.OtherTypeSpecify,
                Severity = i.Severity,
                Status = i.Status,
                Title = i.Title,
                IncidentDateTime = i.IncidentDateTime,
                Location = i.Location,
                ReportedByName = i.ReportedByUser.FirstName + " " + i.ReportedByUser.LastName,
                InvolvedParticipantName = i.InvolvedParticipant != null
                    ? i.InvolvedParticipant.FirstName + " " + i.InvolvedParticipant.LastName : null,
                QscReportingStatus = i.QscReportingStatus,
                IsOverdue24h = true,
                CreatedAt = i.CreatedAt
            }).ToListAsync(ct);

        return Ok(ApiResponse<List<IncidentListDto>>.Ok(items));
    }
}
