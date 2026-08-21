namespace Odip.Application.Interfaces;

/// <summary>
/// Tracks <em>failed</em> credential exchanges per client, so repeated failures can be
/// locked out without successful sign-ins spending from the same budget.
///
/// A request-rate limiter cannot express this. ASP.NET's rate limiting middleware runs
/// before the endpoint and consumes a permit whether the attempt succeeds or fails, so a
/// small per-IP budget is drained by ordinary use. Behind shared egress — several devices
/// leaving one NAT address — that is an outage waiting to happen: one busy or misbehaving
/// device locks every other user out of signing in, while an attacker gains nothing that
/// counting only failures wouldn't also stop.
///
/// Implementations must be safe for concurrent use and are registered as a singleton.
/// </summary>
public interface ILoginAttemptTracker
{
    /// <summary>
    /// True when <paramref name="key"/> has failed too many times inside the current
    /// window. <paramref name="retryAfter"/> is how long until the window rolls over,
    /// suitable for a Retry-After header.
    /// </summary>
    bool IsLockedOut(string key, out TimeSpan retryAfter);

    /// <summary>Records one failed attempt for <paramref name="key"/>.</summary>
    void RecordFailure(string key);

    /// <summary>
    /// Clears the failure count for <paramref name="key"/>. Called on a successful
    /// sign-in so a user who mistypes a few times and then succeeds starts clean.
    /// </summary>
    void RecordSuccess(string key);
}
