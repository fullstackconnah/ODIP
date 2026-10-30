using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Complaints;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The complaints register. A complaint names people, so every route (reads included) is for SuperAdmin, Admin and Coordinator only: the class carries the
/// roles, SupportWorker is refused by them and ReadOnly by them as well (its writes also by ReadOnlyMiddleware). Never hard-deleted: archive and restore.
/// Nothing here contacts the NDIS Commission; "told about the Commission" is a record the staff member keeps.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/complaints")]
public class ComplaintsController : ControllerBase
{
    private const int SummaryMax = 4000;
    private const int NameMax = 200;
    private const string ChangedByOther = "Someone else just changed this complaint, so your changes weren't saved. Open it again to see theirs.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;

    public ComplaintsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The organisation's calendar date now. A SuperAdmin with no organisation chosen reads the first settings row (cross-organisation list: accepted, the figure can be a day off).</summary>
    private Task<DateOnly> TodayAsync(CancellationToken ct) =>
        _tenant.TenantId is Guid tenantId
            ? ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct)
            : ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ComplaintListDto>>>> List(
        [FromQuery] ComplaintStatus? status, [FromQuery] bool? longOpen, [FromQuery] string? search, [FromQuery] bool? isActive,
        [FromQuery] int page = 1, [FromQuery] int pageSize = PagingParams.DefaultPageSize, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var today = await TodayAsync(ct);

        var query = _db.Complaints.AsQueryable();
        query = isActive == false ? query.Where(c => !c.IsActive) : query.Where(c => c.IsActive);
        if (status.HasValue) query = query.Where(c => c.Status == status.Value);
        if (longOpen == true) query = query.Where(ComplaintAge.IsOpenLongerThanExpr(today));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            // Anonymous rows have no participant, so every participant read is null-guarded (EF InMemory throws otherwise).
            query = query.Where(c => c.Summary.ToLower().Contains(term)
                || (c.ComplainantName != null && c.ComplainantName.ToLower().Contains(term))
                || (c.Participant != null && (c.Participant.FirstName + " " + c.Participant.LastName).ToLower().Contains(term))
                || (c.Participant != null && c.Participant.PreferredName != null && c.Participant.PreferredName.ToLower().Contains(term)));
        }

        // Open and Investigating first, oldest first; then the rest, newest closed first (a Resolved row has no ClosedOn, so it falls back to ReceivedOn).
        // Null-free keys, so Npgsql (NULLs first in DESC) and InMemory order alike; CreatedAt then Id make paging deterministic.
        var ordered = query
            .OrderBy(c => c.Status == ComplaintStatus.Open || c.Status == ComplaintStatus.Investigating ? 0 : 1)
            .ThenBy(c => c.Status == ComplaintStatus.Open || c.Status == ComplaintStatus.Investigating ? c.ReceivedOn : DateOnly.MaxValue)
            .ThenByDescending(c => c.ClosedOn ?? c.ReceivedOn)
            .ThenBy(c => c.CreatedAt)
            .ThenBy(c => c.Id)
            .Select(c => new ListRow(c.Id, c.ReceivedOn, c.Channel, c.ComplainantKind, c.ComplainantName, c.Participant == null ? null : c.Participant.FirstName, c.Participant == null ? null : c.Participant.PreferredName, c.Participant == null ? null : c.Participant.LastName, c.Summary, c.Status, c.AcknowledgedOn, c.IsActive, c.UpdatedAt));

        var paged = await PagedResult<ListRow>.CreateAsync(ordered, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<ComplaintListDto>>.Ok(new PagedResult<ComplaintListDto>
        {
            Items = paged.Items.Select(r => new ComplaintListDto
            {
                Id = r.Id, ReceivedOn = r.ReceivedOn, Channel = r.Channel, ComplainantKind = r.ComplainantKind,
                ComplainantName = r.ComplainantName,
                ParticipantName = r.ParticipantLast == null ? null : PersonName(r.ParticipantFirst, r.ParticipantPreferred, r.ParticipantLast),
                Summary = r.Summary.Length > 200 ? r.Summary[..200] : r.Summary,
                Status = r.Status, OpenDays = ComplaintAge.OpenDays(r.Status, r.ReceivedOn, today),
                AcknowledgedOn = r.AcknowledgedOn, IsActive = r.IsActive, UpdatedAt = r.UpdatedAt,
            }).ToList(),
            TotalCount = paged.TotalCount, Page = paged.Page, PageSize = paged.PageSize,
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<ComplaintDto>>> Get(Guid id, CancellationToken ct)
    {
        var complaint = await LoadAsync(id, ct);
        if (complaint == null) return NotFound(ApiResponse<ComplaintDto>.Fail("Complaint not found"));
        return Ok(ApiResponse<ComplaintDto>.Ok(ToDto(complaint, await TodayAsync(ct))));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<ComplaintDto>>> Create([FromBody] SaveComplaintDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ComplaintDto>.Fail("A tenant context is required."));
        var today = await TodayAsync(ct);
        var error = await ValidateAsync(dto, tenantId, today, ct);
        if (error != null) return BadRequest(ApiResponse<ComplaintDto>.Fail(error));

        // A new complaint always starts Open, so the form's status (if any) and a closing date are ignored.
        var complaint = new Complaint { Id = Guid.NewGuid(), TenantId = tenantId, Status = ComplaintStatus.Open };
        Apply(complaint, dto);
        complaint.ClosedOn = null;
        _db.Complaints.Add(complaint);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ComplaintDto>.Ok(ToDto((await LoadAsync(complaint.Id, ct))!, today)));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ApiResponse<ComplaintDto>>> Update(Guid id, [FromBody] SaveComplaintDto dto, CancellationToken ct)
    {
        var complaint = await _db.Complaints.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (complaint == null) return NotFound(ApiResponse<ComplaintDto>.Fail("Complaint not found"));
        // A form from an older tab sends no version and saves as before. A stale one is refused first; the concurrency token is the backstop for a racing save.
        if (dto.ExpectedUpdatedAt is DateTime expected && expected != complaint.UpdatedAt)
            return Conflict(ApiResponse<ComplaintDto>.Fail(ChangedByOther));
        if (!complaint.IsActive) return BadRequest(ApiResponse<ComplaintDto>.Fail("This complaint is archived. Restore it to change it."));

        var today = await TodayAsync(ct);
        var error = await ValidateAsync(dto, complaint.TenantId, today, ct);
        if (error != null) return BadRequest(ApiResponse<ComplaintDto>.Fail(error));

        Apply(complaint, dto);
        complaint.UpdatedAt = DateTime.UtcNow;
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(ApiResponse<ComplaintDto>.Fail(ChangedByOther));
        }
        return Ok(ApiResponse<ComplaintDto>.Ok(ToDto((await LoadAsync(id, ct))!, today)));
    }

    [HttpPost("{id:guid}/archive")]
    public Task<ActionResult<ApiResponse<ComplaintDto>>> Archive(Guid id, CancellationToken ct) => SetActiveAsync(id, false, ct);

    [HttpPost("{id:guid}/restore")]
    public Task<ActionResult<ApiResponse<ComplaintDto>>> Restore(Guid id, CancellationToken ct) => SetActiveAsync(id, true, ct);

    private async Task<ActionResult<ApiResponse<ComplaintDto>>> SetActiveAsync(Guid id, bool active, CancellationToken ct)
    {
        var complaint = await _db.Complaints.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (complaint == null) return NotFound(ApiResponse<ComplaintDto>.Fail("Complaint not found"));
        if (complaint.IsActive != active)
        {
            complaint.IsActive = active;
            complaint.UpdatedAt = DateTime.UtcNow;
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict(ApiResponse<ComplaintDto>.Fail(ChangedByOther));
            }
        }
        return Ok(ApiResponse<ComplaintDto>.Ok(ToDto((await LoadAsync(id, ct))!, await TodayAsync(ct))));
    }

    private Task<Complaint?> LoadAsync(Guid id, CancellationToken ct) =>
        _db.Complaints.Include(c => c.Participant).Include(c => c.HandledBy).Include(c => c.IncidentReport)
            .FirstOrDefaultAsync(c => c.Id == id, ct);

    private static void Apply(Complaint c, SaveComplaintDto dto)
    {
        c.ReceivedOn = dto.ReceivedOn;
        c.Channel = dto.Channel;
        c.ComplainantKind = dto.ComplainantKind;
        c.ParticipantId = dto.ParticipantId;
        c.ComplainantName = Blank(dto.ComplainantName);
        c.Summary = dto.Summary!.Trim();
        c.Status = dto.Status;
        c.AcknowledgedOn = dto.AcknowledgedOn;
        c.ActionsTaken = Blank(dto.ActionsTaken);
        c.Outcome = Blank(dto.Outcome);
        c.OutcomeCommunicatedOn = dto.OutcomeCommunicatedOn;
        c.ToldAboutCommission = dto.ToldAboutCommission;
        c.ToldAboutCommissionOn = dto.ToldAboutCommission ? dto.ToldAboutCommissionOn : null;
        c.ClosedOn = dto.ClosedOn;
        c.HandledByUserId = dto.HandledByUserId;
        c.IncidentReportId = dto.IncidentReportId;
    }

    /// <summary>The first problem with a save, in the wording the form shows, or null. Dates are checked against the organisation's today.</summary>
    private async Task<string?> ValidateAsync(SaveComplaintDto dto, Guid tenantId, DateOnly today, CancellationToken ct)
    {
        var summary = dto.Summary?.Trim();
        if (string.IsNullOrEmpty(summary)) return "Describe the complaint.";
        if (summary.Length > SummaryMax) return "Keep it to 4,000 characters.";
        if (Blank(dto.ComplainantName) is { Length: > NameMax }) return "Keep the name to 200 characters.";
        if (Blank(dto.ActionsTaken) is { Length: > SummaryMax } || Blank(dto.Outcome) is { Length: > SummaryMax }) return "Keep it to 4,000 characters.";
        if (!Enum.IsDefined(dto.Channel) || !Enum.IsDefined(dto.ComplainantKind) || !Enum.IsDefined(dto.Status)) return "Choose an option from the list.";

        if (dto.ComplainantKind == ComplainantKind.Anonymous && (dto.ParticipantId.HasValue || Blank(dto.ComplainantName) != null))
            return "Anonymous complaints keep no name and no participant.";
        if (dto.ComplainantKind == ComplainantKind.Participant && !dto.ParticipantId.HasValue) return "Choose the participant.";

        // Every filter is bypassed by a SuperAdmin, so a link is checked against the complaint's own organisation here, not left to the filter.
        if (dto.ParticipantId is Guid participantId
            && !await _db.Participants.AnyAsync(p => p.Id == participantId && p.TenantId == tenantId, ct))
            return "That participant isn't in this organisation.";
        if (dto.IncidentReportId is Guid incidentId
            && !await _db.IncidentReports.AnyAsync(i => i.Id == incidentId && i.TenantId == tenantId, ct))
            return "That incident isn't in this organisation.";
        if (dto.HandledByUserId is Guid userId
            && !await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == tenantId && u.IsActive, ct))
            return "That staff member isn't in this organisation.";

        if (dto.ReceivedOn > today) return "The date can't be in the future.";
        foreach (var later in new[] { dto.AcknowledgedOn, dto.OutcomeCommunicatedOn, dto.ToldAboutCommissionOn, dto.ClosedOn })
        {
            if (later is not DateOnly d) continue;
            if (d > today) return "The date can't be in the future.";
            if (d < dto.ReceivedOn) return "That date can't be before the complaint was received.";
        }
        if (dto.ToldAboutCommission && !dto.ToldAboutCommissionOn.HasValue) return "Add the date they were told.";
        // POST starts every complaint Open, so only an edit can close one.
        if (dto.Status == ComplaintStatus.Closed && !dto.ClosedOn.HasValue) return "Add the date it was closed.";
        if (dto.Status != ComplaintStatus.Closed && dto.ClosedOn.HasValue) return "Only a closed complaint has a closing date.";
        return null;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string PersonName(string first, string? preferred, string last) =>
        $"{(string.IsNullOrWhiteSpace(preferred) ? first : preferred)} {last}".Trim();

    private static ComplaintDto ToDto(Complaint c, DateOnly today) => new()
    {
        Id = c.Id, ReceivedOn = c.ReceivedOn, Channel = c.Channel, ComplainantKind = c.ComplainantKind,
        ParticipantId = c.ParticipantId, ParticipantName = c.Participant?.FullName, ComplainantName = c.ComplainantName,
        Summary = c.Summary, Status = c.Status, AcknowledgedOn = c.AcknowledgedOn, ActionsTaken = c.ActionsTaken, Outcome = c.Outcome,
        OutcomeCommunicatedOn = c.OutcomeCommunicatedOn, ToldAboutCommission = c.ToldAboutCommission, ToldAboutCommissionOn = c.ToldAboutCommissionOn,
        ClosedOn = c.ClosedOn, HandledByUserId = c.HandledByUserId, HandledByName = c.HandledBy?.FullName,
        IncidentReportId = c.IncidentReportId, IncidentReportTitle = c.IncidentReport?.Title,
        OpenDays = ComplaintAge.OpenDays(c.Status, c.ReceivedOn, today),
        IsActive = c.IsActive, CreatedAt = c.CreatedAt, UpdatedAt = c.UpdatedAt,
    };

    private sealed record ListRow(Guid Id, DateOnly ReceivedOn, ComplaintChannel Channel, ComplainantKind ComplainantKind, string? ComplainantName,
        string? ParticipantFirst, string? ParticipantPreferred, string? ParticipantLast, string Summary, ComplaintStatus Status,
        DateOnly? AcknowledgedOn, bool IsActive, DateTime UpdatedAt);
}
