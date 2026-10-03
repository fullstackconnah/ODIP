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
///
/// <c>DemoData:Packs</c> is an allow-list of pack names (see <see cref="Packs"/>): empty, the default, is every pack, so nothing changes until it is set.
/// </summary>
public sealed class DemoDataOptions
{
    public const string ScenariosKey = "DemoData:Scenarios";
    public const string FirstRunDelaySecondsKey = "DemoData:FirstRunDelaySeconds";
    public const string IntervalMinutesKey = "DemoData:IntervalMinutes";
    public const string PacksKey = "DemoData:Packs";

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

    /// <summary>
    /// <c>DemoData:Packs</c>: the packs that may run, by name (<see cref="DemoPacks.Names"/>), comma-separated, in any case ("live-set, incidents"). Empty, the default, is every
    /// pack. It exists so a new pack can ship Off: a pack writes into a live tenant every hour and nothing it writes is ever deleted, so the host lists every pack but the
    /// new one, the new code deploys dark, and a later change of the list brings it up (or <c>DemoData:Scenarios</c> Off stops the lot). A name that is not a pack matches
    /// nothing and is reported through <see cref="Warning"/>: an allow-list with a typo in it is a pack that quietly stays off.
    /// </summary>
    public IReadOnlyList<string> Packs { get; init; } = Array.Empty<string>();

    /// <summary>True when the pack may run: the list is empty (every pack), or it names the pack.</summary>
    public bool Allows(string pack) => Allowed(Packs, pack);

    private static bool Allowed(IReadOnlyList<string> list, string pack) => list.Count == 0 || list.Contains(pack, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The packs that will run, in the order they run: what the filter lets through (<see cref="Allows"/>), not the typed text, so a name that is not a pack is not here and a
    /// pack typed in another order is where the code runs it.
    /// </summary>
    public IReadOnlyList<string> PacksThatRun => DemoPacks.Names.Where(Allows).ToList();

    /// <summary>
    /// What the startup line says of the packs: how many will run and which, from the filter ("8 of 14: provider-settings, ..."; with no list, "14 of 14 (DemoData:Packs is
    /// empty, so every pack): ..."), so what the host reads there is what runs and not what was typed.
    /// </summary>
    public string DescribePacksThatRun()
    {
        var runs = PacksThatRun;
        var count = $"{runs.Count} of {DemoPacks.Names.Count}";
        var list = runs.Count == 0 ? "none" : string.Join(", ", runs);
        return Packs.Count == 0 ? $"{count} ({PacksKey} is empty, so every pack): {list}" : $"{count}: {list}";
    }

    /// <summary>Wait after the host starts before the first tick (the "startup run"): readiness never waits for it.</summary>
    public TimeSpan FirstRunDelay { get; init; } = DefaultFirstRunDelay;

    /// <summary>Gap between ticks.</summary>
    public TimeSpan Interval { get; init; } = DefaultInterval;

    /// <summary>
    /// Set when the flag held something that is neither On nor Off, or the pack list named something that is not a pack. Log it once at startup: the notice does with the flag
    /// Off (<see cref="DemoDataConfigNotice"/>), and with it On the hosted service does, as a warning beside its startup line, because an allow-list with a typo in it is a
    /// pack that quietly stays off.
    /// </summary>
    public string? Warning { get; init; }

    public static DemoDataOptions FromConfiguration(IConfiguration configuration)
    {
        var value = configuration[ScenariosKey]?.Trim();
        var on = string.Equals(value, "On", StringComparison.OrdinalIgnoreCase);
        var warning = !on && !string.IsNullOrEmpty(value) && !string.Equals(value, "Off", StringComparison.OrdinalIgnoreCase)
            ? $"{ScenariosKey} is '{value}', which is neither On nor Off: treated as Off."
            : null;

        var packs = (configuration[PacksKey] ?? string.Empty)
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(name => name.ToLowerInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var unknown = packs.Where(name => !DemoPacks.Names.Contains(name, StringComparer.Ordinal)).ToList();
        if (unknown.Count > 0)
        {
            var named = string.Join(", ", unknown.Select(name => $"'{name}'"));
            var packsWarning = $"{PacksKey} names {named}, which {(unknown.Count == 1 ? "is" : "are")} not a pack and match{(unknown.Count == 1 ? "es" : "")} nothing";
            var willRun = DemoPacks.Names.Where(name => Allowed(packs, name)).ToList();
            if (on && willRun.Count > 0)
            {
                // With the flag On the typo is a pack that stays off while the others run: say which run, from the filter and not the typed text, and which stay off, so the
                // one the typo was meant for is among them.
                packsWarning += $". The packs that will run ({willRun.Count} of {DemoPacks.Names.Count}): {string.Join(", ", willRun)}."
                    + $" The packs that stay off ({DemoPacks.Names.Count - willRun.Count}): {string.Join(", ", DemoPacks.Names.Except(willRun))}.";
            }
            else
            {
                packsWarning += (unknown.Count == packs.Count ? ", so no pack will run" : string.Empty) + $" (the packs are {string.Join(", ", DemoPacks.Names)}).";
            }
            warning = warning is null ? packsWarning : warning + " " + packsWarning;
        }

        return new DemoDataOptions
        {
            Scenarios = on ? DemoScenarioMode.On : DemoScenarioMode.Off,
            Packs = packs,
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
