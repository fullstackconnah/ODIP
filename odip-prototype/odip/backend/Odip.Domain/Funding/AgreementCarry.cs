namespace Odip.Domain.Funding;

/// <summary>
/// The agreement check's arithmetic for ONE pool (budget phase 2b), pure: the pool's funding periods in date order, each with its limit, what is already used and what the agreement would cost
/// in it, and out comes what each period has available once the agreement has spent its share of the earlier ones.
///
/// The ledger carries what a period leaves unspent into the next (<c>max(0, available - used)</c>, chained). That is right for money nobody is about to spend, but an agreement IS about to spend
/// it: judged period by period against the ledger's carry, a later period counts the unspent money of an earlier one that the same agreement uses up, and an agreement that overspends the pool
/// as a whole reads as within in every period. So the walk takes the agreement off as it goes: <c>carry out = max(0, limit + carry in - used - agreement cost)</c>, and a period's remaining is
/// <c>limit + carry in - used</c>. With no agreement cost anywhere it is exactly the ledger's own chain. What is booked ahead is not taken off, as everywhere else: it is not used yet.
/// </summary>
public static class AgreementCarry
{
    /// <summary>One period of the pool: its limit, what is used in it already (claimed plus pending), and what the agreement costs in it (0 for a period the agreement does not touch).</summary>
    public readonly record struct PeriodInput(decimal Limit, decimal Used, decimal AgreementCost);

    /// <summary>What a period has once the agreement has spent its share of the earlier ones: what carried in, the limit plus that, what is left after what is used, and how far the agreement passes it.</summary>
    public readonly record struct PeriodOutcome(decimal CarriedIn, decimal Available, decimal Remaining, decimal OverBy);

    /// <param name="carriedIntoFirst">What the ledger says carries into the first period of the walk (0 for the first period of a plan; nothing carries across plans).</param>
    /// <param name="periods">The pool's periods in date order, including the ones the agreement does not touch: their unspent money carries too.</param>
    public static IReadOnlyList<PeriodOutcome> Walk(decimal carriedIntoFirst, IReadOnlyList<PeriodInput> periods)
    {
        var outcomes = new List<PeriodOutcome>(periods.Count);
        var carry = Math.Max(0m, carriedIntoFirst);
        foreach (var period in periods)
        {
            var available = period.Limit + carry;
            var remaining = available - period.Used;
            outcomes.Add(new PeriodOutcome(carry, available, remaining, Math.Max(0m, period.AgreementCost - remaining)));
            carry = Math.Max(0m, remaining - period.AgreementCost);
        }

        return outcomes;
    }
}
