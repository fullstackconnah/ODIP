using Microsoft.Extensions.Configuration;
using Odip.Infrastructure.BackgroundServices;
using Xunit;

namespace Odip.Tests.DataRetention;

/// <summary>The nightly scan is on unless <c>Retention:ScanEnabled</c> says false.</summary>
public class RetentionScanEnabledTests
{
    private static IConfiguration Config(string? value) =>
        new ConfigurationBuilder().AddInMemoryCollection(value is null ? [] : new Dictionary<string, string?> { [RetentionScanBackgroundService.ScanEnabledKey] = value }).Build();

    [Fact] public void Empty_config_is_on() => Assert.True(RetentionScanBackgroundService.Enabled(Config(null)));
    [Fact] public void False_switches_it_off() => Assert.False(RetentionScanBackgroundService.Enabled(Config("false")));
}
