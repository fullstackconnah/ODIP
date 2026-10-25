using System.Linq.Expressions;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// What's new for the signed-in person. The caller is the JWT subject and role, never <c>ICurrentTenant</c>: under
/// <c>X-View-As-Tenant</c> CurrentTenant reports IsSuperAdmin = false and the viewed organisation, which would hide a
/// SuperAdmin's own user row (it has no tenant).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/whats-new")]
public class WhatsNewController : ControllerBase
{
    private const int FeedCap = 50;
    private readonly OdipDbContext _db;

    public WhatsNewController(OdipDbContext db) => _db = db;

    private static readonly Expression<Func<WhatsNewEntry, WhatsNewEntryDto>> ToDto = e => new WhatsNewEntryDto
    {
        Id = e.Id, Title = e.Title, Body = e.Body, Important = e.Important, PublishedAtUtc = e.PublishedAtUtc,
    };

    [HttpGet]
    public async Task<ActionResult<ApiResponse<WhatsNewFeedDto>>> GetFeed(CancellationToken ct)
    {
        var audience = WhatsNewAudienceNames.Of(User);
        var visible = _db.WhatsNewEntries.Where(e => e.ArchivedAtUtc == null);
        if (audience != WhatsNewAudience.All) visible = visible.Where(e => (e.Roles & audience) != 0);
        var ordered = visible.OrderByDescending(e => e.PublishedAtUtc).ThenByDescending(e => e.Id);
        var entries = await ordered.Take(FeedCap).Select(ToDto).ToListAsync(ct);

        // IgnoreQueryFilters: see the type doc. A user who no longer exists still reads the entries but has nothing unread.
        var callerId = ResolveCallerId();
        var created = callerId is null ? null : await _db.Users.IgnoreQueryFilters().Where(u => u.Id == callerId)
            .Select(u => (DateTime?)u.CreatedAt).FirstOrDefaultAsync(ct);
        if (created is null) return Ok(ApiResponse<WhatsNewFeedDto>.Ok(new WhatsNewFeedDto { Entries = entries }));

        var state = await _db.WhatsNewUserStates.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == callerId, ct);
        var listBaseline = Max(state?.LastSeenAtUtc, created.Value);
        // An important entry already read in the panel must not pop up on the next visit, so the pop-up baseline includes the panel's.
        var popupBaseline = Max(state?.PopupSeenThroughUtc, listBaseline);
        var unread = await visible.CountAsync(e => e.PublishedAtUtc > listBaseline, ct);
        var popup = await ordered.Where(e => e.Important && e.PublishedAtUtc > popupBaseline).Take(FeedCap).Select(ToDto).ToListAsync(ct);
        return Ok(ApiResponse<WhatsNewFeedDto>.Ok(new WhatsNewFeedDto { Entries = entries, UnreadCount = unread, Popup = popup }));
    }

    /// <summary>The panel was opened.</summary>
    [HttpPost("seen")]
    public Task<ActionResult<ApiResponse<bool>>> Seen(CancellationToken ct) => Mark((s, now) => s.LastSeenAtUtc = now, ct);

    /// <summary>The pop-up was dismissed.</summary>
    [HttpPost("popup-seen")]
    public Task<ActionResult<ApiResponse<bool>>> PopupSeen(CancellationToken ct) => Mark((s, now) => s.PopupSeenThroughUtc = now, ct);

    private async Task<ActionResult<ApiResponse<bool>>> Mark(Action<WhatsNewUserState, DateTime> apply, CancellationToken ct)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized();
        if (!await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Id == callerId, ct)) return Ok(ApiResponse<bool>.Ok(true));

        for (var attempt = 0; ; attempt++)
        {
            var state = await _db.WhatsNewUserStates.FirstOrDefaultAsync(s => s.UserId == callerId, ct);
            if (state is null)
            {
                state = new WhatsNewUserState { Id = Guid.NewGuid(), UserId = callerId.Value };
                _db.WhatsNewUserStates.Add(state);
            }
            apply(state, DateTime.UtcNow);
            try
            {
                await _db.SaveChangesAsync(ct);
                return Ok(ApiResponse<bool>.Ok(true));
            }
            // Two tabs marking for the first time: the loser re-reads the winner's row and writes onto it.
            catch (DbUpdateException ex) when (attempt == 0 && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                _db.ChangeTracker.Clear();
            }
        }
    }

    private static DateTime Max(DateTime? a, DateTime b) => a is { } x && x > b ? x : b;

    private Guid? ResolveCallerId() =>
        Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
}
