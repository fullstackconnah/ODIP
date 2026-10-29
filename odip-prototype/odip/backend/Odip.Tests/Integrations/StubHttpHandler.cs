using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Odip.Infrastructure.Integrations;

namespace Odip.Tests.Integrations;

/// <summary>The one fake Employment Hero: answers each GET by its path and query from a table (404 for anything else) and records every request. No test ever calls EH.</summary>
internal sealed class StubHttpHandler : HttpMessageHandler
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private readonly Dictionary<string, Func<HttpResponseMessage>> _routes = new();
    public List<HttpRequestMessage> Requests { get; } = new();
    /// <summary>Each request body as sent, in order (null for none): the client disposes the request, so read it here.</summary>
    public List<string?> Bodies { get; } = new();
    private readonly Dictionary<string, Func<HttpResponseMessage>> _methodRoutes = new();
    /// <summary>Runs as each request arrives, before it is answered: a test can change the database while EH is being read.</summary>
    public Action<HttpRequestMessage>? BeforeAnswer { get; set; }

    public StubHttpHandler On(string pathAndQuery, HttpStatusCode status, object? body = null)
    {
        _routes[pathAndQuery] = () => new HttpResponseMessage(status)
        {
            Content = new StringContent(body is null ? "" : JsonSerializer.Serialize(body, Web), Encoding.UTF8, "application/json"),
        };
        return this;
    }

    /// <summary>Answers one verb on a path (tried before the verb-less table), optionally with a Retry-After.</summary>
    public StubHttpHandler On(HttpMethod method, string pathAndQuery, HttpStatusCode status, object? body = null, TimeSpan? retryAfter = null)
    {
        _methodRoutes[$"{method.Method} {pathAndQuery}"] = () =>
        {
            var response = new HttpResponseMessage(status)
            {
                Content = new StringContent(body is null ? "" : body as string ?? JsonSerializer.Serialize(body, Web), Encoding.UTF8, "application/json"),
            };
            if (retryAfter is { } wait) response.Headers.RetryAfter = new RetryConditionHeaderValue(wait);
            return response;
        };
        return this;
    }

    /// <summary>Answers every query on this path the same way, whatever $skip asks for: an EH that never shortens its pages.</summary>
    public StubHttpHandler OnAnyQuery(string path, HttpStatusCode status, object? body = null)
    {
        On(path, status, body);
        _anyQuery.Add(path);
        return this;
    }

    private readonly HashSet<string> _anyQuery = new();

    public StubHttpHandler OnThrow(string pathAndQuery, Exception ex)
    {
        _routes[pathAndQuery] = () => throw ex;
        return this;
    }

    /// <summary>Never answers this path: the request waits until its cancellation token fires.</summary>
    public StubHttpHandler OnHang(string pathAndQuery)
    {
        _hangs.Add(pathAndQuery);
        return this;
    }

    private readonly HashSet<string> _hangs = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        lock (Requests)
        {
            Requests.Add(request);
            Bodies.Add(body);
        }
        BeforeAnswer?.Invoke(request);
        var key = Uri.UnescapeDataString(request.RequestUri!.PathAndQuery);
        if (_hangs.Contains(key)) await Task.Delay(Timeout.Infinite, ct);
        if (_methodRoutes.TryGetValue($"{request.Method.Method} {key}", out var byMethod)) return byMethod();
        if (_anyQuery.Contains(request.RequestUri.AbsolutePath)) key = request.RequestUri.AbsolutePath;
        return _routes.TryGetValue(key, out var answer) ? answer() : new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    public static EmploymentHeroClient Client(StubHttpHandler handler) => new(new HttpClient(handler), new ConfigurationBuilder().Build());

    /// <summary>One EH employee as /employee/details sends it (camelCase, dates without a zone).</summary>
    public static object Employee(int id, string? first, string? surname, string? email, string? mobile = null, string? endDate = null) =>
        new { id, firstName = first, surname, emailAddress = email, mobilePhone = mobile, startDate = "2024-01-15T00:00:00", endDate, taxFileNumber = "123456789" };

    /// <summary>The first (only) page of a business's employees.</summary>
    public static string EmployeesPage(string businessId, int skip = 0) => $"/api/v2/business/{businessId}/employee/details?$orderby=id&$top=100&$skip={skip}";
}
