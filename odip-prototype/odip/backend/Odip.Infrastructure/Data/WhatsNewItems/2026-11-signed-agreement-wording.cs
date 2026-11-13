using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_signed_agreement_wording = new(
    new Item("2026-11-signed-agreement-wording", "Signed agreements keep their wording",
        "A signed service agreement now always prints the responsibilities and complaints wording it was signed with, even after you change your organisation's wording in Settings.",
        WhatsNewAudience.Admin, false));
}
