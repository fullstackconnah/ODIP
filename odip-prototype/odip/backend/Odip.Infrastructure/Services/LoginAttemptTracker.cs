using System.Collections.Concurrent;
using Odip.Application.Interfaces;

namespace Odip.Infrastructure.Services;

/// <summary>
/// In-memory, per-process failed-login tracker. State is deliberately not shared across
/// instances: this API runs as a single container, and a distributed store would add a
/// dependency for a defence that is already best-effort. If the API is ever scaled out,
/// this must move to Redis or the lockout becomes per-replica.
///
/// Losing the counts on restart is acceptable and is the same trade the in-memory rate
/// limiter already makes.
/// </summary>
public sealed class LoginAttemptTracker : ILoginAttemptTracker
{
    /// <summary>
    /// Failures allowed inside <see cref="FailureWindow"/> before a client is locked out.
    /// Set well above a typo-and-retry sequence because the key may be a shared NAT
    /// address covering several people. It is still far below what brute-forcing a
    /// Firebase-signed ID token would need — that credential is not guessable, so this
    /// limit exists to stop abuse and noise, not to be the last line of defence.
    /// </summary>
    public const int MaxFailures = 10;

    public static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(15);

    // Above this many tracked keys, expired entries are swept on the next write. A
    // fixed-size sweep keeps a flood of one-request-per-forged-key traffic from growing
    // the dictionary without bound, without paying for a timer.
    private const int SweepThreshold = 10_000;

    private sealed record Attempts(int Count, DateTimeOffset WindowStart);

    private readonly ConcurrentDictionary<string, Attempts> _attempts = new();
    private readonly TimeProvider _clock;

    public LoginAttemptTracker() : this(TimeProvider.System) { }

    public LoginAttemptTracker(TimeProvider clock) => _clock = clock;

    public bool IsLockedOut(string key, out TimeSpan retryAfter)
    {
        retryAfter = TimeSpan.Zero;

        if (!_attempts.TryGetValue(key, out var attempts))
            return false;

        var elapsed = _clock.GetUtcNow() - attempts.WindowStart;

        // An elapsed window is treated as no failures at all. Leaving the entry in place
        // is fine — the next write rewrites it, and the sweep collects it eventually.
        if (elapsed >= FailureWindow)
            return false;

        if (attempts.Count < MaxFailures)
            return false;

        retryAfter = FailureWindow - elapsed;
        return true;
    }

    public void RecordFailure(string key)
    {
        var now = _clock.GetUtcNow();

        if (_attempts.Count > SweepThreshold)
            Sweep(now);

        _attempts.AddOrUpdate(
            key,
            _ => new Attempts(1, now),
            (_, existing) => now - existing.WindowStart >= FailureWindow
                // Window elapsed: start a fresh one rather than incrementing forever.
                ? new Attempts(1, now)
                : existing with { Count = existing.Count + 1 });
    }

    public void RecordSuccess(string key) => _attempts.TryRemove(key, out _);

    private void Sweep(DateTimeOffset now)
    {
        foreach (var (key, attempts) in _attempts)
        {
            if (now - attempts.WindowStart >= FailureWindow)
                _attempts.TryRemove(key, out _);
        }
    }
}
