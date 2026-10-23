using System.Text.Json;

namespace Odip.Infrastructure.Integrations;

public sealed record EhWorkType(int Id, string? Name, string? MappingType);
public sealed record EhPaySchedule(int Id, string? Name, string? Frequency);
public sealed record EhNextPayDate(int PayScheduleId, DateTime? NextScheduledFromDate, DateTime? NextScheduledToDate);
public sealed record EhPayRun(int Id, int PayScheduleId, DateTime PayPeriodStarting, DateTime PayPeriodEnding, bool IsFinalised);
public sealed record EhBreak(string StartTime, string EndTime, bool IsPaidBreak);
/// <summary>The line as sent. String times never gain an offset: EH reads them as the business's wall clock.</summary>
public sealed record EhTimesheetLine(int? Id, int EmployeeId, string StartTime, string EndTime, List<EhBreak> Breaks, int? WorkTypeId, string ExternalId);
/// <summary>Read back from create, update and find: EH's other fields (some of them string ids) can't break it.</summary>
public sealed record EhTimesheetRef(int Id, string? ExternalId);
/// <summary>Read back from get.</summary>
public sealed record EhTimesheetState(int Id, string? Status);

/// <summary>Employment Hero timesheets (PR 2): write, find, read and delete one line, plus the lists the Payroll page and work-type settings need.</summary>
public partial class EmploymentHeroClient
{
    private static string Business(string businessId) => $"api/v2/business/{Uri.EscapeDataString(businessId)}";

    /// <summary>Only the work types a timesheet line can carry: pay categories, not leave, shift conditions or others.</summary>
    public async Task<List<EhWorkType>> ListWorkTypesAsync(string apiKey, string businessId, CancellationToken ct) =>
        (await GetAsync<List<EhWorkType>>(apiKey, $"{Business(businessId)}/worktype", ct)).Where(w => w.MappingType is "PayCategory" or "PrimaryPayCategory").ToList();

    public Task<List<EhPaySchedule>> ListPaySchedulesAsync(string apiKey, string businessId, CancellationToken ct) =>
        GetAsync<List<EhPaySchedule>>(apiKey, $"{Business(businessId)}/payschedule", ct);

    public Task<List<EhNextPayDate>> ListNextPayDatesAsync(string apiKey, string businessId, CancellationToken ct) =>
        GetAsync<List<EhNextPayDate>>(apiKey, $"{Business(businessId)}/payschedule/nextpaydates", ct);

    public Task<List<EhPayRun>> ListRecentPayRunsAsync(string apiKey, string businessId, CancellationToken ct) =>
        GetAsync<List<EhPayRun>>(apiKey, $"{Business(businessId)}/payrun?$orderby=PayPeriodEnding desc&$top=30", ct);

    /// <summary>One line. enforceUniqueExternalId makes EH refuse a second line with the same externalId (400), so a retry after a lost answer can't double up.</summary>
    public Task<EhTimesheetRef> CreateTimesheetAsync(string apiKey, string businessId, EhTimesheetLine line, CancellationToken ct) =>
        SendAsync<EhTimesheetRef>(apiKey, HttpMethod.Post, $"{Business(businessId)}/timesheet?enforceUniqueExternalId=true", line, ct);

    /// <summary>The first line with this externalId, or null.</summary>
    public async Task<EhTimesheetRef?> FindTimesheetByExternalIdAsync(string apiKey, string businessId, string externalId, CancellationToken ct) =>
        (await GetAsync<List<EhTimesheetRef>>(apiKey, $"{Business(businessId)}/timesheet?$filter=ExternalId eq '{externalId.Replace("'", "''")}'", ct)).FirstOrDefault();

    /// <summary>The line, or null when EH has no such line (404).</summary>
    public async Task<EhTimesheetState?> GetTimesheetAsync(string apiKey, string businessId, int lineId, CancellationToken ct)
    {
        try
        {
            return await GetAsync<EhTimesheetState>(apiKey, $"{Business(businessId)}/timesheet/{lineId}", ct);
        }
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.BusinessNotFound)
        {
            return null;
        }
    }

    public Task<EhTimesheetRef> UpdateTimesheetAsync(string apiKey, string businessId, int lineId, EhTimesheetLine line, CancellationToken ct) =>
        SendAsync<EhTimesheetRef>(apiKey, HttpMethod.Put, $"{Business(businessId)}/timesheet/{lineId}", line with { Id = lineId }, ct);

    /// <summary>True when the line was deleted, false when it was already gone (404).</summary>
    public async Task<bool> DeleteTimesheetAsync(string apiKey, string businessId, int lineId, CancellationToken ct)
    {
        try
        {
            await SendAsync<JsonElement>(apiKey, HttpMethod.Delete, $"{Business(businessId)}/timesheet/{lineId}", null, ct);
            return true;
        }
        catch (EmploymentHeroException ex) when (ex.Failure == EmploymentHeroFailure.BusinessNotFound)
        {
            return false;
        }
    }
}
