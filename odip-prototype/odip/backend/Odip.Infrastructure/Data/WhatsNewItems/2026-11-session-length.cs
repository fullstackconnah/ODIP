using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_session_length = new(
    new Item("2026-11-session-length", "Choose how long people stay signed in",
        "Choose how long people stay signed in, in Settings, under Security.",
        WhatsNewAudience.Admin, false));
}
