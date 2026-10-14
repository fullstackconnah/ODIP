using System.Globalization;
using System.Text.RegularExpressions;
using Odip.Application.DTOs;
using Odip.Application.Funding;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Infrastructure.Services;

/// <summary>
/// One funding row as read from the file. Category 0 is Core. Category, Management and Amount are null on a row that can't be imported; the line is
/// still set when the row says who and when, so that row keeps the rest of its plan out. <see cref="ParticipantId"/> is filled by ImportFundingRows.Match.
/// </summary>
public sealed record ImportFundingLine(string? NdisKey, string FullName, DateOnly? DateOfBirth, DateOnly PlanStart, DateOnly PlanEnd, int? Category, PlanType? Management, decimal? Amount)
{
    public Guid ParticipantId { get; init; }
}

/// <summary>
/// The funding plans import: one row per participant per support category. Rows are read here, matched to participants already in ODIP, and grouped
/// into one plan per participant and plan dates. Only the file and in-memory rules live here: the service reads the database, and FundingPlanService
/// checks every plan again at commit.
/// </summary>
public static class ImportFundingRows
{
    /// <summary>The category of the Core (flexible) pool: 01 to 04 are one pool for each way of managing it.</summary>
    private const int Core = 0;
    private const int RecurringTransport = 18;
    private static readonly string[] DateKeys = ["dateOfBirth", "planStart", "planEnd"];

    public static List<ImportRowPlan> Build(ImportTable table, IReadOnlyList<string?> mapping)
    {
        var column = new Dictionary<string, int>();
        for (var i = 0; i < mapping.Count; i++)
            if (mapping[i] is { } key) column[key] = i;
        var monthFirst = DateKeys.ToDictionary(key => key,
            key => column.TryGetValue(key, out var c) && table.Rows.Any(r => ImportValues.LooksMonthFirst(table.Cell(r, c))));

        var plans = new List<ImportRowPlan>(table.Rows.Count);
        foreach (var row in table.Rows)
        {
            string Get(string key) => column.TryGetValue(key, out var i) ? table.Cell(row, i) : "";
            plans.Add(BuildRow(row.RowNumber, Get, monthFirst));
        }
        return plans;
    }

    private static ImportRowPlan BuildRow(int rowNumber, Func<string, string> get, Dictionary<string, bool> monthFirst)
    {
        var reasons = new List<string>();
        var ndis = get("ndisNumber");
        var first = get("firstName");
        var last = get("lastName");
        var fullName = $"{first} {last}".Trim();
        var (dateOfBirth, dobError) = ImportValues.Date(get("dateOfBirth"), "Date of birth", monthFirst["dateOfBirth"]);
        if (dobError != null) reasons.Add(dobError);
        var known = ndis.Length > 0 || (first.Length > 0 && last.Length > 0 && dateOfBirth is not null);
        if (!known) reasons.Add("Give the participant's NDIS number, or their first name, last name and date of birth.");

        var (start, startError) = RequiredDate(get("planStart"), "Plan start", monthFirst["planStart"]);
        if (startError != null) reasons.Add(startError);
        var (end, endError) = RequiredDate(get("planEnd"), "Plan end", monthFirst["planEnd"]);
        if (endError != null) reasons.Add(endError);
        if (start > end) reasons.Add("Plan end is before Plan start.");

        var categoryText = get("category");
        var category = Category(categoryText);
        if (categoryText.Length == 0) reasons.Add("Support category is required.");
        else if (category is null) reasons.Add("Support category must be a number from 01 to 21, a category name, or Core.");

        var managementText = get("management");
        var (management, managementError) = ImportValues.PlanManagement(managementText, "Managed by");
        if (managementText.Length == 0) reasons.Add("Managed by is required.");
        else if (managementError != null) reasons.Add(managementError);

        var (amount, amountError) = Amount(get("amount"));
        if (amountError != null) reasons.Add(amountError);

        // Who the row is for, set even when its dates can't be read: Check then keeps that participant's plans out.
        var who = ndis.Length > 0 ? ImportParticipantRows.NdisKey(ndis) : known ? $"{NameKey(fullName)}|{dateOfBirth!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}" : null;
        var plan = new ImportRowPlan
        {
            RowNumber = rowNumber, Name = fullName.Length > 0 ? fullName : ndis.Length > 0 ? $"NDIS {ndis}" : $"Row {rowNumber}", DuplicateKey = who,
        };
        if (known && start is { } s && end is { } e)
            plan.Funding = new ImportFundingLine(ndis.Length > 0 ? ImportParticipantRows.NdisKey(ndis) : null, fullName, dateOfBirth, s, e, category, management, amount);
        if (first == ImportParticipantRows.ExampleFirstName && last == ImportParticipantRows.ExampleLastName) plan.Skip("This is the template's example row.");
        else if (category == RecurringTransport) plan.Skip("Recurring Transport (18) is paid to the participant and never claimed by providers, so ODIP doesn't record it.");
        else reasons.ForEach(plan.Refuse);
        return plan;
    }

    private static string NameKey(string name) => string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

    private static (DateOnly? Value, string? Error) RequiredDate(string text, string label, bool columnIsMonthFirst) =>
        text.Length == 0 ? (null, $"{label} is required.") : ImportValues.Date(text, label, columnIsMonthFirst);

    /// <summary>"Core", a category number ("01" or "1") or the category's name as the NDIA prints it; null when it is none of them.</summary>
    private static int? Category(string text)
    {
        var key = ImportFields.Normalise(text);
        if (key is "core" or "coresupports" or "coreflexible") return Core;
        if (int.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var number)) return PaceCategories.Find(number)?.Number;
        return key.Length == 0 ? null : PaceCategories.All.FirstOrDefault(c => ImportFields.Normalise(c.Name) == key)?.Number;
    }

    // A comma only between thousands: "12500,50" or "1,5" read with the commas dropped would be $1,250,050.00 or $15.
    private static readonly Regex Thousands = new(@"^-?\d{1,3}(,\d{3})+(\.\d+)?$");

    /// <summary>Dollars as a person or Excel writes them ("$12,500.00", "12500", "12,500.5"): never negative, to the cent, at most the plan screen's limit.</summary>
    private static (decimal? Value, string? Error) Amount(string text)
    {
        if (text.Length == 0) return (null, "Amount is required.");
        var digits = text.Replace("$", "").Replace(" ", "");
        if (digits.Contains(',') && !Thousands.IsMatch(digits)) return (null, "Amount: use a dot for cents, and commas only between thousands, like 12,500.00.");
        digits = digits.Replace(",", "");
        if (!decimal.TryParse(digits, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount))
            return (null, "Amount must be a number of dollars, like 12500.00.");
        if (amount < 0m) return (null, "Amount can't be negative.");
        if (decimal.Round(amount, 2) != amount) return (null, "Amount is in dollars and cents: at most two decimal places.");
        if (amount > FundingPlanValidator.MaxAmount) return (null, $"Amount can be at most ${FundingPlanValidator.MaxAmount.ToString("N2", CultureInfo.InvariantCulture)}.");
        return (amount, null);
    }
}
