using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compat_card = new(
    new Item("2026-11-compat-card", "Staff preferences on the participant now use the board",
        "The Staff preferences card on a participant's Rostering tab now shows the same Preferred, Backup, Emergency and No board as the Compatibility page. Add, move and remove staff right there; the card, the page and the shift panel always agree. To mark someone No, use Open on the Compatibility page.",
        Staff, false));
}
