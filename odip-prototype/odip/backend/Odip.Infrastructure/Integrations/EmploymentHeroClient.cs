using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Odip.Infrastructure.Integrations;

/// <summary>Why an Employment Hero call failed: the card's words come with it, and the sync log stores the name.</summary>
public enum EmploymentHeroFailure { KeyRefused, BusinessNotFound, RateLimited, Unavailable }

/// <summary>A failed Employment Hero call. The message is for the Admin and never contains the key.</summary>
public sealed class EmploymentHeroException(EmploymentHeroFailure failure, string message) : Exception(message)
{
    public EmploymentHeroFailure Failure { get; } = failure;
}

public sealed record EhBusiness(int Id, string Name);

/// <summary>An employee as <c>/employee/details</c> gives it: only what ODIP keeps in step. No tax, bank, super or pay field is ever read.</summary>
public sealed record EhEmployee(int Id, string? FirstName, string? Surname, string? EmailAddress, string? MobilePhone, DateTime? StartDate, DateTime? EndDate);

/// <summary>
/// Employment Hero Payroll API v2 (formerly KeyPay), AU region: HTTP Basic with the API key as the username and a blank password. A typed
/// HttpClient like NagerHolidayProvider (Program.cs sets a 30 s timeout and redacts the Authorization header from HttpClient's logging). The key is
/// passed per call and only ever goes into that header. Endpoints and their sources: the plan's "Employment Hero Payroll API v2" table.
/// </summary>
public partial class EmploymentHeroClient
{
    public const string DefaultBaseUrl = "https://api.yourpayroll.com.au/";
    private const int PageSize = 100;
    // 20,000 employees: past this the list is not ending, and a run must not page forever.
    private const int MaxPages = 200;
    private const string NotEndingMessage = "Employment Hero kept sending the same employees, so ODIP stopped reading the list. Try again in a few minutes.";
    // EH allows 5 requests a second per key and IP (Usage.html): a short pause between pages keeps a large list under it.
    private static readonly TimeSpan PagePause = TimeSpan.FromMilliseconds(250);
    private readonly HttpClient _http;

    public EmploymentHeroClient(HttpClient http, IConfiguration config)
    {
        _http = http;
        _http.BaseAddress ??= new Uri(config["EmploymentHero:BaseUrl"] ?? DefaultBaseUrl);
    }

    public Task<List<EhBusiness>> ListBusinessesAsync(string apiKey, CancellationToken ct) => GetAsync<List<EhBusiness>>(apiKey, "api/v2/business", ct);

    /// <summary>One call that proves both the key and the business: a 200 means the key works and can see the business.</summary>
    public Task<EhBusiness> GetBusinessAsync(string apiKey, string businessId, CancellationToken ct) =>
        GetAsync<EhBusiness>(apiKey, $"api/v2/business/{Uri.EscapeDataString(businessId)}", ct);

    public Task<EhEmployee> GetEmployeeAsync(string apiKey, string businessId, string employeeId, CancellationToken ct) =>
        GetAsync<EhEmployee>(apiKey, $"api/v2/business/{Uri.EscapeDataString(businessId)}/employee/{Uri.EscapeDataString(employeeId)}/details", ct);

    /// <summary>
    /// Every employee, 100 a page in id order until a short page. Any failure throws, so a caller never acts on part of the list. A page that adds nobody
    /// new (an EH that ignores $skip) or a list past MaxPages is Unavailable, never an endless loop.
    /// </summary>
    public async Task<List<EhEmployee>> ListEmployeesAsync(string apiKey, string businessId, CancellationToken ct)
    {
        var all = new List<EhEmployee>();
        var seen = new HashSet<int>();
        for (var pageNo = 0; pageNo < MaxPages; pageNo++)
        {
            if (pageNo > 0) await Task.Delay(PagePause, ct);
            var page = await GetAsync<List<EhEmployee>>(apiKey,
                $"api/v2/business/{Uri.EscapeDataString(businessId)}/employee/details?$orderby=id&$top={PageSize}&$skip={pageNo * PageSize}", ct);
            var added = page.Count(e => seen.Add(e.Id));
            all.AddRange(page);
            if (page.Count < PageSize) return all;
            if (added == 0) break;
        }
        throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, NotEndingMessage);
    }

    private async Task<T> GetAsync<T>(string apiKey, string path, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(apiKey + ":")));
        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, "Employment Hero couldn't be reached. Try again in a few minutes.");
        }

        using (response)
        {
            switch (response.StatusCode)
            {
                case HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden:
                    throw new EmploymentHeroException(EmploymentHeroFailure.KeyRefused, "Employment Hero didn't accept the API key. Check it in Employment Hero and connect again.");
                case HttpStatusCode.NotFound:
                    throw new EmploymentHeroException(EmploymentHeroFailure.BusinessNotFound, "Employment Hero couldn't find that business or employee for this API key.");
                case HttpStatusCode.TooManyRequests:
                    throw new EmploymentHeroException(EmploymentHeroFailure.RateLimited, "Employment Hero is busy. ODIP tries again at the next sync.");
            }
            if (!response.IsSuccessStatusCode)
                throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, $"Employment Hero answered with an error ({(int)response.StatusCode}). Try again in a few minutes.");
            try
            {
                return await response.Content.ReadFromJsonAsync<T>(ct) ?? throw new JsonException("empty");
            }
            catch (JsonException)
            {
                throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, "Employment Hero sent an answer ODIP couldn't read.");
            }
        }
    }
}
