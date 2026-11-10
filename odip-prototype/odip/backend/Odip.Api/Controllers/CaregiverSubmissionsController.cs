using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Services;
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

    private const string WaitingForReview = "A caregiver form is waiting for review. Accept or decline it before sending a new link.";
    private const string LinkJustSent = "Another coordinator just sent a link for this participant. Reload and try again.";

    [HttpPost("/api/v1/participants/{participantId:guid}/caregiver-link")]
    public async Task<ActionResult<ApiResponse<CaregiverLinkDto>>> CreateLink(Guid participantId, CancellationToken ct)
    {
        var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (p == null) return NotFound(ApiResponse<CaregiverLinkDto>.Fail("Participant not found"));
        // The public form refuses an archived participant's link (the dead-link page), so none is issued.
        if (!p.IsActive) return BadRequest(ApiResponse<CaregiverLinkDto>.Fail("This participant is archived. Restore them before sending a caregiver link."));

        // A new link would revoke the pending answers (they drop off the review list and Accept returns 409): make the reviewer decide first.
        if (await _db.CaregiverProfileSubmissions.AnyAsync(s => s.ParticipantId == participantId && s.Status == CaregiverSubmissionStatus.Submitted, ct))
            return Conflict(ApiResponse<CaregiverLinkDto>.Fail(WaitingForReview));

        // Claim each Draft in one statement, so a caregiver Submit that commits meanwhile is never overwritten (409, the transaction rolls back); the tracked save keeps the audit row.
        await using var tx = _db.Database.IsRelational() ? await _db.Database.BeginTransactionAsync(ct) : null;
        var drafts = await _db.CaregiverProfileSubmissions
            .Where(s => s.ParticipantId == participantId && s.Status == CaregiverSubmissionStatus.Draft)
            .ToListAsync(ct);
        foreach (var a in drafts)
        {
            // A lost claim is a caregiver Submit (a form now waits) or another coordinator's link that took the Draft (nothing waits).
            if (!await ClaimAsync(a.Id, CaregiverSubmissionStatus.Draft, CaregiverSubmissionStatus.Revoked, ct))
                return Conflict(ApiResponse<CaregiverLinkDto>.Fail(await _db.CaregiverProfileSubmissions.AnyAsync(s => s.ParticipantId == participantId && s.Status == CaregiverSubmissionStatus.Submitted, ct) ? WaitingForReview : LinkJustSent));
            a.Status = CaregiverSubmissionStatus.Revoked;
        }
        if (await _db.CaregiverProfileSubmissions.AnyAsync(s => s.ParticipantId == participantId && s.Status == CaregiverSubmissionStatus.Submitted, ct))
            return Conflict(ApiResponse<CaregiverLinkDto>.Fail(WaitingForReview));

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
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        // The only insert in this save is the new link, so a unique violation is the one-active-link index: another coordinator's link committed since the checks above. Nothing is kept (no commit).
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict(ApiResponse<CaregiverLinkDto>.Fail(LinkJustSent));
        }
        if (tx != null) await tx.CommitAsync(ct);

        return Ok(ApiResponse<CaregiverLinkDto>.Ok(new CaregiverLinkDto { Token = raw, ExpiresAt = sub.ExpiresAt }));
    }

    [HttpDelete("/api/v1/participants/{participantId:guid}/caregiver-link")]
    public async Task<IActionResult> RevokeLink(Guid participantId, CancellationToken ct)
    {
        // Claim each row in one statement, so a form an Accept just moved on is never overwritten with Revoked; the tracked save keeps the audit row.
        await using var tx = _db.Database.IsRelational() ? await _db.Database.BeginTransactionAsync(ct) : null;
        var rows = await _db.CaregiverProfileSubmissions
            .Where(s => s.ParticipantId == participantId && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted))
            .ToListAsync(ct);
        var claimed = 0;
        foreach (var a in rows)
        {
            if (_db.Database.IsRelational() && await _db.CaregiverProfileSubmissions
                    .Where(x => x.Id == a.Id && (x.Status == CaregiverSubmissionStatus.Draft || x.Status == CaregiverSubmissionStatus.Submitted))
                    .ExecuteUpdateAsync(u => u.SetProperty(x => x.Status, CaregiverSubmissionStatus.Revoked), ct) == 0) continue;
            a.Status = CaregiverSubmissionStatus.Revoked;
            claimed++;
        }
        if (claimed == 0) return NotFound(ApiResponse<object>.Fail("No active caregiver link"));
        await _db.SaveChangesAsync(ct);
        if (tx != null) await tx.CommitAsync(ct);
        return NoContent();
    }

    // ── Submissions ────────────────────────────────────────

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<CaregiverSubmissionListItemDto>>>> List([FromQuery] CaregiverSubmissionStatus? status, CancellationToken ct, [FromQuery] Guid? participantId = null)
    {
        var effective = status ?? CaregiverSubmissionStatus.Submitted;
        var rows = await _db.CaregiverProfileSubmissions
            .Include(s => s.Participant)
            .Where(s => s.Status == effective && (participantId == null || s.ParticipantId == participantId))
            .OrderByDescending(s => s.SubmittedAt ?? s.CreatedAt)
            .Select(s => new CaregiverSubmissionListItemDto
            {
                Id = s.Id, ParticipantId = s.ParticipantId,
                ParticipantName = (s.Participant.FirstName + " " + s.Participant.LastName).Trim(),
                Status = s.Status, CaregiverName = s.CaregiverName,
                CreatedAt = s.CreatedAt, ExpiresAt = s.ExpiresAt, SubmittedAt = s.SubmittedAt,
            })
            .ToListAsync(ct);
        return Ok(ApiResponse<List<CaregiverSubmissionListItemDto>>.Ok(rows));
    }

    private IQueryable<CaregiverProfileSubmission> WithParticipant() => _db.CaregiverProfileSubmissions
            .Include(x => x.Participant).ThenInclude(p => p.PreferredUser)
            .Include(x => x.Participant).ThenInclude(p => p.RestrictivePractices)
            .Include(x => x.Participant).ThenInclude(p => p.Consents)
            .Include(x => x.Participant).ThenInclude(p => p.HealthConditions)
            .Include(x => x.Participant).ThenInclude(p => p.AdlAssessments)
            .Include(x => x.Participant).ThenInclude(p => p.ChecklistItems)
            .Include(x => x.Participant).ThenInclude(p => p.CommunityAccessRiskItems);

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<CaregiverSubmissionDetailDto>>> Get(Guid id, CancellationToken ct)
    {
        var s = await WithParticipant().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<CaregiverSubmissionDetailDto>.Fail("Submission not found"));

        var dto = new CaregiverSubmissionDetailDto
        {
            Id = s.Id, ParticipantId = s.ParticipantId,
            ParticipantName = (s.Participant.FirstName + " " + s.Participant.LastName).Trim(),
            Status = s.Status, CaregiverName = s.CaregiverName, CaregiverRelationship = s.CaregiverRelationship,
            CreatedAt = s.CreatedAt, ExpiresAt = s.ExpiresAt, SubmittedAt = s.SubmittedAt,
            ReviewedAt = s.ReviewedAt, RejectionNote = s.RejectionNote,
            Current = await BuildProjectionAsync(s.Participant, ct),
            Payload = s.Payload is null ? null : JsonSerializer.Deserialize<PatchParticipantDto>(s.Payload, Json),
            Base = s.BasePayload is null ? null : JsonSerializer.Deserialize<PatchParticipantDto>(s.BasePayload, Json),
        };
        return Ok(ApiResponse<CaregiverSubmissionDetailDto>.Ok(dto));
    }

    [HttpPost("{id:guid}/accept")]
    public async Task<IActionResult> Accept(Guid id, CancellationToken ct)
    {
        var s = await WithParticipant().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<object>.Fail("Submission not found"));
        if (s.Status != CaregiverSubmissionStatus.Submitted)
            return Conflict(ApiResponse<object>.Fail("Only a submitted form can be accepted."));
        if (s.Payload is null)
            return BadRequest(ApiResponse<object>.Fail("This submission has no content."));

        // Allow-list before the merge: a crafted group (ndisPlan) must not reach it, since the projection lacks that group's internal members.
        var payload = CaregiverFieldPolicy.Sanitise(JsonSerializer.Deserialize<PatchParticipantDto>(s.Payload, Json) ?? new PatchParticipantDto(), s.Participant);
        // A stored base means apply only what the caregiver changed from it; without one (sent before change tracking) the whole payload applies.
        if (s.BasePayload is not null)
        {
            var baseDto = CaregiverFieldPolicy.Sanitise(JsonSerializer.Deserialize<PatchParticipantDto>(s.BasePayload, Json) ?? new PatchParticipantDto(), s.Participant);
            payload = CaregiverFieldPolicy.MergeAgainstBase(await BuildProjectionAsync(s.Participant, ct), payload, baseDto);
        }
        payload = CaregiverFieldPolicy.Sanitise(payload, s.Participant);

        // Claim the row first (Submitted to Accepted in one statement) so a racing Accept or Reject loses with 409; any failure below disposes the transaction and the claim goes with it.
        await using var tx = _db.Database.IsRelational() ? await _db.Database.BeginTransactionAsync(ct) : null;
        if (!await ClaimAsync(id, CaregiverSubmissionStatus.Submitted, CaregiverSubmissionStatus.Accepted, ct)) return AlreadyHandled();

        var error = await ParticipantPatchApplier.ApplyAsync(_db, _safetyNoteSync, _compatLink, s.Participant, payload, null, ct);
        if (error != null) return BadRequest(ApiResponse<object>.Fail(error));

        s.Status = CaregiverSubmissionStatus.Accepted;
        s.ReviewedByUserId = CurrentUserId();
        s.ReviewedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        if (tx != null) await tx.CommitAsync(ct);
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

        await using var tx = _db.Database.IsRelational() ? await _db.Database.BeginTransactionAsync(ct) : null;
        if (!await ClaimAsync(id, CaregiverSubmissionStatus.Submitted, CaregiverSubmissionStatus.Draft, ct)) return AlreadyHandled();

        s.Status = CaregiverSubmissionStatus.Draft;
        s.SubmittedAt = null;
        s.RejectionNote = body.Note.Trim();
        s.ReviewedByUserId = CurrentUserId();
        s.ReviewedAt = DateTime.UtcNow;
        s.ExpiresAt = DateTime.UtcNow.AddDays(_expiryDays);
        await _db.SaveChangesAsync(ct);
        if (tx != null) await tx.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>Compare-and-set on the status: only one caller moves a form on from the given status. EF InMemory (the unit tests) has no ExecuteUpdate and no concurrent callers, so the earlier status check stands alone there.</summary>
    private async Task<bool> ClaimAsync(Guid id, CaregiverSubmissionStatus from, CaregiverSubmissionStatus to, CancellationToken ct) =>
        !_db.Database.IsRelational()
        || await _db.CaregiverProfileSubmissions.Where(x => x.Id == id && x.Status == from)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.Status, to), ct) == 1;

    private ObjectResult AlreadyHandled() => Conflict(ApiResponse<object>.Fail("This form was already handled by someone else. It has been refreshed."));

    private async Task<JsonObject> BuildProjectionAsync(Participant p, CancellationToken ct) =>
        CaregiverFieldPolicy.BuildProjection(await ParticipantDetailMapper.ToDetailDtoAsync(_db, p, ct));
}
