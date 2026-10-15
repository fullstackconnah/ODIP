using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>
/// How the onboarding import reads a cell: dd/mm/yyyy or yyyy-mm-dd dates (an Excel date cell arrives as yyyy-mm-dd), yes/no words, and the
/// length and format rules a DTO's own attributes carry. Every error names the field, never the value.
/// </summary>
public static class ImportValues
{
    private static readonly Regex Slash = new(@"^(\d{1,2})/(\d{1,2})/(\d+)$");
    private static readonly Regex Iso = new(@"^\d{4}-\d{1,2}-\d{1,2}$");

    /// <summary>True for d/m/yyyy-shaped text whose second part cannot be a month (04/23/1990): the column it sits in was written month-first.</summary>
    public static bool LooksMonthFirst(string text)
    {
        var m = Slash.Match(text);
        return m.Success && Part(m, 1) <= 12 && Part(m, 2) > 12;
    }

    /// <summary>
    /// A month-first column (any value in it <see cref="LooksMonthFirst"/>) makes every d/m value in it ambiguous, so they are all refused rather
    /// than half of them guessed.
    /// </summary>
    public static (DateOnly? Value, string? Error) Date(string text, string label, bool columnIsMonthFirst)
    {
        if (text.Length == 0) return (null, null);
        if (Iso.IsMatch(text))
            return DateOnly.TryParseExact(text, "yyyy-M-d", CultureInfo.InvariantCulture, DateTimeStyles.None, out var iso)
                ? (iso, null)
                : (null, $"{label} isn't a real date.");
        var m = Slash.Match(text);
        if (!m.Success) return (null, $"{label} must be a date as dd/mm/yyyy or yyyy-mm-dd.");
        if (m.Groups[3].Value.Length != 4) return (null, $"{label} needs a four-digit year (dd/mm/yyyy).");
        if (columnIsMonthFirst)
            return (null, $"{label}: this column has month-first dates (mm/dd/yyyy), so this date can't be read safely. Use dd/mm/yyyy or yyyy-mm-dd.");
        try { return (new DateOnly(Part(m, 3), Part(m, 2), Part(m, 1)), null); }
        catch (ArgumentOutOfRangeException) { return (null, $"{label} isn't a real date."); }
    }

    public static (bool? Value, string? Error) YesNo(string text, string label) => text.ToLowerInvariant() switch
    {
        "" => (null, null),
        "yes" or "y" or "true" or "1" => (true, null),
        "no" or "n" or "false" or "0" => (false, null),
        _ => (null, $"{label} must be yes or no."),
    };

    // Compared as ImportFields.Normalise leaves them (lower-case letters and digits): "Plan-managed", "plan managed" and "PLAN MANAGED" are one value.
    private static readonly Dictionary<string, PlanType> PlanTypes = new()
    {
        ["selfmanaged"] = PlanType.SelfManaged, ["self"] = PlanType.SelfManaged,
        ["planmanaged"] = PlanType.PlanManaged, ["plan"] = PlanType.PlanManaged, ["planmanager"] = PlanType.PlanManaged,
        ["ndiamanaged"] = PlanType.AgencyManaged, ["ndia"] = PlanType.AgencyManaged, ["agencymanaged"] = PlanType.AgencyManaged, ["agency"] = PlanType.AgencyManaged,
    };

    /// <summary>Self managed, Plan managed or NDIA managed, in the words other platforms export; blank is null.</summary>
    public static (PlanType? Value, string? Error) PlanManagement(string text, string label) =>
        text.Length == 0 ? (null, null)
        : PlanTypes.TryGetValue(ImportFields.Normalise(text), out var type) ? (type, null)
        : (null, $"{label} must be Self managed, Plan managed or NDIA managed.");

    /// <summary>
    /// The [StringLength], [EmailAddress] and [Required] rules on the properties named in <paramref name="labels"/>. A manual create meets them in the
    /// API's model validation before it reaches the create service; an import builds its DTO in-process, so it checks them here.
    /// </summary>
    public static IEnumerable<string> AnnotationErrors(object dto, IReadOnlyDictionary<string, string> labels)
    {
        foreach (var property in dto.GetType().GetProperties())
        {
            if (!labels.TryGetValue(property.Name, out var label)) continue;
            var value = property.GetValue(dto);
            var broken = property.GetCustomAttributes<ValidationAttribute>().FirstOrDefault(rule => !rule.IsValid(value));
            if (broken is null) continue;
            yield return broken switch
            {
                StringLengthAttribute length when value is string s && s.Length > length.MaximumLength => $"{label} is longer than {length.MaximumLength} characters.",
                EmailAddressAttribute => $"{label} isn't a valid email address.",
                _ => $"{label} is required.",
            };
        }
    }

    private static int Part(Match m, int group) => int.Parse(m.Groups[group].Value, CultureInfo.InvariantCulture);
}
