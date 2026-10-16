using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Odip.Api.Middleware;
using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Auth;

/// <summary>
/// The loud startup warning that says the per-client sign-in budget cannot be
/// partitioned — asserted on the EFFECT it has (a warning really is emitted, on a
/// captured logger provider), never on Program.cs's source text.
///
/// <para>
/// Why this file exists: the warning shipped with its guard inverted
/// (<c>if (!IsIndistinguishableFromProxy)</c>), so it stayed silent on the deployed
/// proxy shape that needs it and fired on every healthy, correctly-partitioned client.
/// Nothing tested it, so run 38888414710 was green. A test that grepped Program.cs for
/// the message would have passed with the <c>!</c> still there and been worse than no
/// test at all — so these run the real middleware over a real context and read what
/// reached the logger.
/// </para>
/// </summary>
public class SignInBudgetPartitionWarningMiddlewareTests
{
    public SignInBudgetPartitionWarningMiddlewareTests() => SignInBudgetPartitionWarningMiddleware.ResetForTests();

    /// <summary>The peer docker-proxy leaves behind: nginx's $remote_addr for EVERY caller.</summary>
    private const string BridgeGateway = "172.31.0.1";

    /// <summary>A genuine external client (RFC 5737 documentation range).</summary>
    private const string GenuineClient = "203.0.113.9";

    private const string WarningMarker = "SIGN-IN BUDGET NOT PARTITIONED";

    /// <summary>
    /// A captured-logger sink. Recording the real <c>ILogger</c> output — category,
    /// level and the FORMATTED message with its placeholders substituted — is what
    /// makes the assertions about observable behaviour rather than about source text.
    /// </summary>
    private sealed class RecordingLoggerProvider : ILoggerProvider
    {
        public List<(string Category, LogLevel Level, string Message)> Entries { get; } = new();

        public ILogger CreateLogger(string categoryName) => new RecordingLogger(this, categoryName);

        public void Dispose() { }

        private sealed class RecordingLogger(RecordingLoggerProvider sink, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                sink.Entries.Add((category, logLevel, formatter(state, exception)));
        }
    }

    /// <summary>
    /// A request as the DEPLOYED pipeline delivers it: pushed through the real
    /// <see cref="ForwardedHeadersMiddleware"/> with the deployed options, because
    /// <c>Connection.RemoteIpAddress</c> is only meaningful AFTER that middleware has
    /// run. Same fixture shape as <see cref="ClientIpTests"/>'s.
    /// </summary>
    private static DefaultHttpContext ProxiedContext(string? peer, string? xff = null)
    {
        var context = new DefaultHttpContext { TraceIdentifier = "trace-1" };
        // Left null deliberately when peer is null: that IS the "no address at all" shape.
        if (peer is not null)
            context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        context.Request.Headers["Host"] = "odip.example";
        context.Request.Headers["X-Forwarded-Proto"] = "http";
        if (xff is not null)
            context.Request.Headers["X-Forwarded-For"] = xff;

        var services = new ServiceCollection();
        services.AddLogging();
        var app = new ApplicationBuilder(services.BuildServiceProvider());
        app.UseForwardedHeaders(new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            KnownNetworks = { new Microsoft.AspNetCore.HttpOverrides.IPNetwork(IPAddress.Parse("172.16.0.0"), 12) },
        });
        app.Build()(context);

