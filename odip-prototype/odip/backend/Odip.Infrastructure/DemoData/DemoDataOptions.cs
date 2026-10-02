using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace Odip.Infrastructure.DemoData;

public enum DemoScenarioMode { Off, On }

/// <summary>
/// <c>DemoData:Scenarios</c>: <c>Off</c> (the default) or <c>On</c>. Only the exact word On switches the demo top-up on; anything else
/// (a typo, "true", "1") is Off and is reported through <see cref="Warning"/>, because the cost of a lenient parser is a presenter's typo
/// writing into a live tenant. The cadence keys are tuning knobs for tests and ops, not part of the contract.
/// </summary>
public sealed class DemoDataOptions
{
    public const string ScenariosKey = "DemoData:Scenarios";
    public const string FirstRunDelaySecondsKey = "DemoData:FirstRunDelaySeconds";
    public const string IntervalMinutesKey = "DemoData:IntervalMinutes";

    public DemoScenarioMode Scenarios { get; init; } = DemoScenarioMode.Off;

    public bool Enabled => Scenarios == DemoScenarioMode.On;

    /// <summary>Wait after the host starts before the first tick (the "startup run"): readiness never waits for it.</summary>
    public TimeSpan FirstRunDelay { get; init; } = TimeSpan.FromSeconds(30);

    /// <summary>Gap between ticks.</summary>
    public TimeSpan Interval { get; init; } = TimeSpan.FromMinutes(60);

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
            FirstRunDelay = TimeSpan.FromSeconds(ReadInt(configuration, FirstRunDelaySecondsKey, 30, minimum: 0)),
            Interval = TimeSpan.FromMinutes(ReadInt(configuration, IntervalMinutesKey, 60, minimum: 1)),
            Warning = warning,
        };
    }

    private static int ReadInt(IConfiguration configuration, string key, int fallback, int minimum) =>
        int.TryParse(configuration[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed >= minimum
            ? parsed
            : fallback;
}
