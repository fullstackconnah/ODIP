using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Domain.Billing.Pricing;

/// <summary>
/// The parts of the provider travel rule the agreement quote and the shift claim share (travel plan D2): the per-leg time cap, and the kilometre dollars. One copy, so a quote and a claim
/// cap and convert travel the same way.
/// </summary>
public static class ProviderTravelRule
{
    /// <summary>The travel time a provider may claim each way: 30 minutes in MM1-3, 60 in MM4-5, no cap in MM6-7 (2025-26 rules, NDIS-CODES 7). National with no level given is read as MM1-3, the stricter. A shift with no location (a hand-made one) takes the strict cap.</summary>
    public static int? CapMinutes(PlanLocation? location) => location is null ? 30 : location.Zone switch
    {
        PriceZone.National => location.Mm is 4 or 5 ? 60 : 30,
        _ => null,
    };

    /// <summary>A participant's MM level as a location for the cap, for a shift not made from an agreement block: null (unknown) stays null, which caps at 30. MM6 is Remote and MM7 Very Remote, as on the price zones.</summary>
    public static PlanLocation? LocationOf(int? mm) => mm is null ? null
        : new PlanLocation { Zone = mm >= 7 ? PriceZone.VeryRemote : mm == 6 ? PriceZone.Remote : PriceZone.National, Mm = mm };

    /// <summary>The kilometre dollars of a shift: the summed legs at the rate, shared by the participants, floored to the cent.</summary>
    public static decimal KmDollars(decimal totalKm, decimal ratePerKm, int sharing) => PlanMoney.FloorToCent(totalKm * ratePerKm / Math.Max(1, sharing));
}
