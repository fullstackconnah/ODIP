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
/// The signed-in person's saved screen choices. Like WhatsNewController the caller is the JWT subject and nothing from the request
/// names a user, so one person can never read or write another's row; any role may save their own (ReadOnlyMiddleware allow-lists the PUT).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/me/ui-preferences")]
public class UiPreferencesController : ControllerBase
{
    private readonly OdipDbContext _db;

    public UiPreferencesController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<UiPreferencesDto>>> Get(CancellationToken ct)
    {
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized();
        var row = await _db.UserUiPreferences.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == callerId, ct);
        return Ok(ApiResponse<UiPreferencesDto>.Ok(new UiPreferencesDto { ItineraryView = row?.ItineraryView }));
    }

    [HttpPut]
    public async Task<ActionResult<ApiResponse<UiPreferencesDto>>> Put([FromBody] UiPreferencesDto body, CancellationToken ct)
    {
        // Exact, lower-case match: anything else (missing, blank, other casing, a long string) is refused and nothing is saved.
        if (body.ItineraryView is not ("days" or "list")) return BadRequest(ApiResponse<UiPreferencesDto>.Fail("itineraryView must be 'days' or 'list'."));
        var callerId = ResolveCallerId();
        if (callerId is null) return Unauthorized();
        var saved = Ok(ApiResponse<UiPreferencesDto>.Ok(new UiPreferencesDto { ItineraryView = body.ItineraryView }));
        // A user who no longer exists has nothing to save a choice against (as in What's new); answering OK keeps the client from treating it as a session problem.
        if (!await _db.Users.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(u => u.Id == callerId, ct)) return saved;

        for (var attempt = 0; ; attempt++)
        {
            var row = await _db.UserUiPreferences.FirstOrDefaultAsync(p => p.UserId == callerId, ct);
            if (row is null)
            {
                row = new UserUiPreference { Id = Guid.NewGuid(), UserId = callerId.Value };
                _db.UserUiPreferences.Add(row);
            }
            row.ItineraryView = body.ItineraryView;
            row.UpdatedAt = DateTime.UtcNow;
            try
            {
                await _db.SaveChangesAsync(ct);
                return saved;
            }
            // Two tabs saving for the first time: the loser re-reads the winner's row and writes onto it.
            catch (DbUpdateException ex) when (attempt == 0 && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                _db.ChangeTracker.Clear();
            }
        }
    }

    private Guid? ResolveCallerId() =>
        Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
}
