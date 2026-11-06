using System.Text.Json;

namespace Odip.Domain.Entities;

/// <summary>
/// The "Onboarding checklist" setting (owner 2026-11-06): which checklist items an organisation shows, and whether they are required.
/// Stored on <see cref="ProviderSettings.OnboardingItemModes"/> as a JSON map of key to mode; null means the defaults. An optional item is listed
/// but never counted and never blocks. Modes are strings (they live in a jsonb map); this class owns the allowed set.
/// </summary>
public static class OnboardingItemModeRules
{
    public const string Required = "Required", Optional = "Optional", Off = "Off";

    /// <summary>The settable items, in checklist order. Matching is case-sensitive.</summary>
    public static readonly string[] Keys = ["complaints", "rights", "myProvider", "budget"];

    public static readonly IReadOnlyDictionary<string, string> Defaults = new Dictionary<string, string>
    {
        ["complaints"] = Required, ["rights"] = Required, ["myProvider"] = Required, ["budget"] = Off,
    };

    /// <summary>The label the 400 names for a key.</summary>
    private static string Label(string key) => key switch
    {
        "complaints" => "Told how to make a complaint",
        "rights" => "Rights explained",
        "myProvider" => "Recorded as my provider",
        _ => "Plan budget added",
    };

    private static bool Allowed(string key, string? mode) =>
        mode == Optional || (key == "budget" ? mode == Off : mode == Required);

    /// <summary>The defaults overlaid with the stored valid pairs; an unknown key, a mode the key does not allow, or bad JSON is ignored.</summary>
    public static Dictionary<string, string> Effective(string? json)
    {
        var map = new Dictionary<string, string>(Defaults);
        if (string.IsNullOrWhiteSpace(json)) return map;
        try
        {
            var stored = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
            if (stored == null) return map;
            foreach (var (key, mode) in stored)
                if (map.ContainsKey(key) && Allowed(key, mode)) map[key] = mode;
        }
        catch (JsonException) { }
        return map;
    }

    /// <summary>The error sentence for a map the PUT must refuse (an unknown key, or a mode the key does not allow); null when it is fine.</summary>
    public static string? Problem(Dictionary<string, string> sent)
    {
        foreach (var (key, mode) in sent)
        {
            if (!Defaults.ContainsKey(key)) return $"Unknown onboarding checklist item: {key}.";
            if (!Allowed(key, mode)) return $"{Label(key)} can be {(key == "budget" ? "Off" : "Required")} or Optional.";
        }
        return null;
    }

    /// <summary>What to store: null when the map equals the defaults, else the compact JSON of the four keys in <see cref="Keys"/> order.</summary>
    public static string? Store(IReadOnlyDictionary<string, string> effective) =>
        Keys.All(k => effective[k] == Defaults[k]) ? null : JsonSerializer.Serialize(Keys.ToDictionary(k => k, k => effective[k]));

    /// <summary>One line for the audit row, e.g. "complaints=Required, rights=Optional, myProvider=Required, budget=Off".</summary>
    public static string Describe(IReadOnlyDictionary<string, string> effective) =>
        string.Join(", ", Keys.Select(k => $"{k}={effective[k]}"));
}
