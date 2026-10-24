using System.Globalization;
using System.Text.Json;

namespace Odip.Infrastructure.Integrations;

public sealed record EhLeaveCategory(int Id, string? Name);
public sealed record EhStandardHours(decimal? StandardHoursPerDay);
public sealed record EhLeaveBalance(string? LeaveCategoryName, decimal? AccruedAmount, string? UnitType);
/// <summary>Sent; the dates are strings, so they never gain an offset.</summary>
public sealed record EhLeaveLine(int? Id, int EmployeeId, string FromDate, string ToDate, int LeaveCategoryId, decimal Hours, string Notes, bool AutomaticallyApprove);
/// <summary>Read back; EH's dates have no zone, and only their date part is used.</summary>
public sealed record EhLeaveRef(int Id, int EmployeeId, int? LeaveCategoryId, DateTime FromDate, DateTime ToDate, string? Status, string? Notes);

/// <summary>Employment Hero leave (PR 3): write, find, read and delete one leave request, plus categories, standard hours and balances.</summary>
public partial class EmploymentHeroClient
{
    private static string Num(int n) => n.ToString(CultureInfo.InvariantCulture);
    private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static string Employee(string businessId, int employeeId) => $"{Business(businessId)}/employee/{Num(employeeId)}";
    private static string Leave(string businessId, int employeeId, int leaveId) => $"{Employee(businessId, employeeId)}/leaverequest/{Num(leaveId)}";

    public Task<List<EhLeaveCategory>> ListLeaveCategoriesAsync(string apiKey, string businessId, CancellationToken ct) =>
        GetAsync<List<EhLeaveCategory>>(apiKey, $"{Business(businessId)}/leavecategory", ct);

    /// <summary>The employee's hours per day, or null when EH has none on record.</summary>
    public async Task<decimal?> GetStandardHoursPerDayAsync(string apiKey, string businessId, int employeeId, CancellationToken ct) =>
        (await GetAsync<EhStandardHours>(apiKey, $"{Employee(businessId, employeeId)}/standardhours", ct)).StandardHoursPerDay;

    public Task<List<EhLeaveBalance>> ListLeaveBalancesAsync(string apiKey, string businessId, int employeeId, CancellationToken ct) =>
        GetAsync<List<EhLeaveBalance>>(apiKey, $"{Employee(businessId, employeeId)}/leavebalances", ct);

    public Task<EhLeaveRef> CreateLeaveRequestAsync(string apiKey, string businessId, int employeeId, EhLeaveLine line, CancellationToken ct) =>
        SendAsync<EhLeaveRef>(apiKey, HttpMethod.Post, $"{Employee(businessId, employeeId)}/leaverequest", line, ct);

    /// <summary>EH documents no answer body for the update.</summary>
    public Task UpdateLeaveRequestAsync(string apiKey, string businessId, int employeeId, int leaveId, EhLeaveLine line, CancellationToken ct) =>
        SendAsync<JsonElement>(apiKey, HttpMethod.Put, Leave(businessId, employeeId, leaveId), line with { Id = leaveId }, ct);

    public Task ApproveLeaveRequestAsync(string apiKey, string businessId, int employeeId, int leaveId, CancellationToken ct) =>
        SendAsync<JsonElement>(apiKey, HttpMethod.Post, Leave(businessId, employeeId, leaveId) + "/approve", null, ct);

    /// <summary>The request, or null when EH has no such request (404).</summary>
    public async Task<EhLeaveRef?> GetLeaveRequestAsync(string apiKey, string businessId, int employeeId, int leaveId, CancellationToken ct)
    {
        try
        {
            return await GetAsync<EhLeaveRef>(apiKey, Leave(businessId, employeeId, leaveId), ct);
        }
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.BusinessNotFound)
        {
            return null;
        }
    }

    /// <summary>True when the request was deleted, false when it was already gone (404).</summary>
    public async Task<bool> DeleteLeaveRequestAsync(string apiKey, string businessId, int employeeId, int leaveId, CancellationToken ct)
    {
        try
        {
            await SendAsync<JsonElement>(apiKey, HttpMethod.Delete, Leave(businessId, employeeId, leaveId), null, ct);
            return true;
        }
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.BusinessNotFound)
        {
            return false;
        }
    }

    /// <summary>Requests overlapping the dates (every status), for one employee or the whole business.</summary>
    public Task<List<EhLeaveRef>> ListLeaveRequestsAsync(string apiKey, string businessId, DateOnly from, DateOnly to, int? employeeId, CancellationToken ct) =>
        GetAsync<List<EhLeaveRef>>(apiKey,
            $"{Business(businessId)}/leaverequest?FromDate={Day(from)}&ToDate={Day(to)}" + (employeeId is { } e ? $"&EmployeeId={Num(e)}" : ""), ct);
}
