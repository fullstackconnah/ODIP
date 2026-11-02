using Odip.Domain.Enums;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Whether an item may be claimed as a short-notice cancellation: its catalogue flag says Yes, or the catalogue holds its "_CA" twin (the NDIA's own cancellation item).
/// One rule for the claim engine and the send check, so a claim the screen offers is a claim the send check lets through.
/// </summary>
public static class ShortNoticeCancellationRule
{
    public static bool Allows(SupportCatalogueItem item, SupportCatalogueItem? cancellationTwin) =>
        item.ShortNoticeCancellation == CatalogueClaimFlag.Yes || cancellationTwin is not null;

    public static string NotAllowedSentence(string itemCode) => $"{itemCode} can't be claimed as a short-notice cancellation in the price guide. Check the short-notice setting for this item in the price guide.";
}
