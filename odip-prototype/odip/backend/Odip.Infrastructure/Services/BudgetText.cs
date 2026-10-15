using System.Globalization;
using Odip.Domain.Enums;
using Odip.Domain.Funding;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The words the budget feature's server-written sentences share (the participant alerts, the Budgets list's pool names), so that no two of them spell a pool, a sum or a day differently. Everything
/// is formatted with the invariant culture: the deploy image runs under invariant globalization and the dev machine is en-AU, and a sentence that read differently in the two would pass here and
/// fail there (CLAUDE.md, Gotchas).
/// </summary>
public static class BudgetText
{
    /// <summary>A sum of money as a sentence carries it: "$8,000" when it is whole dollars, else "$8,000.50". Never negative: a sentence says "over", it does not print a minus.</summary>
    public static string Money(decimal amount)
    {
        var magnitude = Math.Abs(amount);
        return "$" + magnitude.ToString(magnitude % 1m == 0m ? "N0" : "N2", CultureInfo.InvariantCulture);
    }

    /// <summary>A day as a sentence carries it: "31 Dec 2026".</summary>
    public static string Day(DateOnly day) => day.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

    /// <summary>
    /// What an alert says when the figures it rests on leave shifts out: the shift claim cannot price a sleepover, a passive night or a group shift yet, so each is $0 in every figure and the period counts
    /// them (<see cref="PeriodLedger.UnpricedShiftCount"/>). "1 shift in this period is not priced yet, so this leaves it out"; "3 shifts in this period are not priced yet, so this leaves them out".
    /// </summary>
    public static string UnpricedShifts(int count) => count == 1
        ? "1 shift in this period is not priced yet, so this leaves it out"
        : string.Create(CultureInfo.InvariantCulture, $"{count} shifts in this period are not priced yet, so this leaves them out");

    /// <summary>
    /// What a pool is called in a sentence. A stated pool is the category as the plan prints it. The Core (flexible) pool a plan holds under the default name is just "Core", and when a plan
    /// holds two of them (the NDIA splits Core by how the money is managed) each says how, so the two can be told apart.
    /// </summary>
    public static string PoolLabel(FundingPool pool, bool planHoldsSeveralCorePools)
    {
        var name = pool.Kind == FundingPoolKind.CoreFlexible && string.Equals(pool.Name, PaceCategories.CoreFlexibleName, StringComparison.Ordinal) ? "Core" : pool.Name;
        return pool.Kind == FundingPoolKind.CoreFlexible && planHoldsSeveralCorePools ? $"{name} ({ManagementWords(pool.ManagementType)})" : name;
    }

    /// <summary>How the money of a pool is managed, in lower case for the middle of a sentence.</summary>
    public static string ManagementWords(PlanType management) => management switch
    {
        PlanType.SelfManaged => "self managed",
        PlanType.PlanManaged => "plan managed",
        PlanType.AgencyManaged => "agency managed",
        _ => management.ToString(),
    };
}
