using Odip.Api.Services;

namespace Odip.Api.Middleware;

/// <summary>
/// Says LOUDLY, on a real request, when the failed-sign-in budget cannot be
/// partitioned per caller — the condition
/// <see cref="ClientIp.SignInBudgetCannotBePartitioned"/> reports on.
///
/// <para>
/// This is a DIAGNOSTIC, not a control: it never short-circuits, blocks or rewrites
/// the request, and <c>_next</c> runs for every request whatever the address turns out
/// to be. Its whole job is to make this shape impossible to rediscover as a mystery
/// later.
/// </para>
///
/// <para>
/// It is deliberately a named middleware class rather than an inline
/// <c>app.Use(async ...)</c> lambda, so the behaviour is reachable from a test that
/// runs it. A test that only asserted against Program.cs's source TEXT would still
/// pass with this guard inverted — which is exactly how the inverted guard shipped
/// with a green CI run (38888414710).
/// </para>
/// </summary>
public class SignInBudgetPartitionWarningMiddleware
{
    /// <summary>
    /// The logger category, so an operator can find these lines on their own and a
    /// test can assert the exact category rather than "some logger said something".
    /// </summary>
    public const string LoggerCategory = "Odip.ClientIp";

    // Once per process: a proxied deploy resolves EVERY request to the proxy, so a
    // per-request warning is log amplification (and amplifies a flood).
    private static int _warned;

    internal static void ResetForTests() => Interlocked.Exchange(ref _warned, 0);

    private readonly RequestDelegate _next;
    private readonly ILoggerFactory _loggerFactory;

    public SignInBudgetPartitionWarningMiddleware(RequestDelegate next, ILoggerFactory loggerFactory)
    {
        _next = next;
        _loggerFactory = loggerFactory;
    }

    public Task InvokeAsync(HttpContext context)
    {
        // The guard is ClientIp's predicate, NOT a second opinion formed here: the range
        // test lives in exactly one place, so this warning and the key it describes
        // cannot disagree about what "the proxy" is. It is deliberately NOT negated —
        // the budget is absent precisely WHEN the address is the proxy's.
        if (ClientIp.SignInBudgetCannotBePartitioned(context) && Interlocked.Exchange(ref _warned, 1) == 0)
        {
            // Both shapes that leave LoginAttemptKey null are reported, and named
            // differently, because they are different faults: an in-range address is the
            // proxy hop talking, while a null address means there was nothing to resolve
            // at all. Reporting only the first would under-report a shape the budget is
            // equally absent for.
            var resolved = ClientIp.Resolve(context);
            var cause = resolved is null
                ? "there was no client address to resolve at all (Connection.RemoteIpAddress is null)"
                : $"this request resolved to the proxy address {resolved}, not a client";

            _loggerFactory.CreateLogger(LoggerCategory).LogWarning(
                "SIGN-IN BUDGET NOT PARTITIONED: {Cause}. " +
                "The address-keyed rate limiter is one shared bucket and failed sign-ins are not " +
                "counted. If the published port is served by docker-proxy (a userspace proxy), the real client " +
                "address is destroyed before nginx sees it and no application code can recover it. Fix at the " +
                "deploy layer: publish without the userspace proxy (userland-proxy:false), or serve from a " +
                "reverse proxy that terminates outside the published port.",
                cause);
        }

        return _next(context);
    }
}
