using System.Globalization;
using System.Text.RegularExpressions;
using Odip.Application.DTOs;
using Odip.Application.Funding;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Infrastructure.Services;

/// <summary>
/// One funding row as read from the file. Category 0 is Core. The dates, Category, Management and Amount are null on a row that can't be imported; the
/// line is still set when the row names anyone, so that row keeps the rest of its participant's plan out. <see cref="ParticipantId"/> is filled by
/// ImportFundingRows.Match.
/// </summary>
public sealed record ImportFundingLine(string? NdisKey, string FullName, DateOnly? DateOfBirth, DateOnly? PlanStart, DateOnly? PlanEnd, int? Category, PlanType? Management, decimal? Amount)
{
    public Guid ParticipantId { get; init; }
    /// <summary>What the NDIS cell held when it isn't a 9-digit number ("43000O001"): never a key, only a hint for which participant a bad row was for.</summary>
    public string? UnreadNdis { get; init; }
}

/// <summary>A participant as the funding import matches them: by NDIS number, else by full name and date of birth.</summary>
public sealed record ImportParticipantMatch(Guid Id, string? NdisNumber, string FirstName, string LastName, DateOnly? DateOfBirth);

/// <summary>One plan a commit creates: its participant, the rows it came from (in file order) and the plan as the Funding tab would save it.</summary>
public sealed record ImportFundingPlan(Guid ParticipantId, List<ImportRowPlan> Rows, SaveFundingPlanDto Plan);

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

    /// <summary>
    /// Gives each ready row its participant: the one with its NDIS number or, only when the row has none, the one with its full name (whatever the case
    /// and spacing) and date of birth. None, or more than one, is a reason. A row with an NDIS number never falls back to the name: that could put the
    /// money on someone else.
    /// </summary>
    public static void Match(List<ImportRowPlan> plans, IReadOnlyList<ImportParticipantMatch> participants)
    {
        var lookup = new ImportParticipantLookup(participants);
        foreach (var plan in plans.Where(p => p.Funding != null && p.Status != ImportRowStatus.Skipped))
        {
            var line = plan.Funding!;
            var found = lookup.Find(line.NdisKey, line.FullName, line.DateOfBirth);
            if (plan.Status != ImportRowStatus.Ready)
            {
                // A row that can't be imported still says whose plan it belongs to, so Check can keep the rest of that plan out.
                if (found.Count == 1) plan.Name = (found[0].FirstName + " " + found[0].LastName).Trim();
                if ((found.Count == 1 ? found[0] : Likely(line, participants)) is { } owner) plan.Funding = line with { ParticipantId = owner.Id };
                continue;
            }
            if (found.Count == 0)
            {
                plan.Refuse($"No participant in Bunya Support has {(line.NdisKey is null ? "this name and date of birth" : "this NDIS number")}. Import or add them first.");
                if (Likely(line, participants) is { } owner) plan.Funding = line with { ParticipantId = owner.Id };
            }
            else if (found.Count > 1)
                plan.Refuse(line.NdisKey is null
                    ? $"{found.Count} participants in Bunya Support have this name and date of birth. Add their NDIS number to the row."
                    : $"{found.Count} participants in Bunya Support have this NDIS number. Correct it on their profiles first.");
            else
            {
                var match = found[0];
                plan.Name = $"{match.FirstName} {match.LastName}".Trim();
                plan.Funding = line with { ParticipantId = match.Id };
                // A known number on a row that names someone else is most likely a typo that hit another real participant, and the preview shows only the
                // ODIP name: say so (a warning, since the number is the stronger key).
                if (line.NdisKey is null) continue;
                if (line.FullName.Contains(' ') && NameKey(line.FullName) != NameKey(plan.Name))
                    plan.Warnings.Add($"The file names {line.FullName} for this NDIS number, which is {plan.Name} in Bunya Support. Check the number.");
                else if (line.DateOfBirth is { } dob && match.DateOfBirth is { } recorded && dob != recorded)
                    plan.Warnings.Add($"The file's date of birth for this NDIS number isn't {plan.Name}'s in Bunya Support. Check the number.");
            }
        }
    }

    /// <summary>
    /// Who a row that matched nobody was most likely meant for: the participant whose NDIS number is one character off a cell that can't be a number
    /// ("43000O001"), or whose name (and date of birth, when the row gives one) is the row's. A valid number nobody holds links to nobody: it is most
    /// likely someone not imported yet, and numbers run close together. Null unless exactly one fits. It only keeps that participant's plan out.
    /// </summary>
    private static ImportParticipantMatch? Likely(ImportFundingLine line, IReadOnlyList<ImportParticipantMatch> participants)
    {
        var fits = participants.Where(p =>
                (line.UnreadNdis != null && p.NdisNumber != null && OneOff(line.UnreadNdis, ImportParticipantRows.NdisKey(p.NdisNumber)))
                || (line.FullName.Contains(' ') && NameKey($"{p.FirstName} {p.LastName}".Trim()) == NameKey(line.FullName) && (line.DateOfBirth is null || line.DateOfBirth == p.DateOfBirth)))
            .Take(2).ToList();
        return fits.Count == 1 ? fits[0] : null;
    }

    private static bool OneOff(string typed, string number) =>
        ImportParticipantRows.IsNdisNumber(number) && typed.Length == number.Length && typed.Zip(number).Count(pair => pair.First != pair.Second) <= 1;

    /// <summary>
    /// The plan rules, over the rows grouped into plans:
    /// - one row per category and management (Core is one amount, or categories 01 to 04, never both);
    /// - no overlap with the participant's plans already in ODIP, or with another of their plans in the file (a re-plan or a mistyped date: both are left out);
    /// - the Funding tab's own validator.
    /// A plan with any row that can't be imported is left out whole, so no plan lands with a category missing.
    /// </summary>
    public static void Check(List<ImportRowPlan> plans, IReadOnlyCollection<(Guid ParticipantId, DateOnly Start, DateOnly End)> existing)
    {
        // A row of a participant's whose plan dates can't be read belongs to no plan, so every plan of that participant in the file is left out.
        var undated = plans.Where(p => p.Status == ImportRowStatus.Invalid && p.Funding is { } line && line.ParticipantId != Guid.Empty && (line.PlanStart is null || line.PlanEnd is null))
            .GroupBy(p => p.Funding!.ParticipantId).ToDictionary(g => g.Key, g => g.First().RowNumber);
        var groups = Groups(plans);
        foreach (var rows in groups)
        {
            var (participantId, start, end) = (rows[0].Funding!.ParticipantId, rows[0].Funding!.PlanStart!.Value, rows[0].Funding!.PlanEnd!.Value);
            if (undated.TryGetValue(participantId, out var undatedRow))
            {
                Refuse(rows.Where(r => r.Status == ImportRowStatus.Ready).ToList(), $"Row {undatedRow} for this participant can't be imported, so their plans in this file are left out.");
                continue;
            }
            RefuseRepeats(rows);
            if (rows.FirstOrDefault(r => r.Status == ImportRowStatus.Invalid) is { } bad)
            {
                Refuse(rows.Where(r => r.Status == ImportRowStatus.Ready).ToList(), $"Row {bad.RowNumber} of this plan can't be imported, so the whole plan is left out.");
                continue;
            }
            var inOdip = existing.Where(p => p.ParticipantId == participantId && p.Start <= end && start <= p.End)
                .Select(p => $"{Say(p.Start)} to {Say(p.End)}").FirstOrDefault();
            var inFile = groups.Where(g => g != rows && g[0].Funding!.ParticipantId == participantId && g[0].Funding!.PlanStart <= end && start <= g[0].Funding!.PlanEnd)
                .Select(g => (int?)g[0].RowNumber).FirstOrDefault();
            if (inOdip != null)
                Refuse(rows, $"This participant already has a plan in Bunya Support from {inOdip}, which overlaps these dates. Change that plan on their Funding tab, or leave these rows out.");
            else if (inFile != null)
                Refuse(rows, $"This plan overlaps the plan on row {inFile} for the same participant, so both are left out. Check the plan dates on those rows.");
            else
                foreach (var error in FundingPlanValidator.Validate(ToDto(rows))) Refuse(rows, error);
            if (rows[0].Status != ImportRowStatus.Ready) continue;
            NoteCore(rows);
        }
    }

    /// <summary>The plans a commit creates: the ready rows grouped as <see cref="Check"/> grouped them, in file order.</summary>
    public static List<ImportFundingPlan> Plans(IEnumerable<ImportRowPlan> plans) =>
        Groups(plans.Where(p => p.Status == ImportRowStatus.Ready)).Select(rows => new ImportFundingPlan(rows[0].Funding!.ParticipantId, rows, ToDto(rows))).ToList();

    /// <summary>
    /// The rows (not skipped) of each plan, by the participant they were matched or linked to and the plan dates, in file order: rows of one participant
    /// found by number and by name are one plan.
    /// </summary>
    private static List<List<ImportRowPlan>> Groups(IEnumerable<ImportRowPlan> plans) =>
        plans.Where(p => p.Funding is { PlanStart: not null, PlanEnd: not null } line && line.ParticipantId != Guid.Empty && p.Status != ImportRowStatus.Skipped)
            .GroupBy(p => (p.Funding!.ParticipantId, p.Funding.PlanStart, p.Funding.PlanEnd))
            .Select(g => g.ToList())
            .ToList();

    /// <summary>One row per category and management in a plan. Core is one amount or categories 01 to 04, never both, so no money is counted twice.</summary>
    private static void RefuseRepeats(List<ImportRowPlan> rows)
    {
        var seen = new Dictionary<(int Category, PlanType Management), int>();
        foreach (var row in rows.Where(r => r.Status == ImportRowStatus.Ready))
        {
            var (category, management) = (row.Funding!.Category!.Value, row.Funding.Management!.Value);
            // Row numbers start at 2 (the header is row 1), so 0 means none.
            var same = seen.GetValueOrDefault((category, management));
            var core = IsCore(category)
                ? seen.Where(s => s.Key.Management == management && IsCore(s.Key.Category) && (s.Key.Category == Core) != (category == Core)).Select(s => s.Value).FirstOrDefault()
                : 0;
            if (same != 0) row.Refuse($"Row {same} has the same category and management for this plan.");
            else if (core != 0) row.Refuse($"Row {core} gives Core for this plan too. Give Core as one amount, or as categories 01 to 04, not both.");
            else seen[(category, management)] = row.RowNumber;
        }
    }

    private static void Refuse(List<ImportRowPlan> rows, string reason) => rows.ForEach(r => r.Refuse(reason));

    /// <summary>The note on each row that went into a Core (flexible) pool as category 01 to 04: the pool's total.</summary>
    private static void NoteCore(List<ImportRowPlan> rows)
    {
        foreach (var pool in rows.Where(r => r.Funding!.Category is >= 1 and <= 4).GroupBy(r => r.Funding!.Management!.Value))
        {
            var note = $"Categories 01 to 04 are one Core (flexible) pool in Bunya Support: this plan's {Words(pool.Key)} Core comes to ${Money(pool.Sum(r => r.Funding!.Amount!.Value))}.";
            foreach (var row in pool) row.Notes.Add(note);
        }
    }

    /// <summary>The plan as the Funding tab saves it: one pool per category and management (01 to 04 added into Core), each with one period equal to the plan.</summary>
    private static SaveFundingPlanDto ToDto(List<ImportRowPlan> rows)
    {
        var (start, end) = (rows[0].Funding!.PlanStart!.Value, rows[0].Funding!.PlanEnd!.Value);
        return new SaveFundingPlanDto
        {
            PlanStart = start, PlanEnd = end, Evidence = BudgetEvidenceSource.Other,
            Pools = rows
                .GroupBy(r => (Category: IsCore(r.Funding!.Category!.Value) ? Core : r.Funding.Category.Value, Management: r.Funding.Management!.Value))
                .Select(pool => new SaveFundingPoolDto
                {
                    Kind = pool.Key.Category == Core ? FundingPoolKind.CoreFlexible : FundingPoolKind.Stated,
                    PaceCategory = pool.Key.Category, ManagementType = pool.Key.Management,
                    Periods = [new SaveFundingPeriodDto { PeriodStart = start, PeriodEnd = end, PlanAmount = pool.Sum(r => r.Funding!.Amount!.Value) }],
                })
                .ToList(),
        };
    }

    private static bool IsCore(int category) => category is >= Core and <= 4;

    private static string Words(PlanType management) => management switch
    {
        PlanType.SelfManaged => "self-managed",
        PlanType.PlanManaged => "plan-managed",
        _ => "NDIA-managed",
    };

    private static string Say(DateOnly day) => day.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    private static string Money(decimal amount) => amount.ToString("N2", CultureInfo.InvariantCulture);

    private static ImportRowPlan BuildRow(int rowNumber, Func<string, string> get, Dictionary<string, bool> monthFirst)
    {
        var reasons = new List<string>();
        var ndis = get("ndisNumber");
        var first = get("firstName");
        var last = get("lastName");
        var fullName = $"{first} {last}".Trim();
        var (dateOfBirth, dobError) = ImportValues.Date(get("dateOfBirth"), "Date of birth", monthFirst["dateOfBirth"]);
        if (dobError != null) reasons.Add(dobError);
        // A placeholder ("-", "TBC", "N/A") or anything else that isn't 9 digits is no NDIS number: as a key it would put several people's money on
        // whoever in ODIP holds the same placeholder. The row finds its participant by name and date of birth instead.
        var ndisKey = ImportParticipantRows.IsNdisNumber(ImportParticipantRows.NdisKey(ndis)) ? ImportParticipantRows.NdisKey(ndis) : null;
        var byName = first.Length > 0 && last.Length > 0 && dateOfBirth is not null;
        var known = ndisKey != null || byName;
        if (!known) reasons.Add(ndis.Length > 0
            ? "The NDIS number isn't 9 digits, so give the participant's first name, last name and date of birth instead."
            : "Give the participant's NDIS number, or their first name, last name and date of birth.");

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
        var who = ndisKey ?? (known ? $"{NameKey(fullName)}|{dateOfBirth!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}" : null);
        var plan = new ImportRowPlan
        {
            RowNumber = rowNumber, Name = fullName.Length > 0 ? fullName : ndisKey != null ? $"NDIS {ndis}" : $"Row {rowNumber}", DuplicateKey = who,
        };
        if (known || ndis.Length > 0)
            plan.Funding = new ImportFundingLine(ndisKey, fullName, dateOfBirth, start, end, category, management, amount)
            {
                UnreadNdis = ndisKey is null && ImportParticipantRows.NdisKey(ndis) is { Length: > 0 } typed ? typed : null,
            };
        if (category is { } c && management is { } m && amount is { } a && start is { } from && end is { } to)
            plan.Detail = $"{(c == Core ? "Core" : $"{c:00} {PaceCategories.NameOf(c)}")}, {Words(m)}, ${Money(a)}, {Say(from)} to {Say(to)}";
        if (ndis.Length > 0 && ndisKey is null && known) plan.Warnings.Add("The NDIS number isn't 9 digits, so this row finds its participant by name and date of birth.");
        if (first == ImportParticipantRows.ExampleFirstName && last == ImportParticipantRows.ExampleLastName) plan.Skip("This is the template's example row.");
        else if (category == RecurringTransport) plan.Skip("Recurring Transport (18) is paid to the participant and never claimed by providers, so Bunya Support doesn't record it.");
        else reasons.ForEach(plan.Refuse);
        return plan;
    }

    private static string NameKey(string name) => ImportParticipantLookup.NameKey(name);

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
        // Counted in the text, not the value: "12.500" (a thousands dot) is 12.5m, which would pass a value check as $12.50.
        if (digits.IndexOf('.') is var dot and >= 0 && digits.Length - dot - 1 > 2) return (null, "Amount is in dollars and cents: at most two decimal places.");
        if (amount > FundingPlanValidator.MaxAmount) return (null, $"Amount can be at most ${FundingPlanValidator.MaxAmount.ToString("N2", CultureInfo.InvariantCulture)}.");
        return (amount, null);
    }
}
