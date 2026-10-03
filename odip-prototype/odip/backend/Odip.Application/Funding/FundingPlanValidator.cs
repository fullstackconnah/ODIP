using System.Globalization;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Application.Funding;

/// <summary>
/// The server's rules for a plan budget being created or replaced, in plain words: every reason a save is refused, not just the first. It checks the invariants
/// and never proposes periods (the screen proposes them from the plan's dates and the period length, and the user may edit each one to match the plan's release
/// schedule). Nothing here reads the database: whether another plan overlaps, and whether the save is stale, are the service's.
///
/// The rules, from the spec:
/// <list type="bullet">
/// <item>the plan: both dates, the end on or after the start, at most <see cref="FundingPlan.MaxPlanDays"/> days; the period length 1, 3, 6 or 12 months or none; a source;</item>
/// <item>a pool: Core (flexible) has category 0; a stated pool has one of 5 to 17, 19, 20 or 21 (never 1 to 4, which are Core flexible, and never 18, which is paid to the
///   participant); a management type; no two pools with the same category and management type;</item>
/// <item>the periods of a pool: contiguous, from the plan's first day to its last, none longer than 12 months, and when the plan has no funding periods exactly one,
///   equal to the plan's dates (the 12-month cap is for release periods, so a plan with none may be longer than 12 months, up to the plan limit);</item>
/// <item>the money: a plan amount of zero or more, in dollars and cents; a set-aside on every period of a pool or on none, zero or more and never above the plan amount.</item>
/// </list>
/// </summary>
public static class FundingPlanValidator
{
    public const int MaxPools = 40;
    public const int MaxPeriodsPerPool = 60;
    /// <summary>The largest amount one period may hold: far below what decimal(18,2) can store, so a slipped decimal point cannot overflow a column or read as real money.</summary>
    public const decimal MaxAmount = 99_999_999.99m;

    private static readonly int[] AllowedPeriodLengths = { 1, 3, 6, 12 };

    public static List<string> Validate(SaveFundingPlanDto dto)
    {
        var errors = new List<string>();

        // ── The plan ────────────────────────────────────────────────────────
        if (dto.PlanStart is null) errors.Add("Give the day the plan starts.");
        if (dto.PlanEnd is null) errors.Add("Give the day the plan ends.");
        DateOnly? planStart = null, planEnd = null;
        if (dto.PlanStart is { } start && dto.PlanEnd is { } end)
        {
            if (end < start)
            {
                errors.Add("The plan ends before it starts.");
            }
            else
            {
                (planStart, planEnd) = (start, end);
                var days = end.DayNumber - start.DayNumber + 1;
                if (days > FundingPlan.MaxPlanDays)
                    errors.Add(string.Create(CultureInfo.InvariantCulture, $"The plan runs {days} days. A plan can be at most {FundingPlan.MaxPlanDays} days long."));
            }
        }

        var hasFundingPeriods = dto.PeriodLengthMonths is not null;
        if (dto.PeriodLengthMonths is { } months && !AllowedPeriodLengths.Contains(months))
            errors.Add("Funding periods are 1, 3, 6 or 12 months long, or the plan has none.");

        if (dto.Evidence is not { } evidence || !Enum.IsDefined(evidence))
            errors.Add("Choose where the figures came from.");

        if (dto.ConfirmedByName?.Trim().Length > 200) errors.Add("Confirmed by can be at most 200 characters.");
        if (HasNull(dto.ConfirmedByName)) errors.Add("Confirmed by cannot contain a null character.");
        if (dto.Notes?.Trim().Length > 2000) errors.Add("Notes can be at most 2000 characters.");
        if (HasNull(dto.Notes)) errors.Add("The notes cannot contain a null character.");

        // ── The pools ───────────────────────────────────────────────────────
        var pools = dto.Pools;
        if (pools is null || pools.Count == 0)
        {
            errors.Add("Add at least one pool from the plan.");
            return errors;
        }

        if (pools.Count > MaxPools) errors.Add($"A plan can hold at most {MaxPools} pools.");

        var seen = new HashSet<(int Category, PlanType Management)>();
        for (var index = 0; index < pools.Count; index++)
        {
            var pool = pools[index];
            // A body can carry a null where a pool should be (JSON allows it): say so, and go on to read the others.
            if (pool is null)
            {
                errors.Add($"Pool {index + 1} is empty. Give its details, or leave it out.");
                continue;
            }

            var label = Label(pool, index);
            var kindOk = pool.Kind is { } kind && Enum.IsDefined(kind);
            var managementOk = pool.ManagementType is { } management && Enum.IsDefined(management);

            if (!kindOk) errors.Add($"Say whether pool {index + 1} is Core (flexible) or a stated support.");
            else CheckCategory(pool, label, errors);
            if (!managementOk) errors.Add($"Say who manages the money for {label}: the participant, a plan manager or the NDIA.");

            if (kindOk && managementOk && !seen.Add((pool.PaceCategory, pool.ManagementType!.Value)))
                errors.Add($"The plan lists {label} twice. A plan holds each category once for each way of managing it.");

            if (pool.Name?.Trim().Length > 200) errors.Add($"{label}: the pool name can be at most 200 characters.");
            if (HasNull(pool.Name)) errors.Add($"{label}: the pool name cannot contain a null character.");
            if (pool.Notes?.Trim().Length > 1000) errors.Add($"{label}: the pool notes can be at most 1000 characters.");
            if (HasNull(pool.Notes)) errors.Add($"{label}: the pool notes cannot contain a null character.");

            CheckPeriods(pool.Periods, label, planStart, planEnd, hasFundingPeriods, errors);
        }

        return errors;
    }

