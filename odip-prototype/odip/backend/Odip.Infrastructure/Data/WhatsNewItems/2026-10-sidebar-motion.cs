using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_sidebar_motion = new(25,
    new Item("2026-10-sidebar-motion", "The side menu folds away more smoothly",
        "When you collapse or expand the side menu, the labels fade and the icons glide into place instead of jumping.",
        WhatsNewAudience.All, false));
}
