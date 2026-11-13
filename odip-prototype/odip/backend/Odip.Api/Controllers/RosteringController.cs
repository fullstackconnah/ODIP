using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Api.Rostering;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Api.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Rostering API (M4 pass 1): the week roster board, shift CRUD, weekly shift-pattern
/// generation, and the staff-participant compatibility matrix. Gated to
/// <c>SuperAdmin,Admin,Coordinator</c> on every action including reads — deliberately
/// STRICTER than <see cref="ScheduleController"/>'s plain <c>[Authorize]</c> (that
/// controller's posture is a separate, pre-existing issue and out of scope here; do not
/// "harmonise" the two). Rostering is coordinator work: the board exposes participant
/// support needs and staff credential/compliance status, and the frontend already excludes
/// rostering from a SupportWorker's visible pages (<c>SUPPORT_WORKER_PAGES</c>) — that
/// nav-level exclusion is not access control on its own, so the API must enforce the same
/// restriction itself rather than relying on the UI to hide it. Every write that touches a
/// shift runs <see cref="RosterConflictService.Check"/> before saving; see
/// <see cref="EvaluateFindings"/> for the Blocking/Warning/override gate.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/rostering")]
public partial class RosteringController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly RosterShiftGenerator _generator;
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;
    private readonly RosterAvailability _availability;
    private readonly RosterWeekStarter _weekStarter;

    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;
    private readonly Odip.Application.Interfaces.IObligationTaskService _obligationTasks;
    private readonly ShiftPackageService _package;
    // The request's clock: a test fixes it. Every calendar rule uses the PROVIDER's date from it (ProviderTimeZoneResolver.TodayAsync), never the UTC date.
    private readonly TimeProvider _clock;
    // Budget phase 3: the budget check of a one-off shift, which needs to know whose money it may show (the caller's organisation). Without a tenant on the request there is no budget check.
    private readonly ICurrentTenant? _tenant;
    private readonly ShiftBudgetCheck? _budget;
    private readonly ShiftBudgetEffect? _budgetEffect;
    private readonly ILogger<RosteringController>? _logger;

    public RosteringController(
        OdipDbContext db, StaffCompatibilityLinkService compatLink, IStaffUnavailabilityQuery unavailabilityQuery,
        IConfiguration? config = null, Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null,
        Odip.Application.Interfaces.IObligationTaskService? obligationTasks = null,
        ShiftPackageService? package = null, TimeProvider? clock = null, RosterShiftGenerator? generator = null,
        ICurrentTenant? tenant = null, ShiftBudgetCheck? budget = null, ShiftBudgetEffect? budgetEffect = null, ILogger<RosteringController>? logger = null, RosterWeekStarter? weekStarter = null)
    {
        _logger = logger;
        _db = db;
        _generator = generator ?? new RosterShiftGenerator();
        _clock = clock ?? TimeProvider.System;
        _tenant = tenant;
        _budget = budget ?? (tenant is null ? null : new ShiftBudgetCheck(db, new BudgetLedgerService(db, _clock)));
        _budgetEffect = budgetEffect ?? (tenant is null ? null : new ShiftBudgetEffect(db, new BudgetLedgerService(db, _clock)));
        _compatLink = compatLink;
        _unavailabilityQuery = unavailabilityQuery;
        _availability = new RosterAvailability(db, unavailabilityQuery);
        _weekStarter = weekStarter ?? new RosterWeekStarter(_generator, _availability);
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
        _obligationTasks = obligationTasks ?? new Odip.Infrastructure.Tasks.ObligationTaskService(db);
        _package = package ?? new ShiftPackageService(db);
    }
}
