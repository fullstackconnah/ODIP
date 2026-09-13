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

        foreach (var (eventType, channel, enabled) in parsed)
        {
            var row = await _db.NotificationPreferences.FirstOrDefaultAsync(
                p => p.UserId == callerId.Value && p.EventType == eventType && p.Channel == channel, ct);
            if (row is null)
            {
                _db.NotificationPreferences.Add(new NotificationPreference
                {
                    Id = Guid.NewGuid(), UserId = callerId.Value, EventType = eventType, Channel = channel, Enabled = enabled,
                });
            }
            else
            {
                row.Enabled = enabled;
            }
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<NotificationPreferenceGridDto>.Ok(await BuildGridAsync(callerId.Value, ct)));
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
