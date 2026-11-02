using System.Globalization;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Domain.Billing.Services;

/// <summary>One leg of a shift's travel: whole minutes and kilometres, as the worker recorded them or the agreement forecasts them.</summary>
public sealed record TravelLeg(int Minutes, decimal Km)
{
    public bool IsEmpty => Minutes <= 0 && Km <= 0m;
}

/// <summary>
/// The travel a shift is claimed with (travel plan D5): the two legs, where the shift is (null for a hand-made shift, which takes the strict 30-minute cap), how many participants share the trip,
/// whether the agreement block lets the organisation claim travel at all, and whether it includes the trip back (the return box, D7). A hand-made shift passes both as true.
/// </summary>
public sealed record ShiftTravelInput(TravelLeg Pre, TravelLeg Post, PlanLocation? Location, int Sharing, bool BlockAllows, bool ReturnAllowed);

/// <summary>
/// Adds a shift's provider travel to its priced lines (travel plan D2, D2i, D7), as ONE rule for the claim, the budget ledger and the roster estimate: one time line (claim type TRAN) on the shift's
/// own hourly item, and one kilometre line on the _799_ "each" item. Each leg is capped first, then the legs are summed and shared; a rule that cannot apply says why in the outcome's caveat and
/// adds nothing (the shift is still claimed, flagged). Every line's TotalAmount is its Hours, 2 dp as the file carries them, times its unit price, as every claim line is.
/// </summary>
public static class ShiftTravelPricer
{
    /// <summary>The catalogue item numbers of provider travel kilometres read <c>04_799_0125_6_1</c>: the category, then this, then the group.</summary>
    public const string KmItemMarker = "_799_";

    public static ShiftPriceOutcome Apply(ShiftPriceOutcome outcome, ShiftTravelInput? input, DateOnly serviceDate, string state, decimal kmRate,
        IReadOnlyList<SupportCatalogueItem> basisRows, IReadOnlyList<SupportCatalogueItem> travelRows)
    {
        if (input is null || !outcome.IsPriced || (input.Pre.IsEmpty && input.Post.IsEmpty)) return outcome;

        var notes = new List<string>();
        ShiftPriceOutcome Done(IEnumerable<ShiftPrice>? added = null) =>
            outcome with { Lines = added is null ? outcome.Lines : outcome.Lines.Concat(added).ToList(), Caveat = Join(outcome.Caveat, notes) };

        if (!input.BlockAllows)
        {
            notes.Add("Travel not claimed: the agreement doesn't include provider travel.");
            return Done();
        }

        var hour = outcome.Lines.FirstOrDefault(l => l.CatalogueItem.Unit == "H" && l.ClaimType == ClaimType.Standard && !l.IsTravelKm);
        if (hour is null)
        {
            notes.Add("Travel not claimed: there is no support hour to claim it against.");
            return Done();
        }

        // The travel is dated the shift's service date and priced at the first support hour's item, from the row valid on THAT date.
        var rows = EffectiveCatalogueResolver.NewestVersion(basisRows.Where(r => r.ItemNumber == hour.CatalogueItem.ItemNumber && EffectiveCatalogueResolver.IsValidOn(r, serviceDate)).ToList());
        var basis = rows.Count == 1 ? rows[0] : hour.CatalogueItem;
        if (basis.ProviderTravel != CatalogueClaimFlag.Yes)
        {
            notes.Add($"Travel not claimed: {basis.ItemNumber} does not allow provider travel.");
            return Done();
        }

        var pre = input.Pre;
        var post = input.Post;
        if (!input.ReturnAllowed && !post.IsEmpty)
        {
            notes.Add("Travel after the shift not claimed: the agreement doesn't include the trip back.");
            post = new TravelLeg(0, 0m);
        }

        var cap = ProviderTravelRule.CapMinutes(input.Location);
        var preMinutes = Capped(pre.Minutes, cap, "before", notes);
        var postMinutes = Capped(post.Minutes, cap, "after", notes);
        var sharing = Math.Max(1, input.Sharing);
        var price = CatalogueStatePrice.For(basis, state);
        var added = new List<ShiftPrice>();

        var minutes = (preMinutes + postMinutes) / sharing;   // whole minutes: the share is floored
        if (minutes > 0 && price > 0m)
        {
            var hours = ClaimPricing.LineHours(minutes / 60m);
            added.Add(new ShiftPrice(basis, hour.DayType, hours, price, ClaimPricing.LineAmount(hours, price), serviceDate, ClaimType.ProviderTravel));
        }

        var km = pre.Km + post.Km;
        if (km > 0m)
        {
            var prefix = basis.ItemNumber.Split('_')[0];
            var kmRows = EffectiveCatalogueResolver.NewestVersion(travelRows.Where(r => r.Unit == "E" && r.ItemNumber.StartsWith($"{prefix}{KmItemMarker}", StringComparison.Ordinal)
                && r.RegistrationGroup == basis.RegistrationGroup && EffectiveCatalogueResolver.IsValidOn(r, serviceDate)).ToList());
            if (kmRows.Count != 1)
                notes.Add($"Travel kilometres not claimed: no {prefix}{KmItemMarker.TrimEnd('_')} item is in the catalogue for {serviceDate.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)}.");
            else
            {
                var kmPrice = CatalogueStatePrice.For(kmRows[0], state);
                var dollars = ProviderTravelRule.KmDollars(km, kmRate, sharing);
                if (kmPrice > 0m && dollars > 0m)
                {
                    var quantity = ClaimPricing.LineHours(Math.Floor(dollars / kmPrice * 100m) / 100m);
                    added.Add(new ShiftPrice(kmRows[0], hour.DayType, quantity, kmPrice, ClaimPricing.LineAmount(quantity, kmPrice), serviceDate));
                }
            }
        }

        return Done(added);
    }

    private static int Capped(int minutes, int? cap, string side, List<string> notes)
    {
        if (minutes <= 0) return 0;
        if (cap is not { } limit || minutes <= limit) return minutes;
        notes.Add($"Travel {side} the shift capped at {limit} minutes: {minutes} minutes were recorded.");
        return limit;
    }

    private static string? Join(string? existing, List<string> notes) =>
        notes.Count == 0 ? existing : string.Join(" ", new[] { existing }.Concat(notes).Where(s => !string.IsNullOrEmpty(s)));
}
