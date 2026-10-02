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

    [Fact]
    public void TheCadence_CanBeTunedByConfig_ButOnlyToSaneValues()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [DemoDataOptions.ScenariosKey] = "On",
            ["DemoData:FirstRunDelaySeconds"] = "5",
            ["DemoData:IntervalMinutes"] = "15",
        }).Build();
        var tuned = DemoDataOptions.FromConfiguration(config);
        Assert.Equal(TimeSpan.FromSeconds(5), tuned.FirstRunDelay);
        Assert.Equal(TimeSpan.FromMinutes(15), tuned.Interval);

        var silly = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DemoData:FirstRunDelaySeconds"] = "-4",
            ["DemoData:IntervalMinutes"] = "0",
        }).Build();
        var fallback = DemoDataOptions.FromConfiguration(silly);
        Assert.Equal(TimeSpan.FromSeconds(30), fallback.FirstRunDelay);
        Assert.Equal(TimeSpan.FromMinutes(60), fallback.Interval);
    }
}
