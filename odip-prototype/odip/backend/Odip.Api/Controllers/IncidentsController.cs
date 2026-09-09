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
        // IN-5: an Injury incident must record where on the body it happened — mirrors the
        // wizard's own details-step Next-button gate (defense in depth, same idiom as every other
        // rule in this method).
        if (dto.IncidentType == IncidentType.Injury && dto.Injuries.Count == 0)
            return "Please record at least one injury.";
        // IN-4: RestrictivePracticeId (a link to one of the participant's approved/active
        // register entries) and UnapprovedRestrictivePracticeDetails (free text describing a
        // practice that was NOT one of those entries) are mutually exclusive by construction —
        // the wizard's own step schema already enforces "exactly one of the two" client-side, but
        // a modified/malicious client could still send both, which would be an incoherent state
        // (linking an approved entry while also claiming an unapproved one was used). Reject it
        // outright rather than silently picking one side to honour.
        if (dto.RestrictivePracticeId.HasValue && !string.IsNullOrWhiteSpace(dto.UnapprovedRestrictivePracticeDetails))
            return "An incident cannot both link an approved restrictive practice and describe an unapproved one.";
        // IN-7: a nominated staff witness must not be the incident's own reporter — mirrors the
        // medication witness flow's own self-witness rule, adapted to this form's equivalent
        // identity (the reporter, not an "administerer").
        if (dto.Witnesses.Any(w => w.WitnessUserId.HasValue && w.WitnessUserId.Value == dto.ReportedByStaffId))
            return "A staff member cannot witness their own incident report.";
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
    /// IN-7: every nominated staff witness (WitnessUserId set) must resolve to an active User —
    /// same tenant-scoped check as <see cref="IsValidUserRefAsync"/>, applied per-row. Returns an
    /// error message, or null when every row passes.
    /// </summary>
    private async Task<string?> ValidateWitnessesAsync(List<CreateIncidentWitnessDto> witnesses, CancellationToken ct)
    {
        foreach (var w in witnesses)
        {
            if (w.WitnessUserId.HasValue && !await IsValidUserRefAsync(w.WitnessUserId, ct))
                return "One of the nominated staff witnesses was not found.";
        }
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

        // PP-2 follow-up: archiving sets Status = Closed without touching IsActive (see Delete
        // below), so the IsActive filter above no longer keeps archived incidents out of the
        // default list. Exclude Closed by default unless the caller explicitly filters by
        // status — e.g. the Archived tab's explicit ?status=Closed keeps working unchanged.
        if (!status.HasValue)
            query = query.Where(i => i.Status != IncidentStatus.Closed);

        if (tripId.HasValue) query = query.Where(i => i.TripInstanceId == tripId.Value);
        if (status.HasValue) query = query.Where(i => i.Status == status.Value);
        if (severity.HasValue) query = query.Where(i => i.Severity == severity.Value);
        if (qscStatus.HasValue) query = query.Where(i => i.QscReportingStatus == qscStatus.Value);

        // Correctness fix: IncidentDateTime is user-entered (picked in the report form) and
        // trivially collision-prone — two incidents can share the exact same value. With no
        // tiebreaker, SQL makes no ordering guarantee among rows that tie on the only ORDER BY
        // key, so two independent Skip/Take executions (page 1, page 2) can each resolve the tied
        // group differently — a row can land on both pages (duplicate) or neither (vanishes).
        // .Id is a unique Guid primary key, so ThenBy(i => i.Id) makes the total order
        // deterministic and safe to paginate.
        var items = await query.OrderByDescending(i => i.IncidentDateTime).ThenBy(i => i.Id)
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
            .Include(i => i.Injuries)
            .Include(i => i.Witnesses).ThenInclude(w => w.WitnessUser)
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
                UnapprovedRestrictivePracticeDetails = i.UnapprovedRestrictivePracticeDetails,
                IsRestrictivePracticeAuthorised = i.IsRestrictivePracticeAuthorised,
                Description = i.Description,
                ImmediateActionsTaken = i.ImmediateActionsTaken,
                WereEmergencyServicesCalled = i.WereEmergencyServicesCalled,
                EmergencyServicesDetails = i.EmergencyServicesDetails,
                WitnessNames = i.WitnessNames,
                WitnessStatements = i.WitnessStatements,
                Injuries = i.Injuries.Select(inj => new IncidentInjuryDto
                {
                    Id = inj.Id,
                    Region = inj.Region,
                    InjuryType = inj.InjuryType,
                    Description = inj.Description
                }).ToList(),
                Witnesses = i.Witnesses.Select(w => new IncidentWitnessDto
                {
                    Id = w.Id,
                    WitnessUserId = w.WitnessUserId,
                    WitnessName = w.WitnessName,
                    IsStaffWitness = w.WitnessUserId != null,
                    WitnessStatus = w.WitnessStatus,
                    WitnessRequestedAt = w.WitnessRequestedAt,
                    WitnessRespondedAt = w.WitnessRespondedAt,
                    StatementText = w.StatementText,
                }).ToList(),
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
        var witnessError = await ValidateWitnessesAsync(dto.Witnesses, ct);
        if (witnessError != null)
            return BadRequest(ApiResponse<IncidentListDto>.Fail(witnessError));

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
            // IN-4: trimmed, empty->null — never written when a register entry was linked
            // instead (the validation above already rejects both being set).
            UnapprovedRestrictivePracticeDetails = string.IsNullOrWhiteSpace(dto.UnapprovedRestrictivePracticeDetails)
                ? null : dto.UnapprovedRestrictivePracticeDetails.Trim(),
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

        // IN-5: injury rows submitted alongside a new incident are created in the same
        // SaveChangesAsync call as the incident insert below — transactional with it, mirrors
        // ParticipantsController.Create's RiskEntries insert loop.
        foreach (var injury in dto.Injuries)
        {
            _db.IncidentInjuries.Add(new IncidentInjury
            {
                Id = Guid.NewGuid(),
                IncidentReportId = incident.Id,
                Region = injury.Region,
                InjuryType = injury.InjuryType,
                Description = injury.Description.Trim(),
            });
        }

        // IN-7: every witness submitted with a new incident is a fresh row — a staff witness
        // (WitnessUserId set) starts Pending with WitnessRequestedAt stamped now (surfaces on the
        // nominated user's portal witness-requests list); a free-text/external witness has
        // nothing to approve, so it starts NotRequired.
        var now = DateTime.UtcNow;
        foreach (var witness in dto.Witnesses)
        {
            var isStaff = witness.WitnessUserId.HasValue;
            _db.IncidentWitnesses.Add(new IncidentWitness
            {
                Id = Guid.NewGuid(),
                IncidentReportId = incident.Id,
                WitnessUserId = witness.WitnessUserId,
                WitnessName = witness.WitnessName.Trim(),
                WitnessStatus = isStaff ? WitnessStatus.Pending : WitnessStatus.NotRequired,
                WitnessRequestedAt = isStaff ? now : null,
            });
        }

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
        var witnessError = await ValidateWitnessesAsync(dto.Witnesses, ct);
        if (witnessError != null)
            return BadRequest(ApiResponse<IncidentListDto>.Fail(witnessError));

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
        // IN-4: same trim/empty->null rule as Create — still frozen against ever creating a
        // RestrictivePractice register row (no such code path exists here or anywhere else).
        i.UnapprovedRestrictivePracticeDetails = string.IsNullOrWhiteSpace(dto.UnapprovedRestrictivePracticeDetails)
            ? null : dto.UnapprovedRestrictivePracticeDetails.Trim();
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

        // IN-5: full-replace the injuries collection — the form always sends the complete list
        // (same "form owns the full list" contract as RiskEntries), so this is a straightforward
        // delete-all-then-reinsert rather than an id-matched diff (contrast IN-7's
        // IncidentWitness Update, which must preserve already-responded rows).
        var existingInjuries = await _db.IncidentInjuries.Where(x => x.IncidentReportId == id).ToListAsync(ct);
        _db.IncidentInjuries.RemoveRange(existingInjuries);
        foreach (var injury in dto.Injuries)
        {
            _db.IncidentInjuries.Add(new IncidentInjury
            {
                Id = Guid.NewGuid(),
                IncidentReportId = i.Id,
                Region = injury.Region,
                InjuryType = injury.InjuryType,
                Description = injury.Description.Trim(),
            });
        }

        // IN-7: NOT a straightforward full-replace like Injuries above — a witness who has already
        // Approved/Declined carries state the reporter does not own, and resubmitting the full
        // witnesses list must never silently reset it back to Pending. Match incoming rows to
        // existing ones by Id: a row with no Id (or an Id that doesn't match anything persisted) is
        // a newly-added witness, inserted fresh exactly like Create does; a row matched by Id keeps
        // its existing WitnessStatus/WitnessRequestedAt/WitnessRespondedAt/StatementText untouched —
        // only WitnessName is updatable (mirrors the medication amend flow's "amending only edits
        // the legacy free-text name" convention). A persisted row whose Id is absent from the
        // submitted list has been deliberately removed by the reporter and is deleted.
        var existingWitnesses = await _db.IncidentWitnesses.Where(x => x.IncidentReportId == id).ToListAsync(ct);
        var submittedIds = dto.Witnesses.Where(w => w.Id.HasValue).Select(w => w.Id!.Value).ToHashSet();
        var toDelete = existingWitnesses.Where(x => !submittedIds.Contains(x.Id)).ToList();
        _db.IncidentWitnesses.RemoveRange(toDelete);

        var updateNow = DateTime.UtcNow;
        foreach (var witness in dto.Witnesses)
        {
            var existing = witness.Id.HasValue ? existingWitnesses.FirstOrDefault(x => x.Id == witness.Id.Value) : null;
            if (existing != null)
            {
                // Matched by id — preserve everything but the display name.
                existing.WitnessName = witness.WitnessName.Trim();
            }
            else
            {
                var isStaff = witness.WitnessUserId.HasValue;
                _db.IncidentWitnesses.Add(new IncidentWitness
                {
                    Id = Guid.NewGuid(),
                    IncidentReportId = i.Id,
                    WitnessUserId = witness.WitnessUserId,
                    WitnessName = witness.WitnessName.Trim(),
                    WitnessStatus = isStaff ? WitnessStatus.Pending : WitnessStatus.NotRequired,
                    WitnessRequestedAt = isStaff ? updateNow : null,
                });
            }
        }

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
        // PP-2: status-only lifecycle, matching TasksDashboardController's archive pattern —
        // IsActive is left untouched so GetAll's default `isActive == true` filter doesn't hide
        // archived incidents, and the Archived tab (status=Closed) plus Restore (status=Draft)
        // both operate purely on Status.
        i.Status = IncidentStatus.Closed;
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
