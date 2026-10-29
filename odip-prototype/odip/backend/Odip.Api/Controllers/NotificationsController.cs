using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Self-service notification preferences — actions on the caller's own account, matching how
/// PortalController puts self-scoped actions directly under its own route. There is no
/// `userId` field anywhere on the request DTO: the endpoint is self-scoped by construction.
/// docs/specs/2026-09-08-notifications-design.md §2.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/notifications")]
public class NotificationsController : ControllerBase
{
    private const int MaxReadAllIds = 100;

    private readonly OdipDbContext _db;
    public NotificationsController(OdipDbContext db) => _db = db;

    [HttpGet("preferences")]
    public async Task<ActionResult<ApiResponse<NotificationPreferenceGridDto>>> GetPreferences(CancellationToken ct)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized(ApiResponse<NotificationPreferenceGridDto>.Fail("Caller identity could not be resolved."));

        return Ok(ApiResponse<NotificationPreferenceGridDto>.Ok(await BuildGridAsync(callerId.Value, ct)));
    }

    [HttpPut("preferences")]
    public async Task<ActionResult<ApiResponse<NotificationPreferenceGridDto>>> UpdatePreferences(
        [FromBody] List<UpdateNotificationPreferenceDto> dtos, CancellationToken ct)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized(ApiResponse<NotificationPreferenceGridDto>.Fail("Caller identity could not be resolved."));

        dtos ??= new List<UpdateNotificationPreferenceDto>();
        var parsed = new List<(NotificationEventType EventType, NotificationChannelKind Channel, bool Enabled)>();
        foreach (var dto in dtos)
        {
            if (!Enum.TryParse<NotificationEventType>(dto.EventType, ignoreCase: true, out var eventType)
                || !Enum.IsDefined(eventType)
                || !Enum.TryParse<NotificationChannelKind>(dto.Channel, ignoreCase: true, out var channel)
                || !Enum.IsDefined(channel))
            {
                return BadRequest(ApiResponse<NotificationPreferenceGridDto>.Fail("Unknown event type or channel."));
            }
            parsed.Add((eventType, channel, dto.Enabled));
        }

        // One query for the caller's rows. SuperAdmin sees every tenant, so a key can repeat: keep the first, as FirstOrDefault did.
        var existing = (await _db.NotificationPreferences.Where(p => p.UserId == callerId.Value).ToListAsync(ct))
            .GroupBy(p => (p.EventType, p.Channel))
            .ToDictionary(g => g.Key, g => g.First());
        foreach (var (eventType, channel, enabled) in parsed)
        {
            if (existing.TryGetValue((eventType, channel), out var row))
            {
                row.Enabled = enabled;
                continue;
            }
            // Also tracked here, so a repeated key in this request updates the row just added (last value wins).
            row = new NotificationPreference
            {
                Id = Guid.NewGuid(), UserId = callerId.Value, EventType = eventType, Channel = channel, Enabled = enabled,
            };
            _db.NotificationPreferences.Add(row);
            existing[(eventType, channel)] = row;
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<NotificationPreferenceGridDto>.Ok(await BuildGridAsync(callerId.Value, ct)));
    }

    /// <summary>
    /// The bell (dashboard spec 2026-10-14): the caller's own items, unread first and then newest first, and their unread count (unread first so "Mark all as read" always reaches the next unseen batch). Own rows are
    /// the JWT subject's, never X-View-As-User's (lead decision 1); the tenant filter applies as well. `take` is clamped to
    /// 1..50, and HasMore comes from asking for one row more than is returned.
    /// </summary>
    [HttpGet("inbox")]
    public async Task<ActionResult<ApiResponse<InboxDto>>> GetInbox([FromQuery] int take = 30, CancellationToken ct = default)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized(ApiResponse<InboxDto>.Fail("Caller identity could not be resolved."));

        take = Math.Clamp(take, 1, 50);
        var mine = _db.InAppNotifications.Where(n => n.RecipientUserId == callerId.Value);
        var rows = await mine
            .OrderBy(n => n.ReadAt != null).ThenByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id)
            .Take(take + 1)
            .Select(n => new InAppNotificationDto { Id = n.Id, Title = n.Title, LinkTo = n.LinkTo, CreatedAt = n.CreatedAt, ReadAt = n.ReadAt })
            .ToListAsync(ct);
        var unread = await mine.CountAsync(n => n.ReadAt == null, ct);

        return Ok(ApiResponse<InboxDto>.Ok(new InboxDto { Items = rows.Take(take).ToList(), UnreadCount = unread, HasMore = rows.Count > take }));
    }

    /// <summary>Marks one of the caller's own items read. Idempotent: an item already read keeps its first ReadAt. Anyone else's item, or another organisation's, is 404.</summary>
    [HttpPost("inbox/{id:guid}/read")]
    public async Task<IActionResult> MarkInboxRead(Guid id, CancellationToken ct)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized(ApiResponse<object>.Fail("Caller identity could not be resolved."));

        var row = await _db.InAppNotifications.FirstOrDefaultAsync(n => n.Id == id && n.RecipientUserId == callerId.Value, ct);
        if (row is null) return NotFound(ApiResponse<object>.Fail("Notification not found."));

        row.ReadAt ??= DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Marks the caller's unread items read: only the ids the bell shows when it sends them (other people's ids are ignored; more than 100 is 400), every unread item when it sends none (an old client mid-deploy).</summary>
    [HttpPost("inbox/read-all")]
    public async Task<IActionResult> MarkAllInboxRead([FromBody] MarkInboxReadRequest? request, CancellationToken ct)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized(ApiResponse<object>.Fail("Caller identity could not be resolved."));

        if (request?.Ids is { Length: > MaxReadAllIds }) return BadRequest(ApiResponse<object>.Fail($"At most {MaxReadAllIds} ids."));

        // shortcut: loads every unread row, because EF InMemory (the controller tests) has no ExecuteUpdate; move to ExecuteUpdateAsync if inboxes reach thousands unread.
        var now = DateTime.UtcNow;
        var ids = request?.Ids;
        foreach (var row in await _db.InAppNotifications.Where(n => n.RecipientUserId == callerId.Value && n.ReadAt == null && (ids == null || ids.Contains(n.Id))).ToListAsync(ct))
            row.ReadAt = now;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Every event x channel, `enabled` = the user's own row if one exists, else the documented default (ON) — design spec §1.</summary>
    private async Task<NotificationPreferenceGridDto> BuildGridAsync(Guid userId, CancellationToken ct)
    {
        var existing = await _db.NotificationPreferences.Where(p => p.UserId == userId).ToListAsync(ct);

        var rows = new List<NotificationPreferenceRowDto>();
        foreach (NotificationEventType eventType in Enum.GetValues<NotificationEventType>())
        {
            foreach (NotificationChannelKind channel in Enum.GetValues<NotificationChannelKind>())
            {
                var match = existing.FirstOrDefault(p => p.EventType == eventType && p.Channel == channel);
                rows.Add(new NotificationPreferenceRowDto
                {
                    EventType = eventType, Channel = channel, Enabled = match?.Enabled ?? true,
                });
            }
        }
        return new NotificationPreferenceGridDto { Rows = rows };
    }

    private Guid? ResolveCallerId() =>
        Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
}
