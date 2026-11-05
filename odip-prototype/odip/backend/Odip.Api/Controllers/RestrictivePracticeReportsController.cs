using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The monthly restrictive practice reports: the worklist of months owed, lodging one (recording that it was reported to the NDIS Commission), undoing a lodge, and a CSV
/// of a month. Admin, Coordinator and SuperAdmin only, as the register's own writes are. Every action works on one organisation, and every query names it
/// explicitly: a SuperAdmin context has no tenant filter.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/restrictive-practice-reports")]
public class RestrictivePracticeReportsController : ControllerBase
{
    public const string ChooseOrganisation = "Choose an organisation to view as first: monthly reports belong to one organisation.";
    private const string NoSuchMonth = "This practice has no monthly report for that month.";
    private const string AlreadyLodged = "This month has already been lodged. Reload to see it.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;

    public RestrictivePracticeReportsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
    }

    private Task<List<RestrictivePracticeReportLineDto>> LinesAsync(Guid tenantId, IReadOnlyCollection<Guid>? participantIds, CancellationToken ct) =>
        RestrictivePracticeReportWorklist.LinesAsync(_db, _clock.GetUtcNow().UtcDateTime, tenantId, participantIds, withDetails: true, ct);

    private async Task<DateOnly> TodayAsync(Guid tenantId, CancellationToken ct) =>
        ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone);

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<RestrictivePracticeReportLineDto>>>> GetLines([FromQuery] Guid? participantId, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<List<RestrictivePracticeReportLineDto>>.Fail(ChooseOrganisation));
        var lines = await LinesAsync(tenantId, participantId is { } id ? [id] : null, ct);
        return Ok(ApiResponse<List<RestrictivePracticeReportLineDto>>.Ok(lines));
    }

    /// <summary>One month's lines as a CSV; the month defaults to the organisation's last ended month.</summary>
    [HttpGet("csv")]
    public async Task<IActionResult> GetCsv([FromQuery] DateOnly? month, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<bool>.Fail(ChooseOrganisation));
        var wanted = month ?? RestrictivePracticeMonthlyReporting.LastEndedMonth(await TodayAsync(tenantId, ct));
        if (wanted.Day != 1) return BadRequest(ApiResponse<bool>.Fail("Choose a month."));
        var lines = (await LinesAsync(tenantId, null, ct)).Where(l => l.Month == wanted);
        return File(RestrictivePracticeReportCsv.Build(lines), "text/csv", $"rp-monthly-reports-{wanted.ToString("yyyy-MM", CultureInfo.InvariantCulture)}.csv");
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<RestrictivePracticeReportLineDto>>> Lodge([FromBody] LodgeRestrictivePracticeReportDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<RestrictivePracticeReportLineDto>.Fail(ChooseOrganisation));
        var practice = await _db.RestrictivePractices.AsNoTracking().FirstOrDefaultAsync(rp => rp.Id == dto.RestrictivePracticeId && rp.TenantId == tenantId, ct);
        if (practice == null) return NotFound(ApiResponse<RestrictivePracticeReportLineDto>.Fail("Restrictive practice entry not found"));
        if (dto.Month.Day != 1) return BadRequest(ApiResponse<RestrictivePracticeReportLineDto>.Fail("Choose a month."));

        // The worklist is the one rule for which months exist (cut-over, authorisation window, Eliminated, a deactivated practice's months with a use).
        var line = (await LinesAsync(tenantId, [practice.ParticipantId], ct)).FirstOrDefault(l => l.RestrictivePracticeId == practice.Id && l.Month == dto.Month);
        if (line == null) return BadRequest(ApiResponse<RestrictivePracticeReportLineDto>.Fail(NoSuchMonth));
        if (line.Report != null) return Conflict(ApiResponse<RestrictivePracticeReportLineDto>.Fail(AlreadyLodged));

        // JsonStringEnumConverter also accepts a bare integer; an undefined value would otherwise be stored.
        if (!Enum.IsDefined(dto.ReportType) || (dto.VariedKind is { } kind && !Enum.IsDefined(kind)))
            return BadRequest(ApiResponse<RestrictivePracticeReportLineDto>.Fail("Choose a valid report type."));

        var prn = line.UseKind == RestrictivePracticeUseKind.Prn;
        var today = await TodayAsync(tenantId, ct);
        var error = dto.ReportType switch
        {
            RestrictivePracticeReportType.UsedAsPerPlan or RestrictivePracticeReportType.VariedUse when prn => "Used as per plan and varied use are for routine practices only.",
            RestrictivePracticeReportType.UsesReported when !prn => "Uses reported is for as-needed practices only.",
            _ => null,
        };
        if (error == null && dto.ReportType == RestrictivePracticeReportType.VariedUse)
            error = dto.VariedKind == null ? "Choose how the use was varied." : dto.VariedAlsoUnauthorised == null ? "Say whether the varied use was also unauthorised." : null;
        error ??= dto.LodgedOn > today ? "The lodged date can't be in the future."
            : dto.LodgedOn < dto.Month.AddMonths(1) ? "The lodged date must be after the month ends."
            : dto.Note is { Length: > 2000 } ? "Keep the note under 2,000 characters." : null;
        if (error != null) return BadRequest(ApiResponse<RestrictivePracticeReportLineDto>.Fail(error));

        Guid? userId = Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;
        var name = userId == null ? null : await _db.Users.Where(u => u.Id == userId).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefaultAsync(ct);
        var varied = dto.ReportType == RestrictivePracticeReportType.VariedUse;
        _db.RestrictivePracticeMonthlyReports.Add(new RestrictivePracticeMonthlyReport
        {
            Id = Guid.NewGuid(), TenantId = practice.TenantId, RestrictivePracticeId = practice.Id, Month = dto.Month, ReportType = dto.ReportType,
            VariedKind = varied ? dto.VariedKind : null, VariedAlsoUnauthorised = varied ? dto.VariedAlsoUnauthorised : null,
            UseCount = prn ? line.Uses.Count : null, Note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim(), LodgedOn = dto.LodgedOn,
            LodgedByUserId = userId, LodgedByName = string.IsNullOrWhiteSpace(name) ? "A staff member" : name,
            PracticeType = practice.Type, PracticeDescription = practice.Description, CreatedAt = _clock.GetUtcNow().UtcDateTime,
        });
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Another request lodged the same month between the check above and this save.
            return Conflict(ApiResponse<RestrictivePracticeReportLineDto>.Fail(AlreadyLodged));
        }

        var lodged = (await LinesAsync(tenantId, [practice.ParticipantId], ct)).First(l => l.RestrictivePracticeId == practice.Id && l.Month == dto.Month);
        return Ok(ApiResponse<RestrictivePracticeReportLineDto>.Ok(lodged));
    }

    /// <summary>Undo a lodge (a mistake): the month goes back to Due or Overdue.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<bool>.Fail(ChooseOrganisation));
        var report = await _db.RestrictivePracticeMonthlyReports.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId, ct);
        if (report == null) return NotFound(ApiResponse<bool>.Fail("Monthly report not found"));
        _db.RestrictivePracticeMonthlyReports.Remove(report);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
