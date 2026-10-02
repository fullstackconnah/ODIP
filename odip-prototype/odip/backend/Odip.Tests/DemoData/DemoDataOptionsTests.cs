using Microsoft.Extensions.Configuration;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The flag is Off unless it says exactly "On". Anything else (a typo, "true", "1") must never switch demo writes on: the
/// failure mode of a lenient parser here is a presenter's typo rewriting a live tenant.
/// </summary>
public class DemoDataOptionsTests
{
    private static IConfiguration Config(string? value)
    {
        var data = new Dictionary<string, string?>();
        if (value is not null) data[DemoDataOptions.ScenariosKey] = value;
        return new ConfigurationBuilder().AddInMemoryCollection(data).Build();
    }

    [Fact]
    public void Default_IsOff()
    {
        var options = DemoDataOptions.FromConfiguration(Config(null));

        Assert.Equal(DemoScenarioMode.Off, options.Scenarios);
        Assert.False(options.Enabled);
        Assert.Equal(TimeSpan.FromSeconds(30), options.FirstRunDelay);
        Assert.Equal(TimeSpan.FromMinutes(60), options.Interval);
    }

    [Theory]
    [InlineData("On")]
    [InlineData("on")]
    [InlineData("ON")]
    [InlineData(" On ")]
    public void On_IsRecognised_WhateverTheCase(string value)
    {
        var options = DemoDataOptions.FromConfiguration(Config(value));

        Assert.Equal(DemoScenarioMode.On, options.Scenarios);
        Assert.True(options.Enabled);
    }

    [Theory]
    [InlineData("Off")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("true")]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("Enabled")]
    [InlineData("On,Off")]
    public void AnythingElse_IsOff(string value)
    {
        var options = DemoDataOptions.FromConfiguration(Config(value));

        Assert.Equal(DemoScenarioMode.Off, options.Scenarios);
        Assert.False(options.Enabled);
    }

    [Fact]
    public void ACompletelyUnrecognisedValue_IsReportedSoItCanBeLogged_ButStaysOff()
    {
        Assert.Null(DemoDataOptions.FromConfiguration(Config("Off")).Warning);
        Assert.Null(DemoDataOptions.FromConfiguration(Config(null)).Warning);
        Assert.Null(DemoDataOptions.FromConfiguration(Config("On")).Warning);

        var typo = DemoDataOptions.FromConfiguration(Config("true"));
        Assert.False(typo.Enabled);
        Assert.Contains("true", typo.Warning);
        Assert.Contains("DemoData:Scenarios", typo.Warning);
    }

    private static DemoDataOptions Tuned(string? firstRunDelaySeconds, string? intervalMinutes)
    {
        var data = new Dictionary<string, string?> { [DemoDataOptions.ScenariosKey] = "On" };
        if (firstRunDelaySeconds is not null) data[DemoDataOptions.FirstRunDelaySecondsKey] = firstRunDelaySeconds;
        if (intervalMinutes is not null) data[DemoDataOptions.IntervalMinutesKey] = intervalMinutes;
        return DemoDataOptions.FromConfiguration(new ConfigurationBuilder().AddInMemoryCollection(data).Build());
    }

    [Fact]
    public void TheCadence_CanBeTunedByConfig()
    {
        var tuned = Tuned("5", "15");

        Assert.Equal(TimeSpan.FromSeconds(5), tuned.FirstRunDelay);
        Assert.Equal(TimeSpan.FromMinutes(15), tuned.Interval);
    }

    // Review L2: a delay Task.Delay cannot take (above about 49.7 days) throws inside the hosted service and stops the host, so both knobs
    // are moved to the nearest end of their range instead of being passed on as typed.
    [Theory]
    [InlineData("100000", 1440)]            // the review's example: 69 days
    [InlineData("99999999999999", 1440)]    // beyond an int
    [InlineData("1441", 1440)]
    [InlineData("1440", 1440)]
    [InlineData("15", 15)]
    [InlineData("1", 1)]
    [InlineData("0", 1)]
    [InlineData("-5", 1)]
    public void TheInterval_IsClampedToBetweenOneMinuteAndOneDay(string configured, int expectedMinutes)
    {
        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), Tuned(null, configured).Interval);
    }

    [Theory]
    [InlineData("5000000", 3600)]           // the review's example: 58 days
    [InlineData("3601", 3600)]
    [InlineData("3600", 3600)]
    [InlineData("45", 45)]
    [InlineData("0", 0)]
    [InlineData("-4", 0)]
    public void TheFirstRunDelay_IsClampedToBetweenNoneAndOneHour(string configured, int expectedSeconds)
    {
        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), Tuned(configured, null).FirstRunDelay);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("soon")]
    [InlineData("1.5")]
    public void ACadenceThatIsNotAWholeNumber_FallsBackToTheDefault(string configured)
    {
        var options = Tuned(configured, configured);

        Assert.Equal(TimeSpan.FromSeconds(30), options.FirstRunDelay);
        Assert.Equal(TimeSpan.FromMinutes(60), options.Interval);
    }

    [Fact]
    public async Task TheClampedCadence_IsAlwaysATimeTheFrameworkCanWaitFor()
    {
        var options = Tuned("5000000", "100000");
        var cancelled = new CancellationToken(canceled: true);

        // A delay the framework accepts is cancelled at once on a cancelled token; one it cannot take throws ArgumentOutOfRangeException.
        await Assert.ThrowsAsync<TaskCanceledException>(() => Task.Delay(options.Interval, cancelled));
        await Assert.ThrowsAsync<TaskCanceledException>(() => Task.Delay(options.FirstRunDelay, cancelled));
    }
}
