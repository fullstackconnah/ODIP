using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// The support type a pattern or shift is claimed under is a catalogue group code. One check for the four places that save one (shift create and update, pattern create and update), so a code
/// the claim could not price is refused when it is typed, not when the shift is claimed. Null is community access and is never refused.
/// </summary>
public static class SupportTypeCheck
{
    public const string UnknownMessage = "Choose a support type from the catalogue.";
    public const string AmbiguousMessage = "This support type has more than one hourly rate for some days. Choose a more specific support type.";

    /// <summary>Trimmed; blank is null (community access).</summary>
    public static string? Tidy(string? raw) => string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();

    /// <summary>The 400 sentence for <paramref name="code"/> on <paramref name="onDate"/>, or null when it can be saved.</summary>
    public static async Task<string?> RefusalAsync(OdipDbContext db, string? code, DateOnly onDate, CancellationToken ct)
    {
        if (code is null) return null;
        var group = await db.SupportActivityGroups.AsNoTracking().FirstOrDefaultAsync(g => g.GroupCode == code, ct);
        if (group is null) return UnknownMessage;

        var rows = await db.SupportCatalogueItems.AsNoTracking()
            .Where(i => i.ActivityGroupId == group.Id && i.Unit == "H").Where(EffectiveCatalogueResolver.ValidOn(onDate))
            .ToListAsync(ct);
        if (rows.Count == 0)
            return string.Create(CultureInfo.InvariantCulture, $"{group.DisplayName} has no hourly rate on {onDate:d MMM yyyy}. Choose another support type, or import the catalogue for that date.");
        return IsAmbiguous(rows) ? AmbiguousMessage : null;
    }

    /// <summary>
    /// A group is ambiguous when any day type has more than one standard hourly row valid on the date: the claim would have to guess which one the coordinator meant (the catalogue's
    /// GRP_CENTRE_CAPITAL and GRP_OTHER hold several). <paramref name="validHourlyRows"/> are rows already valid on the date.
    /// </summary>
    public static bool IsAmbiguous(IEnumerable<SupportCatalogueItem> validHourlyRows) =>
        validHourlyRows.Where(i => !i.IsIntensive).GroupBy(i => i.DayType).Any(g => g.Count() > 1);

    /// <summary>The same test for one shift: more than one valid hourly row would price this day type for this participant's intensity (the rows <see cref="EffectiveCatalogueResolver.FindForDay"/> chooses among).</summary>
    public static bool IsAmbiguousForDay(IEnumerable<SupportCatalogueItem> groupRows, ClaimDayType dayType, bool isIntensive, DateOnly date)
    {
        var valid = groupRows.Where(i => i.Unit == "H" && i.DayType == dayType && EffectiveCatalogueResolver.IsValidOn(i, date)).ToList();
        var exact = valid.Where(i => i.IsIntensive == isIntensive).ToList();
        return (exact.Count > 0 ? exact : valid).Count > 1;
    }
}
