using System.Net;
using System.Net.Sockets;

namespace Odip.Api.Services;

/// <summary>
/// The definition of "which client is this request from" for the SIGN-IN
/// defence. Only the failed-sign-in tracker (<c>AuthController.LoginAttemptKey</c>)
/// and the partition warning (<c>SignInBudgetPartitionWarningMiddleware</c>) go
/// through here. The rate limiters do NOT: <c>Program.RateLimitPartitionKey</c>,
/// <c>EarlyAccessRateLimiting.ClientKey</c> and <c>PlanQuoteConcurrency</c> read
/// <c>Connection.RemoteIpAddress</c> directly.
///
/// <para>
/// Why this exists as a named, checked thing rather than three reads of
/// <c>Connection.RemoteIpAddress</c>: behind the deployed stack the login
/// lockout keyed on a value that is CONSTANT for every caller, so one noisy
/// client locked out every user. See <see cref="IsIndistinguishableFromProxy"/>.
/// </para>
/// </summary>
public static class ClientIp
{
    /// <summary>The private Docker bridge range the API trusts to speak for its clients.</summary>
    private static bool IsTrustedProxyNetwork(IPAddress? address)
    {
        if (address is null)
            return false;

        // 172.16.0.0/12 — the Docker default bridge allocation, i.e. the nginx hop.
        var bytes = address.MapToIPv4IfMapped().GetAddressBytes();
        return bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31;
    }

    /// <summary>
    /// The resolved client address as a string, or <see langword="null"/> when
    /// there is none to be had.
    /// </summary>
    public static string? Resolve(HttpContext context)
    {
        var address = context.Connection.RemoteIpAddress;
        return address is null ? null : address.MapToIPv4IfMapped().ToString();
    }

    /// <summary>
        /// TRUE when the "client address" this request resolved to is really just the
        /// proxy talking, so every caller through that proxy shares one key.
        ///
        /// <para>
        /// This is the deployed shape, and it is the reason the lockout was a denial of
        /// service. The single decisive signal is <b>the resolved address is inside the
        /// Docker bridge range</b> — the range reserved for the nginx hop. No end client
        /// is ever at 172.16.0.0/12, so a resolved address inside it is the proxy, not a
        /// person, whatever the headers say.
        /// </para>
        ///
        /// <para>
        /// The forwarded headers are deliberately NOT part of this decision, and the
        /// reason is worth stating because it is surprising: by the time this runs,
        /// <c>ForwardedHeadersMiddleware</c> has already REWRITTEN
        /// <c>Request.Headers["X-Forwarded-For"]</c> to hold only the entry it adopted.
        /// Reading it back shows the client address while
        /// <c>Connection.RemoteIpAddress</c> shows the proxy address — so a check written
        /// against the header here would disagree with the very value it is trying to
        /// explain. It would also be spoofable: a direct client sets the header freely.
        /// The bridge-range test on the resolved address is neither.
        /// </para>
        ///
        /// <para>
        /// Why the resolved address is the proxy's in the first place: the published port
        /// is served by <c>docker-proxy</c>, a userspace proxy
        /// (<c>docker-proxy … -host-port 8475 -container-ip …</c>). It accepts the client's
        /// TCP connection and originates a new one to nginx, so nginx's
        /// <c>$remote_addr</c> is the Docker bridge gateway for every caller; nginx's
        /// <c>proxy_add_x_forwarded_for</c> appends that gateway, and the middleware
        /// adopts it. The genuine address never reaches this process, so no header and no
        /// application code can recover it: the information was destroyed before the
        /// first HTTP byte existed. The middleware is behaving correctly throughout.
        /// </para>
        /// </summary>
        public static bool IsIndistinguishableFromProxy(HttpContext context)
        {
            var resolved = context.Connection.RemoteIpAddress;
            return resolved is not null && IsTrustedProxyNetwork(resolved);
        }

        /// <summary>
        /// TRUE when this request has no failed-sign-in budget that belongs to one caller
        /// alone — the exact condition <see cref="LoginAttemptKey"/> answers
        /// <see langword="null"/> for. This is the shape the startup warning middleware
        /// reports on, so it is defined here rather than at the call site.
        ///
        /// <para>
        /// It covers BOTH of the two shapes <see cref="LoginAttemptKey"/> declines to
        /// count, not just the proxy one, and that is deliberate:
        /// </para>
        /// <list type="bullet">
        /// <item>the address resolved to the proxy's (see
        /// <see cref="IsIndistinguishableFromProxy"/>) — every caller shares it;</item>
        /// <item>there is no address at all, which
        /// <see cref="IsIndistinguishableFromProxy"/> reports FALSE for, because "no
        /// address" is not "an address inside the bridge range".</item>
        /// </list>
        ///
        /// <para>
        /// Warning on only the first would UNDER-report: on a request with no address
        /// the budget is just as absent, and a diagnostic that goes quiet exactly when
        /// the defence is missing is worse than none, because silence there reads as an
        /// all-clear.
        /// </para>
        ///
        /// <para>
        /// It is derived from <see cref="LoginAttemptKey"/> rather than re-testing the
        /// address, so the warning and the key it describes cannot drift apart: one
        /// predicate, one range test. A call site therefore cannot end up warning about
        /// a shape the budget is in fact counted for.
        /// </para>
        /// </summary>
        public static bool SignInBudgetCannotBePartitioned(HttpContext context) =>
            LoginAttemptKey(context) is null;

    /// <summary>
    /// The partition key for the failed-sign-in budget, or <see langword="null"/>
    /// when there is no budget that belongs to this caller alone.
    ///
    /// <para>
    /// Two situations produce null, and both are DELIBERATE rather than incidental:
    /// </para>
    /// <list type="number">
    /// <item>The address is the proxy's (see
    /// <see cref="IsIndistinguishableFromProxy"/>) — every caller shares it.</item>
    /// <item>There is no address at all.</item>
    /// </list>
    ///
    /// <para>
    /// In both cases <c>AuthController</c> declines to count. This is chosen over
    /// both alternatives on purpose: over a shared or literal key, because that is
    /// the denial of service this exists to prevent; and over the previous
    /// <c>TraceIdentifier</c> fallback, because a key unique per request makes the
    /// counter incapable of ever locking anyone out — the defence would be absent
    /// while appearing to be present. No key means the state is honestly "not
    /// counted", and the startup middleware says so loudly instead of letting it
    /// pass as a working defence.
    /// </para>
    ///
    /// <para>
    /// What this costs: on such a deployment the flood is bounded by the address-keyed
    /// rate limiter's own 60-per-5-minutes, and by the cost of a Firebase
    /// verification per attempt. The rate limiter has the same blind spot, which is
    /// why the deploy-side fix — not this — is what restores per-client budgets.
    /// </para>
    /// </summary>
    public static string? LoginAttemptKey(HttpContext context)
    {
        if (IsIndistinguishableFromProxy(context))
            return null;

        return Resolve(context);
    }
}

/// <summary>IPv4/IPv6 normalisation helper, so one client cannot buy two budgets.</summary>
internal static class IpAddressExtensions
{
    /// <summary>
    /// An IPv4-mapped IPv6 address is the same client as the IPv4 address it
    /// carries. Without this, the same person could present ::ffff:203.0.113.9
    /// on one request and 203.0.113.9 on the next and hold two budgets.
    /// </summary>
    public static IPAddress MapToIPv4IfMapped(this IPAddress address) =>
        address.AddressFamily == AddressFamily.InterNetworkV6 && address.IsIPv4MappedToIPv6
            ? address.MapToIPv4()
            : address;
}
