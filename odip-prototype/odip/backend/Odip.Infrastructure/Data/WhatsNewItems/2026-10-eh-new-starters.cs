using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_eh_new_starters =
    new(new Item("2026-10-eh-new-starters", "New starters from Employment Hero",
        "Staff joining through Employment Hero with a future start date appear in Bunya Support straight away, so you can set them up. Their start date shows on their staff page, and the roster won't let you put them on a shift or trip before it.",
        Staff, false));
}
