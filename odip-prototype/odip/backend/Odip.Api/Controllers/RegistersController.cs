using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DataExport;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Settings › Data export › Registers for auditors. One curated CSV per register for the organisation in scope (see DataExportController for how it
/// is chosen). Incidents, restrictive practices, risks and staff credentials are open to the office roles; the complaints register to Admin and
/// SuperAdmin only, like the raw export. Every download writes one audit row (EntityType "Register") before the file is returned: if the save
/// fails the request fails, so there is no untraced download.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/registers")]
public class RegistersController : ControllerBase
{
    /// <summary>AuditLog.EntityType of a register download. Not "Tenant": that row is the full export's "Last exported by" line.</summary>
    public const string AuditEntityType = "Register";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;

    public RegistersController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
    }

    // As DataExportController.Organisation: a SuperAdmin's is the one they chose, an Admin's or Coordinator's the tenant claim.
    private Guid? Organisation => _tenant.IsSuperAdmin ? null : _tenant.TenantId;

    private ObjectResult NoOrganisationResult() => _tenant.IsSuperAdmin
        ? BadRequest(ApiResponse<bool>.Fail(DataExportController.NoOrganisation))
        : StatusCode(StatusCodes.Status403Forbidden, ApiResponse<bool>.Fail("Your account isn't linked to an organisation."));

    [HttpGet("incidents")]
    public Task<IActionResult> Incidents([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        Dated("incidents", from, to, (t, f, u, zone) => Registers.IncidentsAsync(_db, t, f, u, zone, ct), ct);

    [HttpGet("complaints")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public Task<IActionResult> Complaints([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        Dated("complaints", from, to, (t, f, u, _) => Registers.ComplaintsAsync(_db, t, f, u, ct), ct);

    [HttpGet("restrictive-practices")]
    public Task<IActionResult> RestrictivePractices([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        Dated("restrictive-practices", from, to, (t, f, u, _) => Registers.RestrictivePracticesAsync(_db, t, f, u, ct), ct);

    [HttpGet("risks")]
    public Task<IActionResult> Risks(CancellationToken ct) =>
        Snapshot("risks", (t, zone, _) => Registers.RisksAsync(_db, t, zone, ct), ct);

    [HttpGet("staff-credentials")]
    public Task<IActionResult> StaffCredentials(CancellationToken ct) =>
        Snapshot("staff-credentials", (t, _, today) => Registers.StaffCredentialsAsync(_db, t, today, ct), ct);

    // Checks in the pinned order: organisation (400 or 403), its name (404), then the range (400s), then build, audit, return.
    private async Task<IActionResult> Dated(string register, DateOnly? from, DateOnly? to, Func<Guid, DateOnly, DateOnly, TimeZoneInfo, Task<RegisterFile>> build, CancellationToken ct)
    {
        if (Organisation is not { } tenantId) return NoOrganisationResult();
        if (await OrganisationName(tenantId, ct) is not { } name) return NotFound(ApiResponse<bool>.Fail("Organisation not found."));
        if (from is not { } f || to is not { } t) return BadRequest(ApiResponse<bool>.Fail("Choose a start and an end date."));
        if (f > t) return BadRequest(ApiResponse<bool>.Fail("The start date must be on or before the end date."));

        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone;
        var file = await build(tenantId, f, t, zone);
        return await Send(register, file, $"{Iso(f)}-to-{Iso(t)}", f, t, tenantId, name, ct);
    }

    private async Task<IActionResult> Snapshot(string register, Func<Guid, TimeZoneInfo, DateOnly, Task<RegisterFile>> build, CancellationToken ct)
    {
        if (Organisation is not { } tenantId) return NoOrganisationResult();
        if (await OrganisationName(tenantId, ct) is not { } name) return NotFound(ApiResponse<bool>.Fail("Organisation not found."));

        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone;
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var file = await build(tenantId, zone, today);
        return await Send(register, file, Iso(today), null, null, tenantId, name, ct);
    }

    // A stale or mistyped X-View-As-Tenant: never a header-only file, nor an audit row for no organisation.
    private Task<string?> OrganisationName(Guid tenantId, CancellationToken ct) =>
        _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task<IActionResult> Send(string register, RegisterFile file, string span, DateOnly? from, DateOnly? to, Guid tenantId, string organisation, CancellationToken ct)
    {
        var changes = new List<object> { Change("register", register) };
        if (from is { } f) changes.Add(Change("from", Iso(f)));
        if (to is { } t) changes.Add(Change("to", Iso(t)));
        changes.Add(Change("rows", file.Rows.Count.ToString(CultureInfo.InvariantCulture)));
        _db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(), EntityType = AuditEntityType, EntityId = tenantId, Action = AuditAction.Exported, ChangedAt = _clock.GetUtcNow(),
            ChangedById = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var callerId) ? callerId : null,
            ChangedByName = User.FindFirstValue("fullName") ?? User.FindFirstValue(ClaimTypes.Name),
            Changes = System.Text.Json.JsonSerializer.Serialize(changes),
        });
        await _db.SaveChangesAsync(ct);

        Response.Headers.CacheControl = "no-store";
        return File(file.ToCsv(), "text/csv", $"bunya-support-{register}-{DataExportController.Slug(organisation)}-{span}.csv");
    }

    private static object Change(string field, string @new) => new { field, old = (string?)null, @new };
}
