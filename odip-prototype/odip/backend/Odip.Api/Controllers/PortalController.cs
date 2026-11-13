using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Odip.Api.Rostering;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The staff member portal ("My Shifts") — a self-service read surface scoped to the caller's
/// own account, resolved via <see cref="ResolveCurrentStaffIdAsync"/> (post staff/user
/// unification this is simply the caller's own <see cref="User.Id"/>).
///
/// Access rule: a caller can read ONLY their own shifts (matched on <c>Shift.UserId</c>) and
/// only the participant/medication/routine data attached to those shifts — a shift id
/// belonging to another staff member 404s exactly the same as one that doesn't exist at all,
/// so this surface can never be used to enumerate other staff's roster ids. Coordinator/admin
/// routes (<see cref="RosteringController"/>, <see cref="MedicationsController"/>,
/// <see cref="ParticipantRoutinesController"/>) are unaffected — reads here always go via
/// purpose-built portal DTOs, never the coordinator-scoped ones. The one write surface is witness
/// approve/decline (<see cref="ApproveWitnessRequest"/>/<see cref="DeclineWitnessRequest"/>), and
/// the same "only your own, 404 otherwise" scoping applies — matched on
/// <c>MedicationAdministration.WitnessUserId</c> instead of <c>Shift.UserId</c>. These POSTs
/// still go through <c>ReadOnlyMiddleware</c> like every other write in the app — there is no
/// portal-specific exemption from the ReadOnly role's 403.
///
/// Respects the SuperAdmin "view as" switching mechanism: <see cref="ICurrentTenant.ViewAsUserId"/>
/// (set from the X-View-As-User header, only once a SuperAdmin has also scoped to a tenant via
/// X-View-As-Tenant — see <see cref="Odip.Infrastructure.Services.CurrentTenant"/>) takes
/// priority over the caller's own JWT subject claim, so previewing a specific user's portal
/// shows THAT user's shifts, not the SuperAdmin's own (who typically has no linked Staff record
/// at all).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/portal")]
public partial class PortalController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _currentTenant;
    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;
    private readonly Odip.Application.Interfaces.IObligationTaskService _obligationTasks;
    private readonly TimeProvider _clock;
    private readonly ShiftBreakService _breaks;
    private readonly ShiftHandoverService _handover;
    private readonly ShiftPackageService _package;
    private readonly MedicationAdministrationRecorder _recorder;
    private readonly ShiftRoutineCheckService _routineChecks;

    public PortalController(
        OdipDbContext db, ICurrentTenant currentTenant, IConfiguration? config = null,
        Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null,
        Odip.Application.Interfaces.IObligationTaskService? obligationTasks = null,
        TimeProvider? clock = null,
        ShiftBreakService? breaks = null,
        ShiftHandoverService? handover = null,
        ShiftPackageService? package = null,
        MedicationAdministrationRecorder? recorder = null,
        ShiftRoutineCheckService? routineChecks = null)
    {
        _db = db;
        _currentTenant = currentTenant;
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
        _obligationTasks = obligationTasks ?? new Odip.Infrastructure.Tasks.ObligationTaskService(db);
        _clock = clock ?? TimeProvider.System;
        _breaks = breaks ?? new ShiftBreakService(db, _clock);
        _handover = handover ?? new ShiftHandoverService(db, _clock);
        _package = package ?? new ShiftPackageService(db, new MedicationSlotService(db, _clock));
        _recorder = recorder ?? new MedicationAdministrationRecorder(db, _notificationRaiser, _obligationTasks, _clock);
        _routineChecks = routineChecks ?? new ShiftRoutineCheckService(db, _clock);
    }

    private DateTime NowUtc => _clock.GetUtcNow().UtcDateTime;

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Resolves the caller's own user id — post staff/user unification this IS the caller's
    /// linked "staff" identity, there being no separate Staff record any more.
    /// <see cref="ICurrentTenant.ViewAsUserId"/> takes priority over the JWT's own subject claim
    /// (see class remarks). Null covers every "no resolvable identity" case uniformly: no
    /// resolvable user id on the token, or the user row not found (or tenant-filtered out).
    /// </summary>
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        Guid? ownUserId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        var userId = _currentTenant.ViewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var exists = await _db.Users.AnyAsync(u => u.Id == userId.Value && u.IsActive, ct);
        return exists ? userId : null;
    }

    /// <summary>Same "fullName claim, fall back to the Name claim" idiom as ParticipantNotesController.GetCreatedByName.</summary>
    private string GetCallerName() =>
        User?.FindFirst("fullName")?.Value
        ?? User?.FindFirst(ClaimTypes.Name)?.Value
        ?? "Unknown";
}
