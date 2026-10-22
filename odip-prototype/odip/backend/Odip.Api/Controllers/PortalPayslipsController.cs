using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;

namespace Odip.Api.Controllers;

/// <summary>
/// My payslips: the signed-in staff member's own payslips from Employment Hero, read when asked and never kept.
/// - The caller is the token's own user: nothing here takes a person from the client. The one client value is a pay run id, read against the caller's own EH employee id.
/// - SuperAdmins, and anyone viewing as someone else, are refused: payslips are private to the person.
/// - No figure is bound, nothing is saved, audited or logged (no logger on purpose), and every answer says no-store.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/portal/payslips")]
public class PortalPayslipsController : ControllerBase
{
    public const string PrivateMessage = "Payslips are private: only the staff member can open them, signed in as themselves.";
    public const string UnavailableMessage = "Employment Hero can't be reached right now. Try again in a few minutes.";
    public const string NeedsAdminMessage = "Payslips can't be shown right now: an Admin needs to check the Employment Hero connection.";
    public const string GoneMessage = "Employment Hero no longer has this payslip. Refresh the list.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly IntegrationKeyProtector _keys;
    private readonly EmploymentHeroClient _client;

    public PortalPayslipsController(OdipDbContext db, ICurrentTenant tenant, IntegrationKeyProtector keys, EmploymentHeroClient client)
    {
        _db = db;
        _tenant = tenant;
        _keys = keys;
        _client = client;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<PortalPayslipsDto>>> List(CancellationToken ct)
    {
        NoStore();
        if (Refused() is { } refusal) return refusal;
        var (status, employeeId, key) = await LinkAsync(_tenant.TenantId!.Value, ct);
        if (employeeId is null) return Ok(ApiResponse<PortalPayslipsDto>.Ok(new PortalPayslipsDto(status, [])));
        if (key is null) return Failed(EmploymentHeroFailure.KeyRefused);
        try
        {
            var slips = await _client.ListPayslipsAsync(key, employeeId, ct);
            var rows = slips
                .OrderByDescending(p => p.DatePaid.HasValue).ThenByDescending(p => p.DatePaid).ThenByDescending(p => p.Id)
                .Select(p => new PortalPayslipDto(p.Id, ToDate(p.DatePaid), ToDate(p.PayPeriodStart), ToDate(p.PayPeriodEnd), p.PaySchedule))
                .ToList();
            return Ok(ApiResponse<PortalPayslipsDto>.Ok(new PortalPayslipsDto(PortalPayslipsDto.Ready, rows)));
        }
        // EH has no such employee: the link is stale, which is the same answer as no link.
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.BusinessNotFound)
        {
            return Ok(ApiResponse<PortalPayslipsDto>.Ok(new PortalPayslipsDto(PortalPayslipsDto.NotLinked, [])));
        }
        catch (EmploymentHeroException ex)
        {
            return Failed(ex.Failure);
        }
    }

    /// <summary>The PDF straight from EH. No file name is sent: the page names the download.</summary>
    [HttpGet("{payRunId:int}/pdf")]
    public async Task<IActionResult> Pdf(int payRunId, CancellationToken ct)
    {
        NoStore();
        if (Refused() is { } refusal) return refusal;
        var (_, employeeId, key) = await LinkAsync(_tenant.TenantId!.Value, ct);
        if (employeeId is null || payRunId <= 0) return NotFound(ApiResponse<bool>.Fail(GoneMessage));
        if (key is null) return Failed(EmploymentHeroFailure.KeyRefused);
        try
        {
            return File(await _client.GetPayslipPdfAsync(key, employeeId, payRunId, ct), "application/pdf");
        }
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.BusinessNotFound)
        {
            return NotFound(ApiResponse<bool>.Fail(GoneMessage));
        }
        catch (EmploymentHeroException ex)
        {
            return Failed(ex.Failure);
        }
    }

    private void NoStore()
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
    }

    /// <summary>A SuperAdmin (viewing as anyone, too) and a view-as caller are refused before anything is read. Under X-View-As-Tenant IsSuperAdmin is false, so the role is read from the token.</summary>
    private ObjectResult? Refused() =>
        User.IsInRole("SuperAdmin") || _tenant.ViewAsUserId is not null || _tenant.TenantId is null
            ? StatusCode(403, ApiResponse<bool>.Fail(PrivateMessage))
            : null;

    /// <summary>EH's words are for Admins and never reach staff: a refused key needs an Admin, everything else is "try again".</summary>
    private ObjectResult Failed(EmploymentHeroFailure failure) =>
        StatusCode(503, ApiResponse<bool>.Fail(failure == EmploymentHeroFailure.KeyRefused ? NeedsAdminMessage : UnavailableMessage));

    /// <summary>
    /// The caller's EH employee id and the organisation's key. The employee id is always the caller's own row in this organisation.
    /// A null key with an employee id means the saved key can't be read (the caller answers 503, with no EH call).
    /// </summary>
    private async Task<(string Status, string? EmployeeId, string? Key)> LinkAsync(Guid tenantId, CancellationToken ct)
    {
        var conn = await _db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        if (conn is null) return (PortalPayslipsDto.NotConnected, null, null);
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        var payrollId = staffId is null ? null
            : await _db.Users.Where(u => u.Id == staffId && u.TenantId == tenantId).Select(u => u.ExternalPayrollId).FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(payrollId)) return (PortalPayslipsDto.NotLinked, null, null);
        return (PortalPayslipsDto.Ready, payrollId, _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId));
    }

    /// <summary>
    /// The caller's own user id, as PortalController.ResolveCurrentStaffIdAsync gives it, but WITHOUT its X-View-As-User preference:
    /// view-as is refused up front, and with no branch here a later edit to that refusal can never show another person's payslips.
    /// </summary>
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId)) return null;
        return await _db.Users.AnyAsync(u => u.Id == userId, ct) ? userId : null;
    }

    private static DateOnly? ToDate(DateTime? v) => v is { } d ? DateOnly.FromDateTime(d) : null;
}
