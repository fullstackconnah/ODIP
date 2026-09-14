using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Admin surface for the notification outbox — same `api/v1/admin/&lt;noun&gt;` precedent as
/// AdminUsersController/TenantsController. docs/specs/2026-09-08-notifications-design.md §2.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin")]
[Route("api/v1/admin/notifications")]
public class AdminNotificationsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IEnumerable<INotificationChannel> _channels;

    public AdminNotificationsController(OdipDbContext db, IEnumerable<INotificationChannel> channels)
    {
        _db = db;
        _channels = channels;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<NotificationOutboxDto>>>> GetAll(
        [FromQuery] NotificationOutboxStatus? status, [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
    {
        var query = _db.NotificationOutbox.AsQueryable();
        if (status.HasValue) query = query.Where(o => o.Status == status.Value);
        if (from.HasValue) query = query.Where(o => o.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(o => o.CreatedAt <= to.Value);

        var rows = await query.OrderByDescending(o => o.CreatedAt).ToListAsync(ct);

        var recipientIds = rows.Select(o => o.RecipientUserId).Distinct().ToList();
        var names = await _db.Users.IgnoreQueryFilters()
            .Where(u => recipientIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, ct);

        return Ok(ApiResponse<List<NotificationOutboxDto>>.Ok(
            rows.Select(o => ToDto(o, names.GetValueOrDefault(o.RecipientUserId))).ToList()));
    }

    /// <summary>Resets a Failed row to Pending for immediate re-attempt. 404 (never 403) for a missing or cross-tenant id — same idiom as every other tenant-scoped lookup. 409 if not currently Failed.</summary>
    [HttpPost("{id:guid}/retry")]
    public async Task<ActionResult<ApiResponse<NotificationOutboxDto>>> Retry(Guid id, CancellationToken ct)
    {
        var row = await _db.NotificationOutbox.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (row is null) return NotFound(ApiResponse<NotificationOutboxDto>.Fail("Notification not found."));
        if (row.Status != NotificationOutboxStatus.Failed)
            return Conflict(ApiResponse<NotificationOutboxDto>.Fail("Only failed notifications can be retried."));

        row.Status = NotificationOutboxStatus.Pending;
        row.Attempts = 0;
        row.NextAttemptAt = DateTime.UtcNow;
        row.LastError = null;
        await _db.SaveChangesAsync(ct);

        var name = await _db.Users.IgnoreQueryFilters()
            .Where(u => u.Id == row.RecipientUserId)
            .Select(u => u.FirstName + " " + u.LastName)
            .FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<NotificationOutboxDto>.Ok(ToDto(row, name)));
    }

    /// <summary>Sends a synthetic test message via SmtpEmailChannel directly, bypassing the outbox entirely — proves SMTP config works right now, not "queue a real notification."</summary>
    [HttpPost("test-email")]
    public async Task<ActionResult<ApiResponse<TestEmailResultDto>>> SendTestEmail([FromBody] SendTestEmailDto dto, CancellationToken ct)
    {
        if (!IsValidEmail(dto?.To))
            return BadRequest(ApiResponse<TestEmailResultDto>.Fail("Enter a valid email address."));

        var emailChannel = _channels.First(c => c.Kind == NotificationChannelKind.Email);
        var message = new NotificationMessage(
            RecipientAddress: dto!.To,
            Subject: "ODIP test email",
            PlainTextBody: "This is a test email from ODIP to confirm SMTP configuration is working.",
            HtmlBody: "<p>This is a test email from ODIP to confirm SMTP configuration is working.</p>");

        var result = await emailChannel.SendAsync(message, ct);
        // Not a 500 — a failed test is the endpoint's expected outcome, not a server error.
        return Ok(ApiResponse<TestEmailResultDto>.Ok(new TestEmailResultDto
        {
            Sent = result.Outcome == ChannelSendOutcome.Sent,
            Error = result.Outcome == ChannelSendOutcome.Sent ? null : result.Reason,
        }));
    }

    private static bool IsValidEmail(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        try { _ = new MailAddress(value); return true; }
        catch (FormatException) { return false; }
    }

    private static NotificationOutboxDto ToDto(NotificationOutbox o, string? recipientName) => new()
    {
        Id = o.Id, EventType = o.EventType, EntityType = o.EntityType, EntityId = o.EntityId,
        RecipientUserId = o.RecipientUserId, RecipientName = recipientName, Status = o.Status,
        Attempts = o.Attempts, NextAttemptAt = o.NextAttemptAt, LastError = o.LastError,
        CreatedAt = o.CreatedAt, SentAt = o.SentAt,
    };
}