    /// <summary>
    /// The last day of twelve months from <paramref name="start"/> (a period starting 1 Jul 2026 may run to 30 Jun 2027). A period that starts on a leap day may run to
    /// 28 Feb the next year, which is the day before the same date twelve months on (1 Mar).
    /// </summary>
    public static DateOnly MaxPeriodEnd(DateOnly start)
    {
        // Twelve months on from a start in the last year the calendar holds is past its end, so nothing can be later than the limit: no period there is "too long".
        if (start.Year == DateOnly.MaxValue.Year) return DateOnly.MaxValue;
        var sameDayNextYear = start.AddYears(1);
        return start is { Month: 2, Day: 29 } ? sameDayNextYear : sameDayNextYear.AddDays(-1);
    }

    private static void CheckCategory(SaveFundingPoolDto pool, string label, List<string> errors)
    {
        var category = pool.PaceCategory;
        if (pool.Kind == FundingPoolKind.CoreFlexible)
        {
            if (category != 0) errors.Add($"{label}: a Core (flexible) pool covers categories 01 to 04, so it has no category of its own.");
            return;
        }

        if (category == 0) errors.Add($"{label}: choose the support category.");
        else if (category is >= 1 and <= 4) errors.Add($"{label}: categories 01 to 04 are Core (flexible). Record them in a Core (flexible) pool, not as a stated support.");
        else if (category == 18) errors.Add($"{label}: Recurring Transport (18) is paid to the participant and is never claimed by providers, so it cannot be a pool.");
        else if (PaceCategories.Find(category) is not { OfferedAsStatedPool: true }) errors.Add($"{label}: {category} is not an NDIS support category.");
    }

