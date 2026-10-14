using System.Globalization;
using System.Reflection;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DataExport;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Settings → Data export. An organisation's Admin, or a SuperAdmin viewing as the organisation (the Terms' "on request" case), downloads
/// everything it holds as one ZIP (DataExportWriter), streamed as it is built.
/// Every download that completes writes one audit row (EntityType Tenant, the organisation's id, Exported, no data), and GET last reads it.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,SuperAdmin")]
[Route("api/v1/data-export")]
public class DataExportController : ControllerBase
{
    public const string NoOrganisation = "Choose an organisation to view as before exporting data.";

    // Nothing in the build carries a commit, so this is the API assembly's version. Stamping the commit at deploy time is a follow-up.
    private static readonly string Build =
        typeof(DataExportController).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly ILogger<DataExportController> _logger;
    private readonly TimeProvider _clock;

    public DataExportController(OdipDbContext db, ICurrentTenant tenant, ILogger<DataExportController> logger, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>
    /// The organisation in scope, or null (see NoOrganisationResult).
    /// - An Admin's is the tenant_id claim. CurrentTenant ignores X-View-As-Tenant for anyone but a SuperAdmin.
    /// - A SuperAdmin's is the one they explicitly chose with X-View-As-Tenant. CurrentTenant then sets TenantId to it and IsSuperAdmin to false.
    /// - With no choice, IsSuperAdmin stays true and the filters are all off. TenantId may still be set from a tenant_id claim (CurrentTenantTests),
    ///   so TenantId alone is not enough here, unlike ProviderSettingsController.
    /// Every query below then names this id explicitly; none relies on the query filter.
    /// </summary>
    private Guid? Organisation => _tenant.IsSuperAdmin ? null : _tenant.TenantId;

    /// <summary>
    /// No organisation in scope: a SuperAdmin who hasn't chosen one gets 400 with what to do; anyone else (an Admin whose token names no
    /// organisation) gets 403, because choosing one is not theirs to do.
    /// </summary>
    private ObjectResult NoOrganisationResult() => _tenant.IsSuperAdmin
        ? BadRequest(ApiResponse<bool>.Fail(NoOrganisation))
        : StatusCode(StatusCodes.Status403Forbidden, ApiResponse<bool>.Fail("Your account isn't linked to an organisation."));

    [HttpGet("last")]
    public async Task<ActionResult<ApiResponse<DataExportLastDto?>>> Last(CancellationToken ct)
    {
        if (Organisation is not { } tenantId) return NoOrganisationResult();

        var last = await _db.AuditLogs.AsNoTracking()
            .Where(a => a.EntityType == nameof(Tenant) && a.EntityId == tenantId && a.Action == AuditAction.Exported)
            .OrderByDescending(a => a.ChangedAt)
            .Select(a => new { a.ChangedAt, a.ChangedByName })
            .FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<DataExportLastDto?>.Ok(last is null ? null : new DataExportLastDto { ExportedAt = last.ChangedAt.UtcDateTime, ExportedByName = last.ChangedByName }));
    }

    [HttpGet]
    public async Task<IActionResult> Download(CancellationToken ct)
    {
        if (Organisation is not { } tenantId) return NoOrganisationResult();

        var name = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);
        // A stale or mistyped X-View-As-Tenant: never a complete-looking ZIP of empty files, nor an audit row for no organisation.
        if (name is null) return NotFound(ApiResponse<bool>.Fail("Organisation not found."));
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        // ZipArchive writes its headers synchronously on .NET 8, which Kestrel refuses unless the request allows it: this request only.
        if (HttpContext.Features.Get<IHttpBodyControlFeature>() is { } body) body.AllowSynchronousIO = true;
        Response.ContentType = "application/zip";
        Response.Headers.ContentDisposition = $"attachment; filename=\"odip-export-{Slug(name)}-{today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.zip\"";
        Response.Headers.CacheControl = "no-store";

        try
        {
            await Response.StartAsync(ct);
            await DataExportWriter.WriteAsync(Response.Body, _db, tenantId, ExportTables.All, _clock.GetUtcNow().UtcDateTime, Build, ct);
            // After the last byte, so a download that fails never moves the "last exported" line.
            _db.AuditLogs.Add(new AuditLog
            {
                Id = Guid.NewGuid(), EntityType = nameof(Tenant), EntityId = tenantId, Action = AuditAction.Exported, ChangedAt = _clock.GetUtcNow(),
                ChangedById = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var callerId) ? callerId : null,
                ChangedByName = User.FindFirstValue("fullName") ?? User.FindFirstValue(ClaimTypes.Name),
            });
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            // The 200 and part of the ZIP are already out. Ending the response cleanly would hand the browser a truncated file that it saves as
            // whole. Aborting resets the connection, so the download fails.
            // Nothing is rethrown: ExceptionHandlingMiddleware would try to write a 500 into the started response.
            if (ct.IsCancellationRequested) _logger.LogInformation("Data export for {TenantId} stopped: the client went away", tenantId);
            else _logger.LogError(ex, "Data export for {TenantId} failed after the response started", tenantId);
            HttpContext.Abort();
        }
        return new EmptyResult();
    }

    /// <summary>The organisation's name made safe for a file name: lower-case letters and digits, with each run of anything else as one hyphen.</summary>
    public static string Slug(string name)
    {
        var slug = Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return slug.Length == 0 ? "organisation" : slug;
    }
}
