using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>
/// Checks a valid session token against the user's row on every request, so deactivating a person or changing their role takes effect at their
/// next request instead of when the 30-minute token ends. A refused token gets 401; the client then asks for a new one (Firebase exchange or
/// Microsoft refresh), which re-reads the row, so a re-roled person carries on with their new role and a deactivated one is signed out.
/// </summary>
public static class SessionRecheck
{
    public static async Task OnTokenValidated(TokenValidatedContext context)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<OdipDbContext>();
        if (await RefusalAsync(db, context.Principal!, context.HttpContext.RequestAborted) is { } reason) context.Fail(reason);
    }

    /// <summary>Why the token is no longer good, or null if it still is. One primary-key read.</summary>
    public static async Task<string?> RefusalAsync(OdipDbContext db, ClaimsPrincipal user, CancellationToken ct)
    {
        if (!Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return "The token names no user.";

        // By id alone: the id is a global key, and a SuperAdmin viewing as another organisation carries that organisation's tenant_id, not their own.
        var row = await db.Users.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .Where(u => u.Id == id).Select(u => new { u.IsActive, u.Role }).FirstOrDefaultAsync(ct);

        if (row is null) return "The user no longer exists.";
        if (!row.IsActive) return "The user is deactivated.";
        return row.Role.ToString() == user.FindFirstValue(ClaimTypes.Role) ? null : "The user's role has changed.";
    }
}
