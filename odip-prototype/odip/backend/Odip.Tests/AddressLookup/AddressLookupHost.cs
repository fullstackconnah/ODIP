using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Integrations;

namespace Odip.Tests.AddressLookup;

/// <summary>
/// The address proxy on a real Kestrel host with only its controller, the real middleware order (authentication, authorization, controllers), a header-driven test
/// sign-in (no X-Test-Role is a 401) and a fake Google behind the typed client. Nothing here reaches Google.
/// </summary>
internal sealed class AddressLookupHost : IAsyncDisposable
{
    public const string Key = "fake-key-for-tests";
    private readonly WebApplication _app;
    public HttpClient Http { get; }
    public StubHttpHandler Google { get; }
    public List<string> Logs { get; }

    private AddressLookupHost(WebApplication app, StubHttpHandler google, List<string> logs)
    {
        _app = app;
        Google = google;
        Logs = logs;
        Http = new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) };
    }

    public static async Task<AddressLookupHost> StartAsync(StubHttpHandler google, string? key = Key, AddressLookupRateLimits? limits = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var logs = new List<string>();
        builder.Logging.ClearProviders();
        builder.Logging.SetMinimumLevel(LogLevel.Trace);
        builder.Logging.AddProvider(new CapturingLogger(logs));
        if (key is not null) builder.Configuration["GooglePlaces:ApiKey"] = key;
        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestSignIn>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddSingleton(limits ?? AddressLookupRateLimits.Default);
        builder.Services.AddSingleton<AddressLookupRateLimiter>();
        builder.Services.AddScoped<AddressLookupRateLimitFilter>();
        builder.Services.AddGooglePlacesClient().ConfigurePrimaryHttpMessageHandler(() => google);
        builder.Logging.QuietGooglePlacesClient();
        builder.Services.AddControllers().ConfigureApplicationPartManager(m =>
        {
            m.ApplicationParts.Clear();
            m.ApplicationParts.Add(new OnlyAddressController());
        });

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        return new AddressLookupHost(app, google, logs);
    }

    public Task<HttpResponseMessage> SuggestAsync(string? body, string? role = "Coordinator", string user = "u1")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/address/suggest")
        {
            Content = body is null ? null : new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
        return Send(request, role, user);
    }

    public Task<HttpResponseMessage> DetailsAsync(string query, string? role = "Coordinator", string user = "u1") =>
        Send(new HttpRequestMessage(HttpMethod.Get, "/api/v1/address/details" + query), role, user);

    private Task<HttpResponseMessage> Send(HttpRequestMessage request, string? role, string user)
    {
        if (role is not null) request.Headers.Add("X-Test-Role", role);
        request.Headers.Add("X-Test-User", user);
        return Http.SendAsync(request);
    }

    public async ValueTask DisposeAsync()
    {
        Http.Dispose();
        await _app.DisposeAsync();
    }

    private sealed class OnlyAddressController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyAddressController);
        public IEnumerable<TypeInfo> Types { get; } = [typeof(AddressLookupController).GetTypeInfo()];
    }

    private sealed class TestSignIn(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-Role", out var role)) return Task.FromResult(AuthenticateResult.NoResult());
            var identity = new ClaimsIdentity(
                new[] { new Claim(ClaimTypes.NameIdentifier, Request.Headers["X-Test-User"].ToString()), new Claim(ClaimTypes.Role, role.ToString()) }, "Test");
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
        }
    }

    private sealed class CapturingLogger(List<string> sink) : ILoggerProvider
    {
        public ILogger CreateLogger(string categoryName) => new Sink(sink);
        public void Dispose() { }

        private sealed class Sink(List<string> sink) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                lock (sink) sink.Add($"{logLevel}: {formatter(state, exception)} {exception}");
            }
        }
    }
}
