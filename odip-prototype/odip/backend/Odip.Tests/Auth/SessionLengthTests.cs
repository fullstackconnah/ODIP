using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Auth;

/// <summary>The session-length resolver: pure, with a fixed now. A limit counts from sign-in; null means no limit (today's behaviour).</summary>
public class SessionLengthTests
{
    private static readonly DateTime Now = new(2026, 11, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void No_limit_never_ends_and_issues_30_minutes()
    {
        var signedIn = Now.AddDays(-3);
        Assert.False(OdipSession.Ended(Now, signedIn, null));
        Assert.Equal(Now.AddMinutes(30), OdipSession.ExpiresAt(Now, signedIn, null));
    }

    [Fact]
    public void Just_under_the_limit_is_not_ended() =>
        Assert.False(OdipSession.Ended(Now, Now.AddMinutes(-59).AddSeconds(-59), 60));

    [Fact]
    public void At_the_limit_is_ended() => Assert.True(OdipSession.Ended(Now, Now.AddMinutes(-60), 60));

    [Fact]
    public void Over_the_limit_is_ended() => Assert.True(OdipSession.Ended(Now, Now.AddMinutes(-61), 60));

    [Fact]
    public void A_short_limit_caps_the_expiry_below_30_minutes()
    {
        var signedIn = Now.AddMinutes(-10);
        Assert.Equal(signedIn.AddMinutes(15), OdipSession.ExpiresAt(Now, signedIn, 15));
    }

    [Fact]
    public void A_long_limit_leaves_the_30_minute_token_alone() =>
        Assert.Equal(Now.AddMinutes(30), OdipSession.ExpiresAt(Now, Now.AddMinutes(-10), 480));

    [Fact]
    public void A_future_sign_in_time_counts_as_now()
    {
        var future = Now.AddHours(2);
        Assert.False(OdipSession.Ended(Now, future, 60));
        Assert.Equal(Now.AddMinutes(30), OdipSession.ExpiresAt(Now, future, 60));
        Assert.Equal(Now.AddMinutes(15), OdipSession.ExpiresAt(Now, future, 15));
    }

    public static TheoryData<object?, long?> AuthTimes => new()
    {
        { 1700000000L, 1700000000L },
        { 1700000000, 1700000000L },
        { 1700000000.0, 1700000000L },
        { "1700000000", 1700000000L },
        { "abc", null },
        { null, null },
        { true, null },
    };

    [Theory]
    [MemberData(nameof(AuthTimes))]
    public void The_auth_time_claim_is_read_whatever_number_type_it_arrives_as(object? raw, long? epoch)
    {
        var claims = new Dictionary<string, object>();
        if (raw is not null) claims["auth_time"] = raw;
        var expected = epoch is { } e ? DateTimeOffset.FromUnixTimeSeconds(e).UtcDateTime : (DateTime?)null;
        Assert.Equal(expected, OdipSession.AuthTime(claims));
    }

    [Fact]
    public void A_missing_auth_time_is_unreadable() => Assert.Null(OdipSession.AuthTime(new Dictionary<string, object>()));
}
