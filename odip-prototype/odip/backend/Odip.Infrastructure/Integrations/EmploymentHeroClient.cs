using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Odip.Infrastructure.Integrations;

/// <summary>Why an Employment Hero call failed: the card's words come with it, and the sync log stores the name.</summary>
public enum EmploymentHeroFailure { KeyRefused, BusinessNotFound, RateLimited, Unavailable, Refused }

/// <summary>A failed Employment Hero call. The message is for the Admin and never contains the key.</summary>
public sealed class EmploymentHeroException(EmploymentHeroFailure failure, string message) : Exception(message)
{
    public EmploymentHeroFailure Failure { get; } = failure;
    /// <summary>How long EH asked for on a 429, when it said.</summary>
    public TimeSpan? RetryAfter { get; init; }
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
    private const string NotEndingMessage = "Employment Hero kept sending the same employees, so Bunya Support stopped reading the list. Try again in a few minutes.";
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

    private Task<T> GetAsync<T>(string apiKey, string path, CancellationToken ct) => SendAsync<T>(apiKey, HttpMethod.Get, path, null, ct);

    private const int RefusalWordsMax = 200;

    /// <summary>Body serialisation for writes: camelCase, and a null left out (a line with no work type sends none).</summary>
    internal static readonly JsonSerializerOptions WireJson = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    /// <summary>One call: the key goes only into the Basic header, every failure becomes an EmploymentHeroException. A DELETE reads no body.</summary>
    private async Task<T> SendAsync<T>(string apiKey, HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(apiKey + ":")));
        if (body is not null) request.Content = JsonContent.Create(body, options: WireJson);
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
            if (response.StatusCode == HttpStatusCode.BadRequest) throw await RefusedAsync(response, ct);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                var after = response.Headers.RetryAfter;
                throw new EmploymentHeroException(EmploymentHeroFailure.RateLimited, "Employment Hero is busy. Bunya Support tries again at the next sync.")
                {
                    RetryAfter = after?.Delta ?? (after?.Date is { } at ? at - DateTimeOffset.UtcNow : null),
                };
            }
            ThrowForStatus(response);
            if (method == HttpMethod.Delete) return default!;
            try
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                if (method != HttpMethod.Get && string.IsNullOrWhiteSpace(text)) return default!;   // EH's leave PUT and approve document no body
                return JsonSerializer.Deserialize<T>(text, WireJson) ?? throw new JsonException("empty");
            }
            catch (JsonException)
            {
                throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, "Employment Hero sent an answer Bunya Support couldn't read.");
            }
        }
    }

    /// <summary>A 400 is EH saying no to this line: its own words (ProblemDetails detail or title, or a Web API 2 message or model state), clipped, never the request.</summary>
    private static async Task<EmploymentHeroException> RefusedAsync(HttpResponseMessage response, CancellationToken ct)
    {
        string? words = null;
        try
        {
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
                words = new[] { Text(root, "detail"), ModelStateWords(root), Text(root, "title"), Text(root, "message") }.FirstOrDefault(w => w is not null);
        }
        catch (JsonException) { }
        if (words is null) return new EmploymentHeroException(EmploymentHeroFailure.Refused, "Employment Hero refused it.");
        return new EmploymentHeroException(EmploymentHeroFailure.Refused, "Employment Hero refused it: " + (words.Length > RefusalWordsMax ? words[..RefusalWordsMax] : words));
    }

    private static string? Text(JsonElement o, string name) =>
        o.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(p.GetString()) ? p.GetString()!.Trim() : null;

    /// <summary>The first message in an ASP.NET Web API 2 style body: {"message": "...", "modelState": {"field": ["why"]}}.</summary>
    private static string? ModelStateWords(JsonElement o) =>
        o.TryGetProperty("modelState", out var ms) && ms.ValueKind == JsonValueKind.Object
            ? ms.EnumerateObject().Where(f => f.Value.ValueKind == JsonValueKind.Array).SelectMany(f => f.Value.EnumerateArray())
                .Where(v => v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())).Select(v => v.GetString()!.Trim()).FirstOrDefault()
            : null;
}
