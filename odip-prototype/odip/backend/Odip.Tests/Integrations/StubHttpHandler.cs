using System.Net;
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

    public StubHttpHandler On(string pathAndQuery, HttpStatusCode status, object? body = null)
    {
        _routes[pathAndQuery] = () => new HttpResponseMessage(status)
        {
            Content = new StringContent(body is null ? "" : JsonSerializer.Serialize(body, Web), Encoding.UTF8, "application/json"),
        };
        return this;
    }

    public StubHttpHandler OnThrow(string pathAndQuery, Exception ex)
    {
        _routes[pathAndQuery] = () => throw ex;
        return this;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Add(request);
        var key = Uri.UnescapeDataString(request.RequestUri!.PathAndQuery);
        return Task.FromResult(_routes.TryGetValue(key, out var answer) ? answer() : new HttpResponseMessage(HttpStatusCode.NotFound));
    }

    public static EmploymentHeroClient Client(StubHttpHandler handler) => new(new HttpClient(handler), new ConfigurationBuilder().Build());

    /// <summary>One EH employee as /employee/details sends it (camelCase, dates without a zone).</summary>
    public static object Employee(int id, string? first, string? surname, string? email, string? mobile = null, string? endDate = null) =>
        new { id, firstName = first, surname, emailAddress = email, mobilePhone = mobile, startDate = "2024-01-15T00:00:00", endDate, taxFileNumber = "123456789" };

    /// <summary>The first (only) page of a business's employees.</summary>
    public static string EmployeesPage(string businessId, int skip = 0) => $"/api/v2/business/{businessId}/employee/details?$top=100&$skip={skip}";
}
