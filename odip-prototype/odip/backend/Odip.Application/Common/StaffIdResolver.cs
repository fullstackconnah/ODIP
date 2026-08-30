using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;

namespace Odip.Application.Common;

/// <summary>
/// Resolves "my own staff/user id" from a User row, honouring the SuperAdmin "view as" override
/// the same way everywhere it's needed. <paramref name="viewAsUserId"/> (ICurrentTenant.ViewAsUserId,
/// set from the X-View-As-User header — see Odip.Infrastructure.Services.CurrentTenant) takes
/// priority over <paramref name="ownUserId"/> (the caller's own identity, however the caller
/// resolved it — a JWT claim for an already-authenticated request, or the just-looked-up User row
/// for a login exchange that hasn't issued a token yet). Null covers every "no resolvable
/// identity" case uniformly: no resolvable user id at all, or the user row not found (or
/// tenant-filtered out).
///
/// Post staff/user unification, every User IS the staff record, so the resolved id is simply the
/// User's own <see cref="User.Id"/> — the resolver is kept (see the design spec, Task 2 removes
/// it) purely as the single place this priority/lookup behaviour lives, shared by
/// PortalController, MedicationsController, and AuthController.
/// </summary>
public static class StaffIdResolver
{
    public static async Task<Guid?> ResolveAsync(
        IQueryable<User> users, Guid? viewAsUserId, Guid? ownUserId, CancellationToken ct)
    {
        var userId = viewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var user = await users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        return user?.Id;
    }
}
