using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// "Today" for every demo date is the provider's calendar date; every instant goes through ProviderLocalTime.LocalToUtc.
/// Worked values are the plan's own (Fri 2026-10-02 10:30 AEST; NSW daylight saving starts Sun 2026-10-04 02:00).
/// </summary>
public class DemoAnchorsTests
{
    private static DateTime Utc(int y, int mo, int d, int h, int mi) => new(y, mo, d, h, mi, 0, DateTimeKind.Utc);

    [Fact]
    public void Create_FridayMorningInSydney_GivesThePlansWorkedExample()
    {
        var anchors = DemoAnchors.Create(Utc(2026, 10, 2, 0, 30), "NSW");

        Assert.Equal(new DateOnly(2026, 10, 2), anchors.D0);
        Assert.Equal(new DateOnly(2026, 9, 28), anchors.W0);
        Assert.Equal(new DateOnly(2026, 10, 5), anchors.Monday(1));
        Assert.Equal(new DateOnly(2026, 10, 12), anchors.Monday(2));
        Assert.Equal(new DateOnly(2026, 9, 14), anchors.Monday(-2));
        Assert.Equal(new DateTime(2026, 10, 2, 10, 30, 0), anchors.NowLocal);
        Assert.Equal(DateTimeKind.Unspecified, anchors.NowLocal.Kind);
        Assert.Equal(DateTimeKind.Utc, anchors.NowUtc.Kind);
        Assert.Equal("Australia/Sydney", anchors.Provider.Id);
    }

    [Fact]
    public void Create_UsesTheProvidersCalendarDate_NotTheUtcDate()
    {
        // 13:59 UTC is 23:59 Friday in Sydney (AEST); one minute later it is Saturday there.
        Assert.Equal(new DateOnly(2026, 10, 2), DemoAnchors.Create(Utc(2026, 10, 2, 13, 59), "NSW").D0);
        Assert.Equal(new DateOnly(2026, 10, 3), DemoAnchors.Create(Utc(2026, 10, 2, 14, 0), "NSW").D0);
    }

    [Theory]
    [InlineData(2026, 9, 28, 2026, 9, 28)] // Monday is its own week start
    [InlineData(2026, 10, 2, 2026, 9, 28)] // Friday
    [InlineData(2026, 10, 4, 2026, 9, 28)] // Sunday belongs to the week that began six days earlier
    [InlineData(2026, 10, 5, 2026, 10, 5)]
    public void Create_WeekStartIsTheMondayOnOrBeforeToday(int y, int m, int d, int wy, int wm, int wd)
    {
        // Noon local (02:00 UTC) so the UTC and local dates agree.
        var anchors = DemoAnchors.Create(Utc(y, m, d, 2, 0), "NSW");

        Assert.Equal(new DateOnly(wy, wm, wd), anchors.W0);
        Assert.Equal(DayOfWeek.Monday, anchors.W0.DayOfWeek);
    }

    [Fact]
    public void LocalToUtc_FollowsTheZoneAcrossTheDaylightSavingStart()
    {
        var sydney = DemoAnchors.Create(Utc(2026, 10, 2, 0, 30), "NSW");

        // Fri 2 Oct 07:00 AEST = 21:00Z the day before; Mon 5 Oct 07:00 AEDT = 20:00Z (one hour earlier in UTC).
        Assert.Equal(Utc(2026, 10, 1, 21, 0), sydney.LocalToUtc(new DateOnly(2026, 10, 2), new TimeOnly(7, 0)));
        Assert.Equal(Utc(2026, 10, 4, 20, 0), sydney.LocalToUtc(new DateOnly(2026, 10, 5), new TimeOnly(7, 0)));
        Assert.Equal(DateTimeKind.Utc, sydney.LocalToUtc(new DateOnly(2026, 10, 5), new TimeOnly(7, 0)).Kind);
    }

    [Fact]
    public void LocalToUtc_SkewsAValueInsideTheSpringForwardGap_AndNeverThrows()
    {
        var sydney = DemoAnchors.Create(Utc(2026, 10, 2, 0, 30), "NSW");

        // 02:30 on Sun 4 Oct does not exist in Sydney; the first valid instant after it is 03:30 AEDT = 16:30Z the day before.
        Assert.Equal(Utc(2026, 10, 3, 16, 30), sydney.LocalToUtc(new DateTime(2026, 10, 4, 2, 30, 0)));
        Assert.True(sydney.Zone.IsInvalidTime(new DateTime(2026, 10, 4, 2, 30, 0)));
    }

    [Fact]
    public void Create_BrisbaneHasNoDaylightSaving_AdelaideDoes()
    {
        var brisbane = DemoAnchors.Create(Utc(2026, 10, 2, 0, 30), "QLD");
        Assert.Equal("Australia/Brisbane", brisbane.Provider.Id);
        Assert.Equal(Utc(2026, 10, 4, 21, 0), brisbane.LocalToUtc(new DateOnly(2026, 10, 5), new TimeOnly(7, 0)));

        var adelaide = DemoAnchors.Create(Utc(2026, 10, 2, 0, 30), "SA");
        Assert.Equal("Australia/Adelaide", adelaide.Provider.Id);
        Assert.Equal(Utc(2026, 10, 4, 20, 30), adelaide.LocalToUtc(new DateOnly(2026, 10, 5), new TimeOnly(7, 0))); // ACDT is UTC+10:30
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("XX")]
    public void Create_AMissingOrUnknownState_FallsBackToSydney_TheAppsOwnFallback(string? state)
    {
        Assert.Equal(ProviderLocalTime.FallbackZoneId, DemoAnchors.Create(Utc(2026, 10, 2, 0, 30), state).Provider.Id);
    }
}
