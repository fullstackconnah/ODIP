using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

public class LoginAttemptTrackerTests
{
    // Controls time explicitly so the 15-minute window can be tested without waiting or
    // sleeping, and so window-boundary behaviour is deterministic rather than timing luck.
    private sealed class FakeClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static readonly DateTimeOffset Start = new(2026, 8, 21, 9, 0, 0, TimeSpan.Zero);

    private static (LoginAttemptTracker Tracker, FakeClock Clock) Build()
    {
        var clock = new FakeClock(Start);
        return (new LoginAttemptTracker(clock), clock);
    }

    [Fact]
    public void Unknown_key_is_not_locked_out()
    {
        var (tracker, _) = Build();
        Assert.False(tracker.IsLockedOut("1.2.3.4", out _));
    }

    [Fact]
    public void One_failure_short_of_the_limit_still_allows_a_try()
    {
        var (tracker, _) = Build();
        for (var i = 0; i < LoginAttemptTracker.MaxFailures - 1; i++)
            tracker.RecordFailure("1.2.3.4");

        Assert.False(tracker.IsLockedOut("1.2.3.4", out _), "locking out one attempt early would deny a user their last legitimate try");
    }

    [Fact]
    public void Reaching_the_limit_locks_out_and_reports_a_usable_retry_after()
    {
        var (tracker, _) = Build();
        for (var i = 0; i < LoginAttemptTracker.MaxFailures; i++)
            tracker.RecordFailure("1.2.3.4");

        Assert.True(tracker.IsLockedOut("1.2.3.4", out var retryAfter));
        Assert.True(retryAfter > TimeSpan.Zero, "Retry-After must be a usable positive delay");
        Assert.True(retryAfter <= LoginAttemptTracker.FailureWindow, "Retry-After must never exceed the window");
    }

    [Fact]
    public void Clients_are_tracked_independently()
    {
        var (tracker, _) = Build();
        for (var i = 0; i < LoginAttemptTracker.MaxFailures; i++)
            tracker.RecordFailure("1.2.3.4");

        Assert.False(tracker.IsLockedOut("5.6.7.8", out _), "one client's failures must never lock out a different client");
    }

    [Fact]
    public void A_success_clears_earlier_failures()
    {
        var (tracker, _) = Build();
        for (var i = 0; i < LoginAttemptTracker.MaxFailures - 1; i++)
            tracker.RecordFailure("1.2.3.4");

        tracker.RecordSuccess("1.2.3.4");
        tracker.RecordFailure("1.2.3.4");

        Assert.False(tracker.IsLockedOut("1.2.3.4", out _), "a user who mistypes, succeeds, then mistypes once more is not under attack");
    }

    [Fact]
    public void Lockout_expires_once_the_window_passes()
    {
        var (tracker, clock) = Build();
        for (var i = 0; i < LoginAttemptTracker.MaxFailures; i++)
            tracker.RecordFailure("1.2.3.4");

        clock.Advance(LoginAttemptTracker.FailureWindow);

        Assert.False(tracker.IsLockedOut("1.2.3.4", out _));
    }

    [Fact]
    public void Retry_after_shrinks_as_the_window_elapses()
    {
        var (tracker, clock) = Build();
        for (var i = 0; i < LoginAttemptTracker.MaxFailures; i++)
            tracker.RecordFailure("1.2.3.4");

        Assert.True(tracker.IsLockedOut("1.2.3.4", out var first));
        clock.Advance(TimeSpan.FromMinutes(5));
        Assert.True(tracker.IsLockedOut("1.2.3.4", out var later));

        Assert.True(later < first, "Retry-After must count down, not restate the full window");
    }

    [Fact]
    public void Failures_spread_across_more_than_one_window_do_not_accumulate()
    {
        var (tracker, clock) = Build();

        // Nine failures, a full window of quiet, then nine more. A counter that never
        // reset would treat this as eighteen and lock out a merely forgetful user.
        for (var i = 0; i < LoginAttemptTracker.MaxFailures - 1; i++)
            tracker.RecordFailure("1.2.3.4");

        clock.Advance(LoginAttemptTracker.FailureWindow + TimeSpan.FromSeconds(1));

        for (var i = 0; i < LoginAttemptTracker.MaxFailures - 1; i++)
            tracker.RecordFailure("1.2.3.4");

        Assert.False(tracker.IsLockedOut("1.2.3.4", out _));
    }

    [Fact]
    public void A_sustained_attacker_stays_locked_out_across_the_window_boundary()
    {
        var (tracker, clock) = Build();

        for (var i = 0; i < LoginAttemptTracker.MaxFailures; i++)
            tracker.RecordFailure("1.2.3.4");

        // Keeps hammering after the window rolls. The count restarts, so they get another
        // batch of tries — that is intended — but they must lock out again, not run free.
        clock.Advance(LoginAttemptTracker.FailureWindow + TimeSpan.FromSeconds(1));
        for (var i = 0; i < LoginAttemptTracker.MaxFailures; i++)
            tracker.RecordFailure("1.2.3.4");

        Assert.True(tracker.IsLockedOut("1.2.3.4", out _));
    }
}
