using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compatibility_exceptions = new(
    new Item("2026-11-compatibility-exceptions", "Compatibility is now a short list",
        "The Compatibility page lists only the pairings that matter: Preferred, Backup, Emergency and No. Search for a person, filter to No, or use Mark as No to add one. Change a participant's tiers on their Staff preferences card.",
        Staff, false));
}
