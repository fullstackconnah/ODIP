using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Settings › Alpha sign-ups: the SuperAdmin's list of the landing page's early-access rows, and Delete for a person who asks
/// (their request arrives as a repeat sign-up, so it sorts first). Kept apart from EarlyAccessController on purpose: that class is
/// [AllowAnonymous], which would override an [Authorize] on any action added to it. The table is not tenant-scoped, so a
/// view-as header changes nothing here.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin")]
[Route("api/v1/admin/early-access")]
public class AdminEarlyAccessController : ControllerBase
{
    private const int SaveAttempts = 3;
    private readonly OdipDbContext _db;

    public AdminEarlyAccessController(OdipDbContext db) => _db = db;

    // GET api/v1/admin/early-access?page=1&pageSize=50 — latest sent first, so a repeat (a removal request) is on top.
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<EarlyAccessSignupDto>>>> GetAll(
        [FromQuery] int page = 1, [FromQuery] int pageSize = PagingParams.DefaultPageSize, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var query = _db.EarlyAccessRequests.AsNoTracking()
            .OrderByDescending(e => e.LastRequestedAtUtc).ThenBy(e => e.Id)
            .Select(e => new EarlyAccessSignupDto
            {
                Id = e.Id, Name = e.Name, Organisation = e.Organisation, Email = e.Email, Role = e.Role, Phone = e.Phone,
                OrganisationSize = e.OrganisationSize, Message = e.Message, CreatedAtUtc = e.CreatedAtUtc,
                LastRequestedAtUtc = e.LastRequestedAtUtc, RequestCount = e.RequestCount,
                OverLimitCount = e.OverLimitCount,
                LastOverLimitAtUtc = e.LastOverLimitAtUtc,
                FollowUpNeeded = e.FollowUpNeeded,
                FollowUpClearedAtUtc = e.FollowUpClearedAtUtc,
                FirstOverLimit = e.LaterSubmissions.Where(l => l.IsOverLimit).Select(l => new EarlyAccessLaterSubmissionDto
                {
                    Id = l.Id, ReceivedAtUtc = l.ReceivedAtUtc, Name = l.Name, Organisation = l.Organisation, Role = l.Role, Phone = l.Phone,
                    OrganisationSize = l.OrganisationSize, Message = l.Message,
                }).FirstOrDefault(),
                LaterSubmissions = e.LaterSubmissions.Where(l => !l.IsOverLimit).OrderBy(l => l.ReceivedAtUtc).ThenBy(l => l.Id).Select(l => new EarlyAccessLaterSubmissionDto
                {
                    Id = l.Id, ReceivedAtUtc = l.ReceivedAtUtc, Name = l.Name, Organisation = l.Organisation, Role = l.Role, Phone = l.Phone,
                    OrganisationSize = l.OrganisationSize, Message = l.Message,
                }).ToList(),
            });
        return Ok(ApiResponse<PagedResult<EarlyAccessSignupDto>>.Ok(
            await PagedResult<EarlyAccessSignupDto>.CreateAsync(query, page, pageSize, ct)));
    }

    // POST api/v1/admin/early-access/{id}/followed-up — a person has read the over-limit repeats and followed up, so the "Follow up needed" marker goes.
    // Only this clears it; a public submission never does. The body carries the over-limit count the SuperAdmin was looking at: if more have arrived since
    // (a 409), they have not been read and must not be marked as handled. Audited with who and when only, no answers.
    [HttpPost("{id:guid}/followed-up")]
    public async Task<ActionResult<ApiResponse<bool>>> MarkFollowedUp(Guid id, [FromBody] MarkFollowedUpDto body, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var row = await _db.EarlyAccessRequests.SingleOrDefaultAsync(e => e.Id == id, ct);
            if (row is null) return NotFound(ApiResponse<bool>.Fail("Sign-up not found."));
            if (row.OverLimitCount != body.OverLimitCount)
                return Conflict(ApiResponse<bool>.Fail("A new submission arrived after you opened this. Reload to see it."));
            if (!row.FollowUpNeeded) return Ok(ApiResponse<bool>.Ok(true)); // already done, from another tab: nothing to change or audit

            row.FollowUpNeeded = false;
            row.FollowUpClearedAtUtc = DateTime.UtcNow;
            _db.AuditLogs.Add(AuditRow(id, AuditAction.Updated));
            try
            {
                await _db.SaveChangesAsync(ct);
                return Ok(ApiResponse<bool>.Ok(true));
            }
            catch (DbUpdateConcurrencyException) when (attempt < SaveAttempts)
            {
                // RequestCount is a concurrency token: a repeat arrived after the read. Read again; if it was an over-limit one the count now differs and this refuses.
                _db.ChangeTracker.Clear();
            }
        }
    }

    // An audit row that names who and when but holds none of the person's details (EarlyAccessRequest and EarlyAccessLaterSubmission are deliberately
    // not in AuditedEntities, which would copy every column into AuditLog).
    private AuditLog AuditRow(Guid id, AuditAction action) => new()
    {
        Id = Guid.NewGuid(), EntityType = nameof(EarlyAccessRequest), EntityId = id, Action = action,
        ChangedAt = DateTimeOffset.UtcNow,
        ChangedById = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var callerId) ? callerId : null,
        ChangedByName = User.FindFirstValue("fullName") ?? User.FindFirstValue(ClaimTypes.Name),
    };

    // DELETE api/v1/admin/early-access/{id} — a hard delete, plus an audit row that names who and when but holds none of the person's details.
    [HttpDelete("{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            // The later submissions are loaded so they go with the row under any provider (PostgreSQL also cascades).
            var row = await _db.EarlyAccessRequests.Include(e => e.LaterSubmissions).SingleOrDefaultAsync(e => e.Id == id, ct);
            if (row is null) return NotFound(ApiResponse<bool>.Fail("Sign-up not found."));

            _db.EarlyAccessRequests.Remove(row);
            _db.AuditLogs.Add(AuditRow(id, AuditAction.Deleted));
            try
            {
                await _db.SaveChangesAsync(ct); // one transaction: the row goes and its audit row arrives together
                return Ok(ApiResponse<bool>.Ok(true));
            }
            catch (DbUpdateConcurrencyException) when (attempt < SaveAttempts)
            {
                // RequestCount is a concurrency token: a repeat sign-up (or the purge) changed the row after it was read. Read it again.
                _db.ChangeTracker.Clear();
            }
        }
    }
}
