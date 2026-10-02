using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace Odip.Infrastructure.DemoData;

public enum DemoScenarioMode { Off, On }

/// <summary>
/// <c>DemoData:Scenarios</c>: <c>Off</c> (the default) or <c>On</c>. Only the exact word On switches the demo top-up on; anything else
/// (a typo, "true", "1") is Off and is reported through <see cref="Warning"/>, because the cost of a lenient parser is a presenter's typo
/// writing into a live tenant. The cadence keys are tuning knobs for tests and ops, not part of the contract, and both are clamped
/// (<see cref="FirstRunDelaySecondsKey"/> to 0-3600, <see cref="IntervalMinutesKey"/> to 1-1440): Task.Delay throws above about 49.7 days,
/// and a hosted service that throws stops the host, so a typo in a knob must never be able to take the API down. Anything that is not a
/// whole number falls back to the default.
/// </summary>
public sealed class DemoDataOptions
{
    public const string ScenariosKey = "DemoData:Scenarios";
    public const string FirstRunDelaySecondsKey = "DemoData:FirstRunDelaySeconds";
    public const string IntervalMinutesKey = "DemoData:IntervalMinutes";

    public const int MinFirstRunDelaySeconds = 0;
    public const int MaxFirstRunDelaySeconds = 3600;
    public const int MinIntervalMinutes = 1;
    public const int MaxIntervalMinutes = 1440;

    public static readonly TimeSpan DefaultFirstRunDelay = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan DefaultInterval = TimeSpan.FromMinutes(60);

    /// <summary>The longest wait the top-up ever asks of Task.Delay: the configured range stops here.</summary>
    public static readonly TimeSpan MaxInterval = TimeSpan.FromMinutes(MaxIntervalMinutes);

    public DemoScenarioMode Scenarios { get; init; } = DemoScenarioMode.Off;

    public bool Enabled => Scenarios == DemoScenarioMode.On;

    /// <summary>Wait after the host starts before the first tick (the "startup run"): readiness never waits for it.</summary>
    public TimeSpan FirstRunDelay { get; init; } = DefaultFirstRunDelay;

    /// <summary>Gap between ticks.</summary>
    public TimeSpan Interval { get; init; } = DefaultInterval;

    /// <summary>Set when the flag held something that is neither On nor Off. Log it once at startup.</summary>
    public string? Warning { get; init; }

    public static DemoDataOptions FromConfiguration(IConfiguration configuration)
    {
        var value = configuration[ScenariosKey]?.Trim();
        var on = string.Equals(value, "On", StringComparison.OrdinalIgnoreCase);
        var warning = !on && !string.IsNullOrEmpty(value) && !string.Equals(value, "Off", StringComparison.OrdinalIgnoreCase)
            ? $"{ScenariosKey} is '{value}', which is neither On nor Off: treated as Off."
            : null;

        return new DemoDataOptions
        {
            Scenarios = on ? DemoScenarioMode.On : DemoScenarioMode.Off,
            FirstRunDelay = TimeSpan.FromSeconds(ReadInt(configuration, FirstRunDelaySecondsKey, (int)DefaultFirstRunDelay.TotalSeconds,
                MinFirstRunDelaySeconds, MaxFirstRunDelaySeconds)),
            Interval = TimeSpan.FromMinutes(ReadInt(configuration, IntervalMinutesKey, (int)DefaultInterval.TotalMinutes,
                MinIntervalMinutes, MaxIntervalMinutes)),
            Warning = warning,
        };
    }

    /// <summary>A whole number from configuration, moved to the nearest end of [minimum, maximum] when it lies outside; anything else falls back.</summary>
    private static int ReadInt(IConfiguration configuration, string key, int fallback, int minimum, int maximum) =>
        long.TryParse(configuration[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? (int)Math.Clamp(parsed, minimum, maximum)
            : fallback;
}
