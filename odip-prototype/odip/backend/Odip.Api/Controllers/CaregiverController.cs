using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The caregiver-facing half of the caregiver profile form. NO class-level [Authorize] — these
/// routes are reached by a family member with no ODIP account, authenticated solely by the link
/// token. Tenant and participant resolve from the token row: this controller never reads
/// ICurrentTenant (which is built from JWT claims/headers and is empty here) and never honours
/// X-View-As-*. Every failure is a 404 so a probing caller cannot distinguish "no such token"
/// from "expired", "revoked", "already accepted" or "another tenant's".
/// See docs/specs/2026-09-03-caregiver-profile-form-design.md §2.
/// </summary>
[ApiController]
[Route("api/v1/public/caregiver")]
[EnableRateLimiting("public")]
public class CaregiverController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IHttpContextAccessor _http;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public CaregiverController(OdipDbContext db, IHttpContextAccessor http)
    {
        _db = db;
        _http = http;
    }

    private const string NotFoundMessage = "This link is not valid.";

    /// <summary>The one lookup. Existence, liveness, expiry and participant presence all in one query.</summary>
    private async Task<(CaregiverProfileSubmission sub, Participant p)?> ResolveLiveAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var hash = CaregiverTokenService.Hash(token);
        var now = DateTime.UtcNow;
        var sub = await _db.CaregiverProfileSubmissions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TokenHash == hash
                && (s.Status == CaregiverSubmissionStatus.Draft || s.Status == CaregiverSubmissionStatus.Submitted)
                && s.ExpiresAt > now, ct);
        if (sub == null) return null;

        var p = await _db.Participants
            .IgnoreQueryFilters()
            .Include(x => x.PreferredUser)
            .Include(x => x.RestrictivePractices)
            .Include(x => x.Consents)
            .Include(x => x.HealthConditions)
            .Include(x => x.AdlAssessments)
            .Include(x => x.ChecklistItems)
            .Include(x => x.CommunityAccessRiskItems)
            .FirstOrDefaultAsync(x => x.Id == sub.ParticipantId && x.TenantId == sub.TenantId, ct);
        if (p == null) return null;
        return (sub, p);
    }

    [HttpGet("{token}")]
    public async Task<ActionResult<ApiResponse<CaregiverFormDto>>> Get(string token, CancellationToken ct)
    {
        var live = await ResolveLiveAsync(token, ct);
        if (live is null) return NotFound(ApiResponse<CaregiverFormDto>.Fail(NotFoundMessage));
        var (sub, p) = live.Value;

        var dto = new CaregiverFormDto
        {
            Status = sub.Status,
            CaregiverName = sub.CaregiverName,
            CaregiverRelationship = sub.CaregiverRelationship,
            ExpiresAt = sub.ExpiresAt,
            RejectionNote = sub.RejectionNote,
            Current = await BuildProjectionAsync(p, ct),
            Editable = EditableFields(),
            Draft = sub.Payload is null ? null : JsonSerializer.Deserialize<PatchParticipantDto>(sub.Payload, Json),
        };
        return Ok(ApiResponse<CaregiverFormDto>.Ok(dto));
    }

    [HttpPut("{token}/draft")]
    public Task<IActionResult> SaveDraft(string token, [FromBody] CaregiverDraftDto body, CancellationToken ct)
        => WriteAsync(token, body, submit: false, ct);

    [HttpPost("{token}/submit")]
    public Task<IActionResult> Submit(string token, [FromBody] CaregiverDraftDto body, CancellationToken ct)
        => WriteAsync(token, body, submit: true, ct);

    private async Task<IActionResult> WriteAsync(string token, CaregiverDraftDto body, bool submit, CancellationToken ct)
    {
        var live = await ResolveLiveAsync(token, ct);
        if (live is null) return NotFound(ApiResponse<object>.Fail(NotFoundMessage));
        var (sub, _) = live.Value;

        if (string.IsNullOrWhiteSpace(body.CaregiverName))
            return BadRequest(ApiResponse<object>.Fail("Please enter your name before continuing."));
        if (sub.Status != CaregiverSubmissionStatus.Draft)
            return Conflict(ApiResponse<object>.Fail("This form has already been submitted and is awaiting review."));

        sub.CaregiverName = body.CaregiverName.Trim();
        sub.CaregiverRelationship = string.IsNullOrWhiteSpace(body.CaregiverRelationship) ? null : body.CaregiverRelationship.Trim();
        sub.Payload = JsonSerializer.Serialize(body.Payload, Json);
        if (submit)
        {
            sub.Status = CaregiverSubmissionStatus.Submitted;
            sub.SubmittedAt = DateTime.UtcNow;
        }

        // Attribute the audit row to the caregiver — there is no authenticated principal here.
        HttpContext.Items[AuditInterceptor.ActorItemKey] = $"caregiver:{sub.CaregiverName}";
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<JsonObject> BuildProjectionAsync(Participant p, CancellationToken ct) =>
        CaregiverFieldPolicy.BuildProjection(await ParticipantDetailMapper.ToDetailDtoAsync(_db, p, ct));

    private static IReadOnlyList<string> EditableFields() => CaregiverFieldPolicy.EditableFieldIds();
}
