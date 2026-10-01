using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// F2 (Fix B review): the provider-zone lookup underpins the dashboard, task filters, alerts, the medication register and obligation completion
/// as well as the MAR and portal. Its fallback used to call the SAME lookup that had just failed, so a runtime with no tz database (alpine, a
/// stripped container, Windows with invariant globalization) threw from all of them. The last resort is a fixed +10:00 zone, so they answer
/// (right for half the year, an hour out in daylight time) instead of returning 500.
/// </summary>
public class ProviderLocalTimeFallbackTests
{
    private static TimeZoneInfo NoTzdata(string id) => throw new TimeZoneNotFoundException($"no tz database: {id}");

    [Fact]
    public void WithNoTzdataAtAll_AnUnknownOrMissingZone_FallsBackToAFixedPlusTenZone_InsteadOfThrowing()
    {
        var zone = ProviderLocalTime.ResolveZone("Australia/Perth", NoTzdata);

        Assert.Equal(TimeSpan.FromHours(10), zone.BaseUtcOffset);
        Assert.False(zone.SupportsDaylightSavingTime);
    }

    [Fact]
    public void TheLastResortZone_StillGivesTheProviderCalendarDate_SoTheDashboardAndTasksDoNotFail()
    {
        var zone = ProviderLocalTime.ResolveZone(null, NoTzdata);

        // 22:00Z on Fri 2 Oct is 08:00 on Sat 3 Oct at +10:00.
        var today = ProviderLocalTime.TodayIn(new DateTime(2026, 10, 2, 22, 0, 0, DateTimeKind.Utc), zone);

        Assert.Equal(new DateOnly(2026, 10, 3), today);
    }

    [Fact]
    public void ASystemThatKnowsOnlySydney_StillResolvesAnUnknownIdToSydney_NotToTheLastResort()
    {
        var sydney = TimeZoneInfo.CreateCustomTimeZone("Australia/Sydney", TimeSpan.FromHours(10), "Sydney", "Sydney");
        TimeZoneInfo OnlySydney(string id) => id == "Australia/Sydney" ? sydney : throw new TimeZoneNotFoundException(id);

        Assert.Same(sydney, ProviderLocalTime.ResolveZone("Mars/Olympus_Mons", OnlySydney));
        Assert.Same(sydney, ProviderLocalTime.ResolveZone("", OnlySydney));
    }

    [Fact]
    public void AnInvalidZoneException_IsHandledTheSameWay()
    {
        static TimeZoneInfo Corrupt(string id) => throw new InvalidTimeZoneException(id);

        Assert.Equal(TimeSpan.FromHours(10), ProviderLocalTime.ResolveZone("Australia/Sydney", Corrupt).BaseUtcOffset);
    }

    [Fact]
    public void TheSystemLookup_StillResolvesARealZone_WhenTzdataIsPresent()
    {
        // The machine this runs on resolves Sydney for the other Fix B tests; the overload must not change the answer there.
        var zone = ProviderLocalTime.ResolveZone("Australia/Sydney");

        Assert.Equal(TimeSpan.FromHours(10), zone.BaseUtcOffset);
        Assert.True(zone.SupportsDaylightSavingTime);
    }
}
