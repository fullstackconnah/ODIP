using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Admin half of the caregiver profile form: issue and revoke links, list and review
/// submissions, accept (apply via ParticipantPatchApplier) or reject (reopen the link).
/// Role gate matches PATCH /participants/{id}. Tenant scoping comes from the ambient query
/// filter — a wrong-tenant participant or submission simply isn't found.
/// </summary>
[ApiController]
[Route("api/v1/caregiver-submissions")]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
public class CaregiverSubmissionsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly int _expiryDays;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ParticipantPatchApplier.ApplyAsync also needs a StaffCompatibilityLinkService (the plan's
    // quoted constructor omitted it, but Patch's moved body calls
    // compatLink.SyncFromParticipantPreferredStaffAsync when the PreferredStaff group is
    // present) — threaded through here the same way _safetyNoteSync is, so a caregiver payload
    // that touches PreferredStaff still syncs the rostering compatibility matrix on accept.
    public CaregiverSubmissionsController(OdipDbContext db, ICurrentTenant tenant, SafetyNoteSyncService safetyNoteSync, StaffCompatibilityLinkService compatLink, IConfiguration config)
    {
        _db = db;
        _tenant = tenant;
        _safetyNoteSync = safetyNoteSync;
        _compatLink = compatLink;
        _expiryDays = config.GetValue<int?>("Caregiver:LinkExpiryDays") ?? 14;
    }

    private Guid CurrentUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return Guid.TryParse(raw, out var id) ? id : Guid.Empty;
    }

    // ── Links ──────────────────────────────────────────────

    [HttpPost("/api/v1/participants/{participantId:guid}/caregiver-link")]
    public async Task<ActionResult<ApiResponse<CaregiverLinkDto>>> CreateLink(Guid participantId, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (p == null) return NotFound(ApiResponse<CaregiverLinkDto>.Fail("Participant not found"));

        var active = await _db.CaregiverProfileSubmissions
            .Where(s => s.ParticipantId == participantId
                && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted))
            .ToListAsync(ct);
        foreach (var a in active) a.Status = CaregiverSubmissionStatus.Revoked;

        var raw = CaregiverTokenService.GenerateRawToken();
        var sub = new CaregiverProfileSubmission
        {
            Id = Guid.NewGuid(),
            TenantId = p.TenantId,
            ParticipantId = p.Id,
            TokenHash = CaregiverTokenService.Hash(raw),
            Status = CaregiverSubmissionStatus.Draft,
            CreatedByUserId = CurrentUserId(),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(_expiryDays),
        };
        _db.CaregiverProfileSubmissions.Add(sub);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<CaregiverLinkDto>.Ok(new CaregiverLinkDto { Token = raw, ExpiresAt = sub.ExpiresAt }));
    }

    [HttpDelete("/api/v1/participants/{participantId:guid}/caregiver-link")]
    public async Task<IActionResult> RevokeLink(Guid participantId, CancellationToken ct)
    {
        var active = await _db.CaregiverProfileSubmissions
            .Where(s => s.ParticipantId == participantId
                && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted))
            .ToListAsync(ct);
        if (active.Count == 0) return NotFound(ApiResponse<object>.Fail("No active caregiver link"));
        foreach (var a in active) a.Status = CaregiverSubmissionStatus.Revoked;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ── Submissions ────────────────────────────────────────

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<CaregiverSubmissionListItemDto>>>> List([FromQuery] CaregiverSubmissionStatus? status, CancellationToken ct)
    {
        var effective = status ?? CaregiverSubmissionStatus.Submitted;
        var rows = await _db.CaregiverProfileSubmissions
            .Include(s => s.Participant)
            .Where(s => s.Status == effective)
            .OrderByDescending(s => s.SubmittedAt ?? s.CreatedAt)
            .Select(s => new CaregiverSubmissionListItemDto
            {
                Id = s.Id, ParticipantId = s.ParticipantId,
                ParticipantName = s.Participant.FirstName + " " + s.Participant.LastName,
                Status = s.Status, CaregiverName = s.CaregiverName,
                CreatedAt = s.CreatedAt, ExpiresAt = s.ExpiresAt, SubmittedAt = s.SubmittedAt,
            })
            .ToListAsync(ct);
        return Ok(ApiResponse<List<CaregiverSubmissionListItemDto>>.Ok(rows));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<CaregiverSubmissionDetailDto>>> Get(Guid id, CancellationToken ct)
    {
        var s = await _db.CaregiverProfileSubmissions.Include(x => x.Participant).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<CaregiverSubmissionDetailDto>.Fail("Submission not found"));

        var dto = new CaregiverSubmissionDetailDto
        {
            Id = s.Id, ParticipantId = s.ParticipantId,
            ParticipantName = s.Participant.FirstName + " " + s.Participant.LastName,
            Status = s.Status, CaregiverName = s.CaregiverName, CaregiverRelationship = s.CaregiverRelationship,
            CreatedAt = s.CreatedAt, ExpiresAt = s.ExpiresAt, SubmittedAt = s.SubmittedAt,
            ReviewedAt = s.ReviewedAt, RejectionNote = s.RejectionNote,
            Current = BuildProjection(s.Participant),
            Payload = s.Payload is null ? null : JsonSerializer.Deserialize<PatchParticipantDto>(s.Payload, Json),
        };
        return Ok(ApiResponse<CaregiverSubmissionDetailDto>.Ok(dto));
    }

    [HttpPost("{id:guid}/accept")]
    public async Task<IActionResult> Accept(Guid id, CancellationToken ct)
    {
        var s = await _db.CaregiverProfileSubmissions.Include(x => x.Participant).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<object>.Fail("Submission not found"));
        if (s.Status != CaregiverSubmissionStatus.Submitted)
            return Conflict(ApiResponse<object>.Fail("Only a submitted form can be accepted."));
        if (s.Payload is null)
            return BadRequest(ApiResponse<object>.Fail("This submission has no content."));

        var payload = JsonSerializer.Deserialize<PatchParticipantDto>(s.Payload, Json) ?? new PatchParticipantDto();
        payload = Sanitise(payload, s.Participant);   // cg02 Task 12 implements; identity for now

        var error = await ParticipantPatchApplier.ApplyAsync(_db, _safetyNoteSync, _compatLink, s.Participant, payload, ct);
        if (error != null) return BadRequest(ApiResponse<object>.Fail(error));

        s.Status = CaregiverSubmissionStatus.Accepted;
        s.ReviewedByUserId = CurrentUserId();
        s.ReviewedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/reject")]
    public async Task<IActionResult> Reject(Guid id, [FromBody] RejectCaregiverSubmissionDto body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Note))
            return BadRequest(ApiResponse<object>.Fail("A note explaining what to fix is required."));
        var s = await _db.CaregiverProfileSubmissions.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<object>.Fail("Submission not found"));
        if (s.Status != CaregiverSubmissionStatus.Submitted)
            return Conflict(ApiResponse<object>.Fail("Only a submitted form can be rejected."));

        s.Status = CaregiverSubmissionStatus.Draft;
        s.SubmittedAt = null;
        s.RejectionNote = body.Note.Trim();
        s.ReviewedByUserId = CurrentUserId();
        s.ReviewedAt = DateTime.UtcNow;
        s.ExpiresAt = DateTime.UtcNow.AddDays(_expiryDays);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    // cg02 (Tasks 11–12) replaces both of these with CaregiverFieldPolicy.
    private static System.Text.Json.Nodes.JsonObject BuildProjection(Participant p) => new();
    private static PatchParticipantDto Sanitise(PatchParticipantDto dto, Participant p) => dto;
}