    private static void CheckPeriods(List<SaveFundingPeriodDto>? periods, string label, DateOnly? planStart, DateOnly? planEnd, bool hasFundingPeriods, List<string> errors)
    {
        if (periods is null || periods.Count == 0)
        {
            errors.Add($"{label} needs at least one funding period.");
            return;
        }

        if (periods.Count > MaxPeriodsPerPool)
        {
            errors.Add($"{label} has {periods.Count} periods; a pool can have at most {MaxPeriodsPerPool} periods.");
            return;
        }

        // A body can carry a null where a period should be: say so, and check the periods that are there.
        var present = periods.Where(period => period is not null).ToList();
        var emptyPeriod = present.Count < periods.Count;
        if (emptyPeriod) errors.Add($"A period in {label} is empty. Give its dates and plan amount, or leave it out.");

        var missingDates = false;
        var missingAmount = false;
        var dated = new List<(DateOnly Start, DateOnly End)>();
        foreach (var period in present)
        {
            if (period.PeriodStart is { } s && period.PeriodEnd is { } e) dated.Add((s, e));
            else missingDates = true;
            if (period.PlanAmount is null) missingAmount = true;
        }
        if (missingDates) errors.Add($"Give both dates of every period in {label}.");
        if (missingAmount) errors.Add($"Give the plan amount for every period in {label}.");

        CheckMoney(present, label, errors);

        if (!hasFundingPeriods)
        {
            // No funding periods: the whole plan is one period, and the pool holds exactly that.
            if (planStart is { } ps && planEnd is { } pe && !missingDates && !emptyPeriod && (present.Count != 1 || dated[0] != (ps, pe)))
                errors.Add($"{label}: the plan has no funding periods, so it has one period, from {Say(ps)} to {Say(pe)}.");
            return;
        }

        foreach (var (start, end) in dated)
        {
            if (end < start) errors.Add($"A period in {label} ends ({Say(end)}) before it starts ({Say(start)}).");
            else if (end > MaxPeriodEnd(start)) errors.Add($"A period in {label} ({Say(start)} to {Say(end)}) is longer than 12 months.");
        }

        var ordered = dated.OrderBy(p => p.Start).ThenBy(p => p.End).ToList();
        for (var i = 1; i < ordered.Count; i++)
        {
            var (previous, current) = (ordered[i - 1], ordered[i]);
            if (current.Start <= previous.End)
                errors.Add($"Periods in {label} overlap: the period starting {Say(current.Start)} begins before the one before it ends ({Say(previous.End)}).");
            else if (current.Start != previous.End.AddDays(1))
                errors.Add($"There is a gap in {label} between {Say(previous.End)} and {Say(current.Start)}: each period should start the day after the one before it ends.");
        }

        if (planStart is { } first && planEnd is { } last && ordered.Count > 0)
        {
            if (ordered[0].Start != first)
                errors.Add($"The first period in {label} starts on {Say(ordered[0].Start)}; it should start on the plan's first day, {Say(first)}.");
            var latestEnd = ordered.Max(p => p.End);
            if (latestEnd != last)
                errors.Add($"The last period in {label} ends on {Say(latestEnd)}; it should end on the plan's last day, {Say(last)}.");
        }
    }

    private static void CheckMoney(List<SaveFundingPeriodDto> periods, string label, List<string> errors)
    {
        foreach (var period in periods)
        {
            var where = period.PeriodStart is { } s ? $"the period starting {Say(s)} in {label}" : $"a period in {label}";
            if (period.PlanAmount is { } amount)
            {
                if (amount < 0m) errors.Add($"A plan amount cannot be negative ({where}).");
                else if (amount > MaxAmount) errors.Add($"A plan amount can be at most ${Money(MaxAmount)} ({where}).");
                else if (decimal.Round(amount, 2) != amount) errors.Add($"A plan amount is in dollars and cents ({where}).");
            }

            if (period.SetAside is { } setAside)
            {
                if (setAside < 0m) errors.Add($"A set-aside cannot be negative ({where}).");
                else if (decimal.Round(setAside, 2) != setAside) errors.Add($"A set-aside is in dollars and cents ({where}).");
                else if (period.PlanAmount is { } planAmount && setAside > planAmount)
                    errors.Add($"The set-aside (${Money(setAside)}) is more than the plan amount (${Money(planAmount)}) for {where}.");
            }
        }

        var withSetAside = periods.Count(p => p.SetAside is not null);
        if (withSetAside > 0 && withSetAside < periods.Count)
            errors.Add($"In {label}, the set-aside is given for some periods but not all. Give it for every period or for none.");
    }

    /// <summary>A null character in free text: PostgreSQL refuses it in a text column, and an unchecked one would reach it as an error instead of a reason.</summary>
    private static bool HasNull(string? text) => text is not null && text.Contains('\0');

    private static string Label(SaveFundingPoolDto pool, int index)
    {
        var name = pool.Name?.Trim();
        if (string.IsNullOrEmpty(name))
        {
            name = pool.Kind switch
            {
                FundingPoolKind.CoreFlexible => PaceCategories.CoreFlexibleName,
                FundingPoolKind.Stated => PaceCategories.NameOf(pool.PaceCategory) ?? $"Category {pool.PaceCategory}",
                _ => null,
            };
        }
        else if (name.Length > 40)
        {
            name = name[..40].TrimEnd() + "…";
        }

        if (name is null) return $"Pool {index + 1}";
        return pool.ManagementType is { } management && Enum.IsDefined(management) ? $"{name}, {ManagementWords(management)}" : name;
    }

    private static string ManagementWords(PlanType management) => management switch
    {
        PlanType.SelfManaged => "self-managed",
        PlanType.PlanManaged => "plan-managed",
        _ => "NDIA-managed",
    };

    /// <summary>A day as the screens write it: "1 Jul 2026".</summary>
    private static string Say(DateOnly day) => day.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    private static string Money(decimal amount) => amount.ToString("N2", CultureInfo.InvariantCulture);
}
