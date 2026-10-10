namespace Odip.Domain.Enums;

/// <summary>
/// Allowed values for <see cref="Entities.Participant.MobilitySupportOptions"/>, sourced from the
/// Master Data Dictionary mobility picklist (ODIP Master Data Dictionary.xlsx at the repo root) — the spreadsheet
/// is the source of truth for this set.
/// </summary>
public static class MobilitySupportOptions
{
    public static readonly IReadOnlyList<string> All = new[]
    {
        "Wheelchair in vehicle",
        "Full vehicle",
        "Transfers",
        "Ceiling hoist",
        "Manual hoist",
        "Sit-to-stand",
        "Slide board",
        "Walking aid",
        "Swivel board",
        "Standing frame",
    };

    public static bool IsValid(string value) => All.Contains(value);
}
