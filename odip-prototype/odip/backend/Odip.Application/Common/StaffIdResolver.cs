using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;

namespace Odip.Application.Common;

/// <summary>
/// Resolves "my linked Staff id" from a User row, honouring the SuperAdmin "view as" override
/// the same way everywhere it's needed. <paramref name="viewAsUserId"/> (ICurrentTenant.ViewAsUserId,
/// set from the X-View-As-User header — see Odip.Infrastructure.Services.CurrentTenant) takes
/// priority over <paramref name="ownUserId"/> (the caller's own identity, however the caller
/// resolved it — a JWT claim for an already-authenticated request, or the just-looked-up User row
/// for a login exchange that hasn't issued a token yet). Null covers every "not linked" case
/// uniformly: no resolvable user id at all, the user row not found (or tenant-filtered out), or a
/// resolved user whose <see cref="User.StaffId"/> is null — callers never need to distinguish these.
///
/// Shared by PortalController, MedicationsController, and AuthController so this priority order
/// and null-collapsing behaviour lives in exactly one place instead of three copies.
/// </summary>
public static class StaffIdResolver
{
    public static async Task<Guid?> ResolveAsync(
        IQueryable<User> users, Guid? viewAsUserId, Guid? ownUserId, CancellationToken ct)
    {
        var userId = viewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var user = await users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        return user?.StaffId;
    }
}
