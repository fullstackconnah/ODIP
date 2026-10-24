using System.Globalization;
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
/// A person's leave balances, read live from Employment Hero for the person's own My leave page and for an Admin looking at a staff member.
/// Nothing is stored, cached, audited or logged here (there is no logger on purpose): balances are payroll data and EH is the only copy.
/// EH's own error words never reach staff, whose view this is: every failure is the one sentence <see cref="UnavailableMessage"/>.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class LeaveBalancesController : ControllerBase
{
    public const string UnavailableMessage = "Balances aren't available right now.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly IntegrationKeyProtector _keys;
    private readonly EmploymentHeroClient _client;

    public LeaveBalancesController(OdipDbContext db, ICurrentTenant tenant, IntegrationKeyProtector keys, EmploymentHeroClient client)
    {
        _db = db;
        _tenant = tenant;
        _keys = keys;
        _client = client;
    }

    /// <summary>The caller's own balances; follows view-as like My leave does.</summary>
    [HttpGet("portal/leave/balances")]
    public async Task<ActionResult<ApiResponse<LeaveBalancesDto>>> Mine(CancellationToken ct)
    {
        if (OrganisationId is not { } tenantId) return Answer(LeaveBalancesDto.NotConnected);
        var userId = await ResolveCurrentStaffIdAsync(ct);
        return userId is null ? Answer(LeaveBalancesDto.NotLinked) : await BalancesAsync(tenantId, userId.Value, ct);
    }

    /// <summary>One staff member's balances, for an Admin. A person of another organisation is a 404 and EH is not called.</summary>
    [HttpGet("staff/{userId:guid}/leave-balances")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<LeaveBalancesDto>>> ForStaff(Guid userId, CancellationToken ct)
    {
        if (OrganisationId is not { } tenantId) return Answer(LeaveBalancesDto.NotConnected);
        if (!await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == tenantId, ct)) return NotFound(ApiResponse<LeaveBalancesDto>.Fail("That person isn't in this organisation."));
        return await BalancesAsync(tenantId, userId, ct);
    }

    /// <summary>The organisation in view; a SuperAdmin who is not viewing one has none.</summary>
    private Guid? OrganisationId => !_tenant.IsSuperAdmin && _tenant.TenantId is { } id ? id : null;

    private async Task<ActionResult<ApiResponse<LeaveBalancesDto>>> BalancesAsync(Guid tenantId, Guid userId, CancellationToken ct)
    {
        var conn = await _db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        if (conn is null) return Answer(LeaveBalancesDto.NotConnected);
        var payrollId = await _db.Users.AsNoTracking().Where(u => u.Id == userId && u.TenantId == tenantId).Select(u => u.ExternalPayrollId).FirstOrDefaultAsync(ct);
        if (!int.TryParse(payrollId, NumberStyles.None, CultureInfo.InvariantCulture, out var employeeId)) return Answer(LeaveBalancesDto.NotLinked);
        var key = _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId);
        if (key is null) return Unavailable();
        try
        {
            var balances = await _client.ListLeaveBalancesAsync(key, conn.BusinessId, employeeId, ct);
            return Answer(LeaveBalancesDto.Ready, balances.Select(b => new LeaveBalanceDto(b.LeaveCategoryName ?? "Leave", b.AccruedAmount ?? 0, b.UnitType ?? "Hours"))
                .OrderBy(b => b.Category, StringComparer.OrdinalIgnoreCase).ToList());
        }
        catch (EmploymentHeroException)
        {
            return Unavailable();
        }
    }

    private static ActionResult<ApiResponse<LeaveBalancesDto>> Answer(string status, List<LeaveBalanceDto>? balances = null) =>
        new OkObjectResult(ApiResponse<LeaveBalancesDto>.Ok(new LeaveBalancesDto(status, balances ?? [])));

    private ActionResult<ApiResponse<LeaveBalancesDto>> Unavailable() =>
        StatusCode(503, ApiResponse<LeaveBalancesDto>.Fail(UnavailableMessage));

    // Copied from PortalController.ResolveCurrentStaffIdAsync: view-as first, then the token's own subject, and the user must exist in this organisation.
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        Guid? ownUserId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        var userId = _tenant.ViewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var exists = await _db.Users.AnyAsync(u => u.Id == userId.Value, ct);
        return exists ? userId : null;
    }
}
