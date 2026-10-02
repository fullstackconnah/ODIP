using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Odip.Api.RateLimiting;

/// <summary>
/// Marks the action(s) covered by <see cref="EarlyAccessRateLimiting"/>. The limiter keys on this endpoint
/// metadata rather than on the request path, so path spellings the router accepts (trailing slash, letter
/// case) cannot slip past it — whatever routes to a marked action is limited — and CORS preflights, which
/// never match the action, do not spend the visitor's budget.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public sealed class EarlyAccessRateLimitAttribute : Attribute
{
}

/// <summary>The two tiers of the early-access limiter. <see cref="Default"/> is what production uses.</summary>
public sealed record EarlyAccessRateLimits(
    int PerClientPermits, TimeSpan PerClientWindow, int GlobalPermits, TimeSpan GlobalWindow)
{
    /// <summary>
    /// 5 submissions per client IP per 10 minutes (the contract), and 60 across ALL clients per 10 minutes.
    /// The global tier is a flood brake, not a fairness tool: a real B2B interest form does not see a
    /// submission a minute, while a distributed script (many IPs, each under its own limit) could otherwise
    /// fill the table and, when notifications are configured, the operator's inbox.
    /// </summary>
    public static EarlyAccessRateLimits Default { get; } =
        new(5, TimeSpan.FromMinutes(10), 60, TimeSpan.FromMinutes(10));
}

/// <summary>
/// Rate limiting for the public early-access form: a per-client limit and a global cap, chained in that order
/// (<see cref="PartitionedRateLimiter.CreateChained{TResource}"/>). The order matters: a client that is already
/// over its own limit is rejected before the shared budget is touched, so one noisy address cannot use up the
/// global cap and lock everyone else out.
///
/// It is installed as the app's <c>GlobalLimiter</c>, but does nothing for any request that is not routed to an
/// <see cref="EarlyAccessRateLimitAttribute"/> action (those get <see cref="RateLimitPartition.GetNoLimiter{TKey}"/>),
/// so every other endpoint keeps exactly its own named policy. Counts are in-process: like LoginAttemptTracker, a
/// second API replica would get its own counts.
/// </summary>
public static class EarlyAccessRateLimiting
{
    private const string NotLimitedPartition = "early-access:not-limited";

    /// <summary>
    /// The per-client partition key: the client's IPv4 address (an IPv4-mapped IPv6 address counts as the IPv4
    /// address it carries), or the /64 prefix of an IPv6 address. One subscriber or host normally owns a whole /64,
    /// so keying on the full address would let it mint a fresh 5-permit budget per request — and a fresh limiter
    /// that lives out the whole window — just by rotating addresses. With no resolvable address it falls back to
    /// the trace identifier, so unresolvable clients never collapse into one shared bucket.
    /// </summary>
    public static string ClientKey(HttpContext context)
    {
        var address = context.Connection.RemoteIpAddress;
        if (address is null)
            return context.TraceIdentifier;

        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();

        if (address.AddressFamily != AddressFamily.InterNetworkV6)
            return address.ToString();

        Span<byte> bytes = stackalloc byte[16];
        address.TryWriteBytes(bytes, out _);
        bytes[8..].Clear();
        return new IPAddress(bytes).ToString() + "/64";
    }

    /// <param name="clientKey">
    /// Resolves the per-client partition key from the request — in the app, the real client address
    /// (resolved after <c>UseForwardedHeaders</c>), falling back to the trace identifier so that an
    /// unresolvable address does not collapse every such client into one shared bucket.
    /// </param>
    public static PartitionedRateLimiter<HttpContext> CreateLimiter(Func<HttpContext, string> clientKey, EarlyAccessRateLimits limits) =>
        PartitionedRateLimiter.CreateChained(
            PartitionedRateLimiter.Create<HttpContext, string>(context =>
                IsEarlyAccessRequest(context)
                    ? RateLimitPartition.GetFixedWindowLimiter(
                        "early-access:client:" + clientKey(context),
                        _ => Window(limits.PerClientPermits, limits.PerClientWindow))
                    : RateLimitPartition.GetNoLimiter(NotLimitedPartition)),
            PartitionedRateLimiter.Create<HttpContext, string>(context =>
                IsEarlyAccessRequest(context)
                    ? RateLimitPartition.GetFixedWindowLimiter(
                        "early-access:global",
                        _ => Window(limits.GlobalPermits, limits.GlobalWindow))
                    : RateLimitPartition.GetNoLimiter(NotLimitedPartition)));

    private static bool IsEarlyAccessRequest(HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<EarlyAccessRateLimitAttribute>() is not null;

    // Fixed windows, not sliding: in .NET 8 a rejected sliding-window lease carries no RetryAfter value, and the
    // contract promises a Retry-After header. The cost is that a client can land 5 requests at the end of one window
    // and 5 more at the start of the next; for a flood guard on a low-traffic form that is acceptable.
    private static FixedWindowRateLimiterOptions Window(int permits, TimeSpan window) => new()
    {
        PermitLimit = permits,
        Window = window,
        QueueLimit = 0,
    };
}

/// <summary>
/// The app-wide rejection handler for the rate limiter: 429, plus <c>Retry-After</c> (whole seconds) whenever
/// the limiter can say when a permit will free up. Setting <c>OnRejected</c> replaces the middleware's own
/// <c>RejectionStatusCode</c> handling, so it must set the status itself.
/// </summary>
public static class RateLimitRejection
{
    public static ValueTask WriteAsync(OnRejectedContext context, CancellationToken cancellationToken)
    {
        var response = context.HttpContext.Response;
        response.StatusCode = StatusCodes.Status429TooManyRequests;

        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            var seconds = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds));
            response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        }

        return ValueTask.CompletedTask;
    }
}