        return context;
    }

    /// <summary>Runs the real middleware over <paramref name="context"/> and returns what it logged.</summary>
    private static async Task<List<(string Category, LogLevel Level, string Message)>> RunAsync(HttpContext context)
    {
        var sink = new RecordingLoggerProvider();
        var services = new ServiceCollection();
        services.AddSingleton<ILoggerFactory>(new LoggerFactory([sink]));
        context.RequestServices = services.BuildServiceProvider();

        var downstreamRan = false;
        var middleware = new SignInBudgetPartitionWarningMiddleware(
            _ =>
            {
                downstreamRan = true;
                return Task.CompletedTask;
            },
            context.RequestServices.GetRequiredService<ILoggerFactory>());

        await middleware.InvokeAsync(context);

        // A diagnostic must never short-circuit: whichever way the guard goes, the
        // request continues, or the middleware would be an outage instead of a warning.
        Assert.True(downstreamRan, "the middleware must never block the request");

        return sink.Entries;
    }

    private static IEnumerable<(string Category, LogLevel Level, string Message)> Warnings(
        List<(string Category, LogLevel Level, string Message)> entries) =>
        entries.Where(e => e.Level == LogLevel.Warning && e.Message.Contains(WarningMarker, StringComparison.Ordinal));

    // ── The polarity: this is the assertion the inverted guard failed ──────────

    [Fact]
    public async Task A_request_resolving_to_the_bridge_gateway_DOES_warn()
    {
        // The deployed shape: nginx sends X-Forwarded-For "<client>, 172.31.0.1", the
        // middleware adopts the rightmost trusted entry, so the app resolves the
        // gateway. This is the deployment the warning exists for. With the guard
        // inverted this assertion FAILED, silently, under a green run.
        var context = ProxiedContext(BridgeGateway, $"{GenuineClient}, {BridgeGateway}");

        // Guards the fixture itself, so a pass can never be for the wrong reason.
        Assert.Equal(BridgeGateway, context.Connection.RemoteIpAddress!.ToString());
        Assert.True(ClientIp.IsIndistinguishableFromProxy(context));

        var warnings = Warnings(await RunAsync(context)).ToList();

        var warning = Assert.Single(warnings);
        Assert.Equal(SignInBudgetPartitionWarningMiddleware.LoggerCategory, warning.Category);
        Assert.Equal("Odip.ClientIp", warning.Category);
        // The placeholder must be substituted, or the operator is told nothing:
        Assert.Contains(BridgeGateway, warning.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_genuine_client_address_does_NOT_warn()
    {
        // The other half of the polarity, and the one the inverted guard got wrong the
        // other way: a correctly-partitioned request must be silent, or the log claims
        // "NOT PARTITIONED" for every healthy client and trains the operator to ignore it.
        var context = ProxiedContext(BridgeGateway, GenuineClient);

        Assert.Equal(GenuineClient, context.Connection.RemoteIpAddress!.ToString());
        Assert.False(ClientIp.IsIndistinguishableFromProxy(context));

        var warnings = Warnings(await RunAsync(context)).ToList();

        Assert.Empty(warnings);
    }

    [Fact]
    public async Task A_client_reaching_the_API_with_no_proxy_at_all_does_NOT_warn()
    {
        var warnings = Warnings(await RunAsync(ProxiedContext(GenuineClient))).ToList();

        Assert.Empty(warnings);
    }

    // ── The second shape: no address at all ───────────────────────────────────

    [Fact]
    public async Task A_request_with_no_address_at_all_warns_and_says_which_fault_it_was()
    {
        // IsIndistinguishableFromProxy is FALSE here — "no address" is not "an address in
        // the bridge range" — so a guard written only against that predicate would stay
        // silent on a request whose budget is equally absent. SignInBudgetCannotBePartitioned
        // is defined over LoginAttemptKey precisely to close that.
        var context = ProxiedContext(peer: null);

        Assert.Null(context.Connection.RemoteIpAddress);
        Assert.False(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Null(ClientIp.LoginAttemptKey(context));

        var warnings = Warnings(await RunAsync(context)).ToList();

        var warning = Assert.Single(warnings);
        Assert.Equal("Odip.ClientIp", warning.Category);
        // Named differently from the proxy case: these are different faults to fix.
        Assert.Contains("no client address", warning.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("proxy address", warning.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ── The warning describes exactly the shape the budget is missing ──────────

    [Theory]
    [InlineData(BridgeGateway)]            // the proxy hop, as docker-proxy leaves it
    [InlineData("172.16.0.9")]            // the bottom of 172.16.0.0/12
    [InlineData("172.31.255.254")]        // the top of 172.16.0.0/12
    public async Task Every_address_in_the_bridge_range_warns(string address)
    {
        var context = ProxiedContext(address);
        Assert.True(ClientIp.IsIndistinguishableFromProxy(context));

        var warnings = Warnings(await RunAsync(context)).ToList();

        Assert.Single(warnings);
    }

    [Theory]
    [InlineData("172.15.255.255")]        // just BELOW the bridge range
    [InlineData("172.32.0.1")]            // just ABOVE it
    [InlineData("203.0.113.9")]
    [InlineData("198.51.100.7")]
    public async Task No_address_outside_the_bridge_range_warns(string address)
    {
        var context = ProxiedContext(address);
        Assert.False(ClientIp.IsIndistinguishableFromProxy(context));

        var warnings = Warnings(await RunAsync(context)).ToList();

        Assert.Empty(warnings);
    }

    [Fact]
    public async Task The_warning_appears_once_per_process_and_never_as_an_error()
    {
        var all = new List<(string Category, LogLevel Level, string Message)>();
        for (var i = 0; i < 5; i++)
            all.AddRange(await RunAsync(ProxiedContext(BridgeGateway)));

        Assert.Single(Warnings(all));
        Assert.DoesNotContain(all, e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task A_client_address_request_logs_no_warning_and_does_not_use_up_the_once()
    {
        Assert.Empty(Warnings(await RunAsync(ProxiedContext(GenuineClient))));

        Assert.Single(Warnings(await RunAsync(ProxiedContext(BridgeGateway))));
    }

    [Fact]
    public async Task The_warning_names_the_deploy_layer_fix_an_operator_can_actually_take()
    {
        // A warning that only says something is wrong is a support ticket waiting to
        // happen; this one has to carry the remedy.
        var warning = Assert.Single(Warnings(await RunAsync(ProxiedContext(BridgeGateway))));

        Assert.Contains("docker-proxy", warning.Message, StringComparison.Ordinal);
        Assert.Contains("userland-proxy:false", warning.Message, StringComparison.Ordinal);
    }

    // ── The tie between the warning and the key it describes ──────────────────

    [Theory]
    [InlineData(BridgeGateway, null, true)]        // proxy hop
    [InlineData("172.16.0.9", null, true)]         // proxy hop, low end of range
    [InlineData(null, null, true)]                 // no address at all
    [InlineData(GenuineClient, null, false)]       // a real, partitionable client
    [InlineData("198.51.100.7", null, false)]      // a real, partitionable client
    public async Task The_warning_fires_exactly_when_there_is_no_budget_key(
        string? peer, string? xff, bool expectWarning)
    {
        // The two can never disagree, because the guard is derived from LoginAttemptKey
        // rather than from a second copy of the address test.
        var context = ProxiedContext(peer, xff);

        Assert.Equal(expectWarning, ClientIp.LoginAttemptKey(context) is null);
        Assert.Equal(expectWarning, ClientIp.SignInBudgetCannotBePartitioned(context));

        var warnings = Warnings(await RunAsync(context)).ToList();

        Assert.Equal(expectWarning, warnings.Count == 1);
    }
}
