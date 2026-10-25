using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.DependencyInjection;
using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Auth;

/// <summary>
/// <c>ClientIp</c> decides whether a request carries a real client address or only
/// the proxy's, and therefore whether the failed-sign-in budget belongs to one
/// person or is silently shared by everyone.
///
/// <para>
/// These pin the deployed shape from supervisor cycle 884, where the budget keyed on
/// the proxy's address and one caller sending 10 bad tokens locked out every user.
/// The cause was NOT the lockout code: callers from containers on the host (cloudflared)
/// reach the published port through <c>docker-proxy</c>, so nginx's <c>$remote_addr</c> is
/// the Docker bridge gateway and the real address never arrives. See <see cref="ClientIp"/>.
/// </para>
/// </summary>
public class ClientIpTests
{
    // The deployed values: odip-frontend is 172.31.0.4, the bridge gateway — what
    // docker-proxy leaves behind as the peer — is 172.31.0.1.
    private const string NginxAddress = "172.31.0.4";
    private const string BridgeGateway = "172.31.0.1";

    /// <summary>
    /// A request as the DEPLOYED pipeline delivers it: pushed through the real
    /// <see cref="ForwardedHeadersMiddleware"/> with the deployed options, because
    /// <c>Connection.RemoteIpAddress</c> is only meaningful AFTER that middleware has
    /// run. Reading it off a bare context (as the pre-existing suite does) bypasses
    /// the proxy and cannot see the defect at all.
    /// </summary>
    private static DefaultHttpContext Request(string? peer, string? xff = null)
    {
        var context = new DefaultHttpContext { TraceIdentifier = "trace-1" };
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
            KnownIPNetworks = { new System.Net.IPNetwork(IPAddress.Parse("172.16.0.0"), 12) },
        });
        app.Build()(context);

        return context;
    }

    // ── The proxy-hop shapes: the client is UNKNOWN ──────────────────────────

    [Fact]
    public void The_bridge_gateway_itself_is_the_proxy_not_a_client()
    {
        // Pre-fix, this exact request produced the key "172.31.0.1" — shared by everyone.
        Assert.True(ClientIp.IsIndistinguishableFromProxy(Request(BridgeGateway)));
        Assert.Null(ClientIp.LoginAttemptKey(Request(BridgeGateway)));
    }

    [Fact]
    public void The_gateway_appended_by_nginx_as_the_XFF_entry_still_resolves_to_the_proxy()
    {
        // The literal header the deployed nginx sends: proxy_add_x_forwarded_for APPENDS
        // the peer it saw, and that peer is the gateway docker-proxy left behind. The
        // middleware adopts the rightmost trusted entry, so the app resolves 172.31.0.1
        // even though the client sent 203.0.113.9 in front of it.
        var context = Request(BridgeGateway, $"203.0.113.9, {BridgeGateway}");

        Assert.Equal(BridgeGateway, context.Connection.RemoteIpAddress!.ToString());
        Assert.True(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Null(ClientIp.LoginAttemptKey(context));
    }

    [Fact]
    public void A_chain_of_only_proxy_addresses_is_still_not_a_client()
    {
        var context = Request(NginxAddress, $"{BridgeGateway}, {BridgeGateway}");

        Assert.True(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Null(ClientIp.LoginAttemptKey(context));
    }

    [Fact]
    public void An_unreadable_forwarded_entry_cannot_be_taken_as_the_real_client()
    {
        var context = Request(NginxAddress, $"{BridgeGateway}, not-an-address");

        Assert.True(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Null(ClientIp.LoginAttemptKey(context));
    }

    // ── The partitionable shapes: the client IS identifiable ────────────────

    [Fact]
    public void A_genuine_client_address_behind_the_proxy_gets_its_own_key()
    {
        // nginx serving without the userspace proxy: $remote_addr is the real client and
        // the forwarded header names it as the rightmost entry.
        var context = Request(BridgeGateway, "203.0.113.9");

        Assert.Equal("203.0.113.9", context.Connection.RemoteIpAddress!.ToString());
        Assert.False(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Equal("203.0.113.9", ClientIp.LoginAttemptKey(context));
    }

    [Fact]
    public void Two_tunnel_visitors_behind_nginx_get_two_keys_from_the_single_address_nginx_forwards()
    {
        // Pins only the API half of the contract: given the one address nginx forwards, each visitor gets a key. The nginx half
        // (rewriting $remote_addr from CF-Connecting-IP) is pinned by nginxHeaders.test.ts and a post-deploy probe.
        var a = ClientIp.LoginAttemptKey(Request(NginxAddress, "203.0.113.20"));
        var b = ClientIp.LoginAttemptKey(Request(NginxAddress, "203.0.113.21"));

        Assert.Equal("203.0.113.20", a);
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void A_client_directly_reaching_the_API_with_no_proxy_at_all_is_its_own_key()
    {
        // A non-Docker address is never the proxy hop, whatever the headers claim.
        var context = Request("198.51.100.7", "1.2.3.4");

        Assert.False(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Equal("198.51.100.7", ClientIp.LoginAttemptKey(context));
    }

    [Fact]
    public void Two_different_clients_get_two_different_keys_which_is_the_whole_point()
    {
        // The acceptance criterion, at the level it can be tested offline: two distinct
        // forwarded clients behind one proxy must not share a budget key.
        var a = ClientIp.LoginAttemptKey(Request(BridgeGateway, "203.0.113.9"));
        var b = ClientIp.LoginAttemptKey(Request(BridgeGateway, "203.0.113.10"));

        Assert.Equal("203.0.113.9", a);
        Assert.Equal("203.0.113.10", b);
        Assert.NotEqual(a, b);
    }

    // ── The fail-safe direction, stated deliberately ─────────────────────────

    [Fact]
    public void An_unknown_client_never_becomes_one_global_bucket_and_never_a_per_request_key_either()
    {
        // The old fallback was TraceIdentifier: unique per request, so the counter could
        // never lock anyone out — fail-open, and it also meant every request had its own
        // bucket, so the defence did not exist at all. The new answer is neither a shared
        // literal nor a per-request one: no key at all, which AuthController treats as
        // "do not count" and the startup middleware reports loudly.
        var first = Request(BridgeGateway);
        var second = Request(BridgeGateway);
        second.TraceIdentifier = "trace-2";

        Assert.Null(ClientIp.LoginAttemptKey(first));
        Assert.Null(ClientIp.LoginAttemptKey(second));
        Assert.Null(ClientIp.Resolve(Request(peer: null)));
    }

    [Fact]
    public void A_request_with_no_address_at_all_is_treated_as_unknown_rather_than_pooled()
    {
        Assert.False(ClientIp.IsIndistinguishableFromProxy(Request(peer: null)));
        Assert.Null(ClientIp.LoginAttemptKey(Request(peer: null)));
    }

    [Fact]
    public void A_client_address_the_forwarded_header_omits_is_still_resolvable_from_the_connection()
    {
        // No header at all, and the peer is a real client (not the bridge): a direct
        // connection, and the address stands on its own.
        var context = Request("198.51.100.7");

        Assert.False(ClientIp.IsIndistinguishableFromProxy(context));
        Assert.Equal("198.51.100.7", ClientIp.LoginAttemptKey(context));
    }

    // ── One person cannot buy two budgets ────────────────────────────────────

    [Fact]
    public void An_IPv4_mapped_IPv6_address_is_the_same_client_and_so_the_same_key()
    {
        var v4 = ClientIp.LoginAttemptKey(Request(BridgeGateway, "203.0.113.9"));
        var mapped = ClientIp.LoginAttemptKey(Request(BridgeGateway, "::ffff:203.0.113.9"));

        Assert.Equal(v4, mapped);
    }
}