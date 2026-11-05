using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Retention;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Settings → Data retention. An archived participant's record is kept 7 years (RetentionClock); once due, an organisation Admin, and only an Admin, can permanently delete it
/// by typing the participant's last name and giving a reason. A SuperAdmin cannot confirm a purge, even viewing as an organisation. The purge is one transaction (ParticipantPurger)
/// and leaves a PurgeRecord with no personal details. Every query names the organisation itself.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/v1/data-retention")]
public class DataRetentionController : ControllerBase
{
    public const string NotDue = "This record isn't due for purge.";
    public const string ReasonRequired = "Give a reason for the purge.";
    public const string NameMismatch = "The last name doesn't match.";
    public const string CouldNotFinish = "The purge couldn't finish. Nothing was deleted. Try again.";
    public const string NoOrganisation = "Your account isn't linked to an organisation.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;

    public DataRetentionController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
    }

    private Guid? Organisation => _tenant.IsSuperAdmin ? null : _tenant.TenantId;

    /// <summary>The archived participants whose 7 years have run out, with what a purge would delete.</summary>
    [HttpGet("due")]
    public async Task<ActionResult<ApiResponse<List<RetentionDueDto>>>> Due(CancellationToken ct)
    {
        if (Organisation is not { } tenantId) return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<List<RetentionDueDto>>.Fail(NoOrganisation));
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, zone);
        var starts = await RetentionClock.EffectiveStartsAsync(_db, tenantId, zone, null, ct);
        var dueIds = starts.Where(s => RetentionClock.IsDue(s.Value, today)).Select(s => s.Key).ToList();
        var people = await _db.Participants.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .Where(p => p.TenantId == tenantId && dueIds.Contains(p.Id))
            .Select(p => new { p.Id, p.FirstName, p.LastName, p.RetentionStartsOn, p.RetentionStartEstimated }).ToListAsync(ct);
        var result = new List<RetentionDueDto>();
        foreach (var p in people.OrderBy(p => starts[p.Id]).ThenBy(p => p.LastName))
        {
            result.Add(new RetentionDueDto
            {
                ParticipantId = p.Id, FirstName = p.FirstName, LastName = p.LastName, StartsOn = starts[p.Id],
                StartEstimated = p.RetentionStartEstimated && p.RetentionStartsOn == starts[p.Id], DueOn = RetentionClock.DueOn(starts[p.Id]),
                RowCounts = await PurgePlan.CountAsync(_db, tenantId, p.Id, ct),
            });
        }
        return Ok(ApiResponse<List<RetentionDueDto>>.Ok(result));
    }

    /// <summary>The confirmed purge. Idempotent: a participant already purged answers 200 with its record.</summary>
    [HttpPost("{participantId:guid}/purge")]
    public async Task<ActionResult<ApiResponse<PurgeRecordDto>>> Purge(Guid participantId, [FromBody] PurgeParticipantRequest request, CancellationToken ct)
    {
        if (Organisation is not { } tenantId) return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<PurgeRecordDto>.Fail(NoOrganisation));

        if (await ParticipantPurger.ExistingAsync(_db, tenantId, participantId, ct) is { } done) return Ok(ApiResponse<PurgeRecordDto>.Ok(ToDto(done)));

        var p = await _db.Participants.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == participantId).Select(x => new { x.LastName, x.IsActive, x.IsDraft }).FirstOrDefaultAsync(ct);
        if (p == null) return NotFound(ApiResponse<PurgeRecordDto>.Fail("Participant not found"));

        var reason = (request?.Reason ?? "").Trim();
        if (reason.Length == 0) return BadRequest(ApiResponse<PurgeRecordDto>.Fail(ReasonRequired));
        if (reason.Length > PurgeRecord.ReasonMaxLength) return BadRequest(ApiResponse<PurgeRecordDto>.Fail($"Keep the reason to {PurgeRecord.ReasonMaxLength} characters or fewer."));
        if (!string.Equals((request?.LastName ?? "").Trim(), p.LastName.Trim(), StringComparison.OrdinalIgnoreCase)) return BadRequest(ApiResponse<PurgeRecordDto>.Fail(NameMismatch));

        // Fast path; ParticipantPurger checks again inside the transaction, under a lock on the participant's row.
        var status = await RetentionClock.StatusAsync(_db, tenantId, participantId, _clock, ct);
        if (p.IsActive || p.IsDraft || status is not { Due: true }) return Conflict(ApiResponse<PurgeRecordDto>.Fail(NotDue));

        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId);
        var name = User.FindFirstValue("fullName") ?? User.FindFirstValue(ClaimTypes.Name) ?? "Unknown";
        var outcome = await ParticipantPurger.PurgeAsync(_db, tenantId, participantId, userId, name, reason, _clock, ct);
        return outcome.Result switch
        {
            PurgeResult.Purged or PurgeResult.AlreadyPurged => Ok(ApiResponse<PurgeRecordDto>.Ok(ToDto(outcome.Record!))),
            PurgeResult.NotFound => NotFound(ApiResponse<PurgeRecordDto>.Fail("Participant not found")),
            PurgeResult.NotDue => Conflict(ApiResponse<PurgeRecordDto>.Fail(NotDue)),
            _ => Conflict(ApiResponse<PurgeRecordDto>.Fail(CouldNotFinish)),
        };
    }

    private static PurgeRecordDto ToDto(PurgeRecord r) => new()
    {
        Id = r.Id, ParticipantId = r.EntityId, ConfirmedByName = r.ConfirmedByName, ConfirmedAt = r.ConfirmedAt, Reason = r.Reason,
        RetentionStartsOn = r.RetentionStartsOn, RetentionStartEstimated = r.RetentionStartEstimated, DueOn = r.DueOn,
        RowCounts = JsonSerializer.Deserialize<Dictionary<string, int>>(r.RowCounts) ?? new(), ClaimBatchFilesCleared = r.ClaimBatchFilesCleared,
    };
}
