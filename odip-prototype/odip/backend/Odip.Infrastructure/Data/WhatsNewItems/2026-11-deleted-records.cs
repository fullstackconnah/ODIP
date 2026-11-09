using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_deleted_records = new(
    new Item("2026-11-deleted-records", "See what was deleted, and by whom",
        "Settings › Data › Deleted records lists shifts, availability, risk entries and other records deleted in your organisation: who deleted each one, when, and what it held. It starts from this update, so earlier deletions aren't listed.",
        WhatsNewAudience.Admin, false));
}
