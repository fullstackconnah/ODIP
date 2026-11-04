using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_auto_roster_reach = new(
    new Item("2026-11-auto-roster-reach", "Choose how far auto-roster reaches",
        "In Settings, under Rostering rules, an admin can set how far down a participant's compatibility list auto-roster places staff without a second look. The default is anyone not marked No, as before. When it picks someone past that point, Bunya Support still proposes them but marks the shift \"Needs a look\".",
        Staff, false));
}
