using System.Net;
using Microsoft.AspNetCore.Http;
using Odip.Api.RateLimiting;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>The per-client partition key of the early-access limiter (see EarlyAccessRateLimiting.ClientKey).</summary>
public class EarlyAccessClientKeyTests
{
    private static string Key(string? address)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = address is null ? null : IPAddress.Parse(address);
        return EarlyAccessRateLimiting.ClientKey(context);
    }

    [Fact]
    public void IPv4_IsKeyedByTheAddress()
    {
        Assert.Equal("203.0.113.7", Key("203.0.113.7"));
        Assert.NotEqual(Key("203.0.113.7"), Key("203.0.113.8"));
    }

    [Fact]
    public void IPv4MappedIPv6_IsTheSameClientAsItsIPv4Address()
    {
        Assert.Equal(Key("203.0.113.7"), Key("::ffff:203.0.113.7"));
    }

    [Fact]
    public void IPv6_IsKeyedByItsSlash64_SoRotatingWithinOneBlockDoesNotMintNewBudgets()
    {
        var a = Key("2001:db8:aaaa:bbbb:1:2:3:4");
        var b = Key("2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff");
        var otherBlock = Key("2001:db8:aaaa:cccc:1:2:3:4");

        Assert.Equal(a, b);
        Assert.Equal("2001:db8:aaaa:bbbb::/64", a);
        Assert.NotEqual(a, otherBlock);
    }

    [Fact]
    public void IPv6_ScopeIdIsIgnored()
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("fe80::1:2:3:4%5");

        Assert.DoesNotContain("%", EarlyAccessRateLimiting.ClientKey(context));
    }

    [Fact]
    public void NoAddress_FallsBackToTheTraceIdentifier_SoUnresolvableClientsAreNotPooled()
    {
        var first = new DefaultHttpContext { TraceIdentifier = "trace-1" };
        var second = new DefaultHttpContext { TraceIdentifier = "trace-2" };

        Assert.Equal("trace-1", EarlyAccessRateLimiting.ClientKey(first));
        Assert.NotEqual(EarlyAccessRateLimiting.ClientKey(first), EarlyAccessRateLimiting.ClientKey(second));
    }
}
